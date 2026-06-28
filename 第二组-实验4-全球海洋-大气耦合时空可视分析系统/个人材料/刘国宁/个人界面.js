// ---------------------------------------------------------------
//  全球海洋-大气耦合时空可视分析系统
//  热力图 + 耦合时变地图 + 平行坐标图 + 信息面板
// ---------------------------------------------------------------

"use strict";

// --- 1. 常量与配置 ---

const DATA_PATH = "/api/data/filter?page_size=0";
let TOOLTIP = null;

const Adapter = {
  COLORS: {
    "太平洋": "#0072B2", "大西洋": "#009E73", "印度洋": "#F0E442",
    "北极海域": "#56B4E9", "南极海域": "#CC79A7", "赤道区域": "#E69F00"
  },
  REGIONS: ["太平洋", "大西洋", "印度洋", "北极海域", "南极海域", "赤道区域"],

  ALL_NUMERIC_FIELDS: [
    "wind_speed", "wind_dir", "pressure","precipitation", "co2",
    "humidity", "sst", "salinity","current_speed", "chlorophyll"
  ],

  FIELD_LABELS: {
    wind_speed: "风速 Wind (km/h)", wind_dir: "风向 Wind Dir (°)",
    pressure: "气压 Pressure (hPa)", precipitation: "降水量 Precip (mm)",
    co2: "CO₂浓度 (ppm)", humidity: "湿度 Humidity (%)",
    sst: "海表温度 SST (°C)", salinity: "盐度 Salinity (PSU)",
    current_speed: "海流 Current (m/s)", chlorophyll: "叶绿素 Chl (mg/m³)"
  },

  FIELD_SHORT: {
    sst: "SST", salinity: "Sal", wind_speed: "Wind", wind_dir: "Dir",
    pressure: "Pres", precipitation: "Prec", co2: "CO₂",
    humidity: "Hum", current_speed: "Curr", chlorophyll: "Chl"
  },

  FIELD_CN: {
    wind_speed: "风速", wind_dir: "风向", pressure: "气压",
    precipitation: "降水", co2: "CO₂浓度", humidity: "湿度",
    sst: "海表温度", salinity: "盐度",
    current_speed: "海流", chlorophyll: "叶绿素"
  },

  getColor(r) { return this.COLORS[r] || "#999"; },
  getRegions() { return [...this.REGIONS]; }
};


// --- 2. 维度定义 ---

const ATMOS_DIMS = ["wind_speed", "wind_dir", "pressure", "precipitation", "co2"];
const OCEAN_DIMS = ["humidity", "sst", "salinity", "current_speed", "chlorophyll"];

// ── 海区→形状（方向4：各个点模式）─────────────────────
const REGION_SYMBOLS = {
  "太平洋": d3.symbolCircle,
  "大西洋": d3.symbolDiamond,
  "印度洋": d3.symbolSquare,
  "北极海域": d3.symbolTriangle,
  "南极海域": d3.symbolCross,
  "赤道区域": d3.symbolStar,
};

// ── 海区→tooltip 符号字符 ──────────────────────────
const REGION_SYM_CHARS = {
  "太平洋": "○", "大西洋": "◇", "印度洋": "□",
  "北极海域": "△", "南极海域": "✕", "赤道区域": "☆",
};

function regionSymbol(region, radius) {
  const gen = REGION_SYMBOLS[region] || d3.symbolCircle;
  return d3.symbol().type(gen).size(Math.PI * radius * radius)();
}

function computeMonthCorrelation(data, f1, f2) {
  if (data.length < 5) return 0;
  const xV = data.map(d => +d[f1]), yV = data.map(d => +d[f2]);
  const xM = d3.mean(xV), yM = d3.mean(yV);
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < xV.length; i++) { cov += (xV[i]-xM)*(yV[i]-yM); vx += (xV[i]-xM)**2; vy += (yV[i]-yM)**2; }
  return (vx > 0 && vy > 0) ? cov / Math.sqrt(vx * vy) : 0;
}


// --- 3. 全局状态 ---

let cleanData = null;
let corrMatrix = null;
let hiddenRegions = new Set();
let useSampling = true;
let selectedHeatmapPair = null;
let bvMonthIndex = -1;
let bvPlaying = false;
let bvTimer = null;
let bvZoomTransform = null;
let infoCollapsed = false;
let lofResult = null;
let lofOverlayActive = false;
let aeResult = null;
let aeOverlayActive = false;
let pcAnomalyMethod = 'lof';
let pcAnomalyData = null;
let pcSelectedIds = new Set();
let pcHoveredId = null;

const API_BASE = (window.CONFIG && window.CONFIG.API_BASE) || '/api';


// --- 4. 数据预处理 ---

// ── 缺失值插补：按海区+月份分组，取中位数填充 ─────────────
function imputeMissing(data) {
  const groups = d3.group(data, d => d.region, d => d.time?.substring(0, 7));
  Adapter.ALL_NUMERIC_FIELDS.forEach(field => {
    data.forEach(d => {
      if (d[field] == null || (typeof d[field] === 'number' && isNaN(d[field]))) {
        const group = groups.get(d.region)?.get(d.time?.substring(0, 7));
        const groupVals = (group || []).map(r => r[field]).filter(v => v != null && isFinite(v));
        d[field] = groupVals.length ? d3.median(groupVals) : null;
        if (d[field] == null) {
          const allVals = data.map(r => r[field]).filter(v => v != null && isFinite(v));
          d[field] = allVals.length ? d3.median(allVals) : 0;
        }
      }
    });
  });
}


// ── 皮尔逊相关性矩阵计算 ─────────────────────────────────
function computeCorrelationMatrix(data) {
  const fields = Adapter.ALL_NUMERIC_FIELDS;
  const n = data.length;
  const cols = {}, means = {}, stds = {};
  fields.forEach(f => {
    const vals = data.map(d => d[f]);
    cols[f] = vals; means[f] = d3.mean(vals); stds[f] = d3.deviation(vals);
  });
  const matrix = {};
  fields.forEach(f1 => {
    matrix[f1] = {};
    fields.forEach(f2 => {
      if (f1 === f2) { matrix[f1][f2] = 1.0; return; }
      let cov = 0;
      for (let i = 0; i < n; i++) cov += (cols[f1][i] - means[f1]) * (cols[f2][i] - means[f2]);
      cov /= n;
      matrix[f1][f2] = (stds[f1] && stds[f2]) ? cov / (stds[f1] * stds[f2]) : 0;
    });
  });
  return matrix;
}

// ── 海-气耦合评分（跨系统平均绝对 Pearson r）────────────
function couplingScore(mat) {
  const oceanVs = OCEAN_DIMS.filter(f => Adapter.ALL_NUMERIC_FIELDS.includes(f));
  const atmosVs = ATMOS_DIMS.filter(f => Adapter.ALL_NUMERIC_FIELDS.includes(f));
  if (!oceanVs.length || !atmosVs.length) return 0;
  let sum = 0, count = 0;
  oceanVs.forEach(o => {
    atmosVs.forEach(a => {
      if (mat[o] && mat[o][a] !== undefined) { sum += Math.abs(mat[o][a]); count++; }
    });
  });
  return count ? sum / count : 0;
}

// ── 数据准备：应用所有过滤器 ──────────────────────────────
function prepareData() {
  let data = cleanData;
  if (useSampling && data.length > 300) {
    const step = Math.max(1, Math.floor(data.length / 300));
    data = data.filter((_, i) => i % step === 0);
  }
  if (hiddenRegions.size > 0)
    data = data.filter(d => !hiddenRegions.has(d.region));
  return data;
}


// --- 5. Tooltip ---

function showTooltip(event, html) {
  if (!TOOLTIP) return;
  TOOLTIP.style("opacity", 1).html(html)
    .style("left", Math.min(event.clientX + 14, window.innerWidth - 320) + "px")
    .style("top", Math.min(event.clientY - 10, window.innerHeight - 200) + "px");
}

