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
  dateRange: '90',
  startDate: null,
  endDate: null,
  activeJourney: 'awareness',
};

let journeyData = null;

let socialPosts = [];
let funnelRows = [];
let socialPage = 1;
let pagesData = [];
let pagesPage = 1;
let socialSort = { col: 'views', dir: 'desc' };
let funnelSort = { col: 'step', dir: 'asc' };
let trafficSort = { col: 'sessions', dir: 'desc' };
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
  const val = n <= 1 ? n * 100 : n;
  return val.toFixed(1) + '%';
}

function getDateRange() {
  const today = new Date();
  const end = state.endDate || today.toISOString().slice(0, 10);

  if (state.dateRange === 'custom' && state.startDate) {
    return { start: state.startDate, end: state.endDate || end };
  }

  const start = new Date(today);
  const days = state.dateRange === '90' ? 90 : state.dateRange === '30' ? 30 : 7;
  start.setDate(start.getDate() - days);
  return { start: start.toISOString().slice(0, 10), end };
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
  if (!res.ok) throw new Error('API error');
  return res.json();
}

function buildQuery() {
  const { start, end } = getDateRange();
  const params = new URLSearchParams();
  params.set('company', state.company);
  params.set('start', start);
  params.set('end', end);
  return params.toString();
}

function companyLabel(company) {
  return company === 'workjapan' ? 'WORK JAPAN' : 'Nyuuly';
}

function updateFilterLabel(filter) {
  const el = document.getElementById('filterLabel');
  if (!el) return;
  const { start, end } = getDateRange();
  const co = filter?.company || state.company;
  const rangeLabel = state.dateRange === '7' ? 'Last 7 days'
    : state.dateRange === '30' ? 'Last 30 days'
    : state.dateRange === '90' ? 'Last 3 months'
    : 'Custom range';
  el.textContent = `${companyLabel(co)} · ${rangeLabel} (${start} → ${end})`;
}

function syncStateFromUI() {
  const activeCompany = document.querySelector('#companyTabs .tab-btn.active');
  if (activeCompany?.dataset.company) state.company = activeCompany.dataset.company;

  const activeRange = document.querySelector('#dateGroup .tab-btn.active');
  if (activeRange?.dataset.range) state.dateRange = activeRange.dataset.range;

  const today = new Date().toISOString().slice(0, 10);
  const endInput = document.getElementById('endDate');
  const startInput = document.getElementById('startDate');
  if (endInput && !endInput.value) endInput.value = today;
  if (startInput && !startInput.value) {
    const { start } = getDateRange();
    startInput.value = start;
  }
}

