/** Customer journey definitions — derived from the 4 weekly CSV exports. */
const JOURNEYS = [
  {
    id: 'awareness',
    title: 'Awareness & Arrival',
    subtitle: 'Social + Traffic',
    description: 'How users discover NyuuLy / Work Japan and which channels bring them to the site.',
    status: 'live',
    sources: ['social', 'traffic'],
    pagePatterns: [],
  },
  {
    id: 'explore-no-action',
    title: 'Explore — Browse Only',
    subtitle: 'Pages + Funnel',
    description: 'Users land and browse NyuuLy and/or Work Japan pages but do not convert.',
    status: 'live',
    sources: ['pages', 'funnel', 'traffic'],
    pagePatterns: ['/', '/about', '/compass', '/info-hub', '/ja', '/info', '/mobile'],
    excludePatterns: ['/apply', '/welcome-package', '/mobile/sim/apply'],
  },
  {
    id: 'explore-convert',
    title: 'Explore → Sign Up & Subscribe',
    subtitle: 'Pages + Funnel + Traffic',
    description: 'Users browse then sign up to Work Japan or engage with NyuuLy subscription paths.',
    status: 'live',
    sources: ['pages', 'funnel', 'traffic'],
    pagePatterns: ['/apply', '/mobile/sim/apply', '/compass/student', '/mobile/sim/plans', '/signup'],
    excludePatterns: [],
  },
  {
    id: 'welcome-package',
    title: 'Welcome Package',
    subtitle: 'Pages + Funnel',
    description: 'Users explore and move toward the welcome package — early / future journey.',
    status: 'future',
    sources: ['pages', 'funnel'],
    pagePatterns: ['/welcome-package'],
    excludePatterns: [],
  },
  {
    id: 'wj-application',
    title: 'Work Japan Application Funnel',
    subtitle: 'Pages + Funnel',
    description: 'Inside Japan: sign up through the full application flow — drop-off at each step.',
    status: 'live',
    sources: ['pages', 'funnel'],
    pagePatterns: ['/mobile/sim'],
    excludePatterns: [],
    applicationSteps: [
      { label: 'Mobile / SIM interest', path: '/mobile' },
      { label: 'View SIM plans', path: '/mobile/sim/plans' },
      { label: 'Start application', path: '/mobile/sim/apply' },
      { label: 'Verify identity', path: '/mobile/sim/apply/verify' },
      { label: 'Support / contact', path: '/mobile/sim/support/contact' },
    ],
  },
];

const FILE_TYPES = ['social', 'funnel', 'traffic', 'pages'];

const FILE_TYPE_LABELS = {
  social: 'Social Media Posts',
  funnel: 'Funnel Data (GA4)',
  traffic: 'Traffic Acquisition (GA4)',
  pages: 'Pages & Screens (GA4)',
};

function pathMatches(path, patterns, excludePatterns = []) {
  if (!path) return false;
  if (excludePatterns.some((ex) => path === ex || path.startsWith(`${ex}/`))) return false;
  return patterns.some((p) => path === p || path.startsWith(`${p}/`));
}

function aggregatePagesForJourney(pages, journey) {
  const matched = pages.filter((p) =>
    pathMatches(p.page_path, journey.pagePatterns, journey.excludePatterns)
  );
  return {
    pages: matched.sort((a, b) => b.views - a.views),
    totalViews: matched.reduce((s, p) => s + (p.views || 0), 0),
    totalUsers: matched.reduce((s, p) => s + (p.active_users || 0), 0),
    totalKeyEvents: matched.reduce((s, p) => s + (p.key_events || 0), 0),
  };
}

function buildApplicationFunnel(pages, steps) {
  if (!steps) return [];
  const funnel = steps.map((step) => {
    const row = pages.find((p) => p.page_path === step.path)
      || pages.find((p) => p.page_path.startsWith(`${step.path}/`));
    return {
      label: step.label,
      path: step.path,
      views: row?.views || 0,
      users: row?.active_users || 0,
      keyEvents: row?.key_events || 0,
    };
  });

  for (let i = 1; i < funnel.length; i++) {
    const prev = funnel[i - 1].users || funnel[i - 1].views || 1;
    const curr = funnel[i].users || funnel[i].views || 0;
    funnel[i].dropOffPct = prev > 0 ? Math.round((1 - curr / prev) * 1000) / 10 : 0;
    funnel[i].retentionPct = prev > 0 ? Math.round((curr / prev) * 1000) / 10 : 0;
  }
  funnel[0].dropOffPct = 0;
  funnel[0].retentionPct = 100;

  return funnel;
}

function buildGa4FunnelSteps(funnelRows) {
  const totals = funnelRows.filter((r) => r.device_category === 'Total');
  return totals
    .map((r) => ({
      step: r.step,
      stepLabel: (r.step || '').replace(/^\d+\.\s*/, ''),
      users: r.active_users || 0,
      completionRate: r.completion_rate || 0,
      abandonments: r.abandonments || 0,
      abandonmentRate: r.abandonment_rate || 0,
    }))
    .sort((a, b) => (a.step || '').localeCompare(b.step || ''));
}

module.exports = {
  JOURNEYS,
  FILE_TYPES,
  FILE_TYPE_LABELS,
  pathMatches,
  aggregatePagesForJourney,
  buildApplicationFunnel,
  buildGa4FunnelSteps,
};