function hideTooltip() { if (TOOLTIP) TOOLTIP.style("opacity", 0); }


// --- 6. SVG 初始化 ---

let hmSVG, hmG;
let bvSVG, bvG;
let pcSVG, pcG;
let worldMapData = null;

function initSVGs() {
  hmSVG = d3.select("#hm-svg")
    .attr("viewBox", "0 0 400 360")
    .attr("preserveAspectRatio", "xMidYMid meet");
  hmG = hmSVG.append("g").attr("transform", "translate(58, 20)");

  bvSVG = d3.select("#bv-svg")
    .attr("viewBox", "0 0 650 540")
    .attr("preserveAspectRatio", "xMidYMid meet")
    // 强制 GPU 合成层，消除平移抖动
    .style("will-change", "transform")
    .style("transform", "translateZ(0)");
  bvG = bvSVG.append("g");

  pcSVG = d3.select("#pc-svg")
    .attr("viewBox", "0 0 700 440")
    .attr("preserveAspectRatio", "xMidYMid meet");
  pcG = pcSVG.append("g");
}


// --- 7. 工具栏 ---

function resetBivariateView() {
  selectedHeatmapPair = null;
  bvZoomTransform = null;
  stopBvAnim();
  bvMonthIndex = -1;
  d3.select("#bivariate-card").classed("collapsed", true);
  d3.select("#heatmap-thumb-card").classed("expanded", false);
  d3.select("#parallel-coord-card").classed("collapsed", false);
  d3.select("#bv-subtitle").text("点击热力图单元格，在地图上探索海-气耦合时变演变");
  d3.select("#bv-shape-hint").style("display", "none");
}

function initInfoToggle() {
  const panel = d3.select("#side-panel");
  panel.select(".card-title").on("click", function () {
    infoCollapsed = !infoCollapsed;
    panel.select(".card-title span").text(infoCollapsed ? "信息面板" : "▾ 信息面板");
    panel.classed("info-collapsed", infoCollapsed);
    setTimeout(() => fullRender(), 50);
  });
}

function initToolbar() {
  d3.select("#btn-reset").on("click", () => {
    hiddenRegions = new Set();
    pcSelectedIds = new Set();
    pcHoveredId = null;
    resetBivariateView();
    corrMatrix = computeCorrelationMatrix(cleanData);
    fullRender();
  });

  d3.select("#btn-sample").on("click", function () {
    useSampling = !useSampling;
    d3.select(this).classed("active", useSampling).text(useSampling ? "采样模式" : "全量模式");
    fullRender();
  });

  // 异常检测 tab 切换
  d3.selectAll(".anomaly-tab").on("click", function () {
    const tab = this.dataset.tab;
    d3.selectAll(".anomaly-tab").classed("active", false);
    d3.select(this).classed("active", true);
    d3.select("#lof-panel").classed("hidden", tab !== "lof");
    d3.select("#ae-panel").classed("hidden", tab !== "ae");
  });

  // 统一运行按钮 — 根据当前激活 tab 决定调用 LOF 还是 AE
  d3.select("#btn-anomaly-run").on("click", function () {
    const activeTab = d3.select(".anomaly-tab.active").attr("data-tab");
    if (activeTab === "lof") fetchLofResult(20);
    else fetchAeResult();
  });

  // LOF 叠加按钮
  d3.select("#btn-lof-overlay").on("click", function () {
    lofOverlayActive = !lofOverlayActive;
    d3.select(this)
      .style("background", lofOverlayActive ? "#cc3333" : "#fff")
      .style("color", lofOverlayActive ? "#fff" : "#5a6d80")
      .style("border-color", lofOverlayActive ? "#cc3333" : "#c8d6e5");
    fullRender();
  });

  // Autoencoder 叠加按钮
  d3.select("#btn-ae-overlay").on("click", function () {
    aeOverlayActive = !aeOverlayActive;
    d3.select(this)
      .style("background", aeOverlayActive ? "#E69F00" : "#fff")
      .style("color", aeOverlayActive ? "#fff" : "#5a6d80")
      .style("border-color", aeOverlayActive ? "#E69F00" : "#c8d6e5");
    fullRender();
  });

  // 平行坐标图模型选择按钮
  d3.selectAll(".pc-model-btn").on("click", async function () {
    d3.selectAll(".pc-model-btn").classed("active", false);
    d3.select(this).classed("active", true);
    pcAnomalyMethod = this.dataset.method;
    await updateAnomalyFlags();
    fullRender();
  });
}

// ── 耦合地图关闭按钮 ───────────────────────────────────────
function initBivariateClose() {
  d3.select("#bv-close").on("click", function (event) {
    event.stopPropagation();
    resetBivariateView();
    fullRender();
  });
}


// --- 8. 热力图 ---

