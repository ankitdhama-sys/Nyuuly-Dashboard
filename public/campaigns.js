const COLORS = {
  nyuuly: '#4F8EF7',
  workjapan: '#FF6B35',
  grid: 'rgba(136, 146, 176, 0.15)',
  text: '#8892b0',
  palette: ['#4F8EF7', '#FF6B35', '#34d399', '#a78bfa', '#fbbf24', '#f472b6', '#38bdf8', '#fb923c'],
};

const charts = {};
let state = {
  company: sessionStorage.getItem('analyticsCompany') || 'workjapan',
  month: null,
  months: [],
};

function formatNum(n) {
  if (n == null) return '0';
  const num = Number(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 10_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function formatRs(n) {
  if (n == null) return 'Rs 0';
  return `Rs ${formatNum(n)}`;
}

function formatPct(n) {
  if (n == null) return '—';
  return `${Number(n).toFixed(1)}%`;
}

function monthToRange(monthVal) {
  const [y, m] = monthVal.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
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
    plugins: { legend: { labels: { color: COLORS.text } } },
  };
}

function companyColor() {
  return state.company === 'nyuuly' ? COLORS.nyuuly : COLORS.workjapan;
}

function campaignLabel(row) {
  const bits = [row.placement, row.utmOrPromo].filter(Boolean);
  return bits.join(' · ') || 'Campaign';
}

function renderKpis(kpis) {
  const el = document.getElementById('campaignKpis');
  if (!el) return;
  if (!kpis || (!kpis.totalCost && !kpis.totalClicks && !kpis.totalResults)) {
    el.innerHTML = '<div class="empty-state">No campaign data for this month — <a href="/upload">add campaigns on the upload page</a></div>';
    return;
  }
  el.innerHTML = `
    <div class="kpi-card">
      <div class="label">Total spend</div>
      <div class="value">${formatRs(kpis.totalCost)}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Weekly clicks (total)</div>
      <div class="value">${formatNum(kpis.totalClicks)}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Weekly results (total)</div>
      <div class="value">${formatNum(kpis.totalResults)}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Cost per click</div>
      <div class="value">${kpis.costPerClick != null ? formatRs(kpis.costPerClick) : '—'}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Cost per result</div>
      <div class="value">${kpis.costPerResult != null ? formatRs(kpis.costPerResult) : '—'}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Conversion rate</div>
      <div class="value">${formatPct(kpis.conversionRate)}</div>
      <div class="kpi-sub">Results ÷ clicks</div>
    </div>
  `;
}

function renderCampaignTable(rows) {
  const el = document.getElementById('campaignTableWrap');
  if (!el) return;
  if (!rows?.length) {
    el.innerHTML = '<p class="empty-state">No campaigns for this month.</p>';
    return;
  }
  el.innerHTML = `
    <table class="data-table campaign-results-table">
      <thead>
        <tr>
          <th>Placement</th>
          <th>Type</th>
          <th>Location / detail</th>
          <th>UTM / promo</th>
          <th>Monthly cost</th>
          <th>Weekly clicks</th>
          <th>Weekly result</th>
          <th>Cost / click</th>
          <th>Cost / result</th>
          <th>Conv. %</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${row.placement || '—'}</td>
            <td>${row.campaignType || '—'}</td>
            <td>${row.locationDetail || '—'}</td>
            <td><code>${row.utmOrPromo || '—'}</code></td>
            <td>${formatRs(row.monthlyCost)}</td>
            <td>${formatNum(row.weeklyClicks)}</td>
            <td>${formatNum(row.weeklyResult)}</td>
            <td>${row.costPerClick != null ? formatRs(row.costPerClick) : '—'}</td>
            <td>${row.costPerResult != null ? formatRs(row.costPerResult) : '—'}</td>
            <td>${formatPct(row.conversionRate)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderSpendChart(rows) {
  destroyChart('chartCampaignSpend');
  const ctx = document.getElementById('chartCampaignSpend');
  if (!ctx || !rows?.length) return;
  const labels = rows.map(campaignLabel);
  charts.chartCampaignSpend = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Monthly cost (Rs)',
        data: rows.map((r) => r.monthlyCost || 0),
        backgroundColor: companyColor(),
      }],
    },
    options: {
      ...chartDefaults(),
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: COLORS.text, maxRotation: 45 }, grid: { color: COLORS.grid } },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, beginAtZero: true },
      },
    },
  });
}

function renderClicksResultsChart(rows) {
  destroyChart('chartCampaignClicksResults');
  const ctx = document.getElementById('chartCampaignClicksResults');
  if (!ctx || !rows?.length) return;
  const labels = rows.map(campaignLabel);
  charts.chartCampaignClicksResults = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Weekly clicks',
          data: rows.map((r) => r.weeklyClicks || 0),
          backgroundColor: '#34d399',
        },
        {
          label: 'Weekly results',
          data: rows.map((r) => r.weeklyResult || 0),
          backgroundColor: '#a78bfa',
        },
      ],
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { ticks: { color: COLORS.text, maxRotation: 45 }, grid: { color: COLORS.grid } },
        y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, beginAtZero: true },
      },
    },
  });
}

function renderSpendShareChart(rows) {
  destroyChart('chartCampaignSpendShare');
  const ctx = document.getElementById('chartCampaignSpendShare');
  const items = (rows || []).filter((r) => r.monthlyCost > 0);
  if (!ctx || !items.length) return;
  charts.chartCampaignSpendShare = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: items.map(campaignLabel),
      datasets: [{
        data: items.map((r) => r.monthlyCost),
        backgroundColor: COLORS.palette,
        borderWidth: 0,
      }],
    },
    options: {
      ...chartDefaults(),
      plugins: {
        legend: { position: 'bottom', labels: { color: COLORS.text, boxWidth: 12 } },
      },
    },
  });
}

function renderTrendChart(history) {
  destroyChart('chartCampaignTrend');
  const ctx = document.getElementById('chartCampaignTrend');
  if (!ctx || !history?.length) return;
  const hasData = history.some((h) => h.totalCost || h.totalClicks || h.totalResults);
  if (!hasData) return;
  const labels = history.map((h) => h.label.replace(/^\d{4}\s/, ''));
  charts.chartCampaignTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Spend (Rs)',
          data: history.map((h) => h.totalCost || 0),
          borderColor: companyColor(),
          backgroundColor: companyColor(),
          yAxisID: 'y',
          tension: 0.3,
        },
        {
          label: 'Clicks',
          data: history.map((h) => h.totalClicks || 0),
          borderColor: '#34d399',
          backgroundColor: '#34d399',
          yAxisID: 'y1',
          tension: 0.3,
        },
        {
          label: 'Results',
          data: history.map((h) => h.totalResults || 0),
          borderColor: '#a78bfa',
          backgroundColor: '#a78bfa',
          yAxisID: 'y1',
          tension: 0.3,
        },
      ],
    },
    options: {
      ...chartDefaults(),
      scales: {
        x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        y: {
          type: 'linear',
          position: 'left',
          ticks: { color: COLORS.text },
          grid: { color: COLORS.grid },
          beginAtZero: true,
        },
        y1: {
          type: 'linear',
          position: 'right',
          ticks: { color: COLORS.text },
          grid: { drawOnChartArea: false },
          beginAtZero: true,
        },
      },
    },
  });
}

async function loadMonths() {
  const res = await fetch(`/api/campaigns/months?company=${state.company}`);
  const data = await res.json();
  state.months = data.months || [];
  state.month = data.defaultMonth || data.latest || (state.months.length ? state.months[state.months.length - 1].key : null);

  const sel = document.getElementById('monthSelect');
  if (!sel) return;
  sel.innerHTML = state.months.length
    ? state.months.map((m) => `<option value="${m.key}"${m.key === state.month ? ' selected' : ''}>${m.label}</option>`).join('')
    : '<option value="">No campaign data</option>';
}

async function loadCampaigns() {
  const filterEl = document.getElementById('filterLabel');
  if (!state.month) {
    if (filterEl) filterEl.textContent = 'No campaign data — upload on the Upload page';
    renderKpis(null);
    renderCampaignTable([]);
    ['chartCampaignSpend', 'chartCampaignClicksResults', 'chartCampaignSpendShare', 'chartCampaignTrend'].forEach(destroyChart);
    return;
  }

  document.body.classList.add('is-loading');
  try {
    const { start, end } = monthToRange(state.month);
    const [currentRes, historyRes] = await Promise.all([
      fetch(`/api/campaigns?company=${state.company}&start=${start}&end=${end}`),
      fetch(`/api/campaigns/history?company=${state.company}`),
    ]);
    const current = await currentRes.json();
    const historyData = await historyRes.json();

    const monthLabel = state.months.find((m) => m.key === state.month)?.label || state.month;
    if (filterEl) filterEl.textContent = `${monthLabel} · ${state.company === 'nyuuly' ? 'Nyuuly' : 'WORK JAPAN'}`;

    renderKpis(current.kpis);
    renderCampaignTable(current.rows || []);
    renderSpendChart(current.rows || []);
    renderClicksResultsChart(current.rows || []);
    renderSpendShareChart(current.rows || []);
    renderTrendChart(historyData.history || []);
  } catch (err) {
    console.error(err);
    if (filterEl) filterEl.textContent = `Error: ${err.message}`;
  } finally {
    document.body.classList.remove('is-loading');
  }
}

async function loadLastUpdated() {
  try {
    const res = await fetch('/api/upload-history');
    const data = await res.json();
    const el = document.getElementById('lastUpdated');
    if (el && data.lastUpdated) {
      el.textContent = `Last updated: ${new Date(`${data.lastUpdated}Z`).toLocaleString()}`;
    }
  } catch (_) { /* ignore */ }
}

function initControls() {
  document.querySelectorAll('#companyTabs .tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.company === state.company);
    btn.addEventListener('click', async () => {
      state.company = btn.dataset.company;
      sessionStorage.setItem('analyticsCompany', state.company);
      document.querySelectorAll('#companyTabs .tab-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.company === state.company);
      });
      document.body.classList.toggle('company-workjapan', state.company === 'workjapan');
      document.body.classList.toggle('company-nyuuly', state.company === 'nyuuly');
      await loadMonths();
      await loadCampaigns();
    });
  });

  document.getElementById('monthSelect')?.addEventListener('change', async (e) => {
    state.month = e.target.value || null;
    await loadCampaigns();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  document.body.classList.toggle('company-workjapan', state.company === 'workjapan');
  document.body.classList.toggle('company-nyuuly', state.company === 'nyuuly');
  loadLastUpdated();
  if (typeof loadNavDataCoverageAll === 'function') loadNavDataCoverageAll();
  initControls();
  await loadMonths();
  await loadCampaigns();
});
