/* =============================================================================
 * view_forecast.js —— 海温的过去、当下与未来（D3 时序）
 * -----------------------------------------------------------------------------
 *  原始SST散点 + 滑动平均趋势线（随 W 实时重算）+ 未来预测虚线 + 置信带。
 *  控制：海域下拉、平滑窗口 W 滑块。联动：响应全局 region。
 * ===========================================================================*/

const ViewForecast = (function () {
  const EL = "forecast-plot";
  let region = null, W = 10, inited = false;

  const goal =
    "看清某海域温度过去怎么变、当前什么趋势、未来半年走向。" +
    "实线为滑动平均趋势（拖动 W 实时重算），右端虚线与色带是训练模型给出的预测与置信区间。";

  const parse = d3.timeParse("%Y-%m-%d");

  // 客户端重算平滑（与后端 pandas 口径一致）
  function rollingMean(arr, w) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const s = Math.max(0, i - w + 1);
      let sum = 0; for (let k = s; k <= i; k++) sum += arr[k];
      out.push(sum / (i - s + 1));
    }
    return out;
  }
  function ewm(arr, span) {
    const a = 2 / (span + 1); const out = []; let prev;
    arr.forEach((v, i) => { prev = i === 0 ? v : a * v + (1 - a) * prev; out.push(prev); });
    return out;
  }

  function tip() {
    let t = document.querySelector(".tooltip.fc");
    if (!t) { t = document.createElement("div"); t.className = "tooltip fc"; t.style.display = "none";
      document.body.appendChild(t); }
    return t;
  }

  function draw() {
    const host = document.getElementById(EL);
    host.innerHTML = "";
    const series = (DA.smoothed().series || {})[region] || [];
    const fc = (DA.forecast().series || {})[region];
    if (!series.length) return;

    const raw = series.map((d) => d.sst_raw);
    const ma = rollingMean(raw, W);
    const dates = series.map((d) => parse(d.time));
    const hist = dates.map((t, i) => ({ t, raw: raw[i], ma: ma[i] }));

    const fpts = fc ? fc.forecast.map((p) => ({ t: parse(p.time), y: p.yhat, lo: p.lower, hi: p.upper })) : [];
    const anchor = fc ? { t: parse(fc.anchor.time), y: fc.anchor.sst_ewm } : null;

    const box = host.getBoundingClientRect();
    const m = { top: 14, right: 18, bottom: 28, left: 42 };
    const w = box.width - m.left - m.right, h = box.height - m.top - m.bottom;
    const svg = d3.select(host).append("svg").attr("width", box.width).attr("height", box.height);
    const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

    const allT = dates.concat(fpts.map((p) => p.t));
    const x = d3.scaleTime().domain(d3.extent(allT)).range([0, w]);
    const yMin = d3.min(raw.concat(fpts.map((p) => p.lo)));
    const yMax = d3.max(raw.concat(fpts.map((p) => p.hi)));
    const y = d3.scaleLinear().domain([yMin - 1, yMax + 1]).range([h, 0]);

    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat("%Y-%m")));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6));
    g.append("text").attr("x", -m.left + 4).attr("y", -3).attr("fill", "#9aa7b4")
      .style("font-size", "10px").text("SST/°C");

    // 原始散点（半透明）
    g.selectAll("circle.raw").data(hist).join("circle").attr("class", "raw")
      .attr("cx", (d) => x(d.t)).attr("cy", (d) => y(d.raw)).attr("r", 1.6)
      .attr("fill", DA.color(region)).attr("opacity", 0.28);

    // 滑动平均趋势线
    const lineMA = d3.line().x((d) => x(d.t)).y((d) => y(d.ma));
    g.append("path").datum(hist).attr("fill", "none")
      .attr("stroke", DA.color(region)).attr("stroke-width", 2).attr("d", lineMA);

    // 未来置信带 + 预测虚线
    if (fpts.length) {
      const band = [anchor ? { t: anchor.t, lo: anchor.y, hi: anchor.y } : fpts[0]].concat(fpts);
      const area = d3.area().x((d) => x(d.t)).y0((d) => y(d.lo)).y1((d) => y(d.hi));
      g.append("path").datum(band).attr("fill", DA.color(region)).attr("opacity", 0.16).attr("d", area);
      const fline = d3.line().x((d) => x(d.t)).y((d) => y(d.y));
      const dashData = anchor ? [{ t: anchor.t, y: anchor.y }].concat(fpts) : fpts;
      g.append("path").datum(dashData).attr("fill", "none").attr("stroke", DA.color(region))
        .attr("stroke-width", 2).attr("stroke-dasharray", "5 4").attr("d", fline);
      g.selectAll("circle.fc").data(fpts).join("circle").attr("class", "fc")
        .attr("cx", (d) => x(d.t)).attr("cy", (d) => y(d.y)).attr("r", 2.4)
        .attr("fill", "#fff").attr("stroke", DA.color(region));
      // 历史/未来分界线
      if (anchor) g.append("line").attr("x1", x(anchor.t)).attr("x2", x(anchor.t))
        .attr("y1", 0).attr("y2", h).attr("stroke", "#3a4654").attr("stroke-dasharray", "2 3");
    }

    // 图例
    const lg = svg.append("g").attr("transform", `translate(${m.left + 8},${m.top + 4})`);
    const legends = [["原始观测", DA.color(region), "dot"], ["滑动平均趋势", DA.color(region), "line"],
      ["模型预测", DA.color(region), "dash"], ["95%置信区间", DA.color(region), "band"]];
    legends.forEach((l, i) => {
      const gg = lg.append("g").attr("transform", `translate(${i * 110},0)`);
      if (l[2] === "dot") gg.append("circle").attr("cx", 4).attr("cy", 4).attr("r", 2.4).attr("fill", l[1]).attr("opacity", .5);
      else if (l[2] === "band") gg.append("rect").attr("y", 1).attr("width", 16).attr("height", 7).attr("fill", l[1]).attr("opacity", .2);
      else gg.append("line").attr("x1", 0).attr("x2", 16).attr("y1", 4).attr("y2", 4)
        .attr("stroke", l[1]).attr("stroke-width", 2).attr("stroke-dasharray", l[2] === "dash" ? "4 3" : null);
      gg.append("text").attr("x", 22).attr("y", 8).attr("fill", "#9aa7b4").style("font-size", "10.5px").text(l[0]);
    });
  }

  function ensureControls() {
    if (inited) return;
    const sel = document.getElementById("fc-region");
    DA.REGIONS.forEach((r) => sel.add(new Option(r, r)));
    region = region || DA.REGIONS[0];
    sel.value = region;
    sel.onchange = () => { region = sel.value; DA.state.set({ region }, "forecast"); draw(); };

    const slider = document.getElementById("fc-window");
    const wv = document.getElementById("fc-w-val");
    slider.value = W;
    slider.oninput = () => { W = +slider.value; wv.textContent = W; DA.state.set({ window: W }, "forecast"); draw(); };
    inited = true;
  }

  function render() { ensureControls(); if (!region) region = DA.REGIONS[0]; draw(); }

  function onState(state, patch, origin) {
    if (origin === "forecast") return;
    let need = false;
    if (patch.region && patch.region !== region) {
      region = patch.region; const sel = document.getElementById("fc-region"); if (sel) sel.value = region; need = true;
    }
    if (patch.window && patch.window !== W) {
      W = patch.window; const sl = document.getElementById("fc-window");
      if (sl) { sl.value = W; document.getElementById("fc-w-val").textContent = W; } need = true;
    }
    if (need && document.getElementById("view-forecast").classList.contains("active")) draw();
  }

  function resize() { if (region && document.getElementById("view-forecast").classList.contains("active")) draw(); }

  return { id: "forecast", goal, render, onState, resize };
})();
