/* =============================================================================
 * app.js —— 控制器：导航切换 / 信息面板 / 状态栏 / 弹窗 / 三级任务
 * 装配所有视图，订阅 DA.state 实现多视图联动。
 * ===========================================================================*/

(function () {
  const VIEWS = {
    overview: ViewOverview, nebula: ViewNebula, coupling: ViewHeatmap,
    forecast: ViewForecast, waterfall: ViewWaterfall,
  };
  let activeId = "overview";
  const renderedOnce = new Set();

  // --------------------------------------------------------------------------
  // 导航切换：点击哪个出现哪个（单屏，不滚动）
  // --------------------------------------------------------------------------
  function switchView(id) {
    activeId = id;
    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
    document.querySelectorAll(".nav-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === id));
    document.querySelectorAll(".view").forEach((v) =>
      v.classList.toggle("active", v.id === "view-" + id));
    const view = VIEWS[id];
    if (!renderedOnce.has(id)) { view.render(); renderedOnce.add(id); }
    view.resize();
    document.getElementById("ip-goal").textContent = view.goal;
  }

  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view)));

  // --------------------------------------------------------------------------
  // 信息面板 + 状态栏：订阅全局状态
  // --------------------------------------------------------------------------
  function regionBreakdown(byRegion) {
    return Object.entries(byRegion).sort((a, b) => b[1] - a[1])
      .map(([r, n]) => `<tr><td><span class="legend-swatch" style="display:inline-block;background:${DA.color(r)}"></span> ${r}</td><td>${n}</td></tr>`).join("");
  }

  function updateInfoSelection(stats) {
    const el = document.getElementById("ip-detail");
    if (!stats) { el.innerHTML = `<p class="ip-hint">在星云图框选样本，或点击图元查看详情。</p>`; return; }
    el.innerHTML = `
      <table>
        <tr><td>选中样本</td><td>${stats.count}</td></tr>
        <tr><td>主导海域</td><td>${stats.dominant}</td></tr>
        <tr><td>平均SST</td><td>${stats.sstMean.toFixed(2)}°C</td></tr>
        <tr><td>SST范围</td><td>${stats.sstMin.toFixed(1)}~${stats.sstMax.toFixed(1)}°C</td></tr>
        <tr><td>平均CO₂</td><td>${stats.co2Mean.toFixed(1)} ppm</td></tr>
      </table>
      <div style="margin-top:7px;font-size:11px;color:#9aa7b4">海域构成</div>
      <table>${regionBreakdown(stats.byRegion)}</table>`;
  }

  function updateStatus(state) {
    const sel = state.selectedStats;
    document.getElementById("st-selection").textContent =
      sel ? `已选 ${sel.count} 样本（主导：${sel.dominant}）` : "未选中样本";
    document.getElementById("st-filter").textContent =
      "海域筛选：" + (state.region || "全部");
  }

  DA.state.subscribe((state, patch) => {
    if ("selectedStats" in patch) updateInfoSelection(state.selectedStats);
    updateStatus(state);
    // 分发给各视图（除发起者外）
    Object.values(VIEWS).forEach((v) => v.onState && v.onState(state, patch, patch._origin));
  });
  // 包装 set 以携带 origin
  const _set = DA.state.set.bind(DA.state);
  DA.state.set = (patch, origin) => _set(Object.assign({ _origin: origin }, patch), origin);

  // --------------------------------------------------------------------------
  // 数据点查询（Query 低级任务）
  // --------------------------------------------------------------------------
  function initQuery() {
    const rSel = document.getElementById("q-region");
    const dSel = document.getElementById("q-date");
    DA.REGIONS.forEach((r) => rSel.add(new Option(r, r)));
    function fillDates() {
      const series = (DA.smoothed().series || {})[rSel.value] || [];
      dSel.innerHTML = "";
      series.forEach((d) => dSel.add(new Option(d.time, d.time)));
      runQuery();
    }
    function runQuery() {
      const series = (DA.smoothed().series || {})[rSel.value] || [];
      const row = series.find((d) => d.time === dSel.value);
      const out = document.getElementById("q-result");
      if (!row) { out.innerHTML = ""; return; }
      out.innerHTML = `
        <table>
          <tr><td>实测SST</td><td>${row.sst_raw}°C</td></tr>
          <tr><td>滑动平均</td><td>${row.sst_ma}°C</td></tr>
          <tr><td>指数加权</td><td>${row.sst_ewm}°C</td></tr>
        </table>`;
    }
    rSel.onchange = fillDates;
    dSel.onchange = runQuery;
    fillDates();
  }

  // --------------------------------------------------------------------------
  // 多维条件筛选（Search 中级任务）—— 弹窗
  // --------------------------------------------------------------------------
  const SEARCH_DIMS = ["sst", "co2", "wind_speed", "salinity", "humidity", "pressure", "current_speed"];
  function initSearch() {
    const body = document.getElementById("search-body");
    let html = `<p>对清洗后的真实记录做多维阈值筛选（留空表示不限）。示例：CO₂ 下限 420、风速 上限 10，找高碳低风样本。</p>
      <div class="search-grid">`;
    SEARCH_DIMS.forEach((d) => {
      const u = DA.dimUnit(d);
      html += `<label>${DA.dimLabel(d)}${u ? " / " + u : ""}
        <span style="display:flex;gap:6px">
          <input type="number" step="any" placeholder="下限" id="lo-${d}" />
          <input type="number" step="any" placeholder="上限" id="hi-${d}" />
        </span></label>`;
    });
    html += `</div>
      <label style="font-size:12px;color:#9aa7b4">海域
        <select id="search-region"><option value="">全部</option></select></label>
      <div class="search-actions" style="margin-top:10px">
        <button class="btn-primary" id="search-run">筛选</button>
        <span class="search-count" id="search-count"></span>
      </div>
      <div class="search-result" id="search-result"></div>`;
    body.innerHTML = html;
    const rsel = document.getElementById("search-region");
    DA.REGIONS.forEach((r) => rsel.add(new Option(r, r)));

    document.getElementById("search-run").onclick = () => {
      const reg = rsel.value;
      const recs = DA.records().filter((rec) => {
        if (reg && rec.region !== reg) return false;
        return SEARCH_DIMS.every((d) => {
          const lo = parseFloat(document.getElementById("lo-" + d).value);
          const hi = parseFloat(document.getElementById("hi-" + d).value);
          if (!isNaN(lo) && rec[d] < lo) return false;
          if (!isNaN(hi) && rec[d] > hi) return false;
          return true;
        });
      });
      document.getElementById("search-count").textContent = `命中 ${recs.length} 条`;
      const top = recs.slice(0, 200);
      const cols = ["region", "time", "sst", "co2", "wind_speed"];
      let t = `<table><thead><tr><th>海域</th><th>日期</th><th>SST</th><th>CO₂</th><th>风速</th></tr></thead><tbody>`;
      top.forEach((r) => { t += `<tr><td>${r.region}</td><td>${r.time}</td><td>${r.sst}</td><td>${r.co2}</td><td>${r.wind_speed}</td></tr>`; });
      t += `</tbody></table>`;
      if (recs.length > 200) t += `<p class="hint" style="padding:6px">仅显示前 200 条。</p>`;
      document.getElementById("search-result").innerHTML = recs.length ? t : `<p class="hint" style="padding:10px">无符合条件的记录。</p>`;
    };
  }

  // --------------------------------------------------------------------------
  // 弹窗：任务目标 / 算法说明 / 多维筛选
  // --------------------------------------------------------------------------
  function fillTaskModal() {
    document.getElementById("task-body").innerHTML = `
      <h4><span class="task-tag q">Query</span> 低级 · 查询</h4>
      <p>查询某海域某时间的 SST 实测值与平滑值。入口：左侧信息面板「数据点查询」。</p>
      <h4><span class="task-tag s">Search</span> 中级 · 搜索</h4>
      <p>搜索满足多维阈值条件的记录（如 CO₂&gt;420 且 风速&lt;10 的高温样本）。入口：顶栏「多维筛选」。</p>
      <h4><span class="task-tag a">Analyze</span> 高级 · 分析</h4>
      <p>分析多维耦合关系，用多变量模型预测 SST 并量化各维度贡献。入口：「耦合星云」「维度互动强度」「单点预测归因」三视图。</p>`;
  }
  function fillAlgoModal() {
    const pred = DA.prediction().metrics || {};
    const exp = DA.pcaExplained();
    const rf = pred.random_forest || {}, lr = pred.linear_regression || {};
    document.getElementById("algo-body").innerHTML = `
      <h4>1. 数据预处理</h4>
      <p>缺失值线性插值；按海域 3σ 原则剔除 SST 离群点；按海域+月份聚合统计。</p>
      <h4>2. 趋势提取（时空数据变换）</h4>
      <p>对每海域 SST 时间序列做 <code>滑动平均</code> 与 <code>指数加权平均</code>（窗口 W 可调，前端滑块实时重算）。</p>
      <h4>3. 降维耦合分析</h4>
      <p>对标准化后的数值特征做 <code>PCA</code> 降到 3 维（三个主成分累计解释 ${(exp.cumulative*100||0).toFixed(1)}% 方差），并计算 13 维 Pearson 相关矩阵。</p>
      <h4>4. 多变量 SST 预测</h4>
      <p>特征：纬度/CO₂/风速/盐度/湿度/气压/洋流 + 月份 + 海域(one-hot)，<code>StandardScaler</code> 标准化，8:2 划分。</p>
      <ul>
        <li>主模型 <code>随机森林回归</code>：R²=${rf.r2}, MAE=${rf.mae}, RMSE=${rf.rmse}（提供特征重要性）</li>
        <li>对比 <code>线性回归</code>：R²=${lr.r2}, MAE=${lr.mae}, RMSE=${lr.rmse}（提供可解释系数，用于归因瀑布）</li>
      </ul>
      <h4>5. 未来预测</h4>
      <p>由训练好的随机森林对未来特征（逐月气候态 + CO₂ 趋势外推）预测，置信区间取森林内各树预测离散度 ±1.96σ。</p>
      <h4>6. 预留接口</h4>
      <p><code>predict(features)</code> 统一预测入口，未来可替换为昇腾 ModelArts，对前端零影响。</p>`;
  }

  function openModal(id) { document.getElementById(id).hidden = false; }
  function closeModal(el) { el.hidden = true; }
  document.getElementById("btn-task").onclick = () => openModal("modal-task");
  document.getElementById("btn-algo").onclick = () => openModal("modal-algo");
  document.getElementById("btn-search").onclick = () => openModal("modal-search");
  document.getElementById("btn-reset").onclick = () => { DA.state.reset("app"); };
  document.querySelectorAll(".modal-mask").forEach((mask) => {
    mask.addEventListener("click", (e) => {
      if (e.target === mask || e.target.hasAttribute("data-close")) closeModal(mask);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelectorAll(".modal-mask").forEach((m) => (m.hidden = true));
  });

  // --------------------------------------------------------------------------
  // 启动
  // --------------------------------------------------------------------------
  function boot() {
    if (!window.OCEAN_DATA) {
      document.getElementById("st-data").textContent = "数据未加载：请先运行 python code/run.py 生成 data-bundle.js";
      return;
    }
    const n = DA.records().length;
    const rf = (DA.prediction().metrics || {}).random_forest || {};
    document.getElementById("st-data").textContent = `数据就绪 · ${n} 条记录 · 6 海域 · 2020–2022`;
    document.getElementById("st-model").textContent = `随机森林 R²=${rf.r2 ?? "—"}`;

    initQuery(); initSearch(); fillTaskModal(); fillAlgoModal();
    const initial = location.hash.replace("#", "");
    switchView(VIEWS[initial] ? initial : "overview");
    window.addEventListener("resize", () => VIEWS[activeId].resize());
  }
  boot();
})();
