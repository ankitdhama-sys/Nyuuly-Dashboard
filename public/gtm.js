const GTM_MARKETS = {
  nepal: 'Nepal',
  vietnam: 'Vietnam',
  taiwan: 'Taiwan',
};

function resolveGtmMarket() {
  const match = window.location.pathname.match(/^\/gtm(?:\/([a-z-]+))?\/?$/i);
  const slug = match?.[1]?.toLowerCase();
  if (slug && GTM_MARKETS[slug]) return { slug, label: GTM_MARKETS[slug] };
  return { slug: 'nepal', label: GTM_MARKETS.nepal };
}

document.addEventListener('DOMContentLoaded', () => {
  const { slug, label } = resolveGtmMarket();
  if (!window.location.pathname.match(/^\/gtm\/[a-z-]+\/?$/i)) {
    window.location.replace(`/gtm/${slug}`);
    return;
  }

  document.title = `GTM — ${label} — Analytics Dashboard`;
  const marketLabel = document.getElementById('gtmMarketLabel');
  const pageTitle = document.getElementById('gtmPageTitle');
  if (marketLabel) marketLabel.textContent = label;
  if (pageTitle) pageTitle.textContent = 'Coming Soon';

  if (window.SiteNav?.setActiveNav) {
    window.SiteNav.setActiveNav(window.location.pathname);
  }
});
