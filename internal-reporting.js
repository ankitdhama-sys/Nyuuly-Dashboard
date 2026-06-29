/** GA4 pages + manual business metrics for WORK JAPAN internal reporting. */

const CATEGORY_ORDER = [
  'Job Listings',
  'Jobseeker Pages',
  'Employer Dashboard',
  'Blog',
  'Homepage',
  'Other',
];

const CATEGORY_COLORS = {
  'Job Listings': '#4F8EF7',
  'Jobseeker Pages': '#34d399',
  'Employer Dashboard': '#a78bfa',
  Blog: '#facc15',
  Homepage: '#FF6B35',
  Other: '#8892b0',
};

function categorizePagePath(path) {
  if (!path || path === '/') return 'Homepage';
  if (path.startsWith('/jobseeker/blog')) return 'Blog';
  if (path.startsWith('/jobs')) return 'Job Listings';
  if (path.startsWith('/jobseeker')) return 'Jobseeker Pages';
  if (path.startsWith('/dashboard')) return 'Employer Dashboard';
  return 'Other';
}

function monthSortKey(row) {
  return (row.year || 0) * 12 + (row.month || 0);
}

function latestMonthRows(rows) {
  if (!rows?.length) return { rows: [], month_label: null };
  const byMonth = {};
  for (const r of rows) {
    if (!byMonth[r.month_label]) byMonth[r.month_label] = [];
    byMonth[r.month_label].push(r);
  }
  const labels = Object.keys(byMonth).sort(
    (a, b) => monthSortKey(byMonth[a][0]) - monthSortKey(byMonth[b][0])
  );
  const monthLabel = labels[labels.length - 1];
  return { rows: byMonth[monthLabel] || [], month_label: monthLabel };
}

function buildInternalReport(pages, platformRows, applicantRows, filter) {
  const pageRows = (pages || []).map((p) => ({
    path: p.page_path,
    views: p.views || 0,
    active_users: p.active_users || 0,
    views_per_user: p.views_per_user || 0,
    avg_engagement_time: p.avg_engagement_time || 0,
    event_count: p.event_count || 0,
    category: categorizePagePath(p.page_path),
  }));

  const totalViews = pageRows.reduce((s, p) => s + p.views, 0);
  const totalActiveUsers = pageRows.reduce((s, p) => s + p.active_users, 0);

  const topPages = [...pageRows]
    .sort((a, b) => b.active_users - a.active_users)
    .slice(0, 10);

  const categoryMap = {};
  for (const cat of CATEGORY_ORDER) {
    categoryMap[cat] = { category: cat, users: 0, views: 0, pageCount: 0 };
  }
  for (const p of pageRows) {
    const bucket = categoryMap[p.category] || categoryMap.Other;
    bucket.users += p.active_users;
    bucket.views += p.views;
    bucket.pageCount += 1;
  }
  const categories = CATEGORY_ORDER
    .map((c) => categoryMap[c])
    .filter((c) => c.users > 0 || c.views > 0);

  const latestPlatform = latestMonthRows(platformRows || []);
  const latestApplicant = applicantRows?.length ? applicantRows[applicantRows.length - 1] : null;

  const registrations = latestPlatform.rows.reduce((s, r) => s + (r.registrations || 0), 0);
  const applications = latestApplicant?.total_applications ?? 0;
  const selected = latestApplicant?.selected ?? 0;

  const funnelSteps = [
    { id: 'users', label: 'Active Website Users', value: totalActiveUsers, source: 'GA4 Pages CSV (sum of page active users)' },
    { id: 'registrations', label: 'Registrations', value: registrations, source: 'Manual — platform stats' },
    { id: 'applications', label: 'Applications Submitted', value: applications, source: 'Manual — applicant stats' },
    { id: 'selected', label: 'Job Seekers Selected / Hired', value: selected, source: 'Manual — applicant stats' },
  ];

  const conversionLabels = [
    null,
    'of page users registered',
    'of registrants applied',
    'of applicants selected',
  ];

  for (let i = 1; i < funnelSteps.length; i++) {
    const prev = funnelSteps[i - 1].value || 0;
    const curr = funnelSteps[i].value || 0;
    funnelSteps[i].conversionFromPrev = prev > 0 ? Math.round((curr / prev) * 1000) / 10 : 0;
    funnelSteps[i].conversionLabel = conversionLabels[i];
    funnelSteps[i].usersLost = Math.max(0, prev - curr);
  }

  return {
    filter,
    kpis: {
      totalActiveUsers,
      totalViews,
      registrations,
      applications,
      selected,
    },
    topPages,
    categories,
    funnel: funnelSteps,
    allPagesCount: pageRows.length,
    manualPeriod: {
      platformMonth: latestPlatform.month_label,
      applicantMonth: latestApplicant?.month_label || null,
    },
    keyPages: pageRows.filter((p) =>
      ['/', '/jobs/', '/jobseeker/', '/dashboard/applicants', '/dashboard/jobs'].includes(p.path)
      || p.path === '/jobs'
    ),
  };
}

module.exports = {
  categorizePagePath,
  buildInternalReport,
  CATEGORY_ORDER,
  CATEGORY_COLORS,
};