function formatDelta(pct) {
  if (pct == null || Number.isNaN(pct)) return '<span class="delta-neutral">— vs 6mo avg</span>';
  const cls = pct > 0 ? 'delta-up' : pct < 0 ? 'delta-down' : 'delta-neutral';
  const sign = pct > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${pct}% vs 6mo avg</span>`;
}

function renderMarkdownBold(text) {
  return String(text || '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function journeyById(journeys, id) {
  return journeys?.journeys?.find((j) => j.id === id);
}

function updateCompanyLayout() {
  const isWj = state.company === 'workjapan';
  document.body.classList.toggle('company-workjapan', isWj);
  document.body.classList.toggle('company-nyuuly', !isWj);
  document.querySelectorAll('.workjapan-only').forEach((el) => {
    el.style.display = isWj ? '' : 'none';
  });
  const journeysTitle = document.getElementById('journeysSectionTitle');
  if (journeysTitle) {
    journeysTitle.textContent = isWj
      ? 'Customer Journey Deep Dive (optional detail)'
      : 'Customer Journeys';
  }
}

function renderDashboardGuide(guide) {
  if (!guide) return;
  const title = document.getElementById('guideTitle');
  const intro = document.getElementById('guideIntro');
  const pillars = document.getElementById('guidePillars');
  const legend = document.getElementById('guideLegend');
  if (title) title.textContent = guide.title || 'How to read this dashboard';
  if (intro) intro.innerHTML = renderMarkdownBold(guide.intro);
  if (pillars) {
    const extra = guide.pillars_extra || [];
    const all = [...(guide.pillars || []), ...extra.map((p) => ({
      title: p.label || p.title,
      body: p.summary || p.body || p.note || '',
    }))];
    pillars.innerHTML = all.map((p) => `
      <div class="guide-pillar">
        <h4>${p.title}</h4>
        <p>${p.body}</p>
      </div>
    `).join('');
  }
  if (legend) {
    legend.innerHTML = (guide.dataLegend || []).map((d) => `
      <span class="guide-legend-item"><strong>${d.label}</strong> — ${d.desc}</span>
    `).join('');
  }
}

function renderFunnelNav(guide) {
  const nav = document.getElementById('funnelNav');
  if (!nav || state.company !== 'workjapan') return;

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

function renderFunnelPipeline(journeys, platform, applicants, social) {
  const el = document.getElementById('funnelPipeline');
  if (!el || state.company !== 'workjapan') return;

  const awareness = journeyById(journeys, 'awareness');
  const seeker = journeyById(journeys, 'seeker-application');
  const register = journeyById(journeys, 'register-apply');

  const stages = [
    {
      anchor: 'stage-awareness',
      num: 1,
      label: 'Awareness',
      value: formatNum(awareness?.kpis?.socialViews),
      detail: `${formatNum(awareness?.kpis?.socialReach)} reach · ${formatNum(awareness?.kpis?.sessions)} sessions`,
    },
    {
      anchor: 'stage-consideration',
      num: 2,
      label: 'Consideration',
      value: formatNum(seeker?.kpis?.started),
      detail: seeker?.kpis?.biggestDropOffStep
        ? `Biggest drop: ${seeker.kpis.biggestDropOffStep} (${formatPct(seeker.kpis.biggestDropOffPct)})`
        : 'Browse → job detail path',
    },
    {
      anchor: 'stage-commit',
      num: 3,
      label: 'Commit (CV)',
      value: formatNum(platform?.kpis?.totalRegistrations || register?.kpis?.activeUsers),
      detail: `${formatPct(register?.kpis?.conversionRate)} conversion to register`,
    },
    {
      anchor: 'stage-proceed',
      num: 4,
      label: 'Proceed',
      value: formatNum(applicants?.latest?.total_applications ?? applicants?.kpis?.totalApplications),
      detail: `${formatNum(applicants?.latest?.unique_applicants)} unique applicants`,
    },
    {
      anchor: 'stage-result',
      num: 5,
      label: 'Result',
      value: formatNum(applicants?.latest?.selected ?? applicants?.kpis?.selected),
      detail: `${formatNum(applicants?.latest?.interviews_fixed)} interviews`,
    },
  ];

  el.innerHTML = stages.map((s, i) => `
    <a href="#${s.anchor}" class="pipeline-stage">
      <div class="pipeline-num">${s.num}</div>
      <div class="pipeline-label">${s.label}</div>
      <div class="pipeline-value">${s.value}</div>
      <div class="pipeline-detail">${s.detail}</div>
    </a>
    ${i < stages.length - 1 ? '<div class="pipeline-arrow">→</div>' : ''}
  `).join('');
}

function renderConsiderationRegistrationBlock(registrations, bridge) {
  if (!registrations) {
    return `
      <div class="consideration-panel full-width consideration-registrations consideration-registrations-empty">
        <h4>Web registrations (manual)</h4>
        <p class="subsection-hint">Enter platform registrations on the <a href="/upload">upload page</a>. Counts are month-to-date from the 1st through the day you save.</p>
      </div>`;
  }

  const bridgeRows = bridge ? [
    { label: 'Job detail page users', value: bridge.jobDetailUsers, source: 'Pages CSV (dashboard date range)' },
    { label: 'Register page users', value: bridge.registerPageUsers, source: 'Pages CSV' },
    { label: 'Web registrations (actual)', value: bridge.webRegistrations, source: 'Manual upload', highlight: true },
  ] : [];

  return `
    <div class="consideration-panel full-width consideration-registrations">
      <h4>Web registrations — actual sign-ups (manual upload)</h4>
      <p class="subsection-hint">
        <strong>${registrations.monthLabel}</strong> · period: <strong>${registrations.periodLabel}</strong>
        · saved ${registrations.uploadDate}
        ${registrations.isPartialMonth ? `<span class="partial-month-badge">Partial month (${registrations.daysInPeriod} of ${registrations.daysInMonth} days)</span>` : ''}
      </p>
      <p class="registration-period-note">${registrations.periodNote}</p>
      <div class="highlight-grid registration-kpis">
        <div class="highlight-card registration-card-primary">
          <div class="highlight-label">Web registrations</div>
          <div class="highlight-value">${formatNum(registrations.webRegistrations)}</div>
          <div class="highlight-sub">${registrations.periodLabel}</div>
        </div>
        <div class="highlight-card">
          <div class="highlight-label">Web active users</div>
          <div class="highlight-value">${formatNum(registrations.webActiveUsers)}</div>
          <div class="highlight-sub">Same period</div>
        </div>
        <div class="highlight-card">
          <div class="highlight-label">All platforms — registrations</div>
          <div class="highlight-value">${formatNum(registrations.totalRegistrations)}</div>
          <div class="highlight-sub">Web + Android + iOS</div>
        </div>
        ${bridge?.jobDetailToWebRate != null ? `
        <div class="highlight-card">
          <div class="highlight-label">Job detail → web sign-up</div>
          <div class="highlight-value">${formatPct(bridge.jobDetailToWebRate)}</div>
          <div class="highlight-sub">${formatNum(bridge.webRegistrations)} reg ÷ ${formatNum(bridge.jobDetailUsers)} job viewers</div>
        </div>` : ''}
      </div>
      ${bridgeRows.length ? `
        <h5 class="subsection-title">GA4 pages vs actual web registrations</h5>
        <p class="subsection-hint">Pages CSV uses your dashboard date filter. Manual registrations use the month-to-date period above — periods may differ slightly.</p>
        <div class="table-wrap"><table class="consideration-table">
          <thead><tr><th>Metric</th><th>Count</th><th>Source</th></tr></thead>
          <tbody>${bridgeRows.map((row) => `
            <tr class="${row.highlight ? 'registration-row-actual' : ''}">
              <td>${row.label}</td>
              <td><strong>${formatNum(row.value)}</strong></td>
              <td class="nav-hint">${row.source}</td>
            </tr>
          `).join('')}
          ${bridge.registerPageUsers > 0 && bridge.webRegistrations > 0 ? `
            <tr>
              <td>Register page → web sign-up rate</td>
              <td><strong>${formatPct(bridge.registerPageToWebRate)}</strong></td>
              <td class="nav-hint">Actual reg ÷ register page users</td>
            </tr>
          ` : ''}
          </tbody>
        </table></div>
      ` : ''}
      <div class="table-wrap" style="margin-top:0.75rem">
        <table class="consideration-table">
          <thead><tr><th>Platform</th><th>Registrations (MTD)</th><th>Active users</th></tr></thead>
          <tbody>${registrations.byPlatform.map((p) => `
            <tr class="${p.platform === 'Web' ? 'registration-row-actual' : ''}">
              <td>${p.platform}</td>
              <td>${formatNum(p.registrations)}</td>
              <td>${formatNum(p.active_users)}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderConsiderationInsights(consideration) {
  const el = document.getElementById('considerationInsights');
  if (!el || state.company !== 'workjapan') return;

  const hasFunnel = consideration?.fullFunnel?.length;
  const hasRegistrations = consideration?.registrations;

  if (!hasFunnel && !hasRegistrations) {
    el.innerHTML = `
      <div class="consideration-hub-inner">
        <div class="highlight-panel empty">
          Upload the <strong>Pages CSV</strong> to see navigation paths and drop-offs, and enter
          <strong>platform registrations</strong> on the <a href="/upload">upload page</a> for actual web sign-up counts.
        </div>
      </div>`;
    return;
  }

  if (!hasFunnel) {
    el.innerHTML = `
      <div class="consideration-hub-inner">
        ${renderConsiderationRegistrationBlock(consideration.registrations, consideration.registrationBridge)}
        <div class="highlight-panel empty">Upload the <strong>Pages CSV</strong> to add navigation paths and drop-off analysis.</div>
      </div>`;
    return;
  }

  const biggest = consideration.biggestDropOff;
  const topReason = biggest?.likelyReasons?.[0] || 'See ranked table below';
  const reg = consideration.registrations;

  el.innerHTML = `
    <div class="consideration-hub-inner">
      ${renderConsiderationRegistrationBlock(reg, consideration.registrationBridge)}

      <div class="consideration-hero ${biggest?.dropOffPct > 30 ? 'consideration-hero-alert' : ''}">
        <div class="consideration-hero-main">
          <span class="consideration-hero-label">#1 drop-off in consideration (GA4 pages path)</span>
          <h3 class="consideration-hero-title">${biggest ? `${biggest.fromLabel} → ${biggest.toLabel}` : '—'}</h3>
          <p class="consideration-hero-stat">
            <strong>${formatPct(biggest?.dropOffPct)}</strong> of users lost
            (${formatNum(biggest?.usersLost)} users)
          </p>
          <p class="consideration-hero-why"><strong>Likely why:</strong> ${topReason}</p>
        </div>
        <div class="consideration-hero-meta">
          ${reg ? `
          <div class="consideration-stat-pill consideration-stat-pill-reg">
            <span class="pill-label">Web registrations (actual)</span>
            <span class="pill-value">${formatNum(reg.webRegistrations)} · ${reg.periodLabel}</span>
          </div>` : ''}
          <div class="consideration-stat-pill">
            <span class="pill-label">Browse-only (est.)</span>
            <span class="pill-value">${formatNum(consideration.estimatedBrowseOnly)} users (${formatPct(consideration.browseOnlyRate)})</span>
          </div>
          <div class="consideration-stat-pill">
            <span class="pill-label">Funnel started</span>
            <span class="pill-value">${formatNum(consideration.funnelStartUsers)} users on homepage</span>
          </div>
        </div>
      </div>

      <div class="consideration-grid">
        <div class="consideration-panel">
          <h4>Consideration path — where users drop off</h4>
          <p class="subsection-hint">Homepage → job listings → job detail. Each arrow shows users lost before the next step.</p>
          ${renderConsiderationPathFunnel(consideration.considerationFunnel)}
          <div class="chart-container consideration-chart">
            <div class="chart-header"><h3>Users at each step</h3><button class="chart-download" data-chart="chartConsiderationFunnel">PNG</button></div>
            <div class="chart-wrapper"><canvas id="chartConsiderationFunnel"></canvas></div>
          </div>
        </div>

        <div class="consideration-panel">
          <h4>Where users come from</h4>
          <p class="subsection-hint">Top arrival channels before they browse (Traffic CSV).</p>
          <div class="table-wrap"><table class="consideration-table">
            <thead><tr><th>Channel</th><th>Sessions</th><th>Engaged</th><th>Eng. rate</th></tr></thead>
            <tbody>${(consideration.entryChannels || []).map((c) => `
              <tr>
                <td>${c.channel}</td>
                <td>${formatNum(c.sessions)}</td>
                <td>${formatNum(c.engagedSessions)}</td>
                <td>${formatPct(c.engagementRate)}</td>
              </tr>
            `).join('') || '<tr><td colspan="4" class="empty-state">Upload traffic CSV</td></tr>'}
            </tbody>
          </table></div>
        </div>
      </div>

      <div class="consideration-panel full-width">
        <h4>Drop-offs ranked — what to investigate</h4>
        <div class="table-wrap"><table class="consideration-table dropoff-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Transition</th>
              <th>Users lost</th>
              <th>Drop-off</th>
              <th>Likely why</th>
              <th>What to check</th>
            </tr>
          </thead>
          <tbody>${(consideration.dropOffs || []).map((d) => `
            <tr class="${d.rank === 1 ? 'dropoff-row-top' : ''}">
              <td>${d.rank}</td>
              <td>
                <div class="dropoff-transition">${d.fromLabel} → ${d.toLabel}</div>
                <code class="dropoff-path">${d.fromPath} → ${d.toPath}</code>
              </td>
              <td>${formatNum(d.usersLost)}</td>
              <td><span class="dropoff-pct ${d.dropOffPct > 30 ? 'abandon-red-text' : ''}">${formatPct(d.dropOffPct)}</span></td>
              <td class="dropoff-reasons"><ul>${(d.likelyReasons || []).slice(0, 2).map((r) => `<li>${r}</li>`).join('')}</ul></td>
              <td class="dropoff-checks"><ul>${(d.whatToCheck || []).map((c) => `<li>${c}</li>`).join('')}</ul></td>
            </tr>
          `).join('') || '<tr><td colspan="6" class="empty-state">No drop-off data</td></tr>'}
          </tbody>
        </table></div>
        ${consideration.allDropOffs?.some((d) => d.stage === 'commit') ? `
          <p class="journey-note">Register → dashboard drop-off is tracked in <a href="#stage-commit">Commit stage</a>.</p>
        ` : ''}
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

      <div class="consideration-panel full-width">
        <h4>Three customer journeys in consideration</h4>
        <div class="journey-cards-row">${(consideration.journeyCards || []).map((card) => `
          <div class="journey-mini-card">
            <h5>${card.title}</h5>
            <p class="journey-mini-desc">${card.description}</p>
            ${card.id === 'browse-jobs' ? `
              <div class="journey-mini-kpis">
                <span>${formatNum(card.pageViews)} views</span>
                <span>${formatNum(card.estimatedBrowseOnly)} browse-only</span>
              </div>
              ${card.topPages?.length ? `<div class="journey-mini-pages">Top: ${card.topPages.map((p) => `<code>${p.path}</code>`).join(', ')}</div>` : ''}
            ` : ''}
            ${card.id === 'job-detail' ? `
              <div class="journey-mini-kpis">
                <span>${formatNum(card.pageViews)} job views</span>
                <span>${formatNum(card.uniqueJobPages)} job pages</span>
              </div>
              ${card.topCategories?.length ? `<div class="journey-mini-pages">Top categories: ${card.topCategories.map((c) => c.category).join(', ')}</div>` : ''}
            ` : ''}
            ${card.id === 'seeker-application' ? `
              <div class="journey-mini-kpis">
                <span>${formatNum(card.started)} started</span>
                <span>${formatNum(card.completed)} reached dashboard</span>
              </div>
              ${card.biggestDropOff ? `<div class="journey-mini-drop">Worst: ${card.biggestDropOff.step} (−${formatPct(card.biggestDropOff.pct)})</div>` : ''}
            ` : ''}
          </div>
        `).join('')}</div>
      </div>

      ${consideration.topJobCategories?.length ? `
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

  renderChartConsiderationFunnel(consideration.considerationFunnel);

  el.querySelectorAll('.chart-download').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadChart(btn.dataset.chart);
    });
  });
}

function renderConsiderationPathFunnel(steps) {
  if (!steps?.length) return '';

  return `<div class="path-funnel">${steps.map((step, i) => {
    const next = steps[i + 1];
    const arrow = next ? (() => {
      const dropPct = next.dropOffPct || 0;
      const usersLost = Math.max(0, (step.users || step.views || 0) - (next.users || next.views || 0));
      const severity = dropPct > 30 ? 'path-arrow-red' : dropPct > 15 ? 'path-arrow-yellow' : 'path-arrow-green';
      return `
        <div class="path-arrow ${severity}">
          <span class="path-arrow-label">−${formatPct(dropPct)}</span>
          <span class="path-arrow-sub">${formatNum(usersLost)} users lost</span>
        </div>`;
    })() : '';

    return `
      <div class="path-step">
        <div class="path-step-box">
          <span class="path-step-num">${step.stepNum || i + 1}</span>
          <div class="path-step-label">${step.label}</div>
          <code class="path-step-path">${step.path}</code>
          <div class="path-step-users">${formatNum(step.users || step.views)} users</div>
          <div class="path-step-pct">${formatPct(step.pctOfStart)} of homepage</div>
        </div>
      </div>
      ${arrow}
    `;
  }).join('')}</div>`;
}

function renderChartConsiderationFunnel(steps) {
  destroyChart('chartConsiderationFunnel');
  const ctx = document.getElementById('chartConsiderationFunnel');
  if (!ctx || !steps?.length) return;

  charts.chartConsiderationFunnel = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: steps.map((s) => s.label),
      datasets: [{
        label: 'Users',
        data: steps.map((s) => s.users || s.views || 0),
        backgroundColor: [COLORS.workjapan, '#ff9f6b', '#ffb088'],
      }],
    },
    options: {
      ...chartDefaults(),
      indexAxis: 'y',
    },
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

function renderEmployerPanel(journeys) {
  const el = document.getElementById('employerPanel');
  if (!el || state.company !== 'workjapan') return;

  const employer = journeyById(journeys, 'employer');
  if (!employer) {
    el.innerHTML = '<div class="empty-state">No employer journey data.</div>';
    return;
  }

  el.innerHTML = `
    <p class="subsection-hint">${employer.description} Employer backend metrics (hires, job posts live) are not in GA4 — add manual entry later if needed.</p>
    <div class="kpi-row">
      <div class="kpi-card"><div class="label">Employer Page Views</div><div class="value">${formatNum(employer.kpis?.pageViews)}</div></div>
      <div class="kpi-card"><div class="label">Active Users</div><div class="value">${formatNum(employer.kpis?.activeUsers)}</div></div>
    </div>
    <h4 class="subsection-title">Top Employer Pages</h4>
    ${renderPageListTable(employer.topPages)}
    <p class="journey-note">This is a separate customer type from job seekers. Do not compare employer numbers directly to the 5-stage seeker funnel above.</p>
  `;
}

function renderIntelligencePanel(intelligence) {
  const el = document.getElementById('intelligencePanel');
  if (!el || state.company !== 'workjapan') return;

  const hasData = intelligence?.geo?.rows?.length
    || intelligence?.visa?.rows?.length
    || intelligence?.nationality?.rows?.length;

  if (!hasData) {
    el.innerHTML = '<div class="empty-state">No intelligence data yet — enter nationality, visa, geography, and barriers on the <a href="/upload">upload page</a>.</div>';
    return;
  }

  const visaRows = intelligence.visa?.byType || [];
  const natTop = intelligence.nationality?.top || [];

  el.innerHTML = `
    <div class="highlight-grid">
      ${visaRows.map((v) => `
        <div class="highlight-card ${v.abandonmentRate > 30 ? 'abandon-red' : ''}">
          <div class="highlight-label">${v.visa_type}</div>
          <div class="highlight-value">${v.abandonmentRate != null ? formatPct(v.abandonmentRate) : '—'}</div>
          <div class="highlight-sub">abandonment · ${formatDelta(v.vsAvgPct)}</div>
          <div class="highlight-sub">${formatNum(v.latest?.registrations)} reg · ${formatNum(v.latest?.abandonments)} abandon</div>
        </div>
      `).join('')}
    </div>
    ${natTop.length ? `
      <h4 class="subsection-title">Top nationalities (${intelligence.nationality.latestMonth || 'latest'})</h4>
      <div class="table-wrap"><table>
        <thead><tr><th>Nationality</th><th>Visitors</th><th>Registrations</th><th>vs 6mo avg</th></tr></thead>
        <tbody>${natTop.map((n) => `
          <tr>
            <td>${n.nationality}</td>
            <td>${formatNum(n.visitors)}</td>
            <td>${formatNum(n.registrations)}</td>
            <td>${formatDelta(n.vsAvgPct)}</td>
          </tr>
        `).join('')}</tbody>
      </table></div>
    ` : ''}
  `;
}

function renderChartVisaAbandon(byType) {
  destroyChart('chartVisaAbandon');
  const ctx = document.getElementById('chartVisaAbandon');
  if (!ctx || !byType?.length) return;
  const withData = byType.filter((v) => v.abandonmentRate != null);
  if (!withData.length) return;

  charts.chartVisaAbandon = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: withData.map((v) => v.visa_type),
      datasets: [
        {
          label: 'Abandonment % (latest)',
          data: withData.map((v) => v.abandonmentRate),
          backgroundColor: withData.map((v) => (v.abandonmentRate > 30 ? '#ef4444' : COLORS.workjapan)),
        },
        {
          label: '6-month avg %',
          data: withData.map((v) => v.avgAbandonmentRate6mo || 0),
          backgroundColor: 'rgba(136, 146, 176, 0.4)',
        },
      ],
    },
    options: chartDefaults(),
  });
}

function renderChartNationality(top) {
  destroyChart('chartNationality');
  const ctx = document.getElementById('chartNationality');
  if (!ctx || !top?.length) return;

  charts.chartNationality = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map((n) => n.nationality),
      datasets: [{
        label: 'Visitors',
        data: top.map((n) => n.visitors),
        backgroundColor: COLORS.nyuuly,
      }],
    },
    options: chartDefaults(),
  });
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

function renderApplicantProceedKpis(kpis, latest) {
  const el = document.getElementById('applicantProceedKpis');
  if (!el) return;
  if (!latest && (!kpis || !kpis.uniqueApplicants)) {
    el.innerHTML = '<div class="empty-state">No application data — <a href="/upload">enter on upload page</a></div>';
    return;
  }
  const data = latest || kpis;
  el.innerHTML = `
    <div class="kpi-card"><div class="label">Unique Applicants</div><div class="value">${formatNum(data.unique_applicants ?? data.uniqueApplicants)}</div></div>
    <div class="kpi-card"><div class="label">Total Applications</div><div class="value">${formatNum(data.total_applications ?? data.totalApplications)}</div></div>
    <div class="kpi-card"><div class="label">Latest Month</div><div class="value" style="font-size:1rem">${data.month_label || '—'}</div></div>
  `;
}

function renderApplicantResultKpis(kpis, latest) {
  const el = document.getElementById('applicantResultKpis');
  if (!el) return;
  if (!latest && (!kpis || !kpis.selected)) {
    el.innerHTML = '<div class="empty-state">No outcome data — <a href="/upload">enter on upload page</a></div>';
    return;
  }
  const data = latest || kpis;
  el.innerHTML = `
    <div class="kpi-card"><div class="label">Screening Passes</div><div class="value">${formatNum(data.screening_passes ?? data.screeningPasses)}</div></div>
    <div class="kpi-card"><div class="label">Interviews Fixed</div><div class="value">${formatNum(data.interviews_fixed ?? data.interviewsFixed)}</div></div>
    <div class="kpi-card"><div class="label">Remaining ESP</div><div class="value">${formatNum(data.remaining_esp ?? data.remainingEsp)}</div></div>
    <div class="kpi-card"><div class="label">Selected</div><div class="value">${formatNum(data.selected)}</div></div>
  `;
}

function renderProceedWebFunnel(journeys) {
  const el = document.getElementById('proceedWebFunnel');
  if (!el || state.company !== 'workjapan') return;
  const seeker = journeyById(journeys, 'seeker-application');
  if (!seeker?.applicationFunnel?.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <h4 class="subsection-title">Web application path (Pages CSV)</h4>
    ${renderApplicationFunnel(seeker.applicationFunnel)}
  `;
}

function renderPlatformKpis(kpis) {
  const el = document.getElementById('platformKpis');
  if (!el) return;
  if (!kpis || (!kpis.totalRegistrations && !kpis.totalActiveUsers)) {
    el.innerHTML = '<div class="empty-state">No platform data — <a href="/upload">enter data on upload page</a></div>';
    return;
  }
  el.innerHTML = `
    <div class="kpi-card"><div class="label">Total Registrations</div><div class="value">${formatNum(kpis.totalRegistrations)}</div></div>
    <div class="kpi-card"><div class="label">Total Active Users</div><div class="value">${formatNum(kpis.totalActiveUsers)}</div></div>
  `;
}

function renderChartRegistrationsByMonth(byMonth, platforms) {
  destroyChart('chartRegistrationsByMonth');
  const ctx = document.getElementById('chartRegistrationsByMonth');
  if (!ctx || !byMonth?.length) return;

  const labels = byMonth.map((m) => m.month_label);
  const platformList = platforms?.length ? platforms : ['Web', 'Android', 'iOS'];

  charts.chartRegistrationsByMonth = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: platformList.map((platform) => ({
        label: platform,
        data: byMonth.map((month) => {
          const row = month.platforms?.find((p) => p.platform === platform);
          return row ? row.registrations : 0;
        }),
        backgroundColor: COLORS.platform[platform] || COLORS.nyuuly,
      })),
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { stacked: false, ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
      },
    },
  });
}

