const COLORS = {
  nyuuly: '#4F8EF7',
  workjapan: '#FF6B35',
  nyuulyLight: 'rgba(79, 142, 247, 0.6)',
  workjapanLight: 'rgba(255, 107, 53, 0.6)',
  grid: 'rgba(136, 146, 176, 0.15)',
  text: '#8892b0',
};

const charts = {};
let state = {
  company: 'all',
  dateRange: '7',
  startDate: null,
  endDate: null,
  compareMode: false,
};

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
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
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
  if (state.company !== 'all') params.set('company', state.company);
  params.set('start', start);
  params.set('end', end);
  return params.toString();
}

function showCompareSection() {
  const el = document.getElementById('section-compare');
  el.style.display = (state.compareMode || state.company === 'all') ? 'block' : 'none';
}

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
  const companies = state.compareMode || state.company === 'all'
    ? ['nyuuly', 'workjapan']
    : [state.company === 'all' ? 'nyuuly' : state.company];

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
    if (state.compareMode || state.company === 'all') {
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

  if (!state.compareMode && state.company !== 'all') {
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
  showCompareSection();

  try {
    const [social, funnel, traffic, pages, summary] = await Promise.all([
      fetchJSON(`/api/social?${q}`),
      fetchJSON(`/api/funnel?${q}`),
      fetchJSON(`/api/traffic?${q}`),
      fetchJSON(`/api/pages?${q}`),
      fetchJSON(`/api/summary?${q}`),
    ]);

    renderSocialKpis(social.kpis);
    renderChartViewsReach(social.timeSeries || []);
    renderChartEngagement(social.topPosts || []);
    renderChartPostTypes(social.postTypes || []);

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

    if (state.compareMode || state.company === 'all') {
      renderCompareCharts(summary);
    }
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

function initControls() {
  document.getElementById('companyTabs').addEventListener('click', (e) => {
    if (!e.target.dataset.company) return;
    document.querySelectorAll('#companyTabs .tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    state.company = e.target.dataset.company;
    loadDashboard();
  });

  document.getElementById('dateGroup').addEventListener('click', (e) => {
    if (!e.target.dataset.range) return;
    document.querySelectorAll('#dateGroup .tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    state.dateRange = e.target.dataset.range;

    const showCustom = state.dateRange === 'custom';
    document.getElementById('startDate').style.display = showCustom ? 'inline-block' : 'none';
    document.getElementById('endDate').style.display = showCustom ? 'inline-block' : 'none';

    if (!showCustom) loadDashboard();
  });

  document.getElementById('startDate').addEventListener('change', (e) => {
    state.startDate = e.target.value;
    if (state.endDate) loadDashboard();
  });

  document.getElementById('endDate').addEventListener('change', (e) => {
    state.endDate = e.target.value;
    if (state.startDate) loadDashboard();
  });

  document.getElementById('compareMode').addEventListener('change', (e) => {
    state.compareMode = e.target.checked;
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

document.addEventListener('DOMContentLoaded', () => {
  initControls();
  loadLastUpdated();
  loadDashboard();
});