function drawHeatmap() {
  hmG.selectAll("*").remove();
  const fields = Adapter.ALL_NUMERIC_FIELDS;
  const n = fields.length;
  const cellSize = 26, gap = 3;
  const totalSize = n * (cellSize + gap);

  const rExtent = d3.extent(fields.flatMap(f1 => fields.map(f2 => corrMatrix[f1]?.[f2] ?? 0)));
  const maxAbs = Math.max(Math.abs(rExtent[0] || 0), Math.abs(rExtent[1] || 1));
  const colorScale = d3.scaleDiverging(d3.interpolateRdBu).domain([maxAbs, 0, -maxAbs]); // 红=正相关, 蓝=负相关

  fields.forEach((f, i) => {
    hmG.append("text")
      .attr("x", i * (cellSize + gap) + cellSize / 2).attr("y", -4)
      .attr("text-anchor", "middle").attr("font-size", "8px").attr("fill", "#5a6d80")
      .text(Adapter.FIELD_SHORT[f]);
  });

  fields.forEach((f, i) => {
    hmG.append("text")
      .attr("x", -4).attr("y", i * (cellSize + gap) + cellSize / 2)
      .attr("text-anchor", "end").attr("dominant-baseline", "middle")
      .attr("font-size", "8px").attr("fill", "#5a6d80")
      .text(Adapter.FIELD_SHORT[f]);
  });

  fields.forEach((f1, i) => {
    fields.forEach((f2, j) => {
      const x = j * (cellSize + gap), y = i * (cellSize + gap);

      if (j >= i) {
        hmG.append("rect").attr("x", x).attr("y", y)
          .attr("width", cellSize).attr("height", cellSize).attr("fill", "#f0f2f5").attr("rx", 2);
        if (j === i) {
          hmG.append("text")
            .attr("x", x + cellSize / 2).attr("y", y + cellSize / 2)
            .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
            .attr("font-size", "7px").attr("fill", "#7a8fa6").text("●");
        }
      } else {
        const r = corrMatrix[f1]?.[f2] ?? 0;
        hmG.append("rect")
          .attr("x", x).attr("y", y)
          .attr("width", cellSize).attr("height", cellSize)
          .attr("fill", colorScale(r)).attr("rx", 2)
          .attr("class", "hm-cell")
          .on("mouseenter", function (event) {
            if (selectedHeatmapPair && !(selectedHeatmapPair.f1 === f1 && selectedHeatmapPair.f2 === f2)) return;
            d3.select(this).attr("stroke", "#0072B2").attr("stroke-width", 2);
            const html = `<strong>${Adapter.FIELD_SHORT[f1]} ↔ ${Adapter.FIELD_SHORT[f2]}</strong>r = ${r?.toFixed(3)}${Math.abs(r) > 0.5 ? ' ★' : ''}`;
            showTooltip(event, html);
          })
          .on("mouseleave", function () {
            if (selectedHeatmapPair && !(selectedHeatmapPair.f1 === f1 && selectedHeatmapPair.f2 === f2)) return;
            if (selectedHeatmapPair && selectedHeatmapPair.f1 === f1 && selectedHeatmapPair.f2 === f2) {
              d3.select(this).attr("stroke", "#0072B2").attr("stroke-width", 2.5);
              hideTooltip(); return;
            }
            d3.select(this).attr("stroke", "none");
            hideTooltip();
          })
          .on("click", function () {
            hideTooltip();
            if (selectedHeatmapPair && !(selectedHeatmapPair.f1 === f1 && selectedHeatmapPair.f2 === f2)) return;
            if (selectedHeatmapPair && selectedHeatmapPair.f1 === f1 && selectedHeatmapPair.f2 === f2) {
              resetBivariateView();
            } else {
              selectedHeatmapPair = { f1, f2 };
              const a1 = ATMOS_DIMS.includes(f1), a2 = ATMOS_DIMS.includes(f2);
              const sf1 = a1 ? "△" : "◆", sf2 = a2 ? "△" : "◆";
              d3.select("#bivariate-card").classed("collapsed", false);
              d3.select("#heatmap-thumb-card").classed("expanded", false);
              d3.select("#parallel-coord-card").classed("collapsed", true);
              d3.select("#bv-subtitle")
                .text(`${sf1} ${Adapter.FIELD_SHORT[f1]}(${a1?"大气":"海洋"})  ${sf2} ${Adapter.FIELD_SHORT[f2]}(${a2?"大气":"海洋"})  |  r = ${(corrMatrix[f1]?.[f2] ?? 0).toFixed(3)}`);
              d3.select("#bv-shape-hint").style("display", "block")
                .text("形状 = 海区  ○太平洋  ◇大西洋  □印度洋  △北极海域  ✕南极海域  ☆赤道区域");
            }
            fullRender();
          });

        hmG.append("text")
          .attr("x", x + cellSize / 2).attr("y", y + cellSize / 2)
          .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
          .attr("font-size", Math.abs(r) > 0.6 ? "9px" : "8px")
          .attr("fill", Math.abs(r) > 0.7 ? "#fff" : "#2d3e50")
          .attr("pointer-events", "none").text(r.toFixed(2));
      }
    });
  });

  // 颜色图例
  const legW = 100, legH = 8, legY = totalSize + 18;
  const legG = hmG.append("g").attr("transform", `translate(${totalSize - legW},${legY})`);
  const grad = legG.append("defs").append("linearGradient").attr("id", "hm-leg-grad");
  grad.append("stop").attr("offset", "0%").attr("stop-color", d3.interpolateRdBu(1));  // 蓝=负相关
  grad.append("stop").attr("offset", "50%").attr("stop-color", d3.interpolateRdBu(0.5)); // 白=中立
  grad.append("stop").attr("offset", "100%").attr("stop-color", d3.interpolateRdBu(0)); // 红=正相关
  legG.append("rect").attr("width", legW).attr("height", legH).attr("fill", "url(#hm-leg-grad)").attr("rx", 2);
  legG.append("text").attr("x", 0).attr("y", -3).attr("font-size", "8px").attr("fill", "#5a6d80").text("-1");
  legG.append("text").attr("x", legW/2-4).attr("y", -3).attr("font-size", "8px").attr("fill", "#5a6d80").text("0");
  legG.append("text").attr("x", legW).attr("y", -3).attr("text-anchor", "end").attr("font-size", "8px").attr("fill", "#5a6d80").text("+1");

  if (selectedHeatmapPair) {
    const { f1, f2 } = selectedHeatmapPair;
    hmG.selectAll(".hm-cell").filter(function () {
      const el = d3.select(this);
      const cx = parseFloat(el.attr("x")) + cellSize / 2;
      const cy = parseFloat(el.attr("y")) + cellSize / 2;
      const j = Math.round((cx - cellSize / 2) / (cellSize + gap));
      const i = Math.round((cy - cellSize / 2) / (cellSize + gap));
      return fields[i] === f1 && fields[j] === f2;
    }).attr("stroke", "#0072B2").attr("stroke-width", 2.5);
  }
}


// --- 9. 耦合时变地图 ---