function renderChartActiveByPlatform(byPlatform) {
  destroyChart('chartActiveByPlatform');
  const ctx = document.getElementById('chartActiveByPlatform');
  if (!ctx || !byPlatform?.length) return;

  charts.chartActiveByPlatform = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: byPlatform.map((p) => p.platform),
      datasets: [{
        label: 'Active Users',
        data: byPlatform.map((p) => p.active_users),
        backgroundColor: byPlatform.map((p) => COLORS.platform[p.platform] || COLORS.workjapan),
      }],
    },
    options: chartDefaults(),
  });
}

function renderPlatformTable(rows) {
  const table = document.getElementById('platformTable');
  if (!table) return;

  if (!rows?.length) {
    table.querySelector('thead').innerHTML = '';
    table.querySelector('tbody').innerHTML = '<tr><td colspan="4" class="empty-state">No platform data for this date range</td></tr>';
    return;
  }

  table.querySelector('thead').innerHTML = '<tr><th>Month</th><th>Platform</th><th>Registrations</th><th>Active Users</th></tr>';
  table.querySelector('tbody').innerHTML = rows.map((r) => `
    <tr>
      <td>${r.month_label}</td>
      <td>${r.platform}</td>
      <td>${formatNum(r.registrations)}</td>
      <td>${formatNum(r.active_users)}</td>
    </tr>
  `).join('');
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

function renderApplicantTable(rows) {
  const table = document.getElementById('applicantTable');
  if (!table) return;

  if (!rows?.length) {
    table.querySelector('thead').innerHTML = '';
    table.querySelector('tbody').innerHTML = '<tr><td colspan="7" class="empty-state">No applicant data for this date range</td></tr>';
    return;
  }

  table.querySelector('thead').innerHTML = `
    <tr>
      <th>Month</th>
      <th>Unique Applicants</th>
      <th>Screening Passes</th>
      <th>Total Applications</th>
      <th>Interviews Fixed</th>
      <th>Remaining ESP</th>
      <th>Selected</th>
    </tr>
  `;
  table.querySelector('tbody').innerHTML = rows.map((r) => `
    <tr>
      <td>${r.month_label}</td>
      <td>${formatNum(r.unique_applicants)}</td>
      <td>${formatNum(r.screening_passes)}</td>
      <td>${formatNum(r.total_applications)}</td>
      <td>${formatNum(r.interviews_fixed)}</td>
      <td>${formatNum(r.remaining_esp)}</td>
      <td>${formatNum(r.selected)}</td>
    </tr>
  `).join('');
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
    traffic: 'Traffic',
    pages: 'Pages',
  };
  el.innerHTML = Object.entries(labels).map(([key, label]) => {
    const ok = completeness[key];
    return `<span class="data-dot ${ok ? 'data-dot-ok' : 'data-dot-missing'}" title="${label}: ${ok ? 'loaded' : 'missing'}">${label}</span>`;
  }).join('');
}

