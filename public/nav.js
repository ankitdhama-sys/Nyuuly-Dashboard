(function initSiteNav() {
  const GTM_MARKETS = [
    { slug: 'nepal', label: 'Nepal' },
    { slug: 'vietnam', label: 'Vietnam' },
    { slug: 'taiwan', label: 'Taiwan' },
  ];

  function isGtmPath(pathname) {
    return pathname === '/gtm' || pathname.startsWith('/gtm/');
  }

  function currentGtmSlug(pathname) {
    const match = pathname.match(/^\/gtm(?:\/([a-z-]+))?\/?$/i);
    return match?.[1]?.toLowerCase() || null;
  }

  function setActiveNav(pathname) {
    document.querySelectorAll('.nav-pill[data-nav]').forEach((link) => {
      const nav = link.dataset.nav;
      let active = false;
      if (nav === 'weekly') active = pathname === '/weekly';
      else if (nav === 'combined') active = pathname === '/combined';
      else if (nav === 'dashboard') active = pathname === '/' || pathname === '/index.html';
      else if (nav === 'campaigns') active = pathname === '/campaigns';
      else if (nav === 'upload') active = pathname === '/upload';
      link.classList.toggle('active', active);
    });

    const gtmDropdown = document.getElementById('gtmNavDropdown');
    if (gtmDropdown) {
      gtmDropdown.classList.toggle('active', isGtmPath(pathname));
      const slug = currentGtmSlug(pathname);
      gtmDropdown.querySelectorAll('.nav-dropdown-item').forEach((item) => {
        item.classList.toggle('active', slug != null && item.dataset.market === slug);
      });
    }
  }

  function initGtmDropdown() {
    const dropdown = document.getElementById('gtmNavDropdown');
    const toggle = document.getElementById('gtmNavToggle');
    const menu = document.getElementById('gtmNavMenu');
    if (!dropdown || !toggle || !menu) return;

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = dropdown.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dropdown.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  setActiveNav(window.location.pathname);
  initGtmDropdown();

  window.SiteNav = { GTM_MARKETS, isGtmPath, currentGtmSlug, setActiveNav };
})();