function drawBivariateChart(data) {
  bvG.selectAll("*").remove();

  if (!selectedHeatmapPair) {
    stopBvAnim(); bvMonthIndex = -1;
    bvG.append("text").attr("x", 325).attr("y", 230)
      .attr("text-anchor", "middle").attr("fill", "#7a8fa6").attr("font-size", "13px")
      .text("← 点击左侧热力图单元格，在地图上查看海-气变量的空间耦合关系");
    bvG.append("text").attr("x", 325).attr("y", 260)
      .attr("text-anchor", "middle").attr("fill", "#b0bec5").attr("font-size", "10px")
      .text("每个海区使用不同形状标记 · 颜色与大小编码两个变量");
    return;
  }

  const { f1, f2 } = selectedHeatmapPair;

  const allMonths = [...new Set(data.map(d => d.time?.substring(0, 7)))].sort();
  const parseMonth = d3.timeParse("%Y-%m");
  const monthObjs = allMonths.map(m => ({ month: m, date: parseMonth(m) })).filter(d => d.date);

  const allData = data.filter(d =>
    d.longitude != null && isFinite(d.longitude) &&
    d.latitude != null && isFinite(d.latitude) &&
    d[f1] != null && isFinite(d[f1]) &&
    d[f2] != null && isFinite(d[f2])
  );

  let validData = allData;

  let monthLabel, monthR = 0;
  if (bvMonthIndex >= 0 && bvMonthIndex < allMonths.length) {
    const m = allMonths[bvMonthIndex];
    validData = allData.filter(d => d.time?.substring(0, 7) === m);
    monthLabel = m + " · " + validData.length + "条";
    monthR = computeMonthCorrelation(validData, f1, f2);
  } else {
    monthR = computeMonthCorrelation(validData, f1, f2);
    monthLabel = `全部 ${allMonths.length} 个月 · ${validData.length}条`;
  }
  if (validData.length === 0) {
    bvG.append("text").attr("x", 325).attr("y", 240)
      .attr("text-anchor", "middle").attr("fill", "#7a8fa6").attr("font-size", "13px")
      .text("当前筛选条件下无有效数据");
    return;
  }

  const mapW = 520, mapH = 300, mapLeft = 80, mapTop = 26;
  const projection = d3.geoEquirectangular()
    .scale(mapW / (2 * Math.PI)).translate([mapLeft + mapW / 2, mapTop + mapH / 2]);
  const pathGen = d3.geoPath().projection(projection);
  const mapG = bvG.append("g");

  // ── 缩放 ──────────────────────────────────────────────────
  const zoomBg = mapG.append("rect")
    .attr("class", "zoom-bg")
    .attr("x", mapLeft).attr("y", mapTop)
    .attr("width", mapW).attr("height", mapH)
    .attr("fill", "none").attr("pointer-events", "all")
    .style("cursor", "grab");

  const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .extent([[mapLeft, mapTop], [mapLeft + mapW, mapTop + mapH]])
    .translateExtent([[mapLeft - 50, mapTop - 50], [mapLeft + mapW + 50, mapTop + mapH + 50]])
    .on("start", () => zoomBg.style("cursor", "grabbing"))
    .on("zoom", (event) => {
      const t = event.transform;
      // 平移像素取整 + SVG transform 属性
      const tx = Math.round(t.x), ty = Math.round(t.y);
      mapG.attr("transform", `translate(${tx},${ty}) scale(${t.k})`);
      bvZoomTransform = { x: tx, y: ty, k: t.k };
    })
    .on("end", () => zoomBg.style("cursor", "grab"));

  zoomBg.call(zoom);
  if (bvZoomTransform) {
    zoomBg.call(zoom.transform, d3.zoomIdentity.translate(bvZoomTransform.x, bvZoomTransform.y).scale(bvZoomTransform.k));
  }

  if (worldMapData) {
    mapG.append("g").selectAll("path").data(worldMapData.features).join("path")
      .attr("d", pathGen).attr("fill", "#eef1f5").attr("stroke", "#c8d6e5").attr("stroke-width", 0.5);
  }

  const isAtmos1 = ATMOS_DIMS.includes(f1);
  const isAtmos2 = ATMOS_DIMS.includes(f2);
  const couplingType = (isAtmos1 !== isAtmos2) ? "跨界耦合" : (isAtmos1 ? "大气层内" : "海洋层内");

  // ── 渲染散点：viridis=颜色(f1) + 大小=气泡(f2) + 形状=海区 ──
  const f1e = d3.extent(validData, d => +d[f1]);
  const f2e = d3.extent(validData, d => +d[f2]);
  const valColor = d3.scaleSequential(d3.interpolateViridis).domain(f1e);
  const sizeScale = d3.scaleLinear().domain(f2e).range([2.5, 9]);

  mapG.selectAll(".bv-dot").data(validData).join("path")
    .attr("class", "bv-dot")
    .attr("transform", d => {
      const [cx, cy] = projection([d.longitude, d.latitude]);
      return `translate(${cx},${cy})`;
    })
    .attr("d", d => regionSymbol(d.region, sizeScale(+d[f2])))
    .attr("fill", d => valColor(+d[f1]))
    .attr("fill-opacity", 0.85)
    .attr("stroke", "#fff").attr("stroke-width", 0.3)
    .on("mouseenter", function (event, d) {
      d3.select(this).attr("stroke-width", 1.5).attr("stroke", "#1a2b4a");
      const symChar = REGION_SYM_CHARS[d.region] || "?";
      const html = `${Adapter.FIELD_SHORT[f1]}: ${(+d[f1]).toFixed(2)}  |  ${Adapter.FIELD_SHORT[f2]}: ${(+d[f2]).toFixed(2)}<br>${symChar} ${d.region} · ${d.time}`;
      showTooltip(event, html);
    })
    .on("mouseleave", function () {
      d3.select(this).attr("stroke-width", 0.3).attr("stroke", "#fff");
      hideTooltip();
    });

  // ── 缩放按钮 ──────────────────────────────────────────────
  (function addZoomButtons() {
    const btnR = 18, gap = 4, x0 = mapLeft + mapW - btnR - 8, y0 = mapTop + 4;
    const btnData = [
      { label: "+", action: () => zoom.scaleBy(zoomBg, 1.5) },
      { label: "−", action: () => zoom.scaleBy(zoomBg, 1 / 1.5) },
      { label: "⟲", action: () => { bvZoomTransform = null; zoomBg.call(zoom.transform, d3.zoomIdentity); } }
    ];
    btnData.forEach((b, i) => {
      const g = bvG.append("g")
        .attr("transform", `translate(${x0},${y0 + i * (btnR + gap)})`)
        .style("cursor", "pointer");
      g.append("rect").attr("x", -btnR / 2).attr("y", -btnR / 2)
        .attr("width", btnR).attr("height", btnR).attr("rx", 4)
        .attr("fill", "rgba(255,255,255,0.85)").attr("stroke", "#c8d6e5").attr("stroke-width", 1);
      g.append("text").attr("text-anchor", "middle").attr("y", 5)
        .attr("font-size", "13px").attr("fill", "#2d3e50").attr("font-weight", "700")
        .text(b.label);
      g.on("click", b.action);
    });
  })();

  // ── 标题 ──────────────────────────────────────────────────
  bvG.append("text").attr("x", mapLeft + mapW / 2).attr("y", 13)
    .attr("text-anchor", "middle").attr("font-size", "11px").attr("fill", "#1a2b4a").attr("font-weight", "700")
    .text(`颜色 = ${Adapter.FIELD_SHORT[f1]}  大小 = ${Adapter.FIELD_SHORT[f2]}  |  ${couplingType}  |  整体 r = ${monthR.toFixed(3)}  |  ${monthLabel}`);

  // ── 图例：颜色色带（viridis 编码 f1）+ 大小参照圆（编码 f2）──
  const legW = 260, legH = 8, legTopY = mapTop + mapH + 16;
  const legG = bvG.append("g").attr("transform", `translate(${mapLeft + mapW / 2 - legW / 2},${legTopY})`);

  // viridis 渐变色带
  const gradId = "bv-value-legend";
  legG.append("defs").append("linearGradient").attr("id", gradId)
    .selectAll("stop").data([0, 0.5, 1]).join("stop")
    .attr("offset", d => `${d * 100}%`).attr("stop-color", d => d3.interpolateViridis(d));
  legG.append("rect").attr("y", 0).attr("width", legW).attr("height", legH)
    .attr("fill", `url(#${gradId})`).attr("rx", 2);
  legG.append("text").attr("x", 0).attr("y", legH + 16).attr("text-anchor", "start")
    .attr("font-size", "7px").attr("fill", "#2d3e50").text(f1e[0]?.toFixed(1) || "");
  legG.append("text").attr("x", legW / 2).attr("y", legH + 16).attr("text-anchor", "middle")
    .attr("font-size", "7px").attr("fill", "#2d3e50")
    .text(`颜色 = ${Adapter.FIELD_SHORT[f1]}`);
  legG.append("text").attr("x", legW).attr("y", legH + 16).attr("text-anchor", "end")
    .attr("font-size", "7px").attr("fill", "#2d3e50").text(f1e[1]?.toFixed(1) || "");

  // 大小参照圆（min / mid / max）
  const sizeY = legH + 38;
  const sizeVals = [f2e[0], (f2e[0] + f2e[1]) / 2, f2e[1]];
  const sizeXs = [legW * 0.15, legW * 0.5, legW * 0.85];
  sizeVals.forEach((v, i) => {
    const r = sizeScale(v);
    legG.append("circle").attr("cx", sizeXs[i]).attr("cy", sizeY)
      .attr("r", r).attr("fill", "none").attr("stroke", "#2d3e50").attr("stroke-width", 1);
    legG.append("text").attr("x", sizeXs[i]).attr("y", sizeY - r - 5)
      .attr("text-anchor", "middle").attr("font-size", "6.5px").attr("fill", "#2d3e50").text(v.toFixed(1));
  });
  legG.append("text").attr("x", legW / 2).attr("y", sizeY + sizeScale(f2e[1]) + 10)
    .attr("text-anchor", "middle").attr("font-size", "7px").attr("fill", "#2d3e50")
    .text(`大小 = ${Adapter.FIELD_SHORT[f2]}`);

  // 形状图例已移至 HTML 卡片底部，由 drawBivariateChart 更新 #bv-shape-hint

  // ── 时间滑条（scaleTime — 真实时间轴间距）─────────────────
  if (monthObjs.length < 2) return;

  const sliderY = mapTop + mapH + 85;
  const sliderX = mapLeft + 10, sliderW = mapW - 20;
  const [tMin, tMax] = d3.extent(monthObjs, d => d.date);
  const sliderScale = d3.scaleTime().domain([tMin, tMax]).range([sliderX, sliderX + sliderW]);

  bvG.append("line").attr("x1", sliderX).attr("x2", sliderX + sliderW)
    .attr("y1", sliderY).attr("y2", sliderY)
    .attr("stroke", "#c8d6e5").attr("stroke-width", 4).attr("stroke-linecap", "round");

  bvG.append("text").attr("x", sliderX).attr("y", sliderY+28).attr("text-anchor", "start")
    .attr("font-size", "8px").attr("fill", "#5a6d80").text(allMonths[0]);
  bvG.append("text").attr("x", sliderX+sliderW).attr("y", sliderY+28).attr("text-anchor", "end")
    .attr("font-size", "8px").attr("fill", "#5a6d80").text(allMonths[allMonths.length-1]);

  allMonths.forEach((m, i) => {
    if (i % 3 !== 0 || i === 0 || i === allMonths.length-1) return;
    const d = parseMonth(m);
    if (!d) return;
    const cx = sliderScale(d);
    bvG.append("line").attr("x1", cx).attr("x2", cx).attr("y1", sliderY-5).attr("y2", sliderY+5)
      .attr("stroke", "#a0b0c0").attr("stroke-width", 1);
    bvG.append("text").attr("x", cx).attr("y", sliderY+16).attr("text-anchor", "middle")
      .attr("font-size", "7px").attr("fill", "#8a9ab0").text(m.substring(5));
  });

  const btnX = sliderX + sliderW + 16;
  const btnG = bvG.append("g").attr("transform", `translate(${btnX},${sliderY-7})`).style("cursor", "pointer");
  btnG.append("rect").attr("x", -12).attr("y", -9).attr("width", 24).attr("height", 18)
    .attr("fill", "#f0f4f8").attr("rx", 4).attr("stroke", "#c8d6e5");
  btnG.append("text").attr("text-anchor", "middle").attr("y", 4).attr("font-size", "13px").attr("fill", "#2d3e50")
    .text(bvPlaying ? "⏸" : "▶");
  btnG.on("click", () => { if (bvPlaying) stopBvAnim(); else startBvAnim(allMonths.length); fullRender(); });

  const allBtnX = btnX + 30;
  const allBtnG = bvG.append("g").attr("transform", `translate(${allBtnX},${sliderY-7})`).style("cursor", "pointer");
  allBtnG.append("rect").attr("x", -14).attr("y", -9).attr("width", 28).attr("height", 18)
    .attr("fill", bvMonthIndex < 0 ? "#0072B2" : "#f0f4f8").attr("rx", 4)
    .attr("stroke", bvMonthIndex < 0 ? "#0072B2" : "#c8d6e5");
  allBtnG.append("text").attr("text-anchor", "middle").attr("y", 4).attr("font-size", "9px").attr("font-weight", "600")
    .attr("fill", bvMonthIndex < 0 ? "#fff" : "#5a6d80").text("All");
  allBtnG.on("click", () => { stopBvAnim(); bvMonthIndex = -1; fullRender(); });

  // ── 交互拖拽层 + 滑块圆点 ─────────────────────────────────
  let curIdx = bvMonthIndex >= 0 ? bvMonthIndex : -1;
  const curMonthDate = curIdx >= 0 && curIdx < monthObjs.length ? monthObjs[curIdx].date : null;
  const handleX = curMonthDate ? sliderScale(curMonthDate) : null;

  bvG.append("rect").attr("x", sliderX-10).attr("y", sliderY-14).attr("width", sliderW+20).attr("height", 28)
    .attr("fill", "transparent").style("cursor", handleX ? "grab" : "pointer")
    .on("mousedown", function (event) {
      stopBvAnim();
      let lastIdx = bvMonthIndex;
      const snap = ev => {
        const [mx] = d3.pointer(ev, bvG.node());
        const t = sliderScale.invert(mx);
        let best = monthObjs[0], bestDist = Math.abs(t - best.date);
        for (let k = 1; k < monthObjs.length; k++) {
          const dist = Math.abs(t - monthObjs[k].date);
          if (dist < bestDist) { best = monthObjs[k]; bestDist = dist; }
        }
        const idx = allMonths.indexOf(best.month);
        if (idx >= 0 && idx !== lastIdx) { lastIdx = idx; bvMonthIndex = idx; fullRender(); }
      };
      snap(event);
      d3.select(window).on("mousemove.bv-slider", snap).on("mouseup.bv-slider", () => {
        d3.select(window).on("mousemove.bv-slider", null).on("mouseup.bv-slider", null);
      });
    });

  if (handleX) {
    bvG.append("circle").attr("cx", handleX).attr("cy", sliderY).attr("r", 8)
      .attr("fill", "#0072B2").attr("stroke", "#fff").attr("stroke-width", 2).attr("class", "bv-slider-handle")
      .attr("pointer-events", "none");
  }

  // LOF 异常叠加
  applyLofOverlay(mapG, projection, validData);
  applyAeOverlay(mapG, projection, validData);
}