function renderJourneyTabs(journeys) {
  const tabs = document.getElementById('journeyTabs');
  tabs.innerHTML = journeys.map((j) => `
    <button class="journey-tab ${state.activeJourney === j.id ? 'active' : ''} ${j.status === 'future' ? 'future' : ''}"
      data-journey="${j.id}">
      ${j.title}
      ${j.status === 'future' ? '<span class="future-badge">Future</span>' : ''}
    </button>
  `).join('');

  tabs.querySelectorAll('.journey-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeJourney = btn.dataset.journey;
      renderJourneyPanel(journeyData);
      renderJourneyTabs(journeyData.journeys);
    });
  });
}

function renderJourneyPanel(data) {
  const panel = document.getElementById('journeyPanel');
  const intro = document.getElementById('journeyIntro');
  if (intro && data?.companyLabel) {
    intro.textContent = data.company === 'workjapan'
      ? 'Optional detail view — the 5-stage funnel above is the primary navigation. Use these tabs for step-by-step exploration of specific paths.'
      : `${data.companyLabel} customer journeys — built from your 4 weekly CSVs (social, traffic, pages, funnel).`;
  }

  if (!data || !data.journeys?.length) {
    panel.innerHTML = '<div class="empty-state">Upload all 4 CSV files on the <a href="/upload">upload page</a> to see customer journeys.</div>';
    return;
  }

  const journey = data.journeys.find((j) => j.id === state.activeJourney) || data.journeys[0];
  let html = `
    <div class="journey-card">
      <div class="journey-card-header">
        <div>
          <h3>${journey.title}</h3>
          <p class="journey-sources">Sources: ${journey.subtitle}</p>
        </div>
        ${journey.status === 'future' ? '<span class="future-badge large">Coming soon</span>' : ''}
      </div>
      <p class="journey-desc">${journey.description}</p>
  `;

  if (journey.id === 'awareness') {
    const isWj = data.company === 'workjapan';
    html += `
      <div class="kpi-row">
        <div class="kpi-card"><div class="label">${isWj ? 'Instagram Post Views' : 'Social Views'}</div><div class="value">${formatNum(journey.kpis.socialViews)}</div></div>
        <div class="kpi-card"><div class="label">${isWj ? 'Instagram Reach' : 'Social Reach'}</div><div class="value">${formatNum(journey.kpis.socialReach)}</div></div>
        <div class="kpi-card"><div class="label">${isWj ? 'Job Posts' : 'Social Engagement'}</div><div class="value">${formatNum(isWj ? journey.kpis.postCount : journey.kpis.socialEngagement)}</div></div>
        <div class="kpi-card"><div class="label">Website Sessions</div><div class="value">${formatNum(journey.kpis.sessions)}</div></div>
        <div class="kpi-card"><div class="label">Engagement Rate</div><div class="value">${formatPct(journey.kpis.engagementRate)}</div></div>
      </div>
      <h4 class="subsection-title">Top Arrival Channels</h4>
      <div class="table-wrap"><table>
        <thead><tr><th>Channel</th><th>Sessions</th><th>Engaged Sessions</th>${isWj ? '<th>Eng. Rate</th>' : ''}</tr></thead>
        <tbody>${(journey.topChannels || []).map((c) => `
          <tr>
            <td>${c.channel}</td>
            <td>${formatNum(c.sessions)}</td>
            <td>${formatNum(c.engagedSessions)}</td>
            ${isWj ? `<td>${formatPct(c.engagementRate)}</td>` : ''}
          </tr>
        `).join('') || '<tr><td colspan="4" class="empty-state">No traffic data</td></tr>'}
        </tbody>
      </table></div>
    `;
  } else if (journey.id === 'browse-jobs' || journey.id === 'explore-no-action') {
    html += `
      <div class="kpi-row">
        <div class="kpi-card"><div class="label">Exploration Page Views</div><div class="value">${formatNum(journey.kpis.pageViews)}</div></div>
        <div class="kpi-card"><div class="label">Active Users (browse)</div><div class="value">${formatNum(journey.kpis.activeUsers)}</div></div>
        <div class="kpi-card"><div class="label">Est. Browse Only</div><div class="value">${formatNum(journey.kpis.estimatedBrowseOnly)}</div></div>
        <div class="kpi-card"><div class="label">Browse Rate</div><div class="value">${formatPct(journey.kpis.browseRate)}</div></div>
      </div>
      ${renderMiniFunnel(journey.ga4Funnel)}
      <h4 class="subsection-title">Top Exploration Pages</h4>
      ${renderPageListTable(journey.topPages)}
      <h4 class="subsection-title">How They Arrived</h4>
      <div class="channel-chips">${(journey.entryChannels || []).map((c) =>
        `<span class="channel-chip">${c.channel}: ${formatNum(c.sessions)}</span>`
      ).join('') || '<span class="channel-chip muted">Upload traffic CSV</span>'}</div>
    `;
  } else if (journey.id === 'job-detail') {
    html += `
      <div class="kpi-row">
        <div class="kpi-card"><div class="label">Job Page Views</div><div class="value">${formatNum(journey.kpis.pageViews)}</div></div>
        <div class="kpi-card"><div class="label">Active Users</div><div class="value">${formatNum(journey.kpis.activeUsers)}</div></div>
        <div class="kpi-card"><div class="label">Unique Job Pages</div><div class="value">${formatNum(journey.kpis.uniqueJobPages)}</div></div>
        <div class="kpi-card"><div class="label">Views per User</div><div class="value">${formatNum(journey.kpis.viewsPerUser)}</div></div>
      </div>
      <h4 class="subsection-title">Top Job Categories</h4>
      ${renderJobCategoriesTable(journey.topJobCategories)}
      <h4 class="subsection-title">Top Individual Job Pages</h4>
      ${renderPageListTable(journey.topPages)}
    `;
  } else if (journey.id === 'register-apply' || journey.id === 'explore-convert') {
    html += `
      <div class="kpi-row">
        <div class="kpi-card"><div class="label">Conversion Page Views</div><div class="value">${formatNum(journey.kpis.pageViews)}</div></div>
        <div class="kpi-card"><div class="label">Active Users</div><div class="value">${formatNum(journey.kpis.activeUsers)}</div></div>
        <div class="kpi-card"><div class="label">Key Events</div><div class="value">${formatNum(journey.kpis.keyEvents)}</div></div>
        <div class="kpi-card"><div class="label">Conversion Rate</div><div class="value">${formatPct(journey.kpis.conversionRate)}</div></div>
      </div>
      ${renderMiniFunnel(journey.ga4Funnel)}
      <h4 class="subsection-title">Sign-up &amp; Subscribe Pages</h4>
      ${renderPageListTable(journey.topPages, true)}
    `;
  } else if (journey.id === 'employer') {
    html += `
      <div class="kpi-row">
        <div class="kpi-card"><div class="label">Employer Page Views</div><div class="value">${formatNum(journey.kpis.pageViews)}</div></div>
        <div class="kpi-card"><div class="label">Active Users</div><div class="value">${formatNum(journey.kpis.activeUsers)}</div></div>
      </div>
      <h4 class="subsection-title">Top Employer Pages</h4>
      ${renderPageListTable(journey.topPages)}
    `;
  } else if (journey.id === 'welcome-package') {
    html += `
      <div class="kpi-row">
        <div class="kpi-card"><div class="label">Welcome Package Views</div><div class="value">${formatNum(journey.kpis.pageViews)}</div></div>
        <div class="kpi-card"><div class="label">Active Users</div><div class="value">${formatNum(journey.kpis.activeUsers)}</div></div>
        <div class="kpi-card"><div class="label">Key Events</div><div class="value">${formatNum(journey.kpis.keyEvents)}</div></div>
      </div>
      ${renderPageListTable(journey.topPages)}
      <p class="journey-note">This journey is marked as future — data will grow when the welcome package flow goes live.</p>
    `;
  } else if (journey.id === 'seeker-application' || journey.id === 'nyuuly-application' || journey.id === 'wj-application') {
    html += `
      <div class="kpi-row">
        <div class="kpi-card"><div class="label">Funnel Started</div><div class="value">${formatNum(journey.kpis.started)}</div></div>
        <div class="kpi-card"><div class="label">Reached Last Step</div><div class="value">${formatNum(journey.kpis.completed)}</div></div>
        <div class="kpi-card"><div class="label">Overall Completion</div><div class="value">${formatPct(journey.kpis.overallCompletion)}</div></div>
        <div class="kpi-card abandon-red"><div class="label">Biggest Drop-off</div><div class="value" style="font-size:1rem">${journey.kpis.biggestDropOffStep} (${formatPct(journey.kpis.biggestDropOffPct)})</div></div>
      </div>
      <h4 class="subsection-title">${data.company === 'workjapan' ? 'Job Seeker Application Steps' : 'Application Steps'} (from Pages CSV)</h4>
      ${renderApplicationFunnel(journey.applicationFunnel)}
      ${journey.topJobCategories?.length ? `<h4 class="subsection-title">Top Job Categories in Funnel</h4>${renderJobCategoriesTable(journey.topJobCategories)}` : ''}
    `;
  }

  html += `
    <div class="chart-container journey-chart" id="journeyChartWrap" style="display:none">
      <div class="chart-header"><h3>Journey Funnel</h3></div>
      <div class="chart-wrapper"><canvas id="chartJourneyFunnel"></canvas></div>
    </div>
  </div>`;
  panel.innerHTML = html;

  const hasChart = (['seeker-application', 'nyuuly-application', 'wj-application'].includes(journey.id) && journey.applicationFunnel?.length)
    || (journey.ga4Funnel?.length && !['awareness', 'welcome-package', 'employer', 'job-detail'].includes(journey.id));
  const chartWrap = document.getElementById('journeyChartWrap');
  if (chartWrap) chartWrap.style.display = hasChart ? 'block' : 'none';
  if (hasChart) renderChartJourneyFunnel(journey);
}

