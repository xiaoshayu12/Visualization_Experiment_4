/**
 * ============================================================
 *  全球海洋-大气耦合时空可视分析系统 — 数据适配工具
 *  协同代码 | Week 5
 *
 *  功能：
 *    1. 统一数据加载入口
 *    2. 颜色映射（Okabe-Ito 色盲友好）
 *    3. 各图表类型的数据格式转换
 *    4. 数据采样与过滤工具
 *
 *  使用方式：
 *    在其他 HTML 中引入：
 *    <script src="../协同代码/data-adapter.js"></script>
 *    然后调用：Adapter.load().then(data => { ... });
 *
 *  数据路径说明：
 *    独立导出版中，本文件位于 assets/，
 *    数据集位于 data/，页面可直接从本目录运行。
 * ============================================================
 */

const Adapter = (function () {
  "use strict";

  // ── Okabe-Ito 色盲友好配色（与 type.css 一致）───────────────
  const REGION_COLORS = {
    "太平洋":   "#0072B2",
    "大西洋":   "#009E73",
    "印度洋":   "#F0E442",
    "北极海域": "#56B4E9",
    "南极海域": "#CC79A7",
    "赤道区域": "#E69F00"
  };

  const REGIONS_ORDER = [
    "太平洋", "大西洋", "印度洋", "北极海域", "南极海域", "赤道区域"
  ];

  // ── 数值字段列表 ─────────────────────────────────────────────
  const NUMERIC_FIELDS = [
    "sst", "salinity", "wind_speed", "wind_dir", "pressure",
    "precipitation", "co2", "wave_height", "humidity",
    "current_speed", "chlorophyll"
  ];

  // ── 字段中文标签映射 ────────────────────────────────────────
  const FIELD_LABELS = {
    sst: "海表温度 SST (°C)",
    salinity: "盐度 Salinity (PSU)",
    wind_speed: "风速 Wind Speed (km/h)",
    wind_dir: "风向 Wind Dir (°)",
    pressure: "海平面气压 Pressure (hPa)",
    precipitation: "降水量 Precipitation (mm)",
    co2: "CO₂浓度 (ppm)",
    wave_height: "浪高 Wave Height (m)",
    humidity: "大气湿度 Humidity (%)",
    current_speed: "海流速度 Current (m/s)",
    chlorophyll: "叶绿素 Chlorophyll (mg/m³)",
    longitude: "经度 (°E)",
    latitude: "纬度 (°N)"
  };

  // ── 缓存数据 ─────────────────────────────────────────────────
  let _cache = null;

  /**
   * 加载数据集（带缓存）。
   * @param {string} [path] - 数据集路径，默认从 HTML 页面向上两级
   * @returns {Promise<Array>}
   */
  function load(path) {
    if (_cache) return Promise.resolve(_cache);
    if (Array.isArray(window.MEMBER4_RAW_DATA)) {
      _cache = window.MEMBER4_RAW_DATA;
      return Promise.resolve(_cache);
    }
    // 优先从统一 Flask API 获取数据
    var apiBase = (window.CONFIG && window.CONFIG.API_BASE) || '/api';
    return fetch(apiBase + '/data/filter?page_size=0')
      .then(function (r) {
        if (!r.ok) throw new Error('API returned ' + r.status);
        return r.json();
      })
      .then(function (resp) {
        if (resp && resp.data) {
          _cache = resp.data;
          return _cache;
        }
        throw new Error('Unexpected API response format');
      })
      .catch(function () {
        // API 不可用时回退到原始 JSON
        var apiBase = (window.CONFIG && window.CONFIG.API_BASE) || '/api';
        return d3.json(apiBase + '/data/raw').then(function (data) {
          _cache = data;
          return data;
        });
      });
  }

  /**
   * 清除缓存，强制重新加载。
   */
  function clearCache() {
    _cache = null;
  }

  /**
   * 按比例采样。
   */
  function sample(data, maxCount) {
    if (data.length <= maxCount) return data;
    const step = Math.max(1, Math.floor(data.length / maxCount));
    return data.filter((_, i) => i % step === 0);
  }

  /**
   * 获取海域颜色。
   */
  function getColor(region) {
    return REGION_COLORS[region] || "#999999";
  }

  /**
   * 获取所有海域列表（有序）。
   */
  function getRegions() {
    return [...REGIONS_ORDER];
  }

  /**
   * 转为饼图格式：海域 → 记录数。
   */
  function toPieData(data) {
    const counts = d3.rollup(data, v => v.length, d => d.region);
    return Array.from(counts, ([region, count]) => ({
      category: region,
      value: count,
      color: getColor(region)
    })).sort((a, b) => b.value - a.value);
  }

  /**
   * 转为气泡图 / 散点图格式。
   */
  function toPointData(data, xKey, yKey, sizeKey) {
    return data
      .filter(d =>
        d[xKey] != null && isFinite(d[xKey]) &&
        d[yKey] != null && isFinite(d[yKey]) &&
        (!sizeKey || (d[sizeKey] != null && isFinite(d[sizeKey])))
      )
      .map(d => ({
        id: d.id,
        x: d[xKey],
        y: d[yKey],
        size: sizeKey ? d[sizeKey] : null,
        region: d.region,
        time: d.time,
        color: getColor(d.region)
      }));
  }

  /**
   * 转为雷达图格式：每个海域的各维度均值（归一化 0-100）。
   */
  function toRadarData(data, dimensions) {
    const dims = dimensions || ["sst", "salinity", "wind_speed", "pressure", "humidity", "current_speed"];

    // 计算每个海域每个维度的均值
    const rawMeans = {};
    const globalMin = {};
    const globalMax = {};

    // 初始化
    dims.forEach(f => { globalMin[f] = Infinity; globalMax[f] = -Infinity; });

    REGIONS_ORDER.forEach(region => {
      const subset = data.filter(d => d.region === region);
      rawMeans[region] = {};
      dims.forEach(f => {
        const vals = subset.map(d => d[f]).filter(v => v != null);
        if (vals.length) {
          const m = vals.reduce((s, v) => s + v, 0) / vals.length;
          rawMeans[region][f] = m;
          if (m < globalMin[f]) globalMin[f] = m;
          if (m > globalMax[f]) globalMax[f] = m;
        }
      });
    });

    // 归一化到 0-100
    const result = [];
    REGIONS_ORDER.forEach(region => {
      const entry = { region: region, color: getColor(region) };
      dims.forEach(f => {
        const rng = globalMax[f] - globalMin[f];
        entry[f] = rng > 0 ? (rawMeans[region][f] - globalMin[f]) / rng * 100 : 50;
        entry[f + "_raw"] = rawMeans[region][f];
      });
      result.push(entry);
    });

    return {
      regions: result,
      dimensions: dims.map(f => ({ key: f, label: FIELD_LABELS[f] || f })),
      globalMin,
      globalMax
    };
  }

  /**
   * 转为桑基图格式：海域 → SST 温度区间 → 记录数流向。
   */
  function toSankeyData(data) {
    const regions = REGIONS_ORDER;
    // SST 温度区间
    const tempBins = [
      { name: "冷水 (<5°C)", min: -99, max: 5 },
      { name: "凉水 (5~15°C)", min: 5, max: 15 },
      { name: "温水 (15~25°C)", min: 15, max: 25 },
      { name: "暖水 (>25°C)", min: 25, max: 99 }
    ];

    const nodes = [
      ...regions.map(r => ({ name: r, group: "region" })),
      ...tempBins.map(b => ({ name: b.name, group: "temp" }))
    ];

    const nameToIdx = {};
    nodes.forEach((n, i) => { nameToIdx[n.name] = i; });

    const links = [];
    regions.forEach(region => {
      const subset = data.filter(d => d.region === region);
      tempBins.forEach(bin => {
        const count = subset.filter(d =>
          d.sst != null && d.sst >= bin.min && d.sst < bin.max
        ).length;
        if (count > 0) {
          links.push({
            source: nameToIdx[region],
            target: nameToIdx[bin.name],
            value: count,
            sourceName: region,
            targetName: bin.name
          });
        }
      });
    });

    return { nodes, links };
  }

  /**
   * 计算基本统计量（min, max, mean, median, std）。
   */
  function stats(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((s, v) => s + v, 0) / n;
    const median = n % 2 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    return {
      min: sorted[0],
      max: sorted[n - 1],
      mean: mean,
      median: median,
      std: Math.sqrt(variance),
      count: n
    };
  }

  // ── 公开 API ────────────────────────────────────────────────
  return {
    load,
    clearCache,
    sample,
    getColor,
    getRegions,
    toPieData,
    toPointData,
    toRadarData,
    toSankeyData,
    stats,
    COLORS: REGION_COLORS,
    REGIONS: REGIONS_ORDER,
    NUMERIC_FIELDS,
    FIELD_LABELS
  };
})();
