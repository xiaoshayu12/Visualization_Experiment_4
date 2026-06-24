/* =====================================================================
 *  全球海洋热力时空分布分析 —— 多图联动控制器 (成员A)
 *  四图：① 折线(SST距平) ② 地理热力(主图) ③ 柱状(OHC) ④ 散点(SST距平vs风应力)
 *  联动：时间轴→四图同步 / 地图点击→折线聚焦+详情 / 折线刷选→柱状&散点 / 散点框选→地图高亮
 * ===================================================================== */
"use strict";

const API = {
  meta: () => fetch("/api/meta").then(r => r.json()),
  filter: (time) =>
    fetch(`/api/data/filter?time=${encodeURIComponent(time)}&page_size=0`).then(r => r.json()),
  point: (id) => fetch(`/api/data/point?id=${id}`).then(r => r.json()),
};

const REGION_COLORS = (window.CONFIG && window.CONFIG.REGION_COLORS) || {
  "太平洋": "#0072B2", "大西洋": "#009E73", "印度洋": "#F0E442",
  "北极海域": "#56B4E9", "南极海域": "#CC79A7", "赤道区域": "#E69F00",
};

// ----------------------------------------------------------- 全局状态
const S = {
  meta: null,
  months: [],
  winStart: 0, winEnd: 0,      // 时间窗索引(指向 months)
  records: [],                 // 当前时间窗的原始记录
  selectedRegion: null,        // 地图点击聚焦的海域
  brushMonths: null,           // 折线刷选得到的 [m1,m2] 子区间(YYYY-MM)
  highlightIds: new Set(),     // 散点框选高亮的站点 id
  playTimer: null,
};

let lineChart, geoChart, barChart, scatterChart;

// ----------------------------------------------------------- 工具
const $ = (id) => document.getElementById(id);
const setStatus = (t) => ($("statusBar").textContent = t);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function monthsInWindow() {
  return S.months.slice(S.winStart, S.winEnd + 1);
}
// 当前生效的"时间子集"：优先折线刷选区间，否则整个时间窗
function activeMonths() {
  if (!S.brushMonths) return new Set(monthsInWindow());
  const [a, b] = S.brushMonths;
  return new Set(monthsInWindow().filter(m => m >= a && m <= b));
}

// 按 (区域→月→均值) 聚合
function aggByRegionMonth(records, metric) {
  const acc = {};
  records.forEach(r => {
    (acc[r.region] ??= {});
    (acc[r.region][r.month] ??= []).push(r[metric]);
  });
  const out = {};
  for (const reg in acc) {
    out[reg] = {};
    for (const m in acc[reg]) out[reg][m] = mean(acc[reg][m]);
  }
  return out;
}

// ======================================================================
//  初始化
// ======================================================================
async function init() {
  setStatus("加载元信息…");
  const meta = (await API.meta()).data;
  S.meta = meta;
  S.months = meta.months;
  S.winStart = 0;
  S.winEnd = S.months.length - 1;

  // 注册世界地图
  const world = await fetch("/static/lib/world.json").then(r => r.json());
  echarts.registerMap("world", world);

  // 初始化图表实例
  lineChart = echarts.init($("lineChart"));
  geoChart = echarts.init($("geoChart"));
  barChart = echarts.init($("barChart"));
  scatterChart = echarts.init($("scatterChart"));
  window.addEventListener("resize", () => {
    [lineChart, geoChart, barChart, scatterChart].forEach(c => c.resize());
  });

  initTimeline();
  bindLinkage();
  await loadWindow();
}

// ----------------------------------------------------------- 时间轴
function initTimeline() {
  const rs = $("rangeStart"), re = $("rangeEnd");
  const max = S.months.length - 1;
  [rs, re].forEach(el => { el.min = 0; el.max = max; });
  rs.value = 0; re.value = max;
  syncTimelineLabels();

  const onInput = (which) => {
    let a = +rs.value, b = +re.value;
    if (a > b) { if (which === "s") b = a; else a = b; rs.value = a; re.value = b; }
    S.winStart = a; S.winEnd = b;
    S.brushMonths = null;             // 改变总窗口时重置刷选
    syncTimelineLabels();
    debouncedLoad();
    setActivePreset(null);
  };
  rs.addEventListener("input", () => onInput("s"));
  re.addEventListener("input", () => onInput("e"));

  // 预设
  document.querySelectorAll(".presets button[data-preset]").forEach(btn => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset, btn));
  });
  $("playBtn").addEventListener("click", togglePlay);
}

function syncTimelineLabels() {
  $("tlStart").textContent = S.months[S.winStart];
  $("tlEnd").textContent = S.months[S.winEnd];
}

function setActivePreset(el) {
  document.querySelectorAll(".presets button[data-preset]").forEach(b => b.classList.remove("active"));
  if (el) el.classList.add("active");
}

