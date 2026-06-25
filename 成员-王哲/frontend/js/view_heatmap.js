/* =============================================================================
 * view_heatmap.js —— 维度之间的相互牵动（D3 相关矩阵）
 * -----------------------------------------------------------------------------
 *  16(13)维两两 Pearson 相关，蓝-白-红发散色阶。
 *  点击某格 -> 高亮该对维度，并让星云图按这两维之一重新着色（联动）。
 * ===========================================================================*/

const ViewHeatmap = (function () {
  const EL = "coupling-body";
  let built = false;
  let selected = null;            // {i, j}

  const goal =
    "找出彼此牵动最强的海洋-大气维度。颜色越红越正相关、越蓝越负相关；" +
    "点击任一格，主视图星云图会按对应维度重新着色，验证它在空间上的分布。";

  function tip() {
    let t = document.querySelector(".tooltip.hm");
    if (!t) { t = document.createElement("div"); t.className = "tooltip hm"; t.style.display = "none";
      document.body.appendChild(t); }
    return t;
  }

  function render() {
    if (built) return;
    const host = document.getElementById(EL);
    host.innerHTML = "";
    const corr = DA.correlation();
    const labels = corr.labels, M = corr.matrix;
    const n = labels.length;

    const box = host.getBoundingClientRect();
    const margin = { top: 14, right: 18, bottom: 96, left: 96 };
    const size = Math.min(box.width - margin.left - margin.right,
                          box.height - margin.top - margin.bottom);
    const cell = size / n;

    const svg = d3.select(host).append("svg")
      .attr("width", size + margin.left + margin.right)
      .attr("height", size + margin.top + margin.bottom);
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const color = d3.scaleLinear().domain([-1, 0, 1])
      .range(["#0072B2", "#f5f5f5", "#D55E00"]).clamp(true);
    const t = tip();

    // 单元格
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        g.append("rect")
          .attr("x", j * cell).attr("y", i * cell)
          .attr("width", cell - 1).attr("height", cell - 1)
          .attr("fill", color(M[i][j]))
          .attr("data-i", i).attr("data-j", j)
          .style("cursor", "pointer")
          .on("mousemove", (e) => {
            t.style.display = "block";
            t.style.left = (e.clientX + 12) + "px";
            t.style.top = (e.clientY + 12) + "px";
            t.innerHTML = `${DA.dimLabel(labels[i])} × ${DA.dimLabel(labels[j])}<br>相关系数 <b>${M[i][j].toFixed(2)}</b>`;
          })
          .on("mouseleave", () => (t.style.display = "none"))
          .on("click", () => selectCell(i, j, labels));
      }
    }

    // 坐标标签（中文）
    g.selectAll("text.row").data(labels).join("text").attr("class", "row")
      .attr("x", -6).attr("y", (d, i) => i * cell + cell / 2)
      .attr("text-anchor", "end").attr("dominant-baseline", "middle")
      .attr("fill", "#9aa7b4").style("font-size", "10.5px").text((d) => DA.dimLabel(d));
    g.selectAll("text.col").data(labels).join("text").attr("class", "col")
      .attr("transform", (d, i) => `translate(${i * cell + cell / 2},${size + 8}) rotate(45)`)
      .attr("text-anchor", "start").attr("fill", "#9aa7b4").style("font-size", "10.5px")
      .text((d) => DA.dimLabel(d));

    // 图例色条
    const lg = svg.append("g").attr("transform", `translate(${margin.left},${size + margin.top + 56})`);
    const lw = Math.min(220, size);
    const defs = svg.append("defs");
    const grad = defs.append("linearGradient").attr("id", "corr-grad");
    [["0%", -1], ["50%", 0], ["100%", 1]].forEach(([o, v]) =>
      grad.append("stop").attr("offset", o).attr("stop-color", color(v)));
    lg.append("rect").attr("width", lw).attr("height", 9).attr("fill", "url(#corr-grad)").attr("rx", 2);
    lg.append("text").attr("x", 0).attr("y", 24).attr("fill", "#9aa7b4").style("font-size", "10px").text("-1 负相关");
    lg.append("text").attr("x", lw).attr("y", 24).attr("text-anchor", "end")
      .attr("fill", "#9aa7b4").style("font-size", "10px").text("正相关 +1");

    this._g = g; this._cell = cell; this._labels = labels;
    built = true;
  }

  function selectCell(i, j, labels) {
    selected = { i, j };
    // 高亮：清除旧描边，给选中格描边
    d3.select("#" + EL).selectAll("rect[data-i]").attr("stroke", null);
    d3.select("#" + EL).selectAll(`rect[data-i='${i}'][data-j='${j}']`)
      .attr("stroke", "#fff").attr("stroke-width", 2);
    // 联动：让星云按这两维之一着色（取行维度）
    DA.state.set({ highlightDims: [labels[i], labels[j]] }, "heatmap");
  }

  function onState() {}
  function resize() { if (built) { built = false; render.call(ViewHeatmap); } }

  return { id: "coupling", goal, render, onState, resize };
})();
