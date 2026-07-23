/* 左导航抽屉:桌面端默认收起,点按钮覆盖式滑出 */
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    // 悬浮抽屉按钮(挂在 body,跨页面导航常驻)
    var btn = document.createElement('button');
    btn.className = 'nav-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', '打开导航');
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/></svg>';
    document.body.appendChild(btn);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      document.body.classList.toggle('nav-open');
    });

    var backdrop = document.createElement('div');
    backdrop.className = 'nav-backdrop';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', function () {
      document.body.classList.remove('nav-open');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') document.body.classList.remove('nav-open');
    });

    // 事件委托:点抽屉内链接后收起(适配 instant 导航)
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('nav-open')) return;
      var t = e.target.closest && e.target.closest('.md-sidebar--primary a');
      if (t) document.body.classList.remove('nav-open');
    });
  });
})();
