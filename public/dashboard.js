const COLORS = {
  nyuuly: '#4F8EF7',
  workjapan: '#FF6B35',
  nyuulyLight: 'rgba(79, 142, 247, 0.6)',
  workjapanLight: 'rgba(255, 107, 53, 0.6)',
  grid: 'rgba(136, 146, 176, 0.15)',
  text: '#8892b0',
  platform: {
    Web: '#4F8EF7',
    Android: '#34d399',
    iOS: '#a78bfa',
  },
};

const charts = {};
let state = {
  company: 'workjapan',
  month: null,
  availableMonths: [],
};

let socialPosts = [];
let socialPage = 1;
let pagesData = [];
let pagesPage = 1;
let socialSort = { col: 'views', dir: 'desc' };
let usersSort = { col: 'total_users', dir: 'desc' };
let pagesSort = { col: 'views', dir: 'desc' };

function formatNum(n) {
  if (n == null) return '0';
  const num = Number(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 10_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function formatPct(n) {
  if (n == null) return '0%';
  // Values 0–1 are fractions (e.g. CTR 0.0011); larger values are already percentage points.
  const val = n <= 1 ? n * 100 : n;
  return val.toFixed(1) + '%';
}

/** Format a value already expressed as percentage points (0–100). */
function formatPctPoints(n) {
  if (n == null) return '0%';
  return `${Number(n).toFixed(1)}%`;
}

/** Returns a fraction (0–1) for use with formatPct. */
function conversionFromPrevious(current, previous) {
  if (previous == null || previous <= 0) return null;
  return current / previous;
}

/** Returns a month-over-month delta badge for the given metric key. */
function deltaBadge(deltas, key) {
  if (!deltas || !deltas[key]) return '';
  const d = deltas[key].deltaPct;
  if (d == null) return '<span class="kpi-delta kpi-delta-flat">— no prev</span>';
  if (d > 0) return `<span class="kpi-delta kpi-delta-up">▲ ${Math.abs(d).toFixed(1)}%</span>`;
  if (d < 0) return `<span class="kpi-delta kpi-delta-down">▼ ${Math.abs(d).toFixed(1)}%</span>`;
  return '<span class="kpi-delta kpi-delta-flat">0.0%</span>';
}

function deltaBadgeMoM(deltas, key) {
  if (!deltas || !deltas[key]) return '';
  const d = deltas[key].deltaPct;
  if (d == null) return '<span class="kpi-delta kpi-delta-flat">— no prior month</span>';
  if (d > 0) return `<span class="kpi-delta kpi-delta-up">▲ ${Math.abs(d).toFixed(1)}% vs last month</span>`;
  if (d < 0) return `<span class="kpi-delta kpi-delta-down">▼ ${Math.abs(d).toFixed(1)}% vs last month</span>`;
  return '<span class="kpi-delta kpi-delta-flat">0.0% vs last month</span>';
}

function monthToRange(monthVal) {
  if (!monthVal) return { start: null, end: null };
  const [y, m] = monthVal.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

function monthLabel(key) {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[m - 1] || m} ${y}`;
}

function funnelStepConversionPlain(pct, description) {
  if (pct == null) return '';
  return `<div class="funnel-step-conversion">
    <span class="funnel-step-conversion-pct">${formatPct(pct)}</span>
    <span class="funnel-step-conversion-desc">${description}</span>
  </div>`;
}

function funnelPrevStepHtml(pct) {
  if (pct == null) return '';
  return `<div class="commit-funnel-arrow"><span>${formatPct(pct)} continued from the step above</span></div>`;
}

function funnelConsiderationSourcesHtml(breakdown) {
  if (!breakdown?.totalUsers) return '';
  const lines = [];
  if (breakdown.organicSearchUsers > 0 || breakdown.organicSearchPct != null) {
    lines.push(funnelUserSourceLine(
      breakdown.organicSearchPct,
      breakdown.organicSearchUsers,
      'Google search & AI Overview (GA4 Organic Search + AI channels)',
    ));
  }
  if (breakdown.organicSocialUsers > 0 || breakdown.organicSocialPct != null) {
    lines.push(funnelUserSourceLine(
      breakdown.organicSocialPct,
      breakdown.organicSocialUsers,
      'Social media (GA4 Organic Social)',
    ));
  }
  if (breakdown.otherUsers > 0 || breakdown.otherPct != null) {
    lines.push(funnelUserSourceLine(
      breakdown.otherPct,
      breakdown.otherUsers,
      'Other channels (direct, email, paid, referral, etc.)',
    ));
  }
  if (!lines.length) return '';
  return `<div class="funnel-step-conversions">
    <div class="funnel-step-conversions-intro">Where website users came from (GA4):</div>
    ${lines.join('')}
  </div>`;
}

function funnelUserSourceLine(pct, users, description) {
  if (pct == null && !users) return '';
  return `<div class="funnel-step-conversion">
    <span class="funnel-step-conversion-pct">${formatPctPoints(pct)} · ${formatNum(users || 0)} users</span>
    <span class="funnel-step-conversion-desc">${description}</span>
  </div>`;
}

function renderAwarenessMetricsHtml(gsc, social, deltas) {
  return `
    <div class="pipeline-awareness-metrics">
      <div class="pipeline-awareness-metric">
        <div class="pipeline-awareness-value">${formatNum(gsc)}</div>
        <div class="pipeline-awareness-label">Google search impressions</div>
        <div class="pipeline-awareness-hint">Times we appeared in search results</div>
        ${deltaBadge(deltas, 'gscImpressions')}
      </div>
      <div class="pipeline-awareness-metric">
        <div class="pipeline-awareness-value">${formatNum(social)}</div>
        <div class="pipeline-awareness-label">Social media views</div>
        <div class="pipeline-awareness-hint">Views on Facebook, Instagram, etc.</div>
        ${deltaBadge(deltas, 'socialChannelViews')}
      </div>
    </div>
  `;
}

function gscCtrValue(row) {
  if (!row) return 0;
  if (row.impressions > 0) return row.clicks / row.impressions;
  return row.ctr || 0;
}

function renderPipelineStageCard(stage, prevStage) {
  const convLine = stage.sourceBreakdown
    ? funnelConsiderationSourcesHtml(stage.sourceBreakdown)
    : stage.awarenessMetrics
      ? ''
      : funnelStepConversionPlain(
        prevStage ? conversionFromPrevious(stage.raw, prevStage.raw) : null,
        stage.conversionHint || 'moved to this step from the previous one',
      );

  const valueBlock = stage.awarenessMetrics
    ? renderAwarenessMetricsHtml(stage.awarenessMetrics.gsc, stage.awarenessMetrics.social, stage.deltas)
    : `
      <div class="pipeline-value">${formatNum(stage.raw)}</div>
      ${stage.stepDelta ? stepMoMBadge(stage.stepDelta) : deltaBadge(stage.deltas, stage.deltaKey)}
    `;

  return `
    <a href="#${stage.anchor}" class="pipeline-stage${stage.awarenessMetrics ? ' pipeline-stage-awareness' : ''}">
      <div class="pipeline-num">${stage.num}</div>
      <div class="pipeline-label">${stage.label}</div>
      ${valueBlock}
      ${convLine}
      ${stage.detail ? `<div class="pipeline-detail">${stage.detail}</div>` : ''}
    </a>
  `;
}

async function loadAvailableMonths(forceDefault = false) {
  try {
    const data = await fetchJSON(`/api/available-months?company=${state.company}`);
    state.availableMonths = data.months || [];
    const defaultMonth = data.defaultMonth || data.latest || null;
    if (forceDefault || !state.month || !state.availableMonths.some((m) => m.key === state.month)) {
      state.month = defaultMonth;
    }
    const sel = document.getElementById('monthSelect');
    if (sel) {
      sel.innerHTML = state.availableMonths.map((m) =>
        `<option value="${m.key}" ${m.key === state.month ? 'selected' : ''}>${m.label}</option>`
      ).join('') || '<option value="">No monthly data</option>';
    }
  } catch {
    state.availableMonths = [];
  }
}

function getDateRange() {
  return monthToRange(state.month);
}

function buildQuery() {
  const { start, end } = getDateRange();
  const params = new URLSearchParams();
  params.set('company', state.company);
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  return params.toString();
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: COLORS.text, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const label = ctx.dataset.label || '';
            const val = ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed;
            if (typeof val === 'number') return `${label}: ${formatNum(val)}`;
            return `${label}: ${val}`;
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
      y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
    },
  };
}

function downloadChart(canvasId) {
  const chart = charts[canvasId];
  if (!chart) return;
  const link = document.createElement('a');
  link.download = `${canvasId}.png`;
  link.href = chart.toBase64Image();
  link.click();
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${url} (${res.status})`);
  return res.json();
}

async function fetchJSONSafe(url, fallback = null) {
  try {
    return await fetchJSON(url);
  } catch (err) {
    console.warn('Optional API fetch failed:', err.message || err);
    return fallback;
  }
}

function companyLabel(company) {
  return company === 'workjapan' ? 'WORK JAPAN' : 'Nyuuly';
}

function updateFilterLabel(filter) {
  const el = document.getElementById('filterLabel');
  if (!el) return;
  const { start, end } = getDateRange();
  const co = filter?.company || state.company;
  const label = state.month ? monthLabel(state.month) : 'No month selected';
  el.textContent = start && end
    ? `${companyLabel(co)} · ${label} (${start} → ${end})`
    : `${companyLabel(co)} · ${label}`;
}

function syncStateFromUI() {
  const activeCompany = document.querySelector('#companyTabs .tab-btn.active');
  if (activeCompany?.dataset.company) state.company = activeCompany.dataset.company;
}

function formatDelta(pct) {
  if (pct == null || Number.isNaN(pct)) return '<span class="delta-neutral">— vs 6mo avg</span>';
  const cls = pct > 0 ? 'delta-up' : pct < 0 ? 'delta-down' : 'delta-neutral';
  const sign = pct > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${pct}% vs 6mo avg</span>`;
}

function journeyById(journeys, id) {
  return journeys?.journeys?.find((j) => j.id === id);
}

function companyBrandColor() {
  return state.company === 'workjapan' ? COLORS.workjapan : COLORS.nyuuly;
}

function updateCompanyLayout() {
  const isWj = state.company === 'workjapan';
  document.body.classList.toggle('company-workjapan', isWj);
  document.body.classList.toggle('company-nyuuly', !isWj);
  document.querySelectorAll('.workjapan-only').forEach((el) => {
    el.style.display = isWj ? '' : 'none';
  });
  document.querySelectorAll('.nyuuly-only').forEach((el) => {
    if (el.classList.contains('funnel-nav')) {
      el.style.display = isWj ? 'none' : 'flex';
    } else {
      el.style.display = isWj ? 'none' : '';
    }
  });
}

function renderFunnelNav(guide) {
  const nav = document.getElementById('funnelNav');
  if (!nav) return;

  const stages = guide?.funnelStages || [];
  const pillars = guide?.pillars_extra || [];
  nav.innerHTML = [
    ...stages.map((s) => `
      <a href="#${s.anchor}" class="funnel-nav-link" data-stage="${s.id}">
        <span class="funnel-nav-num">${s.number}</span>${s.label}
      </a>
    `),
    ...pillars.map((p) => `
      <a href="#${p.anchor}" class="funnel-nav-link funnel-nav-pillar">${p.label}</a>
    `),
  ].join('');
}

function renderFunnelPipeline(journeys, platform, applicants, social, users, deltas, nyuulyCommit, nyuulyResult, mobileSimFlow) {
  const el = document.getElementById('funnelPipeline');
  if (!el) return;

  const awareness = journeyById(journeys, 'awareness');
  const isWj = state.company === 'workjapan';

  const stages = isWj ? [
    {
      anchor: 'stage-awareness',
      num: 1,
      label: 'Awareness',
      awarenessMetrics: {
        gsc: awareness?.kpis?.gscImpressions || 0,
        social: awareness?.kpis?.socialChannelViews || 0,
      },
      deltas,
    },
    {
      anchor: 'stage-consideration',
      num: 2,
      label: 'Consideration',
      raw: users?.kpis?.totalUsers || 0,
      deltaKey: 'totalUsers',
      deltas,
      sourceBreakdown: users?.sourceBreakdown,
    },
    {
      anchor: 'stage-commit',
      num: 3,
      label: 'Commit (CV)',
      raw: platform?.kpis?.totalRegistrations || 0,
      deltaKey: 'registrations',
      deltas,
      conversionHint: 'of website visitors created an account',
    },
    {
      anchor: 'stage-proceed',
      num: 4,
      label: 'Proceed',
      raw: applicants?.latest?.total_applications ?? applicants?.kpis?.totalApplications ?? 0,
      deltaKey: 'totalApplications',
      deltas,
      conversionHint: 'of registered users submitted a job application',
      detail: `${formatNum(applicants?.latest?.unique_applicants)} unique applicants`,
    },
    {
      anchor: 'stage-result',
      num: 5,
      label: 'Result',
      raw: applicants?.latest?.selected ?? applicants?.kpis?.selected ?? 0,
      deltaKey: 'selected',
      deltas,
      conversionHint: 'of total applications were selected (job offer)',
      detail: `${formatNum(applicants?.latest?.interviews_fixed)} interviews`,
    },
  ] : [
    {
      anchor: 'stage-awareness',
      num: 1,
      label: 'Awareness',
      awarenessMetrics: {
        gsc: awareness?.kpis?.gscImpressions || 0,
        social: awareness?.kpis?.socialChannelViews || 0,
      },
      deltas,
    },
    {
      anchor: 'stage-consideration',
      num: 2,
      label: 'Consideration',
      raw: users?.kpis?.totalUsers || 0,
      deltaKey: 'totalUsers',
      deltas,
      sourceBreakdown: users?.sourceBreakdown,
      detail: `${formatNum(deltas?.appDownloads?.value)} app downloads`,
    },
    {
      anchor: 'stage-commit-nyuuly',
      num: 3,
      label: 'Commit',
      raw: nyuulyCommit?.nyuulySubscribe || 0,
      deltaKey: 'nyuulySubscribe',
      deltas,
      conversionHint: 'of website visitors subscribed to Nyuuly',
      detail: `${formatNum(nyuulyCommit?.compassStarted)} Compass started`,
    },
    {
      anchor: 'stage-proceed-nyuuly',
      num: 4,
      label: 'Proceed (Uses)',
      raw: mobileSimFlow?.steps?.find((s) => s.key === 'apply')?.activeUsers || 0,
      deltaKey: 'mobileSimApply',
      deltas,
      stepDelta: mobileSimFlow?.steps?.find((s) => s.key === 'apply'),
      conversionHint: 'of subscribers started the Mobile Sim application',
      detail: `${formatNum(mobileSimFlow?.steps?.find((s) => s.key === 'confirm')?.activeUsers)} reached Confirm`,
    },
    {
      anchor: 'stage-result-nyuuly',
      num: 5,
      label: 'Result',
      raw: nyuulyResult?.mobileSimPurchased || 0,
      deltaKey: 'mobileSimPurchased',
      deltas,
      conversionHint: 'of Mobile Sim applicants completed a purchase',
      detail: `${formatNum(nyuulyResult?.formFilled)} forms filled`,
    },
  ];

  el.innerHTML = stages.map((s, i) => `
    ${renderPipelineStageCard(s, i > 0 ? stages[i - 1] : null)}
    ${i < stages.length - 1 ? '<div class="pipeline-arrow">→</div>' : ''}
  `).join('');
}

const APP_DOWNLOAD_COLORS = {
  iOS: '#A2AAAD',
  Android: '#3DDC84',
};

function renderConsiderationAudienceCharts(usersHistory, appDownloadsHistory, deltas, monthly) {
  renderConsiderationAudienceKpis(deltas, monthly);
  renderChartConsiderationWebUsers(usersHistory?.history || []);
  renderChartConsiderationAppDownloads(appDownloadsHistory?.history || []);
}

function renderConsiderationAudienceKpis(deltas, monthly) {
  const periodBits = [];
  if (monthly?.monthLabel) periodBits.push(`This month: ${monthly.monthLabel}`);
  if (monthly?.prevMonthLabel) periodBits.push(`compared to ${monthly.prevMonthLabel}`);
  const periodLine = periodBits.length
    ? `<span class="consideration-audience-period">${periodBits.join(' · ')}</span>`
    : '';

  const webEl = document.getElementById('considerationWebUsersKpi');
  if (webEl) {
    const totalUsers = deltas?.totalUsers?.value ?? 0;
    webEl.innerHTML = `
      ${periodLine}
      <div class="consideration-audience-summary">
        <span class="consideration-audience-label">Total users</span>
        <span class="consideration-audience-value">${formatNum(totalUsers)}</span>
        ${deltaBadgeMoM(deltas, 'totalUsers')}
      </div>
    `;
  }

  const appEl = document.getElementById('considerationAppDownloadsKpi');
  if (appEl) {
    const totalDownloads = deltas?.appDownloads?.value ?? 0;
    appEl.innerHTML = `
      ${periodLine}
      <div class="consideration-audience-summary">
        <span class="consideration-audience-label">Total downloads</span>
        <span class="consideration-audience-value">${formatNum(totalDownloads)}</span>
        ${deltaBadgeMoM(deltas, 'appDownloads')}
      </div>
    `;
  }
}

function renderChartConsiderationWebUsers(history) {
  destroyChart('chartConsiderationWebUsers');
  const ctx = document.getElementById('chartConsiderationWebUsers');
  if (!ctx || !history?.length) return;

  const labels = history.map((h) => h.label.replace(/^\d{4}\s/, ''));
  const data = history.map((h) => h.totalUsers);
  if (!data.some((v) => v > 0)) return;

  charts.chartConsiderationWebUsers = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total users',
        data,
        backgroundColor: companyBrandColor(),
      }],
    },
    options: {
      ...chartDefaults(),
      plugins: { ...chartDefaults().plugins, legend: { display: false } },
    },
  });
}

function renderChartConsiderationAppDownloads(history) {
  destroyChart('chartConsiderationAppDownloads');
  const ctx = document.getElementById('chartConsiderationAppDownloads');
  if (!ctx || !history?.length) return;

  const labels = history.map((h) => h.label.replace(/^\d{4}\s/, ''));
  const platforms = ['iOS', 'Android'];
  const hasData = history.some((h) => h.platforms?.some((p) => p.downloads > 0));
  if (!hasData) return;

  charts.chartConsiderationAppDownloads = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: platforms.map((platform) => ({
        label: platform,
        data: history.map((h) => h.platforms.find((p) => p.platform === platform)?.downloads || 0),
        backgroundColor: APP_DOWNLOAD_COLORS[platform],
      })),
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
      },
    },
  });
}

function renderNyuulyCommitSection(stats, historyData, deltas, monthly) {
  const kpiEl = document.getElementById('nyuulyCommitKpis');
  if (!kpiEl || state.company !== 'nyuuly') return;

  const kpis = stats?.kpis || {};
  const hasData = kpis.nyuulySubscribe > 0 || kpis.compassStarted > 0;

  if (!hasData) {
    kpiEl.innerHTML = '<div class="empty-state">No commit data — <a href="/upload">enter Nyuuly Subscribe and Compass started on the upload page</a></div>';
  } else {
    kpiEl.innerHTML = `
      ${monthly?.monthLabel ? `<span class="consideration-audience-period">This month: ${monthly.monthLabel}${monthly.prevMonthLabel ? ` · compared to ${monthly.prevMonthLabel}` : ''}</span>` : ''}
      <div class="kpi-card"><div class="label">Nyuuly Subscribe</div><div class="value">${formatNum(kpis.nyuulySubscribe)}</div>${deltaBadge(deltas, 'nyuulySubscribe')}</div>
      <div class="kpi-card"><div class="label">Compass Started</div><div class="value">${formatNum(kpis.compassStarted)}</div>${deltaBadge(deltas, 'compassStarted')}</div>
    `;
  }

  renderChartNyuulyCommit(historyData?.history || []);
}

const MOBILE_SIM_FLOW_STEPS = [
  { key: 'apply', label: 'Apply', color: '#4F8EF7' },
  { key: 'verify', label: 'Verify', color: '#6366f1' },
  { key: 'identity', label: 'Identity', color: '#a78bfa' },
  { key: 'payment', label: 'Payment', color: '#fbbf24' },
  { key: 'confirm', label: 'Confirm', color: '#34d399' },
];

const COMPASS_USES_CATEGORIES = [
  { key: 'student', label: 'Student', color: '#4F8EF7' },
  { key: 'self-sponsored', label: 'Self-sponsored', color: '#6366f1' },
  { key: 'company-sponsored', label: 'Company sponsored', color: '#a78bfa' },
  { key: 'family', label: 'Family', color: '#fbbf24' },
  { key: 'askme', label: 'Ask me', color: '#34d399' },
  { key: 'others', label: 'Others', color: '#f472b6' },
];

function stepMoMBadge(step) {
  const d = step?.deltaPct;
  if (d == null) return '<span class="kpi-delta kpi-delta-flat">— vs last month</span>';
  if (d > 0) return `<span class="kpi-delta kpi-delta-up">▲ ${Math.abs(d).toFixed(1)}%</span>`;
  if (d < 0) return `<span class="kpi-delta kpi-delta-down">▼ ${Math.abs(d).toFixed(1)}%</span>`;
  return '<span class="kpi-delta kpi-delta-flat">0.0%</span>';
}

function renderMobileSimFlowSection(flowData, historyData, monthly) {
  const kpiEl = document.getElementById('mobileSimFlowKpis');
  const funnelEl = document.getElementById('mobileSimFlowFunnel');
  const tableEl = document.getElementById('mobileSimFlowTable');
  if (!kpiEl || state.company !== 'nyuuly') return;

  const steps = flowData?.steps || [];
  const hasData = steps.some((s) => s.activeUsers > 0);

  if (!hasData) {
    if (funnelEl) funnelEl.innerHTML = '';
    kpiEl.innerHTML = '<div class="empty-state">No Mobile Sim page data — upload the <strong>Pages CSV</strong> for this month on the <a href="/upload">upload page</a></div>';
    if (tableEl) tableEl.innerHTML = '';
    destroyChart('chartMobileSimFlow');
    destroyChart('chartMobileSimFunnel');
    return;
  }

  const period = monthly?.monthLabel
    ? `<span class="consideration-audience-period">This month: ${monthly.monthLabel}${monthly.prevMonthLabel ? ` · compared to ${monthly.prevMonthLabel}` : ''}</span>`
    : '';

  if (funnelEl) {
    funnelEl.innerHTML = steps.map((step, i) => `
      <div class="mobile-sim-step">
        <div class="mobile-sim-step-label">${step.label}</div>
        <div class="mobile-sim-step-value">${formatNum(step.activeUsers)}</div>
        ${step.fromPrevStepPct != null ? `<div class="funnel-step-conversion"><span class="funnel-step-conversion-pct">${formatPctPoints(step.fromPrevStepPct)}</span><span class="funnel-step-conversion-desc">continued from the previous Mobile Sim step</span></div>` : ''}
      </div>
      ${i < steps.length - 1 ? '<div class="mobile-sim-arrow">→</div>' : ''}
    `).join('');
  }

  kpiEl.innerHTML = `
    ${period}
    ${steps.map((step) => `
      <div class="kpi-card">
        <div class="label">${step.label}</div>
        <div class="value">${formatNum(step.activeUsers)}</div>
        ${stepMoMBadge(step)}
        <div class="kpi-sub">${step.path}</div>
      </div>
    `).join('')}
  `;

  if (tableEl) {
    tableEl.innerHTML = `
      <div class="table-wrap">
        <table class="data-table mobile-sim-flow-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Page path</th>
              <th>Active users</th>
              <th>MoM</th>
              <th>From previous step</th>
            </tr>
          </thead>
          <tbody>
            ${steps.map((step, i) => `
              <tr>
                <td><strong>${i + 1}. ${step.label}</strong></td>
                <td><code>${step.path}</code></td>
                <td>${formatNum(step.activeUsers)}</td>
                <td>${stepMoMBadge(step)}</td>
                <td>${step.fromPrevStepPct != null ? formatPctPoints(step.fromPrevStepPct) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderChartMobileSimFunnel(steps);
  renderChartMobileSimFlow(historyData?.history || []);
}

function renderChartMobileSimFunnel(steps) {
  destroyChart('chartMobileSimFunnel');
  const ctx = document.getElementById('chartMobileSimFunnel');
  if (!ctx || !steps?.length) return;

  const hasData = steps.some((s) => s.activeUsers > 0);
  if (!hasData) return;

  charts.chartMobileSimFunnel = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: steps.map((s) => s.label),
      datasets: [{
        label: 'Active users',
        data: steps.map((s) => s.activeUsers),
        backgroundColor: MOBILE_SIM_FLOW_STEPS.map((s) => s.color),
      }],
    },
    options: {
      ...chartDefaults(),
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, beginAtZero: true },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
      },
    },
  });
}

function renderChartMobileSimFlow(history) {
  destroyChart('chartMobileSimFlow');
  const ctx = document.getElementById('chartMobileSimFlow');
  if (!ctx || !history?.length) return;

  const hasData = history.some((h) => MOBILE_SIM_FLOW_STEPS.some((s) => (h[s.key] || 0) > 0));
  if (!hasData) return;

  const labels = history.map((h) => h.label.replace(/^\d{4}\s/, ''));
  charts.chartMobileSimFlow = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: MOBILE_SIM_FLOW_STEPS.map((step) => ({
        label: step.label,
        data: history.map((h) => h[step.key] || 0),
        borderColor: step.color,
        backgroundColor: step.color,
        tension: 0.3,
        pointRadius: 4,
      })),
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, beginAtZero: true },
      },
    },
  });
}

function renderCompassUsesFlowSection(flowData, historyData, monthly) {
  const pathEl = document.getElementById('compassUsesPathExploration');
  const kpiEl = document.getElementById('compassUsesKpis');
  const tableEl = document.getElementById('compassUsesTable');
  if (!pathEl || state.company !== 'nyuuly') return;

  const root = flowData?.root || {};
  const categories = flowData?.categories || [];
  const hasData = (root.activeUsers || 0) > 0 || categories.some((c) => c.activeUsers > 0 || (c.children || []).length > 0);

  if (!hasData) {
    pathEl.innerHTML = '';
    if (kpiEl) kpiEl.innerHTML = '<div class="empty-state">No Compass page data — upload the <strong>Pages CSV</strong> for this month on the <a href="/upload">upload page</a></div>';
    if (tableEl) tableEl.innerHTML = '';
    destroyChart('chartCompassUsesCategories');
    destroyChart('chartCompassUsesHistory');
    return;
  }

  const period = monthly?.monthLabel
    ? `<span class="consideration-audience-period">This month: ${monthly.monthLabel}${monthly.prevMonthLabel ? ` · compared to ${monthly.prevMonthLabel}` : ''}</span>`
    : '';

  const maxCatUsers = Math.max(...categories.map((c) => c.activeUsers || 0), 1);

  pathEl.innerHTML = `
    <div class="path-exploration-grid">
      <div class="path-exploration-col">
        <div class="path-exploration-col-head">Starting point</div>
        <div class="path-node path-node-root">
          <div class="path-node-label">${root.label || 'Compass'}</div>
          <div class="path-node-value">${formatNum(root.activeUsers || 0)}</div>
          <div class="path-node-path"><code>/compass</code></div>
          ${stepMoMBadge(root)}
        </div>
      </div>
      <div class="path-exploration-connector" aria-hidden="true">→</div>
      <div class="path-exploration-col">
        <div class="path-exploration-col-head">Step +1 — Category</div>
        ${categories.map((cat) => `
          <div class="path-node path-node-category" style="--flow-width: ${Math.max(8, (cat.activeUsers / maxCatUsers) * 100)}%">
            <div class="path-node-label">${cat.label}</div>
            <div class="path-node-value">${formatNum(cat.activeUsers || 0)}</div>
            <div class="path-node-path"><code>${cat.path.replace('/compass', '') || '/'}</code></div>
            ${cat.fromCompassPct != null ? `<div class="funnel-step-conversion"><span class="funnel-step-conversion-pct">${formatPctPoints(cat.fromCompassPct)}</span><span class="funnel-step-conversion-desc">of Compass visitors opened this category</span></div>` : ''}
          </div>
        `).join('')}
      </div>
      <div class="path-exploration-connector" aria-hidden="true">→</div>
      <div class="path-exploration-col path-exploration-col-wide">
        <div class="path-exploration-col-head">Step +2 — Sub-pages</div>
        ${categories.map((cat) => `
          <div class="path-node-group">
            <div class="path-node-group-title">${cat.label}</div>
            ${(cat.children || []).length
              ? cat.children.map((child) => `
                <div class="path-node path-node-child">
                  <div class="path-node-label">${child.segment || child.label}</div>
                  <div class="path-node-value">${formatNum(child.activeUsers || 0)}</div>
                  <div class="path-node-path"><code>${child.path.replace('/compass', '')}</code></div>
                </div>
              `).join('')
              : '<div class="path-node path-node-empty">No sub-pages with users</div>'}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  if (kpiEl) {
    kpiEl.innerHTML = `
      ${period}
      <div class="kpi-card">
        <div class="label">Compass total</div>
        <div class="value">${formatNum(root.activeUsers || 0)}</div>
        ${stepMoMBadge(root)}
        <div class="kpi-sub">/compass</div>
      </div>
      ${categories.map((cat) => `
        <div class="kpi-card">
          <div class="label">${cat.label}</div>
          <div class="value">${formatNum(cat.activeUsers || 0)}</div>
          ${stepMoMBadge(cat)}
          <div class="kpi-sub">${cat.path}</div>
        </div>
      `).join('')}
    `;
  }

  if (tableEl) {
    const rows = categories.flatMap((cat) => {
      const baseRow = {
        step: 'Category',
        category: cat.label,
        path: cat.path,
        users: cat.activeUsers || 0,
        deltaPct: cat.deltaPct,
        fromPrev: cat.fromCompassPct,
      };
      const childRows = (cat.children || []).map((child) => ({
        step: 'Sub-page',
        category: cat.label,
        path: child.path,
        users: child.activeUsers || 0,
        deltaPct: child.prevActiveUsers != null ? deltaPctFromValues(child.activeUsers, child.prevActiveUsers) : null,
        fromPrev: cat.activeUsers > 0 ? Math.round((child.activeUsers / cat.activeUsers) * 1000) / 10 : null,
      }));
      return [baseRow, ...childRows];
    });

    tableEl.innerHTML = `
      <div class="table-wrap">
        <table class="data-table compass-uses-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Category</th>
              <th>Page path</th>
              <th>Active users</th>
              <th>MoM</th>
              <th>From previous step</th>
            </tr>
          </thead>
          <tbody>
            <tr class="compass-uses-root-row">
              <td><strong>Start</strong></td>
              <td>—</td>
              <td><code>${root.path || '/compass'}</code></td>
              <td>${formatNum(root.activeUsers || 0)}</td>
              <td>${stepMoMBadge(root)}</td>
              <td>—</td>
            </tr>
            ${rows.map((row) => `
              <tr>
                <td>${row.step}</td>
                <td>${row.category}</td>
                <td><code>${row.path}</code></td>
                <td>${formatNum(row.users)}</td>
                <td>${row.deltaPct != null ? formatDeltaPct(row.deltaPct) : '<span class="kpi-delta kpi-delta-flat">—</span>'}</td>
                <td>${row.fromPrev != null ? formatPctPoints(row.fromPrev) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderChartCompassUsesCategories(categories);
  renderChartCompassUsesHistory(historyData?.history || []);
}

function deltaPctFromValues(current, previous) {
  if (previous == null || previous === 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function formatDeltaPct(d) {
  if (d == null) return '<span class="kpi-delta kpi-delta-flat">—</span>';
  if (d > 0) return `<span class="kpi-delta kpi-delta-up">▲ ${Math.abs(d).toFixed(1)}%</span>`;
  if (d < 0) return `<span class="kpi-delta kpi-delta-down">▼ ${Math.abs(d).toFixed(1)}%</span>`;
  return '<span class="kpi-delta kpi-delta-flat">0.0%</span>';
}

function renderChartCompassUsesCategories(categories) {
  destroyChart('chartCompassUsesCategories');
  const ctx = document.getElementById('chartCompassUsesCategories');
  if (!ctx || !categories?.length) return;

  const hasData = categories.some((c) => c.activeUsers > 0);
  if (!hasData) return;

  const colorMap = Object.fromEntries(COMPASS_USES_CATEGORIES.map((c) => [c.key, c.color]));

  charts.chartCompassUsesCategories = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: categories.map((c) => c.label),
      datasets: [{
        label: 'Active users',
        data: categories.map((c) => c.activeUsers || 0),
        backgroundColor: categories.map((c) => colorMap[c.key] || '#94a3b8'),
      }],
    },
    options: {
      ...chartDefaults(),
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, beginAtZero: true },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
      },
    },
  });
}

function renderChartCompassUsesHistory(history) {
  destroyChart('chartCompassUsesHistory');
  const ctx = document.getElementById('chartCompassUsesHistory');
  if (!ctx || !history?.length) return;

  const hasData = history.some((h) => (h.compass || 0) > 0 || COMPASS_USES_CATEGORIES.some((c) => (h[c.key] || 0) > 0));
  if (!hasData) return;

  const labels = history.map((h) => h.label.replace(/^\d{4}\s/, ''));

  charts.chartCompassUsesHistory = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Compass',
          data: history.map((h) => h.compass || 0),
          borderColor: '#0ea5e9',
          backgroundColor: '#0ea5e9',
          tension: 0.3,
          pointRadius: 4,
        },
        ...COMPASS_USES_CATEGORIES.map((cat) => ({
          label: cat.label,
          data: history.map((h) => h[cat.key] || 0),
          borderColor: cat.color,
          backgroundColor: cat.color,
          tension: 0.3,
          pointRadius: 3,
        })),
      ],
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, beginAtZero: true },
      },
    },
  });
}

function renderChartNyuulyCommit(history) {
  destroyChart('chartNyuulyCommit');
  const ctx = document.getElementById('chartNyuulyCommit');
  if (!ctx || !history?.length) return;

  const hasData = history.some((h) => h.nyuulySubscribe > 0 || h.compassStarted > 0);
  if (!hasData) return;

  const labels = history.map((h) => h.label.replace(/^\d{4}\s/, ''));
  charts.chartNyuulyCommit = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Nyuuly Subscribe',
          data: history.map((h) => h.nyuulySubscribe || 0),
          borderColor: COLORS.nyuuly,
          backgroundColor: COLORS.nyuuly,
          tension: 0.3,
          pointRadius: 4,
        },
        {
          label: 'Compass Started',
          data: history.map((h) => h.compassStarted || 0),
          borderColor: '#34d399',
          backgroundColor: '#34d399',
          tension: 0.3,
          pointRadius: 4,
        },
      ],
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, beginAtZero: true },
      },
    },
  });
}

function renderNyuulyProceedSection(stats, historyData, deltas, monthly) {
  const kpiEl = document.getElementById('nyuulyProceedKpis');
  if (!kpiEl || state.company !== 'nyuuly') return;

  const kpis = stats?.kpis || {};
  const hasData = kpis.addToCart > 0 || kpis.welcomePackageStarted > 0 || kpis.compassFilled > 0;

  if (!hasData) {
    kpiEl.innerHTML = '<div class="empty-state">No proceed data — <a href="/upload">enter Add to cart, Welcome package, and Compass filled on the upload page</a></div>';
  } else {
    kpiEl.innerHTML = `
      ${monthly?.monthLabel ? `<span class="consideration-audience-period">This month: ${monthly.monthLabel}${monthly.prevMonthLabel ? ` · compared to ${monthly.prevMonthLabel}` : ''}</span>` : ''}
      <div class="kpi-card"><div class="label">Add to cart</div><div class="value">${formatNum(kpis.addToCart)}</div>${deltaBadge(deltas, 'addToCart')}</div>
      <div class="kpi-card"><div class="label">Welcome package process started</div><div class="value">${formatNum(kpis.welcomePackageStarted)}</div>${deltaBadge(deltas, 'welcomePackageStarted')}</div>
      <div class="kpi-card"><div class="label">Compass filled</div><div class="value">${formatNum(kpis.compassFilled)}</div>${deltaBadge(deltas, 'compassFilled')}</div>
    `;
  }

  renderChartNyuulyProceed(historyData?.history || []);
}

function renderChartNyuulyProceed(history) {
  destroyChart('chartNyuulyProceed');
  const ctx = document.getElementById('chartNyuulyProceed');
  if (!ctx || !history?.length) return;

  const hasData = history.some((h) => h.addToCart > 0 || h.welcomePackageStarted > 0 || h.compassFilled > 0);
  if (!hasData) return;

  const labels = history.map((h) => h.label.replace(/^\d{4}\s/, ''));
  charts.chartNyuulyProceed = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Add to cart',
          data: history.map((h) => h.addToCart || 0),
          borderColor: COLORS.nyuuly,
          backgroundColor: COLORS.nyuuly,
          tension: 0.3,
          pointRadius: 4,
        },
        {
          label: 'Welcome package process started',
          data: history.map((h) => h.welcomePackageStarted || 0),
          borderColor: '#a78bfa',
          backgroundColor: '#a78bfa',
          tension: 0.3,
          pointRadius: 4,
        },
        {
          label: 'Compass filled',
          data: history.map((h) => h.compassFilled || 0),
          borderColor: '#34d399',
          backgroundColor: '#34d399',
          tension: 0.3,
          pointRadius: 4,
        },
      ],
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, beginAtZero: true },
      },
    },
  });
}

function renderNyuulyResultSection(stats, historyData, deltas, monthly) {
  const kpiEl = document.getElementById('nyuulyResultKpis');
  if (!kpiEl || state.company !== 'nyuuly') return;

  const kpis = stats?.kpis || {};
  const hasData = kpis.mobileSimPurchased > 0 || kpis.welcomePackagePurchased > 0
    || kpis.formFilled > 0 || kpis.askMeRequest > 0;

  if (!hasData) {
    kpiEl.innerHTML = '<div class="empty-state">No result data — <a href="/upload">enter Mobile Sim, Welcome package, Form filled, and Ask me request on the upload page</a></div>';
  } else {
    kpiEl.innerHTML = `
      ${monthly?.monthLabel ? `<span class="consideration-audience-period">This month: ${monthly.monthLabel}${monthly.prevMonthLabel ? ` · compared to ${monthly.prevMonthLabel}` : ''}</span>` : ''}
      <div class="kpi-card"><div class="label">Mobile Sim purchased</div><div class="value">${formatNum(kpis.mobileSimPurchased)}</div>${deltaBadge(deltas, 'mobileSimPurchased')}</div>
      <div class="kpi-card"><div class="label">Welcome package purchased</div><div class="value">${formatNum(kpis.welcomePackagePurchased)}</div>${deltaBadge(deltas, 'welcomePackagePurchased')}</div>
      <div class="kpi-card"><div class="label">Form filled</div><div class="value">${formatNum(kpis.formFilled)}</div>${deltaBadge(deltas, 'formFilled')}</div>
      <div class="kpi-card"><div class="label">Ask me request</div><div class="value">${formatNum(kpis.askMeRequest)}</div>${deltaBadge(deltas, 'askMeRequest')}</div>
    `;
  }

  renderChartNyuulyResult(historyData?.history || []);
}

function renderChartNyuulyResult(history) {
  destroyChart('chartNyuulyResult');
  const ctx = document.getElementById('chartNyuulyResult');
  if (!ctx || !history?.length) return;

  const hasData = history.some((h) => h.mobileSimPurchased > 0 || h.welcomePackagePurchased > 0
    || h.formFilled > 0 || h.askMeRequest > 0);
  if (!hasData) return;

  const labels = history.map((h) => h.label.replace(/^\d{4}\s/, ''));
  charts.chartNyuulyResult = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Mobile Sim purchased',
          data: history.map((h) => h.mobileSimPurchased || 0),
          borderColor: COLORS.nyuuly,
          backgroundColor: COLORS.nyuuly,
          tension: 0.3,
          pointRadius: 4,
        },
        {
          label: 'Welcome package purchased',
          data: history.map((h) => h.welcomePackagePurchased || 0),
          borderColor: '#a78bfa',
          backgroundColor: '#a78bfa',
          tension: 0.3,
          pointRadius: 4,
        },
        {
          label: 'Form filled',
          data: history.map((h) => h.formFilled || 0),
          borderColor: '#34d399',
          backgroundColor: '#34d399',
          tension: 0.3,
          pointRadius: 4,
        },
        {
          label: 'Ask me request',
          data: history.map((h) => h.askMeRequest || 0),
          borderColor: '#fbbf24',
          backgroundColor: '#fbbf24',
          tension: 0.3,
          pointRadius: 4,
        },
      ],
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, beginAtZero: true },
      },
    },
  });
}

function renderCommitRegistrationBlockShell(registrations) {
  const periodHint = registrations
    ? `<strong>${registrations.monthLabel}</strong> · ${registrations.periodLabel}${registrations.isPartialMonth ? ` · <span class="partial-month-badge">Partial month (${registrations.daysInPeriod} of ${registrations.daysInMonth} days)</span>` : ''}`
    : 'Enter platform registrations and applicant stats on the <a href="/upload">upload page</a>.';

  return `
    <div class="consideration-panel full-width consideration-registrations">
      <h4>Commit — Registrations &amp; Applications</h4>
      <p class="subsection-hint">${periodHint}</p>

      <h4 class="subsection-title">Total registrations (Web + iOS + Android)</h4>
      <p class="subsection-hint">Combined sign-ups across all platforms — last 6 months.</p>
      <div id="commitTotalRegKpi"></div>
      <div class="chart-container consideration-chart">
        <div class="chart-header"><h3>Total registrations by month</h3><button class="chart-download" data-chart="chartCommitTotalRegistrations">PNG</button></div>
        <div class="chart-wrapper"><canvas id="chartCommitTotalRegistrations"></canvas></div>
      </div>

      <h4 class="subsection-title consideration-reg-platform-title">Applications — total &amp; unique</h4>
      <p class="subsection-hint">Total applications and unique applicants from manual uploads — last 6 months.</p>
      <div id="commitApplicationsKpi"></div>
      <div class="chart-container consideration-chart">
        <div class="chart-header"><h3>Applications by month</h3><button class="chart-download" data-chart="chartCommitApplications">PNG</button></div>
        <div class="chart-wrapper"><canvas id="chartCommitApplications"></canvas></div>
      </div>

      <h4 class="subsection-title consideration-reg-platform-title">Conversion funnel — this month</h4>
      <p class="subsection-hint">GSC search impressions → website users → registrations → applications. Social channel views are shown separately (not summed with impressions).</p>
      <div id="commitVerticalFunnel" class="commit-funnel-vertical"></div>
    </div>
  `;
}

function platformRegDeltaBadge(current, previous) {
  if (previous == null || previous === 0) {
    return '<span class="kpi-delta kpi-delta-flat">— no prior month</span>';
  }
  const d = Math.round(((current - previous) / previous) * 1000) / 10;
  if (d > 0) return `<span class="kpi-delta kpi-delta-up">▲ ${Math.abs(d).toFixed(1)}% vs last month</span>`;
  if (d < 0) return `<span class="kpi-delta kpi-delta-down">▼ ${Math.abs(d).toFixed(1)}% vs last month</span>`;
  return '<span class="kpi-delta kpi-delta-flat">0.0% vs last month</span>';
}

function renderCommitRegistrationCharts(regContext) {
  if (!regContext) return;
  const { funnelMetrics, platformHistory, applicantHistory, deltas, monthly } = regContext;
  const platHist = platformHistory?.history || [];
  const appHist = applicantHistory?.history || [];

  const totalRegKpiEl = document.getElementById('commitTotalRegKpi');
  if (totalRegKpiEl) {
    const periodBits = [];
    if (monthly?.monthLabel) periodBits.push(`This month: ${monthly.monthLabel}`);
    if (monthly?.prevMonthLabel) periodBits.push(`compared to ${monthly.prevMonthLabel}`);
    totalRegKpiEl.innerHTML = `
      ${periodBits.length ? `<span class="consideration-audience-period">${periodBits.join(' · ')}</span>` : ''}
      <div class="consideration-audience-summary">
        <span class="consideration-audience-label">Total registrations</span>
        <span class="consideration-audience-value">${formatNum(funnelMetrics?.registrations || 0)}</span>
        ${deltaBadgeMoM(deltas, 'registrations')}
      </div>
    `;
  }

  const appKpiEl = document.getElementById('commitApplicationsKpi');
  if (appKpiEl) {
    const monthKey = state.month;
    const idx = appHist.findIndex((h) => h.month === monthKey);
    const currIdx = idx >= 0 ? idx : appHist.length - 1;
    const curr = currIdx >= 0 ? appHist[currIdx] : null;
    const prev = currIdx > 0 ? appHist[currIdx - 1] : null;
    const totalApps = curr?.totalApplications || 0;
    const uniqueApps = curr?.uniqueApplicants || 0;
    const prevTotal = prev?.totalApplications;
    const prevUnique = prev?.uniqueApplicants;

    appKpiEl.innerHTML = `
      ${monthly?.monthLabel ? `<span class="consideration-audience-period">This month: ${monthly.monthLabel}${monthly.prevMonthLabel ? ` · compared to ${monthly.prevMonthLabel}` : ''}</span>` : ''}
      <div class="consideration-reg-kpi-row">
        <div class="consideration-audience-summary">
          <span class="consideration-audience-label">Total applications</span>
          <span class="consideration-audience-value">${formatNum(totalApps)}</span>
          ${platformRegDeltaBadge(totalApps, prevTotal)}
        </div>
        <div class="consideration-audience-summary">
          <span class="consideration-audience-label">Unique applicants</span>
          <span class="consideration-audience-value">${formatNum(uniqueApps)}</span>
          ${platformRegDeltaBadge(uniqueApps, prevUnique)}
        </div>
      </div>
    `;
  }

  renderChartCommitTotalRegistrations(platHist);
  renderChartCommitApplications(appHist);
  renderCommitVerticalFunnel(funnelMetrics);
}

function renderChartCommitTotalRegistrations(history) {
  destroyChart('chartCommitTotalRegistrations');
  const ctx = document.getElementById('chartCommitTotalRegistrations');
  if (!ctx || !history?.length) return;

  const labels = history.map((h) => h.label.replace(/^\d{4}\s/, ''));
  const data = history.map((h) => h.totalRegistrations || 0);
  if (!data.some((v) => v > 0)) return;

  charts.chartCommitTotalRegistrations = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total registrations',
        data,
        backgroundColor: '#34d399',
      }],
    },
    options: {
      ...chartDefaults(),
      plugins: { ...chartDefaults().plugins, legend: { display: false } },
    },
  });
}

function renderChartCommitApplications(history) {
  destroyChart('chartCommitApplications');
  const ctx = document.getElementById('chartCommitApplications');
  if (!ctx || !history?.length) return;

  const labels = history.map((h) => h.label.replace(/^\d{4}\s/, ''));
  const hasData = history.some((h) => h.totalApplications > 0 || h.uniqueApplicants > 0);
  if (!hasData) return;

  charts.chartCommitApplications = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Total applications',
          data: history.map((h) => h.totalApplications || 0),
          backgroundColor: COLORS.workjapan,
        },
        {
          label: 'Unique applicants',
          data: history.map((h) => h.uniqueApplicants || 0),
          backgroundColor: COLORS.nyuuly,
        },
      ],
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
      },
    },
  });
}

function renderCommitVerticalFunnel(funnelMetrics) {
  const el = document.getElementById('commitVerticalFunnel');
  if (!el || !funnelMetrics) return;

  const gscImpressions = funnelMetrics.gscImpressions || 0;
  const socialViews = funnelMetrics.socialViews || 0;
  const steps = [
    { label: 'GSC search impressions', value: gscImpressions, color: '#4F8EF7' },
    { label: 'Website users', value: funnelMetrics.users || 0, color: '#FF6B35' },
    { label: 'Registrations', value: funnelMetrics.registrations || 0, color: '#34d399' },
    { label: 'Applications', value: funnelMetrics.applications || 0, color: '#facc15' },
  ];
  if (!steps.some((s) => s.value > 0) && !socialViews) {
    el.innerHTML = '<p class="empty-state">Upload GSC, User Acquisition, platform registrations, and applicant stats to see the funnel.</p>';
    return;
  }

  const max = Math.max(...steps.map((s) => s.value), 1);
  const socialNote = socialViews > 0
    ? `<div class="commit-funnel-note">Social channel views (separate metric): <strong>${formatNum(socialViews)}</strong> — not added to search impressions</div>`
    : '';
  el.innerHTML = steps.map((step, i) => {
    const widthPct = Math.max(12, Math.round((step.value / max) * 100));
    const prev = i > 0 ? steps[i - 1].value : null;
    const conv = prev > 0 ? conversionFromPrevious(step.value, prev) : null;
    const connector = i > 0 ? funnelPrevStepHtml(conv) : '';
    return `
      ${connector}
      <div class="commit-funnel-step" style="--funnel-width: ${widthPct}%; --funnel-color: ${step.color}">
        <span class="commit-funnel-step-label">${step.label}</span>
        <span class="commit-funnel-step-value">${formatNum(step.value)}</span>
      </div>
    `;
  }).join('') + socialNote;
}

function renderCommitRegistration(regContext, registrations) {
  const el = document.getElementById('commitRegistration');
  if (!el || state.company !== 'workjapan') return;
  el.innerHTML = `<div class="consideration-hub-inner">${renderCommitRegistrationBlockShell(registrations)}</div>`;
  renderCommitRegistrationCharts(regContext);
  bindConsiderationChartDownloads(el);
}

function renderConsiderationInsights(consideration) {
  const el = document.getElementById('considerationInsights');
  if (!el) return;

  const hasFunnel = consideration?.fullFunnel?.length;
  const isWj = state.company === 'workjapan';

  if (!hasFunnel) {
    el.innerHTML = `
      <div class="consideration-hub-inner">
        <div class="highlight-panel empty">Upload the <strong>Pages CSV</strong> and <strong>User Acquisition CSV</strong> on the <a href="/upload">upload page</a>.</div>
      </div>`;
    bindConsiderationChartDownloads(el);
    return;
  }

  el.innerHTML = `
    <div class="consideration-hub-inner">

      <div class="consideration-grid">
        <div class="consideration-panel">
          <h4>Organic landing pages (Search Console)</h4>
          <p class="subsection-hint">Top pages receiving organic search clicks this month — upload GSC Performance zip on the <a href="/upload">upload page</a>.</p>
          <div class="table-wrap"><table class="consideration-table">
            <thead><tr><th>Page</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead>
            <tbody>${(consideration.topGscPages || []).map((p) => `
              <tr>
                <td class="gsc-page-cell">${p.page}</td>
                <td>${formatNum(p.clicks)}</td>
                <td>${formatNum(p.impressions)}</td>
                <td>${formatPct(gscCtrValue(p))}</td>
                <td>${p.position?.toFixed?.(1) ?? p.position}</td>
              </tr>
            `).join('') || '<tr><td colspan="5" class="empty-state">Upload Search Console zip for this month</td></tr>'}
            </tbody>
          </table></div>
        </div>

        <div class="consideration-panel">
          <h4>Where users come from</h4>
          <p class="subsection-hint">Top arrival channels before they browse (User Acquisition CSV).</p>
          <div class="table-wrap"><table class="consideration-table">
            <thead><tr><th>Channel</th><th>Total Users</th><th>New Users</th><th>Avg engagement</th></tr></thead>
            <tbody>${(consideration.entryChannels || []).map((c) => `
              <tr>
                <td>${c.channel}</td>
                <td>${formatNum(c.totalUsers)}</td>
                <td>${formatNum(c.newUsers)}</td>
                <td>${formatNum(c.avgEngagementTime)}s</td>
              </tr>
            `).join('') || '<tr><td colspan="4" class="empty-state">Upload User Acquisition CSV</td></tr>'}
            </tbody>
          </table></div>
        </div>
      </div>

      <div class="consideration-panel full-width">
        <h4>Page navigation — where users go next</h4>
        <p class="subsection-hint">Landing pages and top browse pages, with likely next steps from Pages CSV.</p>
        <div class="table-wrap"><table class="consideration-table">
          <thead><tr><th>Page</th><th>Views</th><th>Users</th><th>Likely next pages</th><th>Notes</th></tr></thead>
          <tbody>${(consideration.navigationPaths || []).map((n) => `
            <tr>
              <td><code>${n.path}</code></td>
              <td>${formatNum(n.views)}</td>
              <td>${formatNum(n.users)}</td>
              <td class="next-pages">${(n.nextPages || []).map((p) => `<code>${p}</code>`).join(' → ') || '—'}</td>
              <td class="nav-hint">${n.hint || ''}</td>
            </tr>
          `).join('') || '<tr><td colspan="5" class="empty-state">No navigation data</td></tr>'}
          </tbody>
        </table></div>
      </div>

      ${consideration.topJobCategories?.length && isWj ? `
        <div class="consideration-panel full-width">
          <h4>Most viewed job categories</h4>
          <p class="subsection-hint">If certain visa types leave more often, compare categories here with visa data in Customer Intelligence.</p>
          <div class="table-wrap"><table class="consideration-table">
            <thead><tr><th>Category</th><th>Listings</th><th>Views</th><th>Users</th></tr></thead>
            <tbody>${consideration.topJobCategories.map((c) => `
              <tr><td>${c.category}</td><td>${formatNum(c.jobs)}</td><td>${formatNum(c.views)}</td><td>${formatNum(c.users)}</td></tr>
            `).join('')}</tbody>
          </table></div>
        </div>
      ` : ''}
    </div>
  `;

  bindConsiderationChartDownloads(el);
}

function bindConsiderationChartDownloads(el) {
  el?.querySelectorAll('.chart-download').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadChart(btn.dataset.chart);
    });
  });
}

function renderConsiderationDropoffs(journeys) {
  renderConsiderationInsights(journeys?.consideration);
}

function renderCommitBarriers(intelligence) {
  const el = document.getElementById('commitBarriers');
  if (!el || state.company !== 'workjapan') return;

  const barrier = intelligence?.barriers?.latest;
  const geo = intelligence?.geo?.latest;
  const dropRate = intelligence?.barriers?.dropOffRate;

  if (!barrier && !geo) {
    el.innerHTML = `
      <div class="highlight-panel empty">
        Enter <strong>conversion barriers</strong> and <strong>audience geography</strong> on the
        <a href="/upload">upload page</a> to track Japanese phone number drop-offs and in-Japan vs abroad users.
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="highlight-panel">
      <h4>Commit stage barriers &amp; geography</h4>
      <div class="highlight-grid">
        ${barrier ? `
        <div class="highlight-card abandon-red">
          <div class="highlight-label">${barrier.barrier_name}</div>
          <div class="highlight-value">${formatPct(dropRate)}</div>
          <div class="highlight-sub">${formatNum(barrier.users_dropped)} dropped of ${formatNum(barrier.users_reached)} reached</div>
        </div>` : ''}
        ${geo ? `
        <div class="highlight-card">
          <div class="highlight-label">In Japan visitors</div>
          <div class="highlight-value">${formatNum(geo.in_japan_visitors)}</div>
          <div class="highlight-sub">${formatDelta(intelligence.geo.comparisons?.inJapanVisitors?.vsAvgPct)}</div>
        </div>
        <div class="highlight-card">
          <div class="highlight-label">Outside Japan visitors</div>
          <div class="highlight-value">${formatNum(geo.out_japan_visitors)}</div>
          <div class="highlight-sub">${formatDelta(intelligence.geo.comparisons?.outJapanVisitors?.vsAvgPct)}</div>
        </div>
        <div class="highlight-card">
          <div class="highlight-label">In Japan registrations</div>
          <div class="highlight-value">${formatNum(geo.in_japan_registrations)}</div>
          <div class="highlight-sub">vs ${formatNum(geo.out_japan_registrations)} abroad</div>
        </div>` : ''}
      </div>
    </div>
  `;
}

function renderSocialAccountsTable(byAccount) {
  const table = document.getElementById('socialAccountsTable');
  if (!table) return;
  if (!byAccount?.length) {
    table.querySelector('thead').innerHTML = '';
    table.querySelector('tbody').innerHTML = '<tr><td colspan="5" class="empty-state">Upload social CSV per platform (IG, YouTube, Facebook…)</td></tr>';
    return;
  }
  table.querySelector('thead').innerHTML = '<tr><th>Account</th><th>Posts</th><th>Views</th><th>Reach</th><th>Engagement</th></tr>';
  table.querySelector('tbody').innerHTML = byAccount.map((a) => `
    <tr>
      <td>${a.account}${a.account_username ? ` <span class="text-muted">@${a.account_username}</span>` : ''}</td>
      <td>${formatNum(a.posts)}</td>
      <td>${formatNum(a.views)}</td>
      <td>${formatNum(a.reach)}</td>
      <td>${formatNum(a.engagement)}</td>
    </tr>
  `).join('');
}

function renderChartSocialAccounts(byAccount) {
  destroyChart('chartSocialAccounts');
  const ctx = document.getElementById('chartSocialAccounts');
  if (!ctx || !byAccount?.length) return;

  charts.chartSocialAccounts = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: byAccount.map((a) => a.account),
      datasets: [
        { label: 'Views', data: byAccount.map((a) => a.views), backgroundColor: COLORS.workjapan },
        { label: 'Reach', data: byAccount.map((a) => a.reach), backgroundColor: COLORS.nyuuly },
      ],
    },
    options: chartDefaults(),
  });
}

function renderTopJobsTable(topJobs) {
  const table = document.getElementById('topJobsTable');
  if (!table) return;
  if (!topJobs?.length) {
    table.querySelector('thead').innerHTML = '';
    table.querySelector('tbody').innerHTML = '<tr><td colspan="4" class="empty-state">No job detail pages in Pages CSV</td></tr>';
    return;
  }
  table.querySelector('thead').innerHTML = '<tr><th>Job Page</th><th>Views</th><th>Users</th><th>Avg Time</th></tr>';
  table.querySelector('tbody').innerHTML = topJobs.map((j) => `
    <tr>
      <td>${j.path}</td>
      <td>${formatNum(j.views)}</td>
      <td>${formatNum(j.users)}</td>
      <td>${formatNum(j.avgTime)}s</td>
    </tr>
  `).join('');
}

function renderApplicantProceedKpis(kpis, latest, deltas) {
  const el = document.getElementById('applicantProceedKpis');
  if (!el) return;
  if (!latest && (!kpis || !kpis.uniqueApplicants)) {
    el.innerHTML = '<div class="empty-state">No application data — <a href="/upload">enter on upload page</a></div>';
    return;
  }
  const data = latest || kpis;
  el.innerHTML = `
    <div class="kpi-card"><div class="label">Unique Applicants</div><div class="value">${formatNum(data.unique_applicants ?? data.uniqueApplicants)}</div>${deltaBadge(deltas, 'uniqueApplicants')}</div>
    <div class="kpi-card"><div class="label">Total Applications</div><div class="value">${formatNum(data.total_applications ?? data.totalApplications)}</div>${deltaBadge(deltas, 'totalApplications')}</div>
    <div class="kpi-card"><div class="label">Latest Month</div><div class="value" style="font-size:1rem">${data.month_label || '—'}</div></div>
  `;
}

function renderApplicantResultKpis(kpis, latest, deltas) {
  const el = document.getElementById('applicantResultKpis');
  if (!el) return;
  if (!latest && (!kpis || !kpis.selected)) {
    el.innerHTML = '<div class="empty-state">No outcome data — <a href="/upload">enter on upload page</a></div>';
    return;
  }
  const data = latest || kpis;
  el.innerHTML = `
    <div class="kpi-card"><div class="label">Screening Passes</div><div class="value">${formatNum(data.screening_passes ?? data.screeningPasses)}</div>${deltaBadge(deltas, 'screeningPasses')}</div>
    <div class="kpi-card"><div class="label">Interviews Fixed</div><div class="value">${formatNum(data.interviews_fixed ?? data.interviewsFixed)}</div>${deltaBadge(deltas, 'interviewsFixed')}</div>
    <div class="kpi-card"><div class="label">Remaining ESP</div><div class="value">${formatNum(data.remaining_esp ?? data.remainingEsp)}</div>${deltaBadge(deltas, 'remainingEsp')}</div>
    <div class="kpi-card"><div class="label">Selected</div><div class="value">${formatNum(data.selected)}</div>${deltaBadge(deltas, 'selected')}</div>
  `;
}

function renderPlatformKpis(kpis, deltas) {
  const el = document.getElementById('platformKpis');
  if (!el) return;
  if (!kpis?.totalActiveUsers) {
    el.innerHTML = '<div class="empty-state">No active user data — <a href="/upload">enter data on upload page</a></div>';
    return;
  }
  el.innerHTML = `
    <div class="kpi-card"><div class="label">Total Active Users</div><div class="value">${formatNum(kpis.totalActiveUsers)}</div>${deltaBadge(deltas, 'platformActiveUsers')}</div>
  `;
}

function renderApplicantKpis(kpis, latest) {
  const el = document.getElementById('applicantKpis');
  if (!el) return;
  if (!latest && (!kpis || !kpis.uniqueApplicants)) {
    el.innerHTML = '<div class="empty-state">No applicant data — <a href="/upload">enter data on upload page</a></div>';
    return;
  }
  const data = latest || kpis;
  el.innerHTML = `
    <div class="kpi-card"><div class="label">Unique Applicants</div><div class="value">${formatNum(data.unique_applicants ?? data.uniqueApplicants)}</div></div>
    <div class="kpi-card"><div class="label">Screening Passes</div><div class="value">${formatNum(data.screening_passes ?? data.screeningPasses)}</div></div>
    <div class="kpi-card"><div class="label">Total Applications</div><div class="value">${formatNum(data.total_applications ?? data.totalApplications)}</div></div>
    <div class="kpi-card"><div class="label">Interviews Fixed</div><div class="value">${formatNum(data.interviews_fixed ?? data.interviewsFixed)}</div></div>
    <div class="kpi-card"><div class="label">Remaining ESP</div><div class="value">${formatNum(data.remaining_esp ?? data.remainingEsp)}</div></div>
    <div class="kpi-card"><div class="label">Selected</div><div class="value">${formatNum(data.selected)}</div></div>
  `;
}

function renderChartApplicantFunnel(funnelSteps, monthLabel) {
  destroyChart('chartApplicantFunnel');
  const ctx = document.getElementById('chartApplicantFunnel');
  if (!ctx || !funnelSteps?.length) return;

  charts.chartApplicantFunnel = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: funnelSteps.map((s) => s.label),
      datasets: [{
        label: monthLabel ? `Count (${monthLabel})` : 'Count',
        data: funnelSteps.map((s) => s.value),
        backgroundColor: [COLORS.nyuuly, '#a78bfa', COLORS.workjapan, '#34d399', '#facc15'],
      }],
    },
    options: {
      ...chartDefaults(),
      indexAxis: 'y',
    },
  });
}

function renderChartApplicantOutcomes(history) {
  destroyChart('chartApplicantOutcomes');
  const ctx = document.getElementById('chartApplicantOutcomes');
  if (!ctx || !history?.length) return;

  const hasData = history.some((h) =>
    h.uniqueApplicants > 0
    || h.screeningPasses > 0
    || h.totalApplications > 0
    || h.interviewsFixed > 0
    || h.remainingEsp > 0
    || h.selected > 0
  );
  if (!hasData) return;

  const labels = history.map((h) => h.label.replace(/^\d{4}\s/, ''));
  const metrics = [
    { label: 'Unique Applicants', key: 'uniqueApplicants', color: COLORS.nyuuly },
    { label: 'Screening Passes', key: 'screeningPasses', color: '#60a5fa' },
    { label: 'Total Applications', key: 'totalApplications', color: COLORS.workjapan },
    { label: 'Interviews Fixed', key: 'interviewsFixed', color: '#34d399' },
    { label: 'Remaining ESP', key: 'remainingEsp', color: '#a78bfa' },
    { label: 'Selected', key: 'selected', color: '#facc15' },
  ];

  charts.chartApplicantOutcomes = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: metrics.map((m) => ({
        label: m.label,
        data: history.map((h) => h[m.key] || 0),
        borderColor: m.color,
        backgroundColor: m.color,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
      })),
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, beginAtZero: true },
      },
    },
  });
}

function renderChartApplicantsByMonth(rows) {
  destroyChart('chartApplicantsByMonth');
  const ctx = document.getElementById('chartApplicantsByMonth');
  if (!ctx || !rows?.length) return;

  charts.chartApplicantsByMonth = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.month_label),
      datasets: [
        { label: 'Unique Applicants', data: rows.map((r) => r.unique_applicants), backgroundColor: COLORS.nyuuly },
        { label: 'Total Applications', data: rows.map((r) => r.total_applications), backgroundColor: COLORS.workjapan },
        { label: 'Interviews Fixed', data: rows.map((r) => r.interviews_fixed), backgroundColor: '#34d399' },
        { label: 'Selected', data: rows.map((r) => r.selected), backgroundColor: '#facc15' },
      ],
    },
    options: chartDefaults(),
  });
}

function renderDataStatus(completeness) {
  const el = document.getElementById('dataStatusDots');
  if (!completeness) {
    el.innerHTML = '—';
    return;
  }
  const labels = {
    social: 'Social',
    funnel: 'Funnel',
    users: 'Users',
    pages: 'Pages',
    gsc: 'GSC',
  };
  el.innerHTML = Object.entries(labels).map(([key, label]) => {
    const ok = completeness[key];
    return `<span class="data-dot ${ok ? 'data-dot-ok' : 'data-dot-missing'}" title="${label}: ${ok ? 'loaded' : 'missing'}">${label}</span>`;
  }).join('');
}

function showCompareSection() {}

async function loadLastUpdated() {
  try {
    const data = await fetchJSON('/api/upload-history');
    const el = document.getElementById('lastUpdated');
    el.textContent = data.lastUpdated
      ? `Last updated: ${new Date(data.lastUpdated + 'Z').toLocaleString()}`
      : 'Last updated: —';
  } catch (_) {}
}

function renderGscKpis(gsc, deltas) {
  const el = document.getElementById('gscKpis');
  if (!el) return;
  const kpis = gsc?.kpis || {};
  if (!gsc?.hasData) {
    el.innerHTML = '<div class="empty-state">No Search Console data for this month — upload the GSC Performance zip on the <a href="/upload">upload page</a>.</div>';
    return;
  }
  el.innerHTML = [
    { label: 'Organic Clicks', value: formatNum(kpis.clicks), key: 'gscClicks' },
    { label: 'Impressions', value: formatNum(kpis.impressions), key: 'gscImpressions' },
    { label: 'Avg Position', value: kpis.avgPosition?.toFixed?.(1) ?? '—', key: 'gscAvgPosition' },
    { label: 'CTR', value: formatPct(kpis.ctr), key: 'gscCtr' },
  ].map((k) => `
    <div class="kpi-card">
      <div class="label">${k.label}</div>
      <div class="value">${k.value}${deltaBadge(deltas, k.key)}</div>
    </div>
  `).join('');
}

function renderGscCharts(gsc) {
  destroyChart('chartGscDaily');
  destroyChart('chartGscQueries');

  const dailyCanvas = document.getElementById('chartGscDaily');
  const queriesCanvas = document.getElementById('chartGscQueries');
  if (!gsc?.hasData) return;

  const daily = gsc.daily || [];
  if (dailyCanvas && daily.length) {
    charts.chartGscDaily = new Chart(dailyCanvas, {
      type: 'line',
      data: {
        labels: daily.map((d) => d.dimension_value.slice(5)),
        datasets: [
          { label: 'Clicks', data: daily.map((d) => d.clicks), borderColor: COLORS.workjapan, tension: 0.3 },
          { label: 'Impressions', data: daily.map((d) => d.impressions), borderColor: COLORS.nyuuly, tension: 0.3, yAxisID: 'y1' },
        ],
      },
      options: {
        ...chartDefaults(),
        scales: {
          x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
          y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, position: 'left' },
          y1: { ticks: { color: COLORS.text }, grid: { drawOnChartArea: false }, position: 'right' },
        },
      },
    });
  }

  const queries = (gsc.topQueries || []).slice(0, 10);
  if (queriesCanvas && queries.length) {
    charts.chartGscQueries = new Chart(queriesCanvas, {
      type: 'bar',
      data: {
        labels: queries.map((q) => q.dimension_value.length > 28 ? q.dimension_value.slice(0, 28) + '…' : q.dimension_value),
        datasets: [{ label: 'Clicks', data: queries.map((q) => q.clicks), backgroundColor: COLORS.workjapanLight }],
      },
      options: { ...chartDefaults(), indexAxis: 'y' },
    });
  }
}

function renderGscQueriesTable(gsc) {
  const table = document.getElementById('gscQueriesTable');
  if (!table) return;
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = '<tr><th>Query</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr>';
  const rows = gsc?.topQueries || [];
  tbody.innerHTML = rows.length
    ? rows.map((q) => `
      <tr>
        <td>${q.dimension_value}</td>
        <td>${formatNum(q.clicks)}</td>
        <td>${formatNum(q.impressions)}</td>
        <td>${formatPct(gscCtrValue(q))}</td>
        <td>${q.position?.toFixed?.(1) ?? q.position}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="5" class="empty-state">No query data</td></tr>';
}

const SOCIAL_PLATFORM_COLORS = {
  Facebook: '#4267B2',
  Instagram: '#E1306C',
  TikTok: '#25F4EE',
  YouTube: '#FF0000',
};

function renderBrandMessage(data, monthly) {
  const el = document.getElementById('brandMessagePanel');
  if (!el) return;

  const message = data?.message?.trim();
  if (!message) {
    el.innerHTML = '<div class="empty-state">No brand message for this month — <a href="/upload">add the key message on the upload page</a></div>';
    return;
  }

  const period = monthly?.monthLabel
    ? `<span class="consideration-audience-period">${monthly.monthLabel} key message</span>`
    : '';
  el.innerHTML = `
    ${period}
    <blockquote class="brand-message-quote">${escapeHtml(message)}</blockquote>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderSocialSectionContribution(journeys, deltas) {
  const el = document.getElementById('socialAwarenessContrib');
  if (!el) return;
  const awareness = journeyById(journeys, 'awareness');
  const socialViews = awareness?.kpis?.socialChannelViews || 0;
  const gscImpressions = awareness?.kpis?.gscImpressions || 0;
  if (!socialViews && !gscImpressions) {
    el.className = 'section-contribution empty';
    el.textContent = 'No social data this month';
    return;
  }
  el.className = 'section-contribution';
  el.innerHTML = `${formatNum(socialViews)} social channel views${deltaBadge(deltas, 'socialChannelViews')}`;
}

function valueDeltaBadge(current, prev) {
  if (prev == null || prev === 0) {
    return '<span class="kpi-delta kpi-delta-flat">— vs last month</span>';
  }
  const d = Math.round(((current - prev) / prev) * 1000) / 10;
  if (d > 0) return `<span class="kpi-delta kpi-delta-up">▲ ${Math.abs(d).toFixed(1)}% vs last month</span>`;
  if (d < 0) return `<span class="kpi-delta kpi-delta-down">▼ ${Math.abs(d).toFixed(1)}% vs last month</span>`;
  return '<span class="kpi-delta kpi-delta-flat">0.0% vs last month</span>';
}

function socialChannelPrevViews(history, monthKey) {
  const months = history || [];
  const idx = months.findIndex((h) => h.month === monthKey);
  const prev = idx > 0 ? months[idx - 1] : null;
  if (!prev) return { totalViews: null, channels: {} };
  const channels = Object.fromEntries(
    (prev.channels || []).map((c) => [c.channel, c.views || 0]),
  );
  return { totalViews: prev.totalViews ?? null, channels };
}

function renderSocialKpis(socialChannels, socialCsv, deltas, socialChannelHistory) {
  const el = document.getElementById('socialKpis');
  if (!el) return;

  const channelMap = Object.fromEntries((socialChannels?.channels || []).map((c) => [c.channel, c.views]));
  const manualTotal = socialChannels?.totalViews || 0;
  const csvPosts = socialCsv?.posts?.length || 0;
  const prev = socialChannelPrevViews(socialChannelHistory?.history, state.month);
  const platforms = ['Facebook', 'Instagram', 'TikTok', 'YouTube'];

  if (!manualTotal && !csvPosts) {
    el.innerHTML = '<div class="empty-state">No social data for this month — enter channel views on the <a href="/upload">upload page</a> or upload a Social CSV.</div>';
    return;
  }

  el.innerHTML = `
    <div class="kpi-card">
      <div class="label">Total Social Views</div>
      <div class="value">${formatNum(manualTotal)}</div>
      ${valueDeltaBadge(manualTotal, prev.totalViews)}
    </div>
    ${platforms.map((platform) => `
      <div class="kpi-card">
        <div class="label">${platform}</div>
        <div class="value">${formatNum(channelMap[platform] || 0)}</div>
        ${valueDeltaBadge(channelMap[platform] || 0, prev.channels[platform])}
      </div>
    `).join('')}
    ${csvPosts ? `
      <div class="kpi-card">
        <div class="label">CSV Posts</div>
        <div class="value">${formatNum(csvPosts)}</div>
        ${deltaBadgeMoM(deltas, 'postCount')}
      </div>
    ` : ''}
  `;
}

function renderChartSocialPlatforms(channels) {
  destroyChart('chartSocialPlatforms');
  const ctx = document.getElementById('chartSocialPlatforms');
  if (!ctx) return;

  const labels = ['Facebook', 'Instagram', 'TikTok', 'YouTube'];
  const channelMap = Object.fromEntries((channels || []).map((c) => [c.channel, c.views]));
  const data = labels.map((l) => channelMap[l] || 0);

  if (!data.some((v) => v > 0)) return;

  charts.chartSocialPlatforms = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Views',
        data,
        backgroundColor: labels.map((l) => SOCIAL_PLATFORM_COLORS[l]),
      }],
    },
    options: {
      ...chartDefaults(),
      plugins: { ...chartDefaults().plugins, legend: { display: false } },
    },
  });
}

function renderChartSocialPlatformsByMonth(history) {
  destroyChart('chartSocialPlatformsByMonth');
  const ctx = document.getElementById('chartSocialPlatformsByMonth');
  if (!ctx || !history?.length) return;

  const labels = history.map((h) => h.label.replace(/^\d{4}\s/, ''));
  const platforms = ['Facebook', 'Instagram', 'TikTok', 'YouTube'];

  charts.chartSocialPlatformsByMonth = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: platforms.map((platform) => ({
        label: platform,
        data: history.map((h) => h.channels.find((c) => c.channel === platform)?.views || 0),
        backgroundColor: SOCIAL_PLATFORM_COLORS[platform],
      })),
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { stacked: false, ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        y: { stacked: false, ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
      },
    },
  });
}

function renderTopContentTable(topPosts) {
  const table = document.getElementById('topContentTable');
  if (!table) return;
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = '<tr><th>#</th><th>Account</th><th>Description</th><th>Type</th><th>Views</th><th>Reach</th><th>Engagement</th><th>Link</th></tr>';

  const posts = (topPosts || []).slice(0, 10);
  tbody.innerHTML = posts.length
    ? posts.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${p.account_username || p.account_name || '—'}</td>
        <td class="content-desc-cell">${(p.description || '—').slice(0, 80)}${(p.description || '').length > 80 ? '…' : ''}</td>
        <td>${p.post_type || '—'}</td>
        <td>${formatNum(p.views)}</td>
        <td>${formatNum(p.reach)}</td>
        <td>${formatNum(p.engagement || (p.likes + p.comments + p.shares + p.saves))}</td>
        <td>${p.permalink ? `<a href="${p.permalink}" target="_blank" rel="noopener">Open ↗</a>` : '—'}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="8" class="empty-state">No posts in Social CSV for this month — upload on the <a href="/upload">upload page</a></td></tr>';
}

function renderUsersKpis(kpis, deltas) {
  const el = document.getElementById('usersKpis');
  if (!kpis || !kpis.totalUsers) {
    el.innerHTML = '<div class="empty-state">No user acquisition data for this date range — <a href="/upload">upload a CSV</a></div>';
    return;
  }
  el.innerHTML = `
    <div class="kpi-card"><div class="label">Total Users</div><div class="value">${formatNum(kpis.totalUsers)}</div>${deltaBadge(deltas, 'totalUsers')}</div>
    <div class="kpi-card"><div class="label">New Users</div><div class="value">${formatNum(kpis.newUsers)}</div>${deltaBadge(deltas, 'newUsers')}</div>
    <div class="kpi-card"><div class="label">Returning Users</div><div class="value">${formatNum(kpis.returningUsers)}</div>${deltaBadge(deltas, 'returningUsers')}</div>
  `;
}

function renderChartViewsReach(timeSeries) {
  destroyChart('chartViewsReach');
  const ctx = document.getElementById('chartViewsReach');
  if (!timeSeries.length) return;

  const dates = [...new Set(timeSeries.map(d => d.date))].sort();
  const companies = state.company === 'all'
    ? ['nyuuly', 'workjapan']
    : [state.company];

  const datasets = [];
  for (const co of companies) {
    const color = co === 'nyuuly' ? COLORS.nyuuly : COLORS.workjapan;
    const label = co === 'nyuuly' ? 'Nyuuly' : 'WORK JAPAN';
    datasets.push({
      label: `${label} Views`,
      data: dates.map(d => {
        const row = timeSeries.find(r => r.date === d && r.company === co);
        return row ? row.views : 0;
      }),
      borderColor: color,
      backgroundColor: 'transparent',
      tension: 0.3,
    });
    if (state.company === 'all') {
      datasets.push({
        label: `${label} Reach`,
        data: dates.map(d => {
          const row = timeSeries.find(r => r.date === d && r.company === co);
          return row ? row.reach : 0;
        }),
        borderColor: color,
        borderDash: [5, 5],
        backgroundColor: 'transparent',
        tension: 0.3,
      });
    }
  }

  if (state.company !== 'all') {
    datasets.push({
      label: 'Reach',
      data: dates.map(d => {
        const row = timeSeries.find(r => r.date === d);
        return row ? row.reach : 0;
      }),
      borderColor: COLORS.workjapan,
      borderDash: [5, 5],
      backgroundColor: 'transparent',
      tension: 0.3,
    });
  }

  charts.chartViewsReach = new Chart(ctx, {
    type: 'line',
    data: { labels: dates, datasets },
    options: chartDefaults(),
  });
}

function renderChartEngagement(topPosts) {
  destroyChart('chartEngagement');
  const ctx = document.getElementById('chartEngagement');
  if (!topPosts.length) return;

  const labels = topPosts.map((p, i) => {
    const d = p.publish_time ? p.publish_time.slice(0, 10) : `Post ${i + 1}`;
    return d;
  });

  charts.chartEngagement = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Likes', data: topPosts.map(p => p.likes), backgroundColor: COLORS.nyuuly },
        { label: 'Comments', data: topPosts.map(p => p.comments), backgroundColor: '#a78bfa' },
        { label: 'Shares', data: topPosts.map(p => p.shares), backgroundColor: COLORS.workjapan },
        { label: 'Saves', data: topPosts.map(p => p.saves), backgroundColor: '#34d399' },
      ],
    },
    options: { ...chartDefaults(), scales: { ...chartDefaults().scales, x: { stacked: true, ticks: { color: COLORS.text, maxRotation: 45 }, grid: { color: COLORS.grid } }, y: { stacked: true, ticks: { color: COLORS.text }, grid: { color: COLORS.grid } } } },
  });
}

function renderChartPostTypes(postTypes) {
  destroyChart('chartPostTypes');
  const ctx = document.getElementById('chartPostTypes');
  if (!postTypes.length) return;

  charts.chartPostTypes = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: postTypes.map(p => p.post_type),
      datasets: [{ label: 'Posts', data: postTypes.map(p => p.count), backgroundColor: [COLORS.nyuuly, COLORS.workjapan, '#a78bfa', '#34d399'] }],
    },
    options: chartDefaults(),
  });
}

function renderChartUsersDonut(rows) {
  destroyChart('chartUsersDonut');
  const ctx = document.getElementById('chartUsersDonut');
  if (!rows.length) return;

  const colors = [COLORS.nyuuly, COLORS.workjapan, '#a78bfa', '#34d399', '#facc15', '#f472b6', '#60a5fa'];

  charts.chartUsersDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: rows.map(r => r.channel_group),
      datasets: [{ data: rows.map(r => r.total_users), backgroundColor: colors }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: COLORS.text, font: { size: 10 } } } },
    },
  });
}

function renderChartUsersEngagement(rows) {
  destroyChart('chartUsersEngagement');
  const ctx = document.getElementById('chartUsersEngagement');
  if (!rows.length) return;

  charts.chartUsersEngagement = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: rows.map(r => r.channel_group),
      datasets: [{ label: 'Avg Engagement Time (sec)', data: rows.map(r => r.avg_engagement_time), backgroundColor: companyBrandColor() }],
    },
    options: chartDefaults(),
  });
}

function renderCompareCharts(summary) {
  destroyChart('chartCompareBar');
  destroyChart('chartCompareRadar');

  const nyuulyUsers = summary.users.find(t => t.company === 'nyuuly') || {};
  const wjUsers = summary.users.find(t => t.company === 'workjapan') || {};

  const ctxBar = document.getElementById('chartCompareBar');
  charts.chartCompareBar = new Chart(ctxBar, {
    type: 'bar',
    data: {
      labels: ['Total Users', 'New Users', 'Avg Engagement Time'],
      datasets: [
        {
          label: 'Nyuuly',
          data: [nyuulyUsers.totalUsers || 0, nyuulyUsers.newUsers || 0, nyuulyUsers.avgEngagementTime || 0],
          backgroundColor: COLORS.nyuuly,
        },
        {
          label: 'WORK JAPAN',
          data: [wjUsers.totalUsers || 0, wjUsers.newUsers || 0, wjUsers.avgEngagementTime || 0],
          backgroundColor: COLORS.workjapan,
        },
      ],
    },
    options: chartDefaults(),
  });

  const nyuulySocial = summary.social.find(s => s.company === 'nyuuly') || {};
  const wjSocial = summary.social.find(s => s.company === 'workjapan') || {};
  const nyuulyFunnel = summary.funnel.filter(f => f.company === 'nyuuly');
  const wjFunnel = summary.funnel.filter(f => f.company === 'workjapan');
  const nyuulyPage = summary.topPages.find(p => p.company === 'nyuuly') || {};
  const wjPage = summary.topPages.find(p => p.company === 'workjapan') || {};

  const metrics = ['Social Views', 'Social Reach', 'Engagement Rate', 'Total Users', 'Funnel Completion', 'Top Page Views'];
  const nyuulyVals = [
    nyuulySocial.views || 0,
    nyuulySocial.reach || 0,
    nyuulySocial.reach ? (nyuulySocial.engagement / nyuulySocial.reach) * 100 : 0,
    nyuulyUsers.totalUsers || 0,
    (nyuulyFunnel.find(f => f.step && f.step.includes('Purchase'))?.completion_rate || 0) * 100,
    nyuulyPage.views || 0,
  ];
  const wjVals = [
    wjSocial.views || 0,
    wjSocial.reach || 0,
    wjSocial.reach ? (wjSocial.engagement / wjSocial.reach) * 100 : 0,
    wjUsers.totalUsers || 0,
    (wjFunnel.find(f => f.step && f.step.includes('Purchase'))?.completion_rate || 0) * 100,
    wjPage.views || 0,
  ];

  const maxes = metrics.map((_, i) => Math.max(nyuulyVals[i], wjVals[i], 1));
  const nyuulyNorm = nyuulyVals.map((v, i) => (v / maxes[i]) * 100);
  const wjNorm = wjVals.map((v, i) => (v / maxes[i]) * 100);

  const ctxRadar = document.getElementById('chartCompareRadar');
  charts.chartCompareRadar = new Chart(ctxRadar, {
    type: 'radar',
    data: {
      labels: metrics,
      datasets: [
        { label: 'Nyuuly', data: nyuulyNorm, borderColor: COLORS.nyuuly, backgroundColor: COLORS.nyuulyLight },
        { label: 'WORK JAPAN', data: wjNorm, borderColor: COLORS.workjapan, backgroundColor: COLORS.workjapanLight },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { r: { beginAtZero: true, max: 100, ticks: { color: COLORS.text, backdropColor: 'transparent' }, grid: { color: COLORS.grid }, pointLabels: { color: COLORS.text, font: { size: 10 } } } },
      plugins: { legend: { labels: { color: COLORS.text } } },
    },
  });

  renderCompareTable(nyuulySocial, wjSocial, nyuulyUsers, wjUsers, nyuulyPage, wjPage);
}

function renderCompareTable(nSocial, wSocial, nUsers, wUsers, nPage, wPage) {
  const table = document.getElementById('compareTable');
  table.querySelector('thead').innerHTML = `
    <tr><th>Metric</th><th>Nyuuly</th><th>WORK JAPAN</th></tr>
  `;
  table.querySelector('tbody').innerHTML = `
    <tr><td>Social Views</td><td>${formatNum(nSocial.views)}</td><td>${formatNum(wSocial.views)}</td></tr>
    <tr><td>Social Reach</td><td>${formatNum(nSocial.reach)}</td><td>${formatNum(wSocial.reach)}</td></tr>
    <tr><td>Social Engagement</td><td>${formatNum(nSocial.engagement)}</td><td>${formatNum(wSocial.engagement)}</td></tr>
    <tr><td>Total Users</td><td>${formatNum(nUsers.totalUsers)}</td><td>${formatNum(wUsers.totalUsers)}</td></tr>
    <tr><td>New Users</td><td>${formatNum(nUsers.newUsers)}</td><td>${formatNum(wUsers.newUsers)}</td></tr>
    <tr><td>Returning Users</td><td>${formatNum(nUsers.returningUsers)}</td><td>${formatNum(wUsers.returningUsers)}</td></tr>
    <tr><td>Top Page Views</td><td>${formatNum(nPage.views)} (${nPage.page_path || '—'})</td><td>${formatNum(wPage.views)} (${wPage.page_path || '—'})</td></tr>
  `;
}

function sortData(data, sort) {
  return [...data].sort((a, b) => {
    let av = a[sort.col], bv = b[sort.col];
    if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv || '').toLowerCase(); }
    if (av < bv) return sort.dir === 'asc' ? -1 : 1;
    if (av > bv) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function renderSortableTable(tableId, columns, data, sort, onSort) {
  const table = document.getElementById(tableId);
  table.querySelector('thead').innerHTML = `<tr>${columns.map(c =>
    `<th class="${sort.col === c.key ? 'sorted-' + sort.dir : ''}" data-col="${c.key}">${c.label}</th>`
  ).join('')}</tr>`;

  table.querySelector('thead').querySelectorAll('th').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.col;
      if (sort.col === col) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
      else { sort.col = col; sort.dir = 'desc'; }
      onSort();
    };
  });

  if (!data.length) {
    table.querySelector('tbody').innerHTML = `<tr><td colspan="${columns.length}" class="empty-state">No data for this date range — <a href="/upload">upload a CSV first</a></td></tr>`;
    return;
  }

  table.querySelector('tbody').innerHTML = data.map(row => row._html).join('');
}

function abandonClass(rate) {
  const pct = rate <= 1 ? rate * 100 : rate;
  if (pct < 10) return 'abandon-green';
  if (pct <= 30) return 'abandon-yellow';
  return 'abandon-red';
}

function renderSocialTable() {
  const sorted = sortData(socialPosts, socialSort);
  const pageSize = 10;
  const start = (socialPage - 1) * pageSize;
  const page = sorted.slice(start, start + pageSize);

  const rows = page.map(p => ({
    ...p,
    _html: `<tr>
      <td>${(p.publish_time || '').slice(0, 10)}</td>
      <td>${p.account_username || p.account_name || '—'}</td>
      <td>${p.post_type || '—'}</td>
      <td>${formatNum(p.views)}</td>
      <td>${formatNum(p.reach)}</td>
      <td>${formatNum(p.likes)}</td>
      <td>${formatNum(p.comments)}</td>
      <td>${formatNum(p.shares)}</td>
      <td>${formatNum(p.saves)}</td>
      <td>${formatPct(p.engagement_rate)}</td>
      <td>${p.permalink ? `<a href="${p.permalink}" target="_blank" rel="noopener">Open ↗</a>` : '—'}</td>
    </tr>`,
  }));

  renderSortableTable('socialTable', [
    { key: 'publish_time', label: 'Date' },
    { key: 'account_username', label: 'Account' },
    { key: 'post_type', label: 'Post Type' },
    { key: 'views', label: 'Views' },
    { key: 'reach', label: 'Reach' },
    { key: 'likes', label: 'Likes' },
    { key: 'comments', label: 'Comments' },
    { key: 'shares', label: 'Shares' },
    { key: 'saves', label: 'Saves' },
    { key: 'engagement_rate', label: 'Eng. Rate' },
    { key: 'permalink', label: 'Link' },
  ], rows, socialSort, () => renderSocialTable());

  renderPagination('socialPagination', socialPage, Math.ceil(socialPosts.length / pageSize), (p) => {
    socialPage = p;
    renderSocialTable();
  });
}

function renderUsersTable(rows) {
  if (!rows.length) {
    document.getElementById('usersTable').querySelector('tbody').innerHTML =
      '<tr><td colspan="8" class="empty-state">No data for this date range — <a href="/upload">upload a CSV first</a></td></tr>';
    return;
  }

  const maxUsers = Math.max(...rows.map(r => r.total_users));
  const maxNew = Math.max(...rows.map(r => r.new_users));
  const maxReturning = Math.max(...rows.map(r => r.returning_users));
  const maxTime = Math.max(...rows.map(r => r.avg_engagement_time));

  const sorted = sortData(rows, usersSort);
  const data = sorted.map(r => ({
    ...r,
    _html: `<tr>
      <td>${r.channel_group}</td>
      <td class="${r.total_users === maxUsers ? 'top-metric' : ''}">${formatNum(r.total_users)}</td>
      <td class="${r.new_users === maxNew ? 'top-metric' : ''}">${formatNum(r.new_users)}</td>
      <td class="${r.returning_users === maxReturning ? 'top-metric' : ''}">${formatNum(r.returning_users)}</td>
      <td class="${r.avg_engagement_time === maxTime ? 'top-metric' : ''}">${formatNum(r.avg_engagement_time)}s</td>
      <td>${formatNum(r.engaged_sessions_per_user)}</td>
      <td>${formatNum(r.event_count)}</td>
      <td>${formatNum(r.key_events)}</td>
    </tr>`,
  }));

  renderSortableTable('usersTable', [
    { key: 'channel_group', label: 'Channel' },
    { key: 'total_users', label: 'Total Users' },
    { key: 'new_users', label: 'New Users' },
    { key: 'returning_users', label: 'Returning Users' },
    { key: 'avg_engagement_time', label: 'Avg Engagement Time' },
    { key: 'engaged_sessions_per_user', label: 'Engaged Sessions/User' },
    { key: 'event_count', label: 'Event Count' },
    { key: 'key_events', label: 'Key Events' },
  ], data, usersSort, () => renderUsersTable(rows));
}

function renderPagesTable() {
  const sorted = sortData(pagesData, pagesSort);
  const pageSize = 15;
  const start = (pagesPage - 1) * pageSize;
  const page = sorted.slice(start, start + pageSize);

  const rows = page.map(r => ({
    ...r,
    _html: `<tr class="${r.views_per_user > 2 ? 'highlight-green' : ''}">
      <td>${r.page_path}</td>
      <td>${formatNum(r.views)}</td>
      <td>${formatNum(r.active_users)}</td>
      <td>${formatNum(r.views_per_user)}</td>
      <td>${formatNum(r.avg_engagement_time)}s</td>
      <td>${formatNum(r.event_count)}</td>
    </tr>`,
  }));

  renderSortableTable('pagesTable', [
    { key: 'page_path', label: 'Page Path' },
    { key: 'views', label: 'Views' },
    { key: 'active_users', label: 'Active Users' },
    { key: 'views_per_user', label: 'Views/User' },
    { key: 'avg_engagement_time', label: 'Avg Engagement Time' },
    { key: 'event_count', label: 'Event Count' },
  ], rows, pagesSort, () => renderPagesTable());

  renderPagination('pagesPagination', pagesPage, Math.ceil(pagesData.length / pageSize), (p) => {
    pagesPage = p;
    renderPagesTable();
  });
}

function renderPagination(containerId, current, total, onChange) {
  const el = document.getElementById(containerId);
  if (total <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button ${current <= 1 ? 'disabled' : ''} id="${containerId}_prev">← Prev</button>
    <span>Page ${current} of ${total}</span>
    <button ${current >= total ? 'disabled' : ''} id="${containerId}_next">Next →</button>
  `;
  document.getElementById(`${containerId}_prev`)?.addEventListener('click', () => onChange(current - 1));
  document.getElementById(`${containerId}_next`)?.addEventListener('click', () => onChange(current + 1));
}

async function loadDashboard() {
  await loadAvailableMonths();
  if (!state.month) {
    updateFilterLabel();
    document.body.classList.remove('is-loading');
    return;
  }

  const q = buildQuery();
  document.body.classList.add('is-loading');
  updateCompanyLayout();

  try {
    const isWorkJapan = state.company === 'workjapan';
    const monthQ = new URLSearchParams({ company: state.company, month: state.month });

    const fetches = [
      fetchJSON(`/api/social?${q}`),
      fetchJSON(`/api/users?${q}`),
      fetchJSON(`/api/pages?${q}`),
      fetchJSON(`/api/journeys?${q}`),
      fetchJSON(`/api/dashboard-guide?company=${state.company}`),
      fetchJSON(`/api/search-console?${q}`),
      fetchJSON(`/api/monthly?${monthQ.toString()}`),
      fetchJSON(`/api/social-channels?${q}`),
      fetchJSON(`/api/social-channels/history?company=${state.company}`),
    ];
    if (isWorkJapan) {
      fetches.push(fetchJSON(`/api/platform-stats?${q}`));
      fetches.push(fetchJSON(`/api/applicant-stats?${q}`));
      fetches.push(fetchJSON(`/api/intelligence?${q}`));
    }

    const results = await Promise.all(fetches);
    const [social, users, pages, journeys, guide, gsc, monthly, socialChannels, socialChannelHistory, platform, applicants, intelligence] = isWorkJapan
      ? results
      : [...results.slice(0, 9), null, null, null];

    const deltas = monthly?.kpis || {};

    updateFilterLabel(journeys.filter || social.filter);
    renderFunnelNav(guide);

    renderGscKpis(gsc, deltas);
    renderGscCharts(gsc);
    renderGscQueriesTable(gsc);

    const brandMessage = await fetchJSONSafe(`/api/brand-message?${q}`, { message: '' });
    renderBrandMessage(brandMessage, monthly);

    const [usersHistory, appDownloadsHistory] = await Promise.all([
      fetchJSONSafe(`/api/users/history?company=${state.company}`, { history: [] }),
      fetchJSONSafe(`/api/app-downloads/history?company=${state.company}`, { history: [] }),
    ]);
    renderConsiderationAudienceCharts(usersHistory, appDownloadsHistory, deltas, monthly);
    renderConsiderationInsights(journeys.consideration);

    if (isWorkJapan) {
      const [platformRegHistory, applicantHistory] = await Promise.all([
        fetchJSONSafe(`/api/platform-stats/history?company=${state.company}`, { history: [] }),
        fetchJSONSafe(`/api/applicant-stats/history?company=${state.company}`, { history: [] }),
      ]);
      renderFunnelPipeline(journeys, platform, applicants, social, users, deltas);
      const regContext = {
        funnelMetrics: {
          gscImpressions: gsc?.kpis?.impressions || 0,
          socialViews: socialChannels?.totalViews || 0,
          users: users?.kpis?.totalUsers || 0,
          registrations: journeys.consideration?.registrations?.totalRegistrations
            || platform?.kpis?.totalRegistrations
            || 0,
          applications: applicants?.kpis?.totalApplications
            || applicants?.latest?.total_applications
            || 0,
        },
        platformHistory: platformRegHistory,
        applicantHistory,
        deltas,
        monthly,
      };
      renderCommitRegistration(regContext, journeys.consideration?.registrations);
      renderCommitBarriers(intelligence);
      renderTopJobsTable(intelligence?.topJobs);

      renderPlatformKpis(platform.kpis, deltas);

      renderApplicantProceedKpis(applicants.kpis, applicants.latest, deltas);
      renderApplicantResultKpis(applicants.kpis, applicants.latest, deltas);
      renderChartApplicantOutcomes(applicantHistory?.history);
      renderChartApplicantFunnel(applicants.funnelSteps, applicants.latest?.month_label);
      renderChartApplicantsByMonth(applicants.rows);
    } else {
      const [nyuulyCommitStats, nyuulyCommitHistory, nyuulyResultStats, nyuulyResultHistory, mobileSimFlow, mobileSimFlowHistory, compassUsesFlow, compassUsesHistory] = await Promise.all([
        fetchJSONSafe(`/api/nyuuly-commit-stats?${q}`, { kpis: {} }),
        fetchJSONSafe(`/api/nyuuly-commit-stats/history?company=${state.company}`, { history: [] }),
        fetchJSONSafe(`/api/nyuuly-result-stats?${q}`, { kpis: {} }),
        fetchJSONSafe(`/api/nyuuly-result-stats/history?company=${state.company}`, { history: [] }),
        fetchJSONSafe(`/api/mobile-sim-flow?${q}`, { steps: [] }),
        fetchJSONSafe(`/api/mobile-sim-flow/history?company=${state.company}`, { history: [] }),
        fetchJSONSafe(`/api/compass-uses-flow?${q}`, { categories: [] }),
        fetchJSONSafe(`/api/compass-uses-flow/history?company=${state.company}`, { history: [] }),
      ]);
      renderNyuulyCommitSection(nyuulyCommitStats, nyuulyCommitHistory, deltas, monthly);
      renderMobileSimFlowSection(mobileSimFlow, mobileSimFlowHistory, monthly);
      renderCompassUsesFlowSection(compassUsesFlow, compassUsesHistory, monthly);
      renderNyuulyResultSection(nyuulyResultStats, nyuulyResultHistory, deltas, monthly);
      renderFunnelPipeline(
        journeys, null, null, social, users, deltas,
        nyuulyCommitStats?.kpis,
        nyuulyResultStats?.kpis,
        mobileSimFlow,
      );
    }

    renderDataStatus(journeys.dataCompleteness);

    renderSocialSectionContribution(journeys, deltas);
    renderSocialKpis(socialChannels, social, deltas, socialChannelHistory);
    renderChartSocialPlatforms(socialChannels?.channels || []);
    renderChartSocialPlatformsByMonth(socialChannelHistory?.history || []);
    renderTopContentTable(social.topPosts || []);

    renderUsersKpis(users.kpis, deltas);
    renderChartUsersDonut(users.rows || []);
    renderChartUsersEngagement(users.rows || []);
    renderUsersTable(users.rows || []);

    pagesData = pages.rows || [];
    pagesPage = 1;
    renderPagesTable();
  } catch (err) {
    console.error('Dashboard load error:', err);
  } finally {
    document.body.classList.remove('is-loading');
  }
}

function initControls() {
  document.getElementById('companyTabs').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-company]');
    if (!btn) return;
    document.querySelectorAll('#companyTabs .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.company = btn.dataset.company;
    sessionStorage.setItem('analyticsCompany', state.company);
    await loadAvailableMonths(true);
    loadDashboard();
  });

  document.getElementById('monthSelect').addEventListener('change', (e) => {
    state.month = e.target.value;
    loadDashboard();
  });

  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('collapsed');
    });
  });

  document.querySelectorAll('.chart-download').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadChart(btn.dataset.chart);
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const saved = sessionStorage.getItem('analyticsCompany');
  if (saved === 'nyuuly' || saved === 'workjapan') {
    document.querySelectorAll('#companyTabs .tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.company === saved);
    });
  }
  syncStateFromUI();
  initControls();
  loadLastUpdated();
  await loadAvailableMonths(true);
  loadDashboard();
});