function applyPreset(preset, el) {
  const idx = (m) => S.months.indexOf(m);
  const last = S.months.length - 1;
  let a = 0, b = last;
  if (preset === "2020") { a = idx("2020-01"); b = idx("2020-12"); }
  else if (preset === "2021") { a = idx("2021-01"); b = idx("2021-12"); }
  else if (preset === "2022") { a = idx("2022-01"); b = idx("2022-12"); }
  else if (preset === "enso") { a = idx("2021-07"); b = idx("2021-12"); } // 拉尼娜冷事件窗口
  if (a < 0) a = 0; if (b < 0) b = last;
  S.winStart = a; S.winEnd = b; S.brushMonths = null;
  $("rangeStart").value = a; $("rangeEnd").value = b;
  syncTimelineLabels(); setActivePreset(el); loadWindow();
}

let _loadTimer = null;
function debouncedLoad() {
  clearTimeout(_loadTimer);
  _loadTimer = setTimeout(loadWindow, 220);
}

function togglePlay() {
  const btn = $("playBtn");
  if (S.playTimer) { clearInterval(S.playTimer); S.playTimer = null; btn.textContent = "▶ 播放"; return; }
  btn.textContent = "⏸ 暂停";
  const span = Math.max(2, S.winEnd - S.winStart);  // 维持窗宽滚动
  S.playTimer = setInterval(() => {
    if (S.winEnd >= S.months.length - 1) { S.winStart = 0; }
    else { S.winStart += 1; }
    S.winEnd = Math.min(S.months.length - 1, S.winStart + span);
    $("rangeStart").value = S.winStart; $("rangeEnd").value = S.winEnd;
    S.brushMonths = null; syncTimelineLabels(); loadWindow();
  }, 900);
}

// ----------------------------------------------------------- 拉取数据
async function loadWindow() {
  const time = `${S.months[S.winStart]},${S.months[S.winEnd]}`;
  setStatus("查询中…");
  const t0 = performance.now();
  const resp = await API.filter(time);
  S.records = resp.data;
  S.highlightIds.clear();
  renderAll();
  setStatus(`✓ ${resp.total_matched} 条 · 后端 ${resp.elapsed_ms}ms · 渲染 ${(performance.now() - t0).toFixed(0)}ms`);
}

function renderAll() {
  renderLine();
  renderGeo();
  renderBar();
  renderScatter();
}

// ======================================================================
//  ① 折线图：各海域月均 SST 距平
// ======================================================================
function renderLine() {
  const months = monthsInWindow();
  const agg = aggByRegionMonth(S.records, "sst_anomaly");
  const regions = S.meta.regions;

  const series = regions.map(reg => {
    const dimmed = S.selectedRegion && S.selectedRegion !== reg;
    return {
      name: reg, type: "line", smooth: true, showSymbol: false,
      emphasis: { focus: "series" },
      lineStyle: { width: S.selectedRegion === reg ? 3.5 : 1.6, opacity: dimmed ? 0.18 : 1 },
      itemStyle: { color: REGION_COLORS[reg], opacity: dimmed ? 0.18 : 1 },
      data: months.map(m => (agg[reg]?.[m] != null ? +agg[reg][m].toFixed(3) : null)),
    };
  });

  lineChart.setOption({
    tooltip: { trigger: "axis", valueFormatter: v => (v == null ? "-" : v + " ℃") },
    legend: { data: regions, textStyle: { color: "#7a8fa6" }, top: 4, type: "scroll" },
    grid: { left: 46, right: 16, top: 38, bottom: 52 },
    brush: { toolbox: [], xAxisIndex: 0, brushType: "lineX",
             brushStyle: { borderColor: "#0072B2", color: "rgba(0,114,178,.12)" } },
    toolbox: { show: false },
    xAxis: { type: "category", data: months, axisLabel: { color: "#7a8fa6", fontSize: 10 },
             axisLine: { lineStyle: { color: "#e4e8ec" } } },
    yAxis: { type: "value", name: "SST距平 ℃", nameTextStyle: { color: "#7a8fa6" },
             axisLabel: { color: "#7a8fa6" }, splitLine: { lineStyle: { color: "#eef1f5" } } },
    series,
  }, { replaceMerge: ["series"] });

  // 标题提示：开启刷选
  lineChart.dispatchAction({ type: "takeGlobalCursor", key: "brush",
    brushOption: { brushType: "lineX", brushMode: "single" } });
}