function startBvAnim(numMonths) {
  bvPlaying = true;
  const step = () => {
    if (!bvPlaying) return;
    bvMonthIndex = (bvMonthIndex + 1) % numMonths;
    fullRender();
    bvTimer = setTimeout(step, 800);
  };
  bvTimer = setTimeout(step, 800);
}

function stopBvAnim() {
  bvPlaying = false;
  if (bvTimer) { clearTimeout(bvTimer); bvTimer = null; }
}


// --- 10. 信息面板 ---

function updateInfoPanel(data) {
  const legend = d3.select("#legend-list").html("");
  Adapter.getRegions().forEach(region => {
    const item = legend.append("div")
      .attr("class", "legend-item" + (hiddenRegions.has(region) ? " inactive" : ""))
      .on("click", () => {
        if (hiddenRegions.has(region)) hiddenRegions.delete(region);
        else hiddenRegions.add(region);
        fullRender();
      });
    item.append("div").attr("class", "legend-dot").style("background", Adapter.getColor(region));
    item.append("span").text(region);
  });

  const statsPanel = d3.select("#stats-panel").html("");
  const stats = [
    ["总记录数", data.length],
    ["覆盖海区", Adapter.getRegions().filter(r => data.some(d => d.region === r)).length],
    ["时间跨度", (d3.min(data, d => d.time) || "") + " ~ " + (d3.max(data, d => d.time) || "")],
    ["平均 SST", d3.mean(data, d => d.sst)?.toFixed(2) + "°C"],
    ["平均 CO₂", d3.mean(data, d => d.co2)?.toFixed(1) + " ppm"],
    ["平均盐度", d3.mean(data, d => d.salinity)?.toFixed(2) + " PSU"],
    ["平均风速", d3.mean(data, d => d.wind_speed)?.toFixed(2) + " km/h"],
  ];
  stats.forEach(([label, val]) => {
    statsPanel.append("div").attr("class", "stat-row").html(`<span>${label}</span><span class="val">${val}</span>`);
  });

  const score = couplingScore(corrMatrix);
  d3.select("#coupling-score").text((score * 100).toFixed(1) + "%");
  d3.select("#coupling-detail").text("海-气跨系统平均绝对 Pearson r");

  d3.select("#filter-indicator").style("display", hiddenRegions.size > 0 ? "inline" : "none");
  d3.select("#render-info").text(`显示 ${data.length} 条 | ${Adapter.ALL_NUMERIC_FIELDS.length} 维 | ${useSampling ? "采样" : "全量"}`);

  const dimLabels = Adapter.ALL_NUMERIC_FIELDS
    .map(f => `${Adapter.FIELD_SHORT[f]}（${Adapter.FIELD_CN[f]}）`)
    .join(" | ");
  d3.select("#dimension-labels").text(dimLabels);
}


// --- 11. LOF 密度感知异常检测 ---

