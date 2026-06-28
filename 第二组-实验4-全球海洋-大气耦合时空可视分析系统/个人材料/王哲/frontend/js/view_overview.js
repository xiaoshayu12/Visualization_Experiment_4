/* =============================================================================
 * view_overview.js —— 总览：海域碳-温状态总览（导航入口的概览图）
 * 回答：数据规模、各海域温度/碳概况、模型整体表现。纯概览，不参与框选联动。
 * ===========================================================================*/

const ViewOverview = (function () {
  let rendered = false;

  const goal =
    "进入分析前的全局概览：掌握数据体量、6 个海域的温度与 CO₂ 水平，以及预测模型的整体精度。";

  function kpiCard(num, lab) {
    return `<div class="ov-card ov-kpi"><div class="num">${num}</div><div class="lab">${lab}</div></div>`;
  }

  function render() {
    if (rendered) return;
    const host = document.getElementById("overview-body");

    const stats = DA.regionStats();
    const pred = DA.prediction();
    const exp = DA.pcaExplained();
    const recs = DA.records();
    const rf = (pred.metrics && pred.metrics.random_forest) || {};

    const nRecords = recs.length;
    const sstAll = stats.length
      ? (stats.reduce((s, r) => s + r.sst_mean * r.count, 0) /
         stats.reduce((s, r) => s + r.count, 0))
      : 0;

    // ---- KPI 行 ----
    let html = "";
    html += kpiCard(nRecords.toLocaleString(), "清洗后记录数");
    html += kpiCard(DA.REGIONS.length, "海域数 · 2020–2022");
    html += kpiCard(rf.r2 != null ? rf.r2 : "—", "随机森林 R²（测试集）");
    html += kpiCard(sstAll.toFixed(1) + "°C", "全局平均海表温度");

    // ---- 各海域 SST 概况（条形）----
    html += `<div class="ov-card ov-wide" id="ov-sst"><h4>各海域海表温度均值 <span class="sub">含极值范围</span></h4></div>`;
    // ---- 特征重要性（条形）----
    html += `<div class="ov-card ov-wide" id="ov-imp"><h4>哪些维度最能决定海温 <span class="sub">随机森林特征重要性</span></h4></div>`;
    // ---- PCA 解释率 ----
    html += `<div class="ov-card ov-wide" id="ov-pca"><h4>三维星云保留了多少信息 <span class="sub">主成分方差解释率</span></h4></div>`;
    // ---- 模型对比 ----
    html += `<div class="ov-card ov-wide" id="ov-metric"><h4>预测模型表现对比 <span class="sub">测试集 8:2 划分</span></h4></div>`;

    host.innerHTML = html;

    drawSstBars(stats);
    drawImportance(DA.featureImportance().importance || []);
    drawPcaExplained(exp);
    drawMetrics(pred.metrics || {});
    rendered = true;
  }

  function drawSstBars(stats) {
    const el = document.getElementById("ov-sst");
    const w = el.clientWidth - 30, rowH = 26, h = stats.length * rowH + 10;
    const svg = d3.select(el).append("svg").attr("width", w).attr("height", h);
    const max = d3.max(stats, (d) => d.sst_max), min = d3.min(stats, (d) => d.sst_min);
    const x = d3.scaleLinear().domain([Math.min(0, min), max]).range([70, w - 50]);
    const g = svg.selectAll("g").data(stats).join("g")
      .attr("transform", (d, i) => `translate(0,${i * rowH + 6})`);
    g.append("text").attr("x", 0).attr("y", 13).attr("fill", "#9aa7b4")
      .style("font-size", "11px").text((d) => d.region);
    // 极值范围线
    g.append("line").attr("x1", (d) => x(d.sst_min)).attr("x2", (d) => x(d.sst_max))
      .attr("y1", 9).attr("y2", 9).attr("stroke", "#3a4654").attr("stroke-width", 2);
    // 均值点
    g.append("circle").attr("cx", (d) => x(d.sst_mean)).attr("cy", 9).attr("r", 5)
      .attr("fill", (d) => DA.color(d.region));
    g.append("text").attr("x", w - 44).attr("y", 13).attr("fill", "#e6edf3")
      .style("font-size", "11px").text((d) => d.sst_mean.toFixed(1) + "°C");
  }

  function drawImportance(items) {
    const el = document.getElementById("ov-imp");
    const data = items.slice(0, 9);
    const w = el.clientWidth - 30, rowH = 22, h = data.length * rowH + 8;
    const svg = d3.select(el).append("svg").attr("width", w).attr("height", h);
    const x = d3.scaleLinear().domain([0, d3.max(data, (d) => d.importance)]).range([90, w - 50]);
    const g = svg.selectAll("g").data(data).join("g")
      .attr("transform", (d, i) => `translate(0,${i * rowH + 4})`);
    g.append("text").attr("x", 0).attr("y", 12).attr("fill", "#9aa7b4")
      .style("font-size", "11px").text((d) => DA.dimLabel(d.feature));
    g.append("rect").attr("x", 90).attr("y", 3).attr("height", 12)
      .attr("width", (d) => x(d.importance) - 90).attr("rx", 3).attr("fill", "#58a6ff");
    g.append("text").attr("x", (d) => x(d.importance) + 6).attr("y", 13).attr("fill", "#e6edf3")
      .style("font-size", "10.5px").text((d) => (d.importance * 100).toFixed(1) + "%");
  }

  function drawPcaExplained(exp) {
    const el = document.getElementById("ov-pca");
    const ratios = exp.explained_variance_ratio || [];
    const comps = exp.components || ratios.map((_, i) => "PC" + (i + 1));
    const cum = exp.cumulative != null ? (exp.cumulative * 100).toFixed(1) : "—";
    el.insertAdjacentHTML("beforeend",
      `<p style="margin:0 0 8px;color:#9aa7b4;font-size:11.5px">三个主成分累计解释 <b style="color:#e6edf3">${cum}%</b> 的方差，是星云图三个坐标轴的信息基础。</p>`);
    const w = el.clientWidth - 30, h = 70;
    const svg = d3.select(el).append("svg").attr("width", w).attr("height", h);
    const x = d3.scaleBand().domain(comps).range([20, w - 20]).padding(0.4);
    const y = d3.scaleLinear().domain([0, d3.max(ratios) * 1.2 || 1]).range([h - 20, 8]);
    svg.selectAll("rect").data(ratios).join("rect")
      .attr("x", (d, i) => x(comps[i])).attr("width", x.bandwidth())
      .attr("y", (d) => y(d)).attr("height", (d) => h - 20 - y(d))
      .attr("rx", 3).attr("fill", "#009E73");
    svg.selectAll("text.v").data(ratios).join("text").attr("class", "v")
      .attr("x", (d, i) => x(comps[i]) + x.bandwidth() / 2).attr("y", (d) => y(d) - 4)
      .attr("text-anchor", "middle").attr("fill", "#e6edf3").style("font-size", "11px")
      .text((d) => (d * 100).toFixed(1) + "%");
    svg.selectAll("text.l").data(comps).join("text").attr("class", "l")
      .attr("x", (d) => x(d) + x.bandwidth() / 2).attr("y", h - 6)
      .attr("text-anchor", "middle").attr("fill", "#9aa7b4").style("font-size", "11px").text((d) => d);
  }

  function drawMetrics(metrics) {
    const el = document.getElementById("ov-metric");
    const rf = metrics.random_forest || {}, lr = metrics.linear_regression || {};
    el.insertAdjacentHTML("beforeend", `
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <tr style="color:#9aa7b4"><th style="text-align:left;padding:4px 0">模型</th>
          <th style="text-align:right">R²</th><th style="text-align:right">MAE</th><th style="text-align:right">RMSE</th></tr>
        <tr><td style="padding:5px 0">随机森林（主，预测+归因）</td>
          <td style="text-align:right;color:#58a6ff">${rf.r2 ?? "—"}</td>
          <td style="text-align:right">${rf.mae ?? "—"}</td><td style="text-align:right">${rf.rmse ?? "—"}</td></tr>
        <tr><td style="padding:5px 0">线性回归（对比，可解释）</td>
          <td style="text-align:right">${lr.r2 ?? "—"}</td>
          <td style="text-align:right">${lr.mae ?? "—"}</td><td style="text-align:right">${lr.rmse ?? "—"}</td></tr>
      </table>`);
  }

  // 概览不参与联动
  function onState() {}
  function resize() {}

  return { id: "overview", goal, render, onState, resize };
})();