// ======================================================================
//  ② 地理热力图（主图）
// ======================================================================
function renderGeo() {
  const data = S.records.map(r => ({
    value: [r.lon, r.lat, r.sst_anomaly], id: r.id, region: r.region,
  }));
  const hi = S.records
    .filter(r => S.highlightIds.has(r.id))
    .map(r => ({ value: [r.lon, r.lat, r.sst_anomaly], id: r.id }));

  geoChart.setOption({
    tooltip: {
      trigger: "item",
      formatter: (p) => {
        const v = p.data?.value; if (!v) return "";
        return `站点 #${p.data.id}<br/>海域：${p.data.region}<br/>经纬：${v[0].toFixed(2)}, ${v[1].toFixed(2)}<br/>SST距平：<b>${v[2]} ℃</b>`;
      },
    },
    visualMap: {
      min: -3, max: 3, dimension: 2, seriesIndex: 0, calculable: true, left: 10, bottom: 16,
      text: ["暖 +", "冷 −"], textStyle: { color: "#7a8fa6" },
      inRange: { color: ["#2166ac", "#92c5de", "#ffffbf", "#f4a582", "#b2182b"] },
    },
    geo: {
      map: "world", roam: true, silent: true,
      itemStyle: { areaColor: "#eef1f5", borderColor: "#d0d8e0" },
      emphasis: { disabled: true },
      scaleLimit: { min: 1, max: 8 },
    },
    series: [
      {
        name: "SST距平", type: "scatter", coordinateSystem: "geo",
        symbolSize: 7, data,
        itemStyle: { opacity: 0.85, borderColor: "rgba(0,0,0,.2)", borderWidth: .5 },
      },
      {
        name: "高亮", type: "effectScatter", coordinateSystem: "geo",
        symbolSize: 13, data: hi, zlevel: 2,
        rippleEffect: { scale: 3, brushType: "stroke" },
        itemStyle: { color: "#0072B2", shadowBlur: 8, shadowColor: "#0072B2" },
      },
    ],
  }, { replaceMerge: ["series"] });
}

// ======================================================================
//  ③ 柱状图：各海域月均 OHC（受时间窗 + 折线刷选影响）
// ======================================================================
function renderBar() {
  const am = activeMonths();
  const subset = S.records.filter(r => am.has(r.month));
  const regions = S.meta.regions;
  const vals = regions.map(reg => {
    const rs = subset.filter(r => r.region === reg).map(r => r.ohc);
    return +mean(rs).toFixed(2);
  });

  barChart.setOption({
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" },
               valueFormatter: v => v + " GJ/m²" },
    grid: { left: 50, right: 16, top: 24, bottom: 60 },
    xAxis: { type: "category", data: regions,
             axisLabel: { color: "#5a6d80", interval: 0, rotate: 24, fontSize: 11 },
             axisLine: { lineStyle: { color: "#e4e8ec" } } },
    yAxis: { type: "value", name: "OHC GJ/m²", nameTextStyle: { color: "#7a8fa6" },
             axisLabel: { color: "#7a8fa6" }, splitLine: { lineStyle: { color: "#eef1f5" } } },
    series: [{
      type: "bar", data: vals.map((v, i) => ({
        value: v,
        itemStyle: {
          color: REGION_COLORS[regions[i]],
          opacity: S.selectedRegion && S.selectedRegion !== regions[i] ? 0.3 : 0.92,
          borderRadius: [4, 4, 0, 0],
        },
      })),
      barWidth: "55%",
      label: { show: true, position: "top", color: "#5a6d80", fontSize: 10 },
    }],
  });
}

// ======================================================================
//  ④ 散点图：SST 距平 vs 风应力（框选→地图高亮）
// ======================================================================
function renderScatter() {
  const am = activeMonths();
  const regions = S.meta.regions;
  const series = regions.map(reg => {
    const dimmed = S.selectedRegion && S.selectedRegion !== reg;
    const pts = S.records
      .filter(r => r.region === reg && am.has(r.month))
      .map(r => ({ value: [r.sst_anomaly, r.wind_stress], id: r.id }));
    return {
      name: reg, type: "scatter", symbolSize: 7, data: pts,
      itemStyle: { color: REGION_COLORS[reg], opacity: dimmed ? 0.12 : 0.7 },
      emphasis: { focus: "series" },
    };
  });

  scatterChart.setOption({
    tooltip: {
      trigger: "item",
      formatter: (p) => `#${p.data.id} · ${p.seriesName}<br/>SST距平：${p.value[0]} ℃<br/>风应力：${p.value[1]} N/m²`,
    },
    legend: { data: regions, textStyle: { color: "#7a8fa6" }, top: 2, type: "scroll" },
    grid: { left: 52, right: 18, top: 34, bottom: 42 },
    brush: { toolbox: [], xAxisIndex: 0, yAxisIndex: 0, brushType: "rect",
             brushStyle: { borderColor: "#CC79A7", color: "rgba(204,121,167,.1)" } },
    toolbox: { show: false },
    xAxis: { type: "value", name: "SST距平 ℃", nameLocation: "middle", nameGap: 24,
             nameTextStyle: { color: "#7a8fa6" }, axisLabel: { color: "#7a8fa6" },
             splitLine: { lineStyle: { color: "#eef1f5" } } },
    yAxis: { type: "value", name: "风应力 N/m²", nameTextStyle: { color: "#7a8fa6" },
             axisLabel: { color: "#7a8fa6" }, splitLine: { lineStyle: { color: "#eef1f5" } } },
    series,
  }, { replaceMerge: ["series"] });

  scatterChart.dispatchAction({ type: "takeGlobalCursor", key: "brush",
    brushOption: { brushType: "rect", brushMode: "single" } });
}

