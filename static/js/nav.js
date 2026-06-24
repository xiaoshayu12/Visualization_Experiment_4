/**
 * 全局导航栏组件
 * 自动生成导航 HTML、管理 Tab 高亮、处理页面切换
 */
(function () {
  'use strict';

  /** 导航 Tab 配置 */
  var TABS = [
    { id: 'sst',       label: 'SST距平分析',           href: '/' },
    { id: 'coupling',  label: '海气耦合与异常检测',      href: '/members/liu' },
    { id: 'carbon',    label: '碳汇压力分析',            href: '/members/cheng' },
    { id: 'overview',  label: '综合分析',                href: '/members/xu' }
  ];

  /**
   * 根据当前 URL 路径自动判断活跃 Tab
   */
  function getActiveTabId() {
    var path = window.location.pathname;
    // 检查各 Tab 的路径前缀匹配（越具体的排前面）
    var candidates = TABS.slice().sort(function (a, b) {
      return b.href.length - a.href.length;
    });
    for (var i = 0; i < candidates.length; i++) {
      var tab = candidates[i];
      if (tab.href === '/') {
        // 主页：路径为 '/' 或 '/index.html' 或无路径
        if (path === '/' || path === '/index.html' || path === '') {
          return tab.id;
        }
      } else {
        if (path.indexOf(tab.href) === 0) {
          return tab.id;
        }
      }
    }
    return 'sst'; // 默认
  }

  /**
   * 生成导航栏 HTML 并插入页面
   */
  function render() {
    var activeId = getActiveTabId();

    var html = '<div id="global-nav">';

    // 左侧：系统标题
    html += '<div class="nav-brand">';
    html += '<span>🌊</span>';
    html += '<span>全球海洋大气耦合时空可视分析系统</span>';
    html += '</div>';

    // 中间：Tab 列表
    html += '<ul class="nav-tabs">';
    for (var i = 0; i < TABS.length; i++) {
      var tab = TABS[i];
      var cls = (tab.id === activeId) ? 'nav-tab active' : 'nav-tab';
      html += '<li>';
      html += '<a class="' + cls + '" href="' + tab.href + '">' + tab.label + '</a>';
      html += '</li>';
    }
    html += '</ul>';

    // 右侧：预留信息
    html += '<div class="nav-info"></div>';
    html += '</div>';

    // 插入到 body 顶部
    var container = document.createElement('div');
    container.innerHTML = html;
    var nav = container.firstChild;
    document.body.insertBefore(nav, document.body.firstChild);
  }

  // 页面加载后自动渲染
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