function renderMiniFunnel(steps) {
  if (!steps?.length) return '<p class="journey-note">Upload funnel CSV for step-by-step drop-off.</p>';
  return `
    <h4 class="subsection-title">GA4 Funnel Steps</h4>
    <div class="mini-funnel">${steps.map((s, i) => `
      <div class="mini-funnel-step">
        <div class="mini-funnel-bar" style="width:${Math.max(8, (s.users / (steps[0].users || 1)) * 100)}%"></div>
        <span class="mini-funnel-label">${s.stepLabel}</span>
        <span class="mini-funnel-val">${formatNum(s.users)} users</span>
        ${i > 0 && s.abandonmentRate ? `<span class="mini-funnel-drop abandon-${s.abandonmentRate > 0.3 ? 'red' : 'yellow'}">−${formatPct(s.abandonmentRate)}</span>` : ''}
      </div>
    `).join('')}</div>
  `;
}

function renderJobCategoriesTable(categories) {
  if (!categories?.length) return '<p class="journey-note">No job category data.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Job Category</th><th>Job Listings</th><th>Views</th><th>Users</th></tr></thead>
    <tbody>${categories.map((c) => `
      <tr>
        <td>${c.category}</td>
        <td>${formatNum(c.jobs)}</td>
        <td>${formatNum(c.views)}</td>
        <td>${formatNum(c.users)}</td>
      </tr>
    `).join('')}</tbody>
  </table></div>`;
}

function renderPageListTable(pages, showKeyEvents = false) {
  if (!pages?.length) return '<p class="journey-note">No matching pages in date range.</p>';
  const cols = showKeyEvents
    ? '<th>Page</th><th>Views</th><th>Users</th><th>Key Events</th>'
    : '<th>Page</th><th>Views</th><th>Users</th><th>Avg Time</th>';
  return `<div class="table-wrap"><table>
    <thead><tr>${cols}</tr></thead>
    <tbody>${pages.map((p) => showKeyEvents
      ? `<tr><td>${p.path}</td><td>${formatNum(p.views)}</td><td>${formatNum(p.users)}</td><td>${formatNum(p.keyEvents)}</td></tr>`
      : `<tr><td>${p.path}</td><td>${formatNum(p.views)}</td><td>${formatNum(p.users)}</td><td>${formatNum(p.avgTime)}s</td></tr>`
    ).join('')}</tbody>
  </table></div>`;
}

function renderApplicationFunnel(steps) {
  if (!steps?.length) return '<p class="journey-note">Upload pages CSV with application paths.</p>';
  const maxUsers = steps[0]?.users || steps[0]?.views || 1;
  return `<div class="app-funnel">${steps.map((s, i) => {
    const users = s.users || s.views;
    const width = Math.max(10, (users / maxUsers) * 100);
    const dropClass = s.dropOffPct > 30 ? 'abandon-red' : s.dropOffPct > 10 ? 'abandon-yellow' : 'abandon-green';
    return `
      <div class="app-funnel-step">
        <div class="app-funnel-step-header">
          <span>${i + 1}. ${s.label}</span>
          <span class="app-funnel-path">${s.path}</span>
        </div>
        <div class="app-funnel-bar-wrap">
          <div class="app-funnel-bar" style="width:${width}%"></div>
          <span>${formatNum(users)} users</span>
        </div>
        ${i > 0 ? `<div class="app-funnel-drop ${dropClass}">Drop-off: ${formatPct(s.dropOffPct)} · Retained: ${formatPct(s.retentionPct)}</div>` : ''}
      </div>
    `;
  }).join('')}</div>`;
}

function renderLandingTable(landingPages) {
  const table = document.getElementById('landingTable');
  if (!landingPages?.length) {
    table.querySelector('thead').innerHTML = '';
    table.querySelector('tbody').innerHTML = '<tr><td colspan="4" class="empty-state">Upload pages CSV to see landing pages</td></tr>';
    return;
  }
  table.querySelector('thead').innerHTML = '<tr><th>Landing Page</th><th>Views</th><th>Users</th><th>Likely Next Pages</th></tr>';
  table.querySelector('tbody').innerHTML = landingPages.map((p) => `
    <tr>
      <td>${p.path}</td>
      <td>${formatNum(p.views)}</td>
      <td>${formatNum(p.users)}</td>
      <td class="next-pages">${(p.nextLikely || []).map((n) => `<code>${n}</code>`).join(' → ') || '—'}</td>
    </tr>
  `).join('');
}

function renderChartJourneyFunnel(journey) {
  destroyChart('chartJourneyFunnel');
  const canvas = document.getElementById('chartJourneyFunnel');
  if (!canvas) return;

  let steps = [];
  let label = '';

  if (journey.id === 'wj-application' && journey.applicationFunnel?.length) {
    steps = journey.applicationFunnel;
    label = 'Users';
  } else if (journey.ga4Funnel?.length) {
    steps = journey.ga4Funnel.map((s) => ({ label: s.stepLabel, users: s.users }));
    label = 'Active Users';
  }

  if (!steps.length) return;

  charts.chartJourneyFunnel = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: steps.map((s) => s.label || s.stepLabel),
      datasets: [{
        label,
        data: steps.map((s) => s.users || s.views || 0),
        backgroundColor: COLORS.nyuuly,
      }],
    },
    options: {
      ...chartDefaults(),
      indexAxis: 'y',
    },
  });
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

function renderSocialKpis(kpis) {
  const el = document.getElementById('socialKpis');
    if (!kpis || (kpis.totalViews === 0 && kpis.totalReach === 0 && kpis.totalLikes === 0)) {
    el.innerHTML = '<div class="empty-state">No social data for this date range — <a href="/upload">upload a CSV</a></div>';
    return;
  }
  el.innerHTML = `
    <div class="kpi-card"><div class="label">Total Views</div><div class="value">${formatNum(kpis.totalViews)}</div></div>
    <div class="kpi-card"><div class="label">Total Reach</div><div class="value">${formatNum(kpis.totalReach)}</div></div>
    <div class="kpi-card"><div class="label">Total Likes</div><div class="value">${formatNum(kpis.totalLikes)}</div></div>
    <div class="kpi-card"><div class="label">Total Engagement</div><div class="value">${formatNum(kpis.totalEngagement)}</div></div>
  `;
}

function renderTrafficKpis(kpis) {
  const el = document.getElementById('trafficKpis');
  if (!kpis || !kpis.totalSessions) {
    el.innerHTML = '<div class="empty-state">No traffic data for this date range — <a href="/upload">upload a CSV</a></div>';
    return;
  }
  el.innerHTML = `
    <div class="kpi-card"><div class="label">Total Sessions</div><div class="value">${formatNum(kpis.totalSessions)}</div></div>
    <div class="kpi-card"><div class="label">Engaged Sessions</div><div class="value">${formatNum(kpis.totalEngagedSessions)}</div></div>
    <div class="kpi-card"><div class="label">Engagement Rate</div><div class="value">${formatPct(kpis.engagementRate)}</div></div>
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

function renderChartFunnel(rows) {
  destroyChart('chartFunnel');
  const ctx = document.getElementById('chartFunnel');
  if (!rows.length) return;

  const steps = [...new Set(rows.map(r => r.step))];
  const devices = ['Desktop', 'Mobile', 'Tablet', 'Total'];
  const deviceColors = { Desktop: COLORS.nyuuly, Mobile: COLORS.workjapan, Tablet: '#a78bfa', Total: '#34d399' };

  const datasets = devices.map(dev => ({
    label: dev,
    data: steps.map(step => {
      const row = rows.find(r => r.step === step && r.device_category === dev);
      return row ? row.active_users : 0;
    }),
    backgroundColor: deviceColors[dev] || COLORS.nyuuly,
  }));

  charts.chartFunnel = new Chart(ctx, {
    type: 'bar',
    data: { labels: steps.map(s => s.replace(/^\d+\.\s*/, '')), datasets },
    options: {
      ...chartDefaults(),
      indexAxis: 'y',
      scales: {
        x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
      },
    },
  });
}

function renderChartFunnelDevice(step1Devices) {
  destroyChart('chartFunnelDevice');
  const ctx = document.getElementById('chartFunnelDevice');
  if (!step1Devices.length) return;

  charts.chartFunnelDevice = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: step1Devices.map(d => d.device_category),
      datasets: [{
        data: step1Devices.map(d => d.active_users),
        backgroundColor: [COLORS.nyuuly, COLORS.workjapan, '#a78bfa'],
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: COLORS.text } } },
    },
  });
}

