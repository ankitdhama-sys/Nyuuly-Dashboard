let state = { month: null, months: [] };

function renderCompanyBlock(companyData, type) {
  if (!companyData) {
    return `
      <div class="weekly-company-block">
        <h3 class="weekly-company-name">${type === 'worst' ? '—' : '—'}</h3>
        <p class="empty-state">No data available for comparison.</p>
      </div>
    `;
  }

  const items = type === 'worst' ? companyData.worst : companyData.best;
  const periodLine = companyData.dataCoverage?.label
    ? `${companyData.monthLabel} · ${companyData.dataCoverage.label}`
    : companyData.prevMonthLabel
      ? `${companyData.monthLabel} compared to ${companyData.prevMonthLabel}`
      : companyData.monthLabel;

  if (!items?.length) {
    return `
      <div class="weekly-company-block">
        <h3 class="weekly-company-name weekly-company-${companyData.company}">${companyData.companyLabel}</h3>
        <p class="weekly-company-period">${periodLine}</p>
        <p class="empty-state">No ${type === 'worst' ? 'declines' : 'improvements'} with month-over-month data this month.</p>
      </div>
    `;
  }

  return `
    <div class="weekly-company-block">
      <h3 class="weekly-company-name weekly-company-${companyData.company}">${companyData.companyLabel}</h3>
      <p class="weekly-company-period">${periodLine}</p>
      <ul class="weekly-brief-list">
        ${items.map((item) => {
          const pct = item.displayDeltaPct ?? item.deltaPct;
          const proratedNote = item.compareMode === 'prorated'
            ? ' <span class="weekly-brief-compare-tag">same period</span>'
            : '';
          return `
          <li class="weekly-brief-item weekly-brief-item-${item.direction}">
            <div class="weekly-brief-text">
              <span class="weekly-brief-pct weekly-brief-pct-${item.direction}">
                ${item.direction === 'down' ? '▼' : '▲'} ${Math.abs(pct).toFixed(1)}%${proratedNote}
              </span>
              <p>${item.summary}</p>
            </div>
            <a href="${item.dashboardUrl}" class="btn-secondary weekly-detail-btn">View details</a>
          </li>
        `;
        }).join('')}
      </ul>
    </div>
  `;
}

function renderBrief(data) {
  const worstEl = document.getElementById('weeklyWorst');
  const bestEl = document.getElementById('weeklyBest');
  const introEl = document.getElementById('weeklyIntro');
  const filterEl = document.getElementById('filterLabel');

  if (!data?.workjapan && !data?.nyuuly) {
    if (filterEl) filterEl.textContent = 'No monthly data available';
    worstEl.innerHTML = '<p class="empty-state">Upload monthly data to generate the brief.</p>';
    bestEl.innerHTML = '';
    return;
  }

  const monthLabel = data.workjapan?.monthLabel || data.nyuuly?.monthLabel || '';
  if (filterEl) filterEl.textContent = monthLabel ? `Brief for ${monthLabel}` : 'Weekly brief';
  if (introEl && monthLabel) {
    introEl.textContent = `Month-over-month KPI highlights for ${monthLabel} — top declines to address and top gains to celebrate for WORK JAPAN and Nyuuly.`;
  }

  worstEl.innerHTML = `
    ${renderCompanyBlock(data.workjapan, 'worst')}
    ${renderCompanyBlock(data.nyuuly, 'worst')}
  `;
  bestEl.innerHTML = `
    ${renderCompanyBlock(data.workjapan, 'best')}
    ${renderCompanyBlock(data.nyuuly, 'best')}
  `;
}

async function loadMonths() {
  const res = await fetch('/api/weekly-brief');
  const data = await res.json();
  state.months = data.months || [];
  state.month = data.month || (state.months.length ? state.months[state.months.length - 1].key : null);

  const sel = document.getElementById('monthSelect');
  sel.innerHTML = state.months.length
    ? state.months.map((m) => `<option value="${m.key}"${m.key === state.month ? ' selected' : ''}>${m.label}</option>`).join('')
    : '<option value="">No data</option>';
}

async function loadBrief() {
  document.body.classList.add('is-loading');
  try {
    const url = state.month ? `/api/weekly-brief?month=${encodeURIComponent(state.month)}` : '/api/weekly-brief';
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load brief');
    renderBrief(data);
  } catch (err) {
    console.error(err);
    document.getElementById('filterLabel').textContent = `Error: ${err.message}`;
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

document.addEventListener('DOMContentLoaded', async () => {
  loadLastUpdated();
  if (typeof loadNavDataCoverageAll === 'function') loadNavDataCoverageAll();
  await loadMonths();
  await loadBrief();

  document.getElementById('monthSelect').addEventListener('change', async (e) => {
    state.month = e.target.value || null;
    await loadBrief();
  });

  document.getElementById('printBriefBtn').addEventListener('click', () => window.print());
});
