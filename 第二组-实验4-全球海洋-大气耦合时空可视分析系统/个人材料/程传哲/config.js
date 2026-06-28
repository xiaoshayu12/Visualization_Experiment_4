/**
 * 全局配置 — 所有前端页面通过此文件获取统一的 API 路径
 */
(function () {
  window.CONFIG = {
    /** API 基础路径 — 指向统一 Flask 后端 */
    API_BASE: window.location.origin + '/api',

    /** 系统页面路由 */
    PAGES: {
      sst: '/',                              // SST距平分析（王哲）— 主页
      coupling: '/members/liu',              // 海气耦合与异常检测（刘国宁）
      carbon: '/members/cheng',              // 碳汇压力分析（程传哲）
      overview: '/members/xu'                // 综合分析（许一凡）
    },

    /** 海域颜色表 (Okabe-Ito 色盲友好调色板) */
    REGION_COLORS: {
      '太平洋': '#0072B2',
      '大西洋': '#009E73',
      '印度洋': '#F0E442',
      '北极海域': '#56B4E9',
      '南极海域': '#CC79A7',
      '赤道区域': '#E69F00'
    },

    /** 距平发散色标 */
    ANOMALY_COLORS: ['#2166ac', '#92c5de', '#f7f7f7', '#f4a582', '#b2182b'],

    /** 图表主题色 */
    CHART_COLORS: ['#0072B2', '#009E73', '#F0E442', '#56B4E9', '#CC79A7', '#E69F00']
  };
})();
