/* =============================================================================
 * view_nebula.js —— 主视图：海域多维耦合星云（Plotly 3D，本组创新图表）
 * -----------------------------------------------------------------------------
 *  X/Y/Z = PCA 三个主成分；颜色 = 海域；点大小 = CO₂浓度
 *  联动：框选样本 -> 写入 DA.state（演变/归因视图响应）
 *        热力图选中维度 -> 按该维度连续着色（按 id 关联 records 取值）
 * ===========================================================================*/

const ViewNebula = (function () {
  const EL = "nebula-plot";
  let built = false;
  let points = [];
  let coloring = "region";            // 'region' 或某个维度名
  const hiddenRegions = new Set();    // 自定义图例隐藏的海域

  const goal =
    "把高维耦合压进可旋转的三维空间，观察各海域是否各自聚成一团“星云”。" +
    "框选一批样本，可在“演变”“归因”视图中联动查看其温度与预测细节。";

  function co2Size(co2, min, max) {
    return 3 + 7 * ((co2 - min) / (max - min || 1));   // 3~10px
  }

  function buildRegionTraces() {
    const co2s = points.map((p) => p.co2);
    const cMin = Math.min(...co2s), cMax = Math.max(...co2s);
    return DA.REGIONS.map((region) => {
      const pts = points.filter((p) => p.region === region);
      return {
        type: "scatter3d", mode: "markers", name: region,
        x: pts.map((p) => p.pc1), y: pts.map((p) => p.pc2), z: pts.map((p) => p.pc3),
        customdata: pts.map((p) => p.id),
        text: pts.map((p) => `${region}<br>SST ${p.sst}°C · CO₂ ${p.co2}ppm`),
        hovertemplate: "%{text}<extra></extra>",
        visible: hiddenRegions.has(region) ? "legendonly" : true,
        marker: {
          size: pts.map((p) => co2Size(p.co2, cMin, cMax)),
          color: DA.color(region), opacity: 0.8,
          line: { width: 0 },
        },
      };
    });
  }

  function buildDimTrace(dim) {
    // 按某维度连续着色：逐点从 records 取该维度真实值
    const vals = points.map((p) => {
      const rec = DA.recordById(p.id);
      return rec ? rec[dim] : null;
    });
    const co2s = points.map((p) => p.co2);
    const cMin = Math.min(...co2s), cMax = Math.max(...co2s);
    const unit = DA.dimUnit(dim);
    return [{
      type: "scatter3d", mode: "markers", name: DA.dimLabel(dim),
      x: points.map((p) => p.pc1), y: points.map((p) => p.pc2), z: points.map((p) => p.pc3),
      customdata: points.map((p) => p.id),
      text: points.map((p, i) => `${p.region}<br>${DA.dimLabel(dim)} ${vals[i]}${unit}`),
      hovertemplate: "%{text}<extra></extra>",
      marker: {
        size: points.map((p) => co2Size(p.co2, cMin, cMax)),
        color: vals, colorscale: "Viridis", opacity: 0.85,
        colorbar: { title: DA.dimLabel(dim) + (unit ? `/${unit}` : ""), thickness: 12, len: 0.6,
                    titlefont: { color: "#9aa7b4" }, tickfont: { color: "#9aa7b4" } },
        line: { width: 0 },
      },
    }];
  }

  function layout() {
    const axis = {
      backgroundcolor: "#0e1116", gridcolor: "#2a3340", zerolinecolor: "#3a4654",
      color: "#9aa7b4", showbackground: true,
    };
    return {
      paper_bgcolor: "#0e1116", plot_bgcolor: "#0e1116",
      margin: { l: 0, r: 0, t: 0, b: 0 },
      showlegend: false,
      scene: {
        xaxis: { ...axis, title: "主成分1 (PC1)" },
        yaxis: { ...axis, title: "主成分2 (PC2)" },
        zaxis: { ...axis, title: "主成分3 (PC3)" },
      },
      font: { color: "#9aa7b4", size: 11 },
    };
  }

  function traces() {
    return coloring === "region" ? buildRegionTraces() : buildDimTrace(coloring);
  }

  function render() {
    if (built) return;
    points = DA.pcaPoints();
    const config = { displayModeBar: true, responsive: true,
      modeBarButtonsToRemove: ["resetCameraLastSave3d"] };
    Plotly.newPlot(EL, traces(), layout(), config);
    buildLegend();

    // 框选联动：收集选中点 id -> 统计摘要 -> 全局状态
    document.getElementById(EL).on("plotly_selected", (ev) => {
      if (!ev || !ev.points || !ev.points.length) return;
      const ids = ev.points.map((p) => p.customdata);
      pushSelection(ids);
    });
    document.getElementById(EL).on("plotly_deselect", () => DA.state.reset("nebula"));
    built = true;
  }

  function pushSelection(ids) {
    const recs = ids.map((id) => DA.recordById(id)).filter(Boolean);
    if (!recs.length) return;
    const ssts = recs.map((r) => r.sst);
    const byRegion = {};
    recs.forEach((r) => { byRegion[r.region] = (byRegion[r.region] || 0) + 1; });
    const dominant = Object.entries(byRegion).sort((a, b) => b[1] - a[1])[0][0];
    const stats = {
      count: recs.length,
      sstMean: d3.mean(ssts), sstMin: d3.min(ssts), sstMax: d3.max(ssts),
      co2Mean: d3.mean(recs, (r) => r.co2),
      byRegion, dominant,
    };
    DA.state.set({ selectedIds: new Set(ids), selectedStats: stats, region: dominant }, "nebula");
  }

  function buildLegend() {
    const host = document.getElementById("nebula-legend");
    if (coloring !== "region") { host.innerHTML =
      `<div class="hint">当前按「${DA.dimLabel(coloring)}」连续着色，颜色条见右上。点顶栏「重置联动」可切回海域着色。</div>`; return; }
    host.innerHTML = "";
    DA.REGIONS.forEach((region, i) => {
      const item = document.createElement("div");
      item.className = "legend-item" + (hiddenRegions.has(region) ? " off" : "");
      item.innerHTML =
        `<span class="legend-swatch" style="background:${DA.color(region)}"></span>${region}`;
      item.onclick = () => {
        if (hiddenRegions.has(region)) hiddenRegions.delete(region);
        else hiddenRegions.add(region);
        Plotly.restyle(EL, { visible: hiddenRegions.has(region) ? "legendonly" : true }, [i]);
        item.classList.toggle("off");
      };
      host.appendChild(item);
    });
  }

  function setColoring(dim) {
    coloring = dim;
    if (built) { Plotly.react(EL, traces(), layout()); buildLegend(); }
  }

  // 接收全局状态：热力图选维度 -> 重新着色
  function onState(state, patch, origin) {
    if (origin === "nebula") return;
    if (patch.highlightDims) {
      setColoring(patch.highlightDims[0]);   // 按选中的第一个维度着色
    } else if (patch.highlightDims === null && coloring !== "region") {
      setColoring("region");
    }
  }

  function resize() { if (built) Plotly.Plots.resize(EL); }

  return { id: "nebula", goal, render, onState, resize };
})();
