/* =============================================================================
 * data-adapter.js —— 统一数据出口 + 颜色规范 + 全局联动状态
 * -----------------------------------------------------------------------------
 * 沿用实验2规范：所有视图通过本文件取数与取色，保证界面一致性。
 *   1. DA.data       算法产物（来自 window.OCEAN_DATA，由 build_bundle.py 打包）
 *   2. DA.color()    Okabe-Ito 色盲友好色板，按海域取色
 *   3. DA.state      统一筛选状态 + 发布订阅，实现多视图联动
 * ===========================================================================*/

const DA = (function () {
  // ---- 数据加载：优先用打包好的 window.OCEAN_DATA（file:// 双击可用）---------
  const data = window.OCEAN_DATA || {};

  // ---- 海域顺序（与后端 REGION_ORDER 保持一致）------------------------------
  const REGIONS = ["太平洋", "大西洋", "印度洋", "北极海域", "南极海域", "赤道区域"];

  // ---- Okabe-Ito 色盲友好色板，逐海域映射 -----------------------------------
  const OKABE_ITO = {
    "太平洋":   "#0072B2", // 蓝
    "大西洋":   "#D55E00", // 朱红
    "印度洋":   "#009E73", // 绿
    "北极海域": "#56B4E9", // 浅蓝
    "南极海域": "#CC79A7", // 紫红
    "赤道区域": "#E69F00", // 橙
  };
  const GREY = "#999999";

  // 维度中文名（界面标注 + tooltip 用），避免直接暴露英文字段
  const DIM_LABEL = {
    longitude: "经度", latitude: "纬度", sst: "海表温度", salinity: "盐度",
    wind_speed: "风速", wind_dir: "风向", pressure: "气压",
    precipitation: "降水", co2: "CO₂浓度", wave_height: "浪高",
    humidity: "湿度", current_speed: "洋流速度", chlorophyll: "叶绿素",
    month: "月份", region: "海域", baseline: "基准值",
  };
  const DIM_UNIT = {
    sst: "°C", salinity: "PSU", wind_speed: "m/s", pressure: "hPa",
    co2: "ppm", humidity: "%", current_speed: "m/s", latitude: "°",
    precipitation: "mm", wave_height: "m", chlorophyll: "mg/m³",
  };

  function color(region) {
    return OKABE_ITO[region] || GREY;
  }
  function dimLabel(key) { return DIM_LABEL[key] || key; }
  function dimUnit(key) { return DIM_UNIT[key] || ""; }

  // ---- 数据访问器 -----------------------------------------------------------
  const get = {
    pcaPoints:        () => data.pca_points || [],
    correlation:      () => data.correlation_matrix || { labels: [], matrix: [] },
    pcaExplained:     () => data.pca_explained || {},
    smoothed:         () => data.smoothed || { series: {}, window: 10 },
    forecast:         () => data.forecast || { series: {} },
    prediction:       () => data.prediction || { metrics: {}, test: [], region_error: [] },
    featureImportance:() => data.feature_importance || { importance: [] },
    regionStats:      () => data.region_stats || [],
    records:          () => data.records || [],
  };

  // 记录按 id 索引（星云重新着色 / 详情查询复用），懒构建一次
  let _recById = null;
  function recordById(id) {
    if (!_recById) {
      _recById = new Map();
      (data.records || []).forEach((r) => _recById.set(r.id, r));
    }
    return _recById.get(id);
  }

  // ===========================================================================
  // 全局联动状态：各视图订阅同一份筛选条件（文档「7.5 多视图联动」）
  //   region        当前聚焦海域（null = 全部）
  //   selectedIds   星云图框选出的记录 id 集合
  //   selectedStats 框选样本的统计摘要（供信息面板/状态栏）
  //   highlightDims 热力图点击选中的两个维度 [a, b]（用于星云重新着色）
  //   window        平滑窗口 W（时序视图滑块）
  // ===========================================================================
  const _state = {
    region: null,
    selectedIds: new Set(),
    selectedStats: null,
    highlightDims: null,
    window: (data.smoothed && data.smoothed.window) || 10,
  };
  const _listeners = [];

  const state = {
    get: (k) => _state[k],
    /** 批量更新状态并通知所有订阅者；origin 用于避免发起视图自我重绘 */
    set(patch, origin) {
      Object.assign(_state, patch);
      _listeners.forEach((fn) => fn(_state, patch, origin));
    },
    subscribe(fn) { _listeners.push(fn); },
    reset(origin) {
      this.set({
        region: null, selectedIds: new Set(), selectedStats: null,
        highlightDims: null,
      }, origin);
    },
  };

  return {
    data, REGIONS, color, dimLabel, dimUnit, state, recordById,
    DIM_LABEL, DIM_UNIT,
    ...get,
  };
})();