function renderChartTrafficDonut(rows) {
  destroyChart('chartTrafficDonut');
  const ctx = document.getElementById('chartTrafficDonut');
  if (!rows.length) return;

  const colors = [COLORS.nyuuly, COLORS.workjapan, '#a78bfa', '#34d399', '#facc15', '#f472b6', '#60a5fa'];

  charts.chartTrafficDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: rows.map(r => r.channel_group),
      datasets: [{ data: rows.map(r => r.sessions), backgroundColor: colors }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: COLORS.text, font: { size: 10 } } } },
    },
  });
}

function renderChartTrafficBar(rows) {
  destroyChart('chartTrafficBar');
  const ctx = document.getElementById('chartTrafficBar');
  const sorted = [...rows].sort((a, b) => b.engaged_sessions - a.engaged_sessions);
  if (!sorted.length) return;

  charts.chartTrafficBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(r => r.channel_group),
      datasets: [{ label: 'Engaged Sessions', data: sorted.map(r => r.engaged_sessions), backgroundColor: COLORS.nyuuly }],
    },
    options: { ...chartDefaults(), indexAxis: 'y' },
  });
}

function renderChartTrafficEngagement(rows) {
  destroyChart('chartTrafficEngagement');
  const ctx = document.getElementById('chartTrafficEngagement');
  if (!rows.length) return;

  charts.chartTrafficEngagement = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: rows.map(r => r.channel_group),
      datasets: [{ label: 'Avg Engagement Time (sec)', data: rows.map(r => r.avg_engagement_time), backgroundColor: COLORS.workjapan }],
    },
    options: chartDefaults(),
  });
}

