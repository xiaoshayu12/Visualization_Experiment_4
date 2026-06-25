/* =============================================================================
 * view_waterfall.js —— 这个温度是怎么算出来的（D3 归因拆解）
 * -----------------------------------------------------------------------------
 *  选定一个预测样本，从基准值出发逐维累加各维度贡献，得到最终预测值。
 *  正贡献暖色、负贡献冷色；并标注随机森林预测值与真实值作参照。
 *  数据来自 prediction.json（线性模型可精确分解：基准 + Σ贡献 = 线性预测）。
 * ===========================================================================*/

const ViewWaterfall = (function () {
  const EL = "waterfall-plot";
  let region = null, inited = false, current = null;

  const goal =
    "拆解单个样本的温度预测：从基准值出发，每个维度把温度往上(暖色)或往下(冷色)推了多少，" +
    "最终累加成预测值。可与星云图框选联动，聚焦选中样本。";

  function tip() {
    let t = document.querySelector(".tooltip.wf");
    if (!t) { t = document.createElement("div"); t.className = "tooltip wf"; t.style.display = "none";
      document.body.appendChild(t); }
    return t;
  }

  function testForRegion(r) {
    return DA.prediction().test.filter((d) => d.region === r);
  }

  function fillSamples(preferId) {
    const sel = document.getElementById("wf-sample");
    sel.innerHTML = "";
    const list = testForRegion(region);
    list.forEach((d) => sel.add(new Option(`#${d.id} · ${d.time} · 实测${d.y_true}°C`, d.id)));
    if (preferId && list.some((d) => d.id === preferId)) sel.value = preferId;
    current = list.find((d) => d.id === (+sel.value)) || list[0];
  }

  function draw() {
    const host = document.getElementById(EL);
    host.innerHTML = "";
    if (!current) { host.innerHTML = `<p class="hint" style="padding:20px">该海域测试集中暂无样本。</p>`; return; }

    const keys = DA.prediction().waterfall_keys || Object.keys(current.contributions);
    const base = current.baseline;
    let run = base;
    const bars = [{ label: "基准值", y0: 0, y1: base, val: base, kind: "base" }];
    keys.forEach((k) => {
      const c = current.contributions[k] || 0;
      bars.push({ label: DA.dimLabel(k), y0: run, y1: run + c, val: c, kind: c >= 0 ? "pos" : "neg" });
      run += c;
    });
    bars.push({ label: "预测值(线性)", y0: 0, y1: run, val: run, kind: "total" });

    const box = host.getBoundingClientRect();
    const m = { top: 16, right: 18, bottom: 64, left: 44 };
    const w = box.width - m.left - m.right, h = box.height - m.top - m.bottom;
    const svg = d3.select(host).append("svg").attr("width", box.width).attr("height", box.height);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

    const x = d3.scaleBand().domain(bars.map((b) => b.label)).range([0, w]).padding(0.3);
    const lo = d3.min(bars, (b) => Math.min(b.y0, b.y1));
    const hi = d3.max(bars, (b) => Math.max(b.y0, b.y1, current.y_true, current.y_pred));
    const y = d3.scaleLinear().domain([Math.min(0, lo) - 1, hi + 1]).range([h, 0]);

    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x)).selectAll("text")
      .attr("transform", "rotate(40)").attr("text-anchor", "start").attr("dx", "4");
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6));
    g.append("text").attr("x", -m.left + 4).attr("y", -4).attr("fill", "#9aa7b4")
      .style("font-size", "10px").text("SST/°C");

    const fill = { base: "#8896a5", total: "#58a6ff", pos: "#D55E00", neg: "#0072B2" };
    const t = tip();
    g.selectAll("rect.bar").data(bars).join("rect").attr("class", "bar")
      .attr("x", (b) => x(b.label)).attr("width", x.bandwidth())
      .attr("y", (b) => y(Math.max(b.y0, b.y1))).attr("height", (b) => Math.abs(y(b.y0) - y(b.y1)) + 0.5)
      .attr("rx", 2).attr("fill", (b) => fill[b.kind])
      .on("mousemove", (e, b) => {
        t.style.display = "block"; t.style.left = (e.clientX + 12) + "px"; t.style.top = (e.clientY + 12) + "px";
        t.innerHTML = b.kind === "pos" || b.kind === "neg"
          ? `${b.label} 贡献 <b>${b.val >= 0 ? "+" : ""}${b.val.toFixed(2)}°C</b>`
          : `${b.label}：<b>${b.y1.toFixed(2)}°C</b>`;
      }).on("mouseleave", () => (t.style.display = "none"));

    // 连接线
    g.selectAll("line.link").data(bars.slice(0, -1)).join("line").attr("class", "link")
      .attr("x1", (b) => x(b.label) + x.bandwidth()).attr("x2", (b, i) => x(bars[i + 1].label))
      .attr("y1", (b) => y(b.y1)).attr("y2", (b) => y(b.y1))
      .attr("stroke", "#3a4654").attr("stroke-dasharray", "2 2");

    // 参照：真实值 + 随机森林预测值
    [["真实值", current.y_true, "#fff"], ["随机森林预测", current.y_pred, "#E69F00"]].forEach((ref, i) => {
      g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(ref[1])).attr("y2", y(ref[1]))
        .attr("stroke", ref[2]).attr("stroke-width", 1).attr("stroke-dasharray", "6 4").attr("opacity", .7);
      g.append("text").attr("x", w).attr("y", y(ref[1]) - 4 - i * 0).attr("text-anchor", "end")
        .attr("fill", ref[2]).style("font-size", "10.5px").text(`${ref[0]} ${ref[1]}°C`);
    });
  }

  function ensureControls() {
    if (inited) return;
    const rs = document.getElementById("wf-region");
    DA.REGIONS.forEach((r) => rs.add(new Option(r, r)));
    region = region || DA.REGIONS[0];
    rs.value = region;
    rs.onchange = () => { region = rs.value; fillSamples(); draw(); };
    document.getElementById("wf-sample").onchange = (e) => {
      current = testForRegion(region).find((d) => d.id === (+e.target.value)); draw();
    };
    inited = true;
  }

  function render() { ensureControls(); if (!region) region = DA.REGIONS[0]; fillSamples(current && current.id); draw(); }

  function onState(state, patch, origin) {
    if (origin === "waterfall") return;
    let need = false, preferId = null;
    if (patch.region && patch.region !== region) {
      region = patch.region; const rs = document.getElementById("wf-region"); if (rs) rs.value = region; need = true;
    }
    // 若有框选样本，优先选中其中落在本海域测试集里的第一个
    if (patch.selectedIds && patch.selectedIds.size) {
      const inTest = testForRegion(region).find((d) => patch.selectedIds.has(d.id));
      if (inTest) { preferId = inTest.id; need = true; }
    }
    if (need) { fillSamples(preferId); if (document.getElementById("view-waterfall").classList.contains("active")) draw(); }
  }

  function resize() { if (region && document.getElementById("view-waterfall").classList.contains("active")) draw(); }

  return { id: "waterfall", goal, render, onState, resize };
})();