// ======================================================================
//  联动事件绑定
// ======================================================================
function bindLinkage() {
  // 地图点击站点 → 详情面板(低级查询) + 聚焦该海域(折线/柱状/散点)
  geoChart.on("click", (p) => {
    if (!p.data || p.data.id == null) return;
    S.selectedRegion = p.data.region;
    renderLine(); renderBar(); renderScatter();
    showDetail(p.data.id);
  });

  // 折线刷选时间段 → 同步柱状 & 散点
  lineChart.on("brushEnd", (params) => {
    const area = params.areas?.[0];
    const months = monthsInWindow();
    if (!area || !area.coordRange) { S.brushMonths = null; }
    else {
      let [i0, i1] = area.coordRange;
      i0 = Math.max(0, Math.round(i0)); i1 = Math.min(months.length - 1, Math.round(i1));
      S.brushMonths = [months[i0], months[i1]];
    }
    renderBar(); renderScatter();
    setStatus(S.brushMonths ? `刷选时段：${S.brushMonths[0]} ~ ${S.brushMonths[1]}` : "已清除刷选");
  });

  // 散点框选 → 地图对应站点高亮
  scatterChart.on("brushselected", (params) => {
    const sel = params.batch?.[0]?.selected || [];
    const ids = new Set();
    sel.forEach(s => {
      const opt = scatterChart.getOption().series[s.seriesIndex];
      s.dataIndex.forEach(di => { const d = opt.data[di]; if (d?.id != null) ids.add(d.id); });
    });
    S.highlightIds = ids;
    renderGeo();
    setStatus(ids.size ? `散点框选 ${ids.size} 站点 → 地图高亮` : "已清除框选");
  });

  // 双击折线空白处清除聚焦
  lineChart.getZr().on("dblclick", () => {
    S.selectedRegion = null; S.brushMonths = null;
    lineChart.dispatchAction({ type: "brush", areas: [] });
    renderAll(); setStatus("已重置聚焦/刷选");
  });

  $("detailClose").addEventListener("click", () => $("detailPanel").classList.add("hidden"));
}

// ----------------------------------------------------------- 单点详情(低级查询)
async function showDetail(id) {
  const resp = await API.point(id);
  if (!resp.ok) return;
  const d = resp.data, c = resp.climatology;
  const devClass = c.sst_deviation >= 0 ? "dev-pos" : "dev-neg";
  const devSign = c.sst_deviation >= 0 ? "+" : "";
  $("detailBody").innerHTML = `
    <div class="kv"><span>站点 ID</span><span>#${d.id}</span></div>
    <div class="kv"><span>时间</span><span>${d.time}</span></div>
    <div class="kv"><span>海域</span><span>${d.region}</span></div>
    <div class="kv"><span>经度 / 纬度</span><span>${d.lon}, ${d.lat}</span></div>
    <div class="section-t">核心指标</div>
    <div class="kv"><span>SST 实测</span><span>${d.sst} ℃</span></div>
    <div class="kv"><span>SST 距平</span><span>${d.sst_anomaly} ℃</span></div>
    <div class="kv"><span>OHC 代理</span><span>${d.ohc} GJ/m²</span></div>
    <div class="kv"><span>风应力</span><span>${d.wind_stress} N/m²</span></div>
    <div class="section-t">同(海域·月)历史气候态 [n=${c.sample_size}]</div>
    <div class="kv"><span>历史月均 SST</span><span>${c.sst_mean} ℃</span></div>
    <div class="kv"><span>相对偏差</span><span class="${devClass}">${devSign}${c.sst_deviation} ℃</span></div>
    <div class="section-t">辅助观测</div>
    <div class="kv"><span>盐度</span><span>${d.salinity ?? "-"} PSU</span></div>
    <div class="kv"><span>气压</span><span>${d.pressure ?? "-"} hPa</span></div>
    <div class="kv"><span>CO₂</span><span>${d.co2 ?? "-"} ppm</span></div>`;
  $("detailPanel").classList.remove("hidden");
}

init().catch(err => { console.error(err); setStatus("初始化失败：" + err.message); });