async function fetchLofResult(n_neighbors) {
  const btn = d3.select("#btn-anomaly-run");
  btn.text("加载中...").attr("disabled", true);
  const resultEl = d3.select("#lof-result");
  resultEl.style("display", "block").html("<div class='lof-loading'>LOF 检测结果加载中...</div>");

  try {
    const url = `${API_BASE}/model/lof?n_neighbors=${n_neighbors}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok) {
      lofResult = data.result;
      renderLofPanel();
      d3.select("#btn-lof-overlay").style("display", "inline-block");
    } else {
      resultEl.html(`<div class='lof-error'>检测失败: ${data.error || '未知错误'}</div>`);
      lofResult = null;
      d3.select("#btn-lof-overlay").style("display", "none");
    }
  } catch (err) {
    console.warn("LOF 请求失败:", err.message);
    resultEl.html(`<div class='lof-error'>请求失败: ${err.message}</div>`);
    lofResult = null;
    d3.select("#btn-lof-overlay").style("display", "none");
  }
  btn.text("▶ 加载检测结果").attr("disabled", null);
}

function renderLofPanel() {
  const container = d3.select("#lof-result").html("").style("display", "block");
  if (!lofResult) return;

  const r = lofResult;
  container.append("div").attr("class", "lof-summary")
    .html(`<span>总检测 <b>${r.total_checked}</b> 条，异常 <b>${r.anomaly_count}</b> 条 (${(r.anomaly_ratio * 100).toFixed(1)}%)</span>
           <span>邻域 k=${r.n_neighbors} | 阈值=${r.threshold}</span>`);

  // 各海域异常分布柱状条
  if (r.by_region) {
    const regions = Object.keys(r.by_region).sort();
    const maxTotal = Math.max(...regions.map(rg => r.by_region[rg].total), 1);
    const barContainer = container.append("div").attr("class", "lof-bars");
    regions.forEach(region => {
      const stat = r.by_region[region];
      const pctAnom = stat.total > 0 ? (stat.anomalies / stat.total * 100) : 0;
      const barW = (stat.total / maxTotal * 100).toFixed(1);
      const color = Adapter.COLORS[region] || "#999";
      const row = barContainer.append("div").attr("class", "lof-bar-row");
      row.append("span").attr("class", "lof-bar-label").text(region);
      row.append("div").attr("class", "lof-bar-track")
        .append("div").attr("class", "lof-bar-fill")
        .style("width", barW + "%")
        .style("background", color);
      row.append("span").attr("class", "lof-bar-num")
        .text(`${stat.anomalies}/${stat.total} (${pctAnom.toFixed(1)}%)`);
    });
  }

  // Top 5 异常记录
  if (r.anomalies) {
    const topAnomalies = r.anomalies
      .filter(a => a.is_anomaly)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    if (topAnomalies.length > 0) {
      container.append("div").attr("class", "lof-top-title").text("Top 异常记录");
      const list = container.append("div").attr("class", "lof-top-list");
      topAnomalies.forEach(a => {
        list.append("div").attr("class", "lof-anomaly-row")
          .html(`<span class="lof-anom-id">${a.id}</span>
                 <span class="lof-anom-region" style="color:${Adapter.COLORS[a.region] || '#999'}">${a.region}</span>
                 <span class="lof-anom-score">${a.score.toFixed(1)}</span>`);
      });
    }
  }
}

function applyLofOverlay(mapG, projection, validData) {
  if (!lofOverlayActive || !lofResult || !lofResult.anomalies) return;

  // 构建异常 ID 集合用于快速查找
  const anomalyIds = new Set(
    lofResult.anomalies.filter(a => a.is_anomaly).map(a => String(a.id))
  );

  // 只标记当前可视数据中的异常点
  const anomalyData = validData.filter(d => anomalyIds.has(String(d.id)));

  if (anomalyData.length === 0) return;

  mapG.selectAll(".bv-dot-lof").remove();
  mapG.selectAll(".bv-dot-lof").data(anomalyData).join("path")
    .attr("class", "bv-dot-lof")
    .attr("transform", d => {
      const [cx, cy] = projection([d.longitude, d.latitude]);
      return `translate(${cx},${cy})`;
    })
    .attr("d", d => {
      // 使用与正常点相同的形状，但更大
      const r = 5.5;
      const gen = REGION_SYMBOLS[d.region] || d3.symbolCircle;
      return d3.symbol().type(gen).size(Math.PI * r * r)();
    })
    .attr("fill", "none")
    .attr("stroke", "#cc3333")
    .attr("stroke-width", 2.5)
    .attr("stroke-opacity", 0.9)
    .on("mouseenter", function (event, d) {
      d3.select(this).attr("stroke-width", 4).attr("stroke", "#ff0000");
      const symChar = REGION_SYM_CHARS[d.region] || "?";
      const aRec = lofResult.anomalies.find(a => String(a.id) === String(d.id));
      const html = `LOF 异常 · 得分: ${aRec ? aRec.score.toFixed(1) : '?'}<br>${symChar} ${d.region} · ${d.time}`;
      showTooltip(event, html);
    })
    .on("mouseleave", function () {
      d3.select(this).attr("stroke-width", 2.5).attr("stroke", "#cc3333");
      hideTooltip();
    });
}


// --- 11c. Autoencoder 深度学习异常检测 ---

async function fetchAeResult() {
  const btn = d3.select("#btn-anomaly-run");
  btn.text("加载中...").attr("disabled", true);
  const resultEl = d3.select("#ae-result");
  resultEl.style("display", "block").html("<div class='lof-loading'>Autoencoder 检测结果加载中...</div>");

  try {
    const url = `${API_BASE}/model/autoencoder`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok) {
      aeResult = data.result;
      renderAePanel();
      d3.select("#btn-ae-overlay").style("display", "inline-block");
    } else {
      resultEl.html(`<div class='lof-error'>检测失败: ${data.error || '未知错误'}</div>`);
      aeResult = null;
      d3.select("#btn-ae-overlay").style("display", "none");
    }
  } catch (err) {
    console.warn("Autoencoder 请求失败:", err.message);
    resultEl.html(`<div class='lof-error'>请求失败: ${err.message}</div>`);
    aeResult = null;
    d3.select("#btn-ae-overlay").style("display", "none");
  }
  btn.text("▸ 加载检测结果").attr("disabled", null);
}

function renderAePanel() {
  const container = d3.select("#ae-result").html("").style("display", "block");
  if (!aeResult) return;

  const r = aeResult;
  const trainInfo = r.train_info || {};

  container.append("div").attr("class", "lof-summary")
    .html(`<span>总检测 <b>${r.total_checked}</b> 条，异常 <b>${r.anomaly_count}</b> 条 (${(r.anomaly_ratio * 100).toFixed(1)}%)</span>
           <span>架构 ${r.feature_cols ? r.feature_cols.length : '?'}→${r.hidden_dim}→${r.latent_dim}→${r.hidden_dim}→${r.feature_cols ? r.feature_cols.length : '?'} | 阈值=${r.threshold}</span>
           <span>训练 loss: ${trainInfo.initial_loss?.toFixed(4) || '?'} → ${trainInfo.final_loss?.toFixed(4) || '?'} (${trainInfo.epochs_trained || '?'} 轮)</span>`);

  // 各海域异常分布柱状条
  if (r.by_region) {
    const regions = Object.keys(r.by_region).sort();
    const maxTotal = Math.max(...regions.map(rg => r.by_region[rg].total), 1);
    const barContainer = container.append("div").attr("class", "lof-bars");
    regions.forEach(region => {
      const stat = r.by_region[region];
      const pctAnom = stat.total > 0 ? (stat.anomalies / stat.total * 100) : 0;
      const barW = (stat.total / maxTotal * 100).toFixed(1);
      const color = Adapter.COLORS[region] || "#999";
      const row = barContainer.append("div").attr("class", "lof-bar-row");
      row.append("span").attr("class", "lof-bar-label").text(region);
      row.append("div").attr("class", "lof-bar-track")
        .append("div").attr("class", "lof-bar-fill")
        .style("width", barW + "%")
        .style("background", color);
      row.append("span").attr("class", "lof-bar-num")
        .text(`${stat.anomalies}/${stat.total} (${pctAnom.toFixed(1)}%)`);
    });
  }

  // Top 5 异常记录
  if (r.anomalies) {
    const topAnomalies = r.anomalies
      .filter(a => a.is_anomaly)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    if (topAnomalies.length > 0) {
      container.append("div").attr("class", "lof-top-title").text("Top 异常记录");
      const list = container.append("div").attr("class", "lof-top-list");
      topAnomalies.forEach(a => {
        list.append("div").attr("class", "lof-anomaly-row")
          .html(`<span class="lof-anom-id">${a.id}</span>
                 <span class="lof-anom-region" style="color:${Adapter.COLORS[a.region] || '#999'}">${a.region}</span>
                 <span class="lof-anom-score" style="color:#E69F00">${a.score.toFixed(1)}</span>`);
      });
    }
  }
}

function applyAeOverlay(mapG, projection, validData) {
  if (!aeOverlayActive || !aeResult || !aeResult.anomalies) return;

  // 构建异常 ID 集合用于快速查找
  const anomalyIds = new Set(
    aeResult.anomalies.filter(a => a.is_anomaly).map(a => String(a.id))
  );

  // 只标记当前可视数据中的异常点
  const anomalyData = validData.filter(d => anomalyIds.has(String(d.id)));

  if (anomalyData.length === 0) return;

  mapG.selectAll(".bv-dot-ae").remove();
  mapG.selectAll(".bv-dot-ae").data(anomalyData).join("path")
    .attr("class", "bv-dot-ae")
    .attr("transform", d => {
      const [cx, cy] = projection([d.longitude, d.latitude]);
      return `translate(${cx},${cy})`;
    })
    .attr("d", d => {
      const r = 5.5;
      const gen = REGION_SYMBOLS[d.region] || d3.symbolCircle;
      return d3.symbol().type(gen).size(Math.PI * r * r)();
    })
    .attr("fill", "none")
    .attr("stroke", "#E69F00")
    .attr("stroke-width", 2.5)
    .attr("stroke-opacity", 0.9)
    .on("mouseenter", function (event, d) {
      d3.select(this).attr("stroke-width", 4).attr("stroke", "#F0C040");
      const symChar = REGION_SYM_CHARS[d.region] || "?";
      const aRec = aeResult.anomalies.find(a => String(a.id) === String(d.id));
      const html = `AE 异常 · 得分: ${aRec ? aRec.score.toFixed(1) : '?'}<br>${symChar} ${d.region} · ${d.time}`;
      showTooltip(event, html);
    })
    .on("mouseleave", function () {
      d3.select(this).attr("stroke-width", 2.5).attr("stroke", "#E69F00");
      hideTooltip();
    });
}


// --- 12. 平行坐标图 ---

// ── 根据所选模型更新异常标记 ─────────────────────────────────
async function updateAnomalyFlags() {
  const data = cleanData;
  if (pcAnomalyMethod === 'lof') {
    if (!lofResult) await fetchLofResult(20);
    if (lofResult) {
      pcAnomalyData = {};
      lofResult.anomalies.forEach(a => { pcAnomalyData[a.id] = a.is_anomaly; });
    }
  } else if (pcAnomalyMethod === 'autoencoder') {
    if (!aeResult) await fetchAeResult();
    if (aeResult) {
      pcAnomalyData = {};
      aeResult.anomalies.forEach(a => { pcAnomalyData[a.id] = a.is_anomaly; });
    }
  }
}

// ── 统一管理平行坐标线视觉状态 ──────────────────────────
function applyPcLineStyles() {
  const hasHover = pcHoveredId !== null;
  const hasSelection = pcSelectedIds.size > 0;

  d3.selectAll("#pc-svg .pc-line").each(function () {
    const el = d3.select(this);
    const id = this.getAttribute("data-id");
    const isAnomaly = el.classed("pc-anomaly");
    const baseWidth = isAnomaly ? 1 : 0.8;
    const defaultOpacity = isAnomaly ? 0.4 : 0.06;

    if (hasHover && id === pcHoveredId) {
      el.interrupt()
        .attr("stroke-opacity", 1)
        .attr("stroke-width", 2.5)
        .raise();
    } else if (!hasHover && pcSelectedIds.has(id)) {
      el.interrupt()
        .attr("stroke-opacity", 0.8)
        .attr("stroke-width", 2);
    } else if (hasHover && pcSelectedIds.has(id)) {
      el.interrupt()
        .attr("stroke-opacity", 0.5)
        .attr("stroke-width", baseWidth);
    } else if (hasHover || hasSelection) {
      el.interrupt()
        .attr("stroke-opacity", 0.02)
        .attr("stroke-width", baseWidth);
    } else {
      el.interrupt()
        .attr("stroke-opacity", defaultOpacity)
        .attr("stroke-width", baseWidth);
    }
  });

  // 控制命中层交互：选中状态下锁定非选中线
  if (pcSelectedIds.size > 0) {
    d3.selectAll("#pc-svg .pc-hit").style("pointer-events", function () {
      const id = this.getAttribute("data-id");
      return pcSelectedIds.has(id) ? "auto" : "none";
    });
  } else {
    d3.selectAll("#pc-svg .pc-hit").style("pointer-events", "auto");
  }
}

// ── 绘制平行坐标图 ──────────────────────────────────────────
function drawParallelCoords(data) {
  if (!pcG) return;
  pcG.selectAll("*").remove();

  const fields = Adapter.ALL_NUMERIC_FIELDS; // 10 个维度
  const n = fields.length;
  const padLeft = 50, padRight = 50, padTop = 32, padBottom = 16;
  const fullW = 700, fullH = 440;
  const chartW = fullW - padLeft - padRight;
  const chartH = fullH - padTop - padBottom;
  const xScale = d3.scalePoint().domain(fields).range([0, chartW]).padding(0.6);
  const axisGap = xScale.step();

  // 准备数据 — 过滤有效记录
  const valid = data.filter(d => {
    for (const f of fields) { if (d[f] == null || !isFinite(d[f])) return false; }
    return true;
  });

  if (valid.length === 0) {
    pcG.append("text").attr("x", fullW / 2).attr("y", fullH / 2)
      .attr("text-anchor", "middle").attr("fill", "#7a8fa6").attr("font-size", "12px")
      .text("当前筛选条件下无有效数据");
    return;
  }

  if (!pcAnomalyData) { pcAnomalyData = {}; }

  // 分离正常和异常
  const normals = valid.filter(d => !pcAnomalyData[d.id]);
  const anomalies = valid.filter(d => pcAnomalyData[d.id]);

  // 为每个维度创建 scale
  const yScales = {};
  fields.forEach(f => {
    const ext = d3.extent(valid, d => +d[f]);
    const pad = (ext[1] - ext[0]) * 0.05 || 0.1;
    yScales[f] = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([chartH, 0]);
  });

  // 异常标记轴: 序数轴
  const anomalyY = d3.scalePoint().domain(["正常", "异常"]).range([chartH, 0]).padding(0.8);

  // 线条路径生成器
  function makeLine(d) {
    let path = "";
    fields.forEach((f, i) => {
      const cx = xScale(f);
      const cy = yScales[f](+d[f]);
      path += (i === 0 ? "M" : "L") + cx + "," + cy;
    });
    // 额外引到异常标记轴
    const ax = chartW + 35; // 异常轴位置
    const ay = pcAnomalyData[d.id] ? anomalyY("异常") : anomalyY("正常");
    path += "L" + ax + "," + ay;
    return path;
  }

  const g = pcG.append("g").attr("transform", `translate(${padLeft},${padTop})`);

  // 公共交互处理器（供 hit 层使用）
  function onLineEnter(event, d) {
    // 如果有已选中的线，且当前悬停的不是选中的线，则忽略
    if (pcSelectedIds.size > 0 && !pcSelectedIds.has(String(d.id))) {
      return;
    }
    pcHoveredId = String(d.id);
    applyPcLineStyles();
    const isAnomaly = pcAnomalyData[d.id];
    const parts = fields.map(f => {
      const val = (+d[f]).toFixed(2);
      if (isAnomaly) {
        const b = fieldBounds[f];
        const isExtreme = (b && (d[f] < b.lo || d[f] > b.hi)) ? " ⚠" : "";
        return `${Adapter.FIELD_SHORT[f]}: ${val}${isExtreme}`;
      }
      return `${Adapter.FIELD_SHORT[f]}: ${val}`;
    }).join("<br>");
    const html = isAnomaly
      ? `<strong>异常点 · ${d.region} · ${d.time}</strong><br>${parts}<br><span style="color:#cc3333;">模型: ${pcAnomalyMethod.toUpperCase()}</span>`
      : `<strong>正常点 · ${d.region} · ${d.time}</strong>${parts}`;
    showTooltip(event, html);
  }
  function onLineLeave() {
    pcHoveredId = null;
    applyPcLineStyles();
    hideTooltip();
  }
  function onLineClick(event, d) {
    event.stopPropagation();
    const id = String(d.id);
    if (pcSelectedIds.has(id)) {
      pcSelectedIds.delete(id);  // 取消选中 → 解锁全部
    } else {
      pcSelectedIds.clear();     // 清除之前的选中（单选）
      pcSelectedIds.add(id);     // 选中当前线 → 其他线锁定
    }
    applyPcLineStyles();
  }

  // ── 1. 正常线条视觉层（底层，不响应事件） ──
  g.selectAll(".pc-normal").data(normals).join("path")
    .attr("class", "pc-line pc-normal")
    .attr("data-id", d => String(d.id))
    .attr("d", d => makeLine(d))
    .attr("fill", "none")
    .attr("stroke", "#56B4E9")
    .attr("stroke-width", 0.8)
    .attr("stroke-opacity", 0.06)
    .attr("pointer-events", "none");

  // ── 2. 异常线条视觉层（上层，不响应事件） ──
  g.selectAll(".pc-anomaly").data(anomalies).join("path")
    .attr("class", "pc-line pc-anomaly")
    .attr("data-id", d => String(d.id))
    .attr("d", d => makeLine(d))
    .attr("fill", "none")
    .attr("stroke", "#cc3333")
    .attr("stroke-width", 1)
    .attr("stroke-opacity", 0.4)
    .attr("pointer-events", "none");

  // ── 3. 透明交互层（最上层，宽线确保可点击） ──
  g.selectAll(".pc-hit").data(valid).join("path")
    .attr("class", "pc-hit")
    .attr("data-id", d => String(d.id))
    .attr("d", d => makeLine(d))
    .attr("fill", "none")
    .attr("stroke", "transparent")
    .attr("stroke-width", 12)
    .style("cursor", "pointer")
    .style("pointer-events", "auto")
    .on("mouseenter", onLineEnter)
    .on("mouseleave", onLineLeave)
    .on("click", onLineClick);

  // 预计算各字段 IQR 边界（供 tooltip 标记极值）
  const fieldBounds = {};
  fields.forEach(f => {
    const vals = valid.map(dd => dd[f]).filter(v => v != null && isFinite(v)).sort(d3.ascending);
    const q1 = d3.quantile(vals, 0.25), q3 = d3.quantile(vals, 0.75), iqr = q3 - q1;
    fieldBounds[f] = { lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr };
  });

  // ── 3. 维度轴 ──
  fields.forEach(f => {
    const cx = xScale(f);
    const axis = d3.axisLeft(yScales[f]).ticks(4).tickFormat(d3.format(".2s")).tickSize(4);
    const axisG = g.append("g").attr("transform", `translate(${cx},0)`).call(axis);

    // 轴样式
    axisG.selectAll("line,path").attr("stroke", "#c8d6e5").attr("stroke-width", 0.8);
    axisG.selectAll("text").attr("font-size", "7px").attr("fill", "#7a8fa6");

    // 轴标签
    g.append("text")
      .attr("x", cx).attr("y", chartH + 20)
      .attr("text-anchor", "middle")
      .attr("font-size", "7px").attr("fill", "#5a6d80").attr("font-weight", "600")
      .text(Adapter.FIELD_SHORT[f]);
  });

  // ── 4. 异常标记轴 ──
  const ax = chartW + 35;
  g.append("line")
    .attr("x1", ax).attr("x2", ax).attr("y1", anomalyY("正常")).attr("y2", anomalyY("异常"))
    .attr("stroke", "#c8d6e5").attr("stroke-width", 1.2);
  // 正常刻度
  g.append("circle").attr("cx", ax).attr("cy", anomalyY("正常")).attr("r", 4).attr("fill", "#56B4E9").attr("stroke", "#fff").attr("stroke-width", 1);
  g.append("text").attr("x", ax + 8).attr("y", anomalyY("正常") + 3).attr("font-size", "8px").attr("fill", "#56B4E9").attr("font-weight", "600").text("正常");
  // 异常刻度
  g.append("circle").attr("cx", ax).attr("cy", anomalyY("异常")).attr("r", 4).attr("fill", "#cc3333").attr("stroke", "#fff").attr("stroke-width", 1);
  g.append("text").attr("x", ax + 8).attr("y", anomalyY("异常") + 3).attr("font-size", "8px").attr("fill", "#cc3333").attr("font-weight", "600").text("异常");
  // 轴标签
  g.append("text").attr("x", ax).attr("y", chartH + 20)
    .attr("text-anchor", "middle").attr("font-size", "7px").attr("fill", "#1a2b4a").attr("font-weight", "700")
    .text("异常标记");

  // ── 5. 图例 ──
  const legX = 10, legY = -12;
  const legG = g.append("g").attr("transform", `translate(${legX},${legY})`);
  legG.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 25).attr("y2", 0)
    .attr("stroke", "#56B4E9").attr("stroke-width", 1.5).attr("stroke-opacity", 0.6);
  legG.append("text").attr("x", 28).attr("y", 3).attr("font-size", "7px").attr("fill", "#5a6d80").text("正常");
  legG.append("line").attr("x1", 60).attr("y1", 0).attr("x2", 85).attr("y2", 0)
    .attr("stroke", "#cc3333").attr("stroke-width", 1.5).attr("stroke-opacity", 0.6);
  legG.append("text").attr("x", 88).attr("y", 3).attr("font-size", "7px").attr("fill", "#5a6d80").text("异常");
  // 异常计数
  legG.append("text").attr("x", 140).attr("y", 3)
    .attr("font-size", "7px").attr("fill", "#7a8fa6")
    .text(`异常: ${anomalies.length}/${valid.length} (${(anomalies.length / valid.length * 100).toFixed(1)}%) · ${pcAnomalyMethod.toUpperCase()}`);
  applyPcLineStyles();
}

// --- 13. 全量渲染 ---

function fullRender() {
  const data = prepareData();
  if (!infoCollapsed) {
    updateInfoPanel(data);
    if (lofResult) renderLofPanel();
    if (aeResult) renderAePanel();
  }
  drawHeatmap();
  drawBivariateChart(data);
  // 仅在平行坐标图可见时绘制
  if (!d3.select("#parallel-coord-card").classed("collapsed")) {
    drawParallelCoords(data);
  }
}


// --- 14. 主流程初始化 ---

async function init() {
  TOOLTIP = d3.select("#tooltip");
  initSVGs();
  initInfoToggle();
  initToolbar();
  initBivariateClose();

  // 初始状态：热力图(左) + 平行坐标图(右)
  d3.select("#heatmap-thumb-card").classed("expanded", false);

  try {
    const resp = await d3.json(DATA_PATH);
    const raw = resp.data || resp;
    imputeMissing(raw);
    cleanData = raw;
    corrMatrix = computeCorrelationMatrix(raw);

    // 启动时自动加载 LOF 异常检测结果
    try {
      await updateAnomalyFlags();
    } catch (e) {
      console.warn("自动加载异常检测失败:", e.message);
      pcAnomalyData = {};
    }

    try {
      const world = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
      worldMapData = topojson.feature(world, world.objects.countries);
    } catch (e) { console.warn("世界地图加载失败:", e.message); }

    fullRender();
  } catch (err) {
    console.error("系统初始化失败:", err);
    const errMsg = err.message || String(err);
    d3.select("#hm-svg").append("text")
      .attr("x", 200).attr("y", 160).attr("text-anchor", "middle")
      .attr("fill", "#cc3333").attr("font-size", "14px").attr("font-weight", "600")
      .text("数据加载失败");
    d3.select("#hm-svg").append("text")
      .attr("x", 200).attr("y", 185).attr("text-anchor", "middle")
      .attr("fill", "#8a9ab0").attr("font-size", "10px")
      .text(errMsg);
    d3.select("#hm-svg").append("text")
      .attr("x", 200).attr("y", 210).attr("text-anchor", "middle")
      .attr("fill", "#b0bec5").attr("font-size", "9px")
      .text("请确认 API 服务已启动 (端口 5000) 且数据可访问");
    d3.select("#render-info").text("加载失败 | " + errMsg);
  }
}

init();
