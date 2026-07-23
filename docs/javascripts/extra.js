/* 左导航抽屉:桌面端默认收起,点按钮覆盖式滑出 */
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var headerInner = document.querySelector('.md-header__inner');
    if (headerInner) {
      var btn = document.createElement('button');
      btn.className = 'md-icon nav-toggle';
      btn.setAttribute('aria-label', '导航抽屉');
      btn.type = 'button';
      btn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
        '<path fill="currentColor" d="M3 6h18M3 12h18M3 18h18" ' +
        'stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
      headerInner.insertBefore(btn, headerInner.firstChild);
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        document.body.classList.toggle('nav-open');
      });
    }

    var backdrop = document.createElement('div');
    backdrop.className = 'nav-backdrop';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', function () {
      document.body.classList.remove('nav-open');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') document.body.classList.remove('nav-open');
    });

    // 点击抽屉内链接后收起
    document.querySelectorAll('.md-sidebar--primary .md-nav__link').forEach(function (a) {
      a.addEventListener('click', function () {
        document.body.classList.remove('nav-open');
      });
    });
  });
})();