function renderChartPagesBar(rows) {
  destroyChart('chartPagesBar');
  const ctx = document.getElementById('chartPagesBar');
  const top = rows.slice(0, 15);
  if (!top.length) return;

  charts.chartPagesBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(r => r.page_path.length > 30 ? r.page_path.slice(0, 30) + '…' : r.page_path),
      datasets: [{ label: 'Views', data: top.map(r => r.views), backgroundColor: COLORS.nyuuly }],
    },
    options: { ...chartDefaults(), indexAxis: 'y' },
  });
}

function renderChartPagesScatter(rows) {
  destroyChart('chartPagesScatter');
  const ctx = document.getElementById('chartPagesScatter');
  if (!rows.length) return;

  charts.chartPagesScatter = new Chart(ctx, {
    type: 'bubble',
    data: {
      datasets: [{
        label: 'Pages',
        data: rows.map(r => ({
          x: r.views,
          y: r.avg_engagement_time,
          r: Math.max(3, Math.min(20, r.active_users / 2)),
        })),
        backgroundColor: COLORS.nyuulyLight,
        borderColor: COLORS.nyuuly,
      }],
    },
    options: {
      ...chartDefaults(),
      plugins: {
        ...chartDefaults().plugins,
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const r = rows[ctx.dataIndex];
              return `${r.page_path}: ${formatNum(r.views)} views, ${formatNum(r.avg_engagement_time)}s avg`;
            },
          },
        },
      },
    },
  });
}

function renderCompareCharts(summary) {
  destroyChart('chartCompareBar');
  destroyChart('chartCompareRadar');

  const nyuulyTraffic = summary.traffic.find(t => t.company === 'nyuuly') || {};
  const wjTraffic = summary.traffic.find(t => t.company === 'workjapan') || {};

  const ctxBar = document.getElementById('chartCompareBar');
  charts.chartCompareBar = new Chart(ctxBar, {
    type: 'bar',
    data: {
      labels: ['Sessions', 'Engaged Sessions', 'Avg Engagement Time'],
      datasets: [
        {
          label: 'Nyuuly',
          data: [nyuulyTraffic.sessions || 0, nyuulyTraffic.engagedSessions || 0, nyuulyTraffic.avgEngagementTime || 0],
          backgroundColor: COLORS.nyuuly,
        },
        {
          label: 'WORK JAPAN',
          data: [wjTraffic.sessions || 0, wjTraffic.engagedSessions || 0, wjTraffic.avgEngagementTime || 0],
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

  const metrics = ['Social Views', 'Social Reach', 'Engagement Rate', 'Sessions', 'Funnel Completion', 'Top Page Views'];
  const nyuulyVals = [
    nyuulySocial.views || 0,
    nyuulySocial.reach || 0,
    nyuulySocial.reach ? (nyuulySocial.engagement / nyuulySocial.reach) * 100 : 0,
    nyuulyTraffic.sessions || 0,
    (nyuulyFunnel.find(f => f.step && f.step.includes('Purchase'))?.completion_rate || 0) * 100,
    nyuulyPage.views || 0,
  ];
  const wjVals = [
    wjSocial.views || 0,
    wjSocial.reach || 0,
    wjSocial.reach ? (wjSocial.engagement / wjSocial.reach) * 100 : 0,
    wjTraffic.sessions || 0,
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

  renderCompareTable(nyuulySocial, wjSocial, nyuulyTraffic, wjTraffic, nyuulyPage, wjPage);
}

function renderCompareTable(nSocial, wSocial, nTraffic, wTraffic, nPage, wPage) {
  const table = document.getElementById('compareTable');
  table.querySelector('thead').innerHTML = `
    <tr><th>Metric</th><th>Nyuuly</th><th>WORK JAPAN</th></tr>
  `;
  table.querySelector('tbody').innerHTML = `
    <tr><td>Social Views</td><td>${formatNum(nSocial.views)}</td><td>${formatNum(wSocial.views)}</td></tr>
    <tr><td>Social Reach</td><td>${formatNum(nSocial.reach)}</td><td>${formatNum(wSocial.reach)}</td></tr>
    <tr><td>Social Engagement</td><td>${formatNum(nSocial.engagement)}</td><td>${formatNum(wSocial.engagement)}</td></tr>
    <tr><td>Sessions</td><td>${formatNum(nTraffic.sessions)}</td><td>${formatNum(wTraffic.sessions)}</td></tr>
    <tr><td>Engaged Sessions</td><td>${formatNum(nTraffic.engagedSessions)}</td><td>${formatNum(wTraffic.engagedSessions)}</td></tr>
    <tr><td>Engagement Rate</td><td>${formatPct(nTraffic.engagementRate)}</td><td>${formatPct(wTraffic.engagementRate)}</td></tr>
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

function renderFunnelTable() {
  const sorted = sortData(funnelRows, funnelSort);
  const data = sorted.map(r => ({
    ...r,
    _html: `<tr>
      <td>${r.step || '—'}</td>
      <td>${r.device_category || '—'}</td>
      <td>${formatNum(r.active_users)}</td>
      <td>${formatPct(r.completion_rate)}</td>
      <td>${formatNum(r.abandonments)}</td>
      <td class="${abandonClass(r.abandonment_rate)}">${formatPct(r.abandonment_rate)}</td>
    </tr>`,
  }));

  renderSortableTable('funnelTable', [
    { key: 'step', label: 'Step' },
    { key: 'device_category', label: 'Device' },
    { key: 'active_users', label: 'Active Users' },
    { key: 'completion_rate', label: 'Completion Rate' },
    { key: 'abandonments', label: 'Abandonments' },
    { key: 'abandonment_rate', label: 'Abandonment Rate' },
  ], data, funnelSort, () => renderFunnelTable());
}

function renderTrafficTable(rows) {
  if (!rows.length) {
    document.getElementById('trafficTable').querySelector('tbody').innerHTML =
      '<tr><td colspan="8" class="empty-state">No data for this date range — <a href="/upload">upload a CSV first</a></td></tr>';
    return;
  }

  const maxSessions = Math.max(...rows.map(r => r.sessions));
  const maxEngaged = Math.max(...rows.map(r => r.engaged_sessions));
  const maxRate = Math.max(...rows.map(r => r.engagement_rate));
  const maxTime = Math.max(...rows.map(r => r.avg_engagement_time));

  const sorted = sortData(rows, trafficSort);
  const data = sorted.map(r => ({
    ...r,
    _html: `<tr>
      <td>${r.channel_group}</td>
      <td class="${r.sessions === maxSessions ? 'top-metric' : ''}">${formatNum(r.sessions)}</td>
      <td class="${r.engaged_sessions === maxEngaged ? 'top-metric' : ''}">${formatNum(r.engaged_sessions)}</td>
      <td class="${r.engagement_rate === maxRate ? 'top-metric' : ''}">${formatPct(r.engagement_rate)}</td>
      <td class="${r.avg_engagement_time === maxTime ? 'top-metric' : ''}">${formatNum(r.avg_engagement_time)}s</td>
      <td>${formatNum(r.events_per_session)}</td>
      <td>${formatNum(r.event_count)}</td>
      <td>${formatNum(r.key_events)}</td>
    </tr>`,
  }));

  renderSortableTable('trafficTable', [
    { key: 'channel_group', label: 'Channel' },
    { key: 'sessions', label: 'Sessions' },
    { key: 'engaged_sessions', label: 'Engaged Sessions' },
    { key: 'engagement_rate', label: 'Engagement Rate' },
    { key: 'avg_engagement_time', label: 'Avg Engagement Time' },
    { key: 'events_per_session', label: 'Events/Session' },
    { key: 'event_count', label: 'Event Count' },
    { key: 'key_events', label: 'Key Events' },
  ], data, trafficSort, () => renderTrafficTable(rows));
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
  const q = buildQuery();
  document.body.classList.add('is-loading');
  updateCompanyLayout();

  try {
    const isWorkJapan = state.company === 'workjapan';
    const fetches = [
      fetchJSON(`/api/social?${q}`),
      fetchJSON(`/api/funnel?${q}`),
      fetchJSON(`/api/traffic?${q}`),
      fetchJSON(`/api/pages?${q}`),
      fetchJSON(`/api/journeys?${q}`),
      fetchJSON(`/api/dashboard-guide?company=${state.company}`),
    ];
    if (isWorkJapan) {
      fetches.push(fetchJSON(`/api/platform-stats?${q}`));
      fetches.push(fetchJSON(`/api/applicant-stats?${q}`));
      fetches.push(fetchJSON(`/api/intelligence?${q}`));
      fetches.push(fetchJSON(`/api/internal-reporting?${q}`));
    }

    const results = await Promise.all(fetches);
    const [social, funnel, traffic, pages, journeys, guide, platform, applicants, intelligence, internalReport] = isWorkJapan
      ? results
      : [...results.slice(0, 6), null, null, null, null];

    updateFilterLabel(journeys.filter || social.filter);
    renderDashboardGuide(guide);
    renderFunnelNav(guide);

    if (isWorkJapan) {
      renderFunnelPipeline(journeys, platform, applicants, social);
      renderConsiderationInsights(journeys.consideration);
      if (typeof renderInternalReporting === 'function') {
        renderInternalReporting(internalReport);
      }
      renderCommitBarriers(intelligence);
      renderEmployerPanel(journeys);
      renderIntelligencePanel(intelligence);
      renderChartVisaAbandon(intelligence?.visa?.byType);
      renderChartNationality(intelligence?.nationality?.top);
      renderTopJobsTable(intelligence?.topJobs);

      renderPlatformKpis(platform.kpis);
      renderChartRegistrationsByMonth(platform.byMonth, platform.platforms);
      renderChartActiveByPlatform(platform.byPlatform);
      renderPlatformTable(platform.rows);

      renderProceedWebFunnel(journeys);
      renderApplicantProceedKpis(applicants.kpis, applicants.latest);
      renderApplicantResultKpis(applicants.kpis, applicants.latest);
      renderChartApplicantFunnel(applicants.funnelSteps, applicants.latest?.month_label);
      renderChartApplicantsByMonth(applicants.rows);
      renderApplicantTable(applicants.rows);
    }

    journeyData = journeys;
    if (!journeys.journeys?.some((j) => j.id === state.activeJourney)) {
      state.activeJourney = journeys.journeys?.[0]?.id || 'awareness';
    }
    renderDataStatus(journeys.dataCompleteness);
    renderJourneyTabs(journeys.journeys || []);
    renderJourneyPanel(journeys);
    renderLandingTable(journeys.landingPages);

    renderSocialKpis(social.kpis);
    renderChartViewsReach(social.timeSeries || []);
    renderChartEngagement(social.topPosts || []);
    renderChartPostTypes(social.postTypes || []);
    if (isWorkJapan) {
      renderSocialAccountsTable(social.byAccount);
      renderChartSocialAccounts(social.byAccount);
    }

    socialPosts = social.posts || [];
    socialPage = 1;
    renderSocialTable();

    funnelRows = funnel.rows || [];
    renderChartFunnel(funnelRows);
    renderChartFunnelDevice(funnel.step1Devices || []);
    renderFunnelTable();

    renderTrafficKpis(traffic.kpis);
    renderChartTrafficDonut(traffic.rows || []);
    renderChartTrafficBar(traffic.rows || []);
    renderChartTrafficEngagement(traffic.rows || []);
    renderTrafficTable(traffic.rows || []);

    pagesData = pages.rows || [];
    pagesPage = 1;
    renderChartPagesBar(pagesData);
    renderChartPagesScatter(pagesData);
    renderPagesTable();
  } catch (err) {
    console.error('Dashboard load error:', err);
  } finally {
    document.body.classList.remove('is-loading');
  }
}

function initControls() {
  document.getElementById('companyTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-company]');
    if (!btn) return;
    document.querySelectorAll('#companyTabs .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.company = btn.dataset.company;
    state.activeJourney = 'awareness';
    loadDashboard();
  });

  document.getElementById('dateGroup').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    document.querySelectorAll('#dateGroup .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.dateRange = btn.dataset.range;

    const showCustom = state.dateRange === 'custom';
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    startInput.style.display = showCustom ? 'inline-block' : 'none';
    endInput.style.display = showCustom ? 'inline-block' : 'none';

    if (showCustom) {
      const today = new Date().toISOString().slice(0, 10);
      if (!endInput.value) endInput.value = today;
      if (!startInput.value) {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        startInput.value = d.toISOString().slice(0, 10);
      }
      state.startDate = startInput.value;
      state.endDate = endInput.value;
    } else {
      state.startDate = null;
      state.endDate = null;
    }

    loadDashboard();
  });

  document.getElementById('startDate').addEventListener('change', (e) => {
    state.startDate = e.target.value;
    state.dateRange = 'custom';
    document.querySelectorAll('#dateGroup .tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelector('#dateGroup [data-range="custom"]')?.classList.add('active');
    if (state.endDate) loadDashboard();
  });

  document.getElementById('endDate').addEventListener('change', (e) => {
    state.endDate = e.target.value;
    state.dateRange = 'custom';
    document.querySelectorAll('#dateGroup .tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelector('#dateGroup [data-range="custom"]')?.classList.add('active');
    if (state.startDate) loadDashboard();
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

document.addEventListener('DOMContentLoaded', () => {
  syncStateFromUI();
  initControls();
  loadLastUpdated();
  loadDashboard();
});
