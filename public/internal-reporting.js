/**
 * WORK JAPAN internal reporting section (Consideration stage).
 * GA4 pages from API + manual metrics with localStorage overrides.
 */
(function () {
  const STORAGE_KEY = 'wj_internal_report_manual';
  const CATEGORY_BADGE_CLASS = {
    'Job Listings': 'ir-badge-blue',
    'Jobseeker Pages': 'ir-badge-green',
    'Employer Dashboard': 'ir-badge-purple',
    Blog: 'ir-badge-yellow',
    Homepage: 'ir-badge-orange',
    Other: 'ir-badge-muted',
  };

  const CATEGORY_CHART_COLORS = {
    'Job Listings': '#4F8EF7',
    'Jobseeker Pages': '#34d399',
    'Employer Dashboard': '#a78bfa',
    Blog: '#facc15',
    Homepage: '#FF6B35',
    Other: '#8892b0',
  };

  let reportData = null;
  let tableSort = { col: 'active_users', dir: 'desc' };
  let editPanelOpen = false;

  function getManualOverrides() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveManualOverrides(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function applyOverrides(report) {
    const o = getManualOverrides();
    const kpis = { ...report.kpis };
    if (o.registrations != null && o.registrations !== '') kpis.registrations = Number(o.registrations);
    if (o.applications != null && o.applications !== '') kpis.applications = Number(o.applications);
    if (o.selected != null && o.selected !== '') kpis.selected = Number(o.selected);

    const funnel = report.funnel.map((step) => {
      if (step.id === 'registrations') return { ...step, value: kpis.registrations };
      if (step.id === 'applications') return { ...step, value: kpis.applications };
      if (step.id === 'selected') return { ...step, value: kpis.selected };
      return { ...step };
    });

    const conversionLabels = [null, 'of page users registered', 'of registrants applied', 'of applicants selected'];
    for (let i = 1; i < funnel.length; i++) {
      const prev = funnel[i - 1].value || 0;
      const curr = funnel[i].value || 0;
      funnel[i].conversionFromPrev = prev > 0 ? Math.round((curr / prev) * 1000) / 10 : 0;
      funnel[i].conversionLabel = conversionLabels[i];
      funnel[i].usersLost = Math.max(0, prev - curr);
    }

    return { ...report, kpis, funnel };
  }

  function formatEngagement(seconds) {
    const s = Math.round(Number(seconds) || 0);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }

  function shortenPath(path, max = 42) {
    if (!path || path.length <= max) return path || '—';
    return `${path.slice(0, max - 1)}…`;
  }

  function conversionClass(pct) {
    if (pct >= 5) return 'ir-conv-good';
    if (pct >= 1) return 'ir-conv-mid';
    return 'ir-conv-low';
  }

  function sortPages(pages) {
    const { col, dir } = tableSort;
    const mult = dir === 'asc' ? 1 : -1;
    return [...pages].sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      if (typeof av === 'string') return mult * av.localeCompare(bv);
      return mult * ((av || 0) - (bv || 0));
    });
  }

  function renderKpiCards(kpis) {
    const cards = [
      { icon: '👥', label: 'Total Active Users', value: kpis.totalActiveUsers, sub: 'GA4 page sum', cls: 'ir-kpi-blue' },
      { icon: '📄', label: 'Total Page Views', value: kpis.totalViews, sub: 'GA4 page sum', cls: 'ir-kpi-blue' },
      { icon: '✍️', label: 'New Registrations', value: kpis.registrations, sub: 'Manual / editable', cls: 'ir-kpi-green' },
      { icon: '📋', label: 'Applications Submitted', value: kpis.applications, sub: 'Manual / editable', cls: 'ir-kpi-green' },
      { icon: '✅', label: 'Job Seekers Selected', value: kpis.selected, sub: 'Manual / editable', cls: 'ir-kpi-green' },
    ];
    return `<div class="ir-kpi-row">${cards.map((c) => `
      <div class="ir-kpi-card ${c.cls}">
        <span class="ir-kpi-icon" aria-hidden="true">${c.icon}</span>
        <div class="ir-kpi-label">${c.label}</div>
        <div class="ir-kpi-value">${formatNum(c.value)}</div>
        <div class="ir-kpi-sub">${c.sub}</div>
      </div>
    `).join('')}</div>`;
  }

  function renderFunnel(funnel) {
    return `<div class="ir-funnel">${funnel.map((step, i) => {
      const arrow = i < funnel.length - 1 ? (() => {
        const next = funnel[i + 1];
        const pct = next.conversionFromPrev;
        return `
          <div class="ir-funnel-arrow">
            <div class="ir-funnel-arrow-line"></div>
            <div class="ir-funnel-conv ${conversionClass(pct)}">
              <strong>${formatPct(pct)}</strong>
              <span>${next.conversionLabel || ''}</span>
            </div>
          </div>`;
      })() : '';
      return `
        <div class="ir-funnel-step">
          <div class="ir-funnel-step-inner">
            <div class="ir-funnel-step-label">${step.label}</div>
            <div class="ir-funnel-step-value">${formatNum(step.value)}</div>
          </div>
        </div>
        ${arrow}
      `;
    }).join('')}</div>`;
  }

  function renderTopPagesTable(pages) {
    const sorted = sortPages(pages);
    const cols = [
      { key: 'path', label: 'Page Path' },
      { key: 'category', label: 'Category' },
      { key: 'views', label: 'Views' },
      { key: 'active_users', label: 'Active Users' },
      { key: 'avg_engagement_time', label: 'Avg. Engagement' },
    ];
    const header = cols.map((c) => {
      const active = tableSort.col === c.key;
      const arrow = active ? (tableSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
      return `<th><button type="button" class="ir-sort-btn" data-sort="${c.key}">${c.label}${arrow}</button></th>`;
    }).join('');

    const rows = sorted.map((p) => `
      <tr>
        <td class="ir-path" title="${p.path}"><code>${shortenPath(p.path)}</code></td>
        <td><span class="ir-badge ${CATEGORY_BADGE_CLASS[p.category] || 'ir-badge-muted'}">${p.category}</span></td>
        <td>${formatNum(p.views)}</td>
        <td>${formatNum(p.active_users)}</td>
        <td>${formatEngagement(p.avg_engagement_time)}</td>
      </tr>
    `).join('');

    return `
      <div class="table-wrap"><table class="ir-table">
        <thead><tr>${header}</tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty-state">No page data — upload Pages CSV</td></tr>'}</tbody>
      </table></div>`;
  }

  function renderEditPanel(kpis, period) {
    const o = getManualOverrides();
    const reg = o.registrations ?? kpis.registrations ?? '';
    const app = o.applications ?? kpis.applications ?? '';
    const sel = o.selected ?? kpis.selected ?? '';

    return `
      <div class="ir-edit-panel">
        <button type="button" class="ir-edit-toggle" id="irEditToggle" aria-expanded="${editPanelOpen}">
          ${editPanelOpen ? '▼' : '▶'} Edit manual business metrics
        </button>
        <div class="ir-edit-body" id="irEditBody" style="display:${editPanelOpen ? 'block' : 'none'}">
          <p class="subsection-hint">
            Override registrations, applications, and selected/hired for this report.
            Saved in your browser — or update permanently on the <a href="/upload">upload page</a>.
            ${period?.platformMonth ? ` Platform month: <strong>${period.platformMonth}</strong>.` : ''}
            ${period?.applicantMonth ? ` Applicant month: <strong>${period.applicantMonth}</strong>.` : ''}
          </p>
          <form id="irManualForm" class="ir-edit-form">
            <div class="ir-edit-field">
              <label for="irRegistrations">Registrations</label>
              <input type="number" id="irRegistrations" min="0" value="${reg}">
            </div>
            <div class="ir-edit-field">
              <label for="irApplications">Applications submitted</label>
              <input type="number" id="irApplications" min="0" value="${app}">
            </div>
            <div class="ir-edit-field">
              <label for="irSelected">Job seekers selected / hired</label>
              <input type="number" id="irSelected" min="0" value="${sel}">
            </div>
            <div class="ir-edit-actions">
              <button type="submit" class="btn-primary">Apply to report</button>
              <button type="button" class="btn-secondary" id="irResetManual">Reset to server data</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  function renderChartsContainers() {
    return `
      <div class="ir-charts-row">
        <div class="chart-container ir-chart-box">
          <div class="chart-header"><h3>Conversion funnel</h3><button class="chart-download" data-chart="chartInternalFunnel">PNG</button></div>
          <div class="chart-wrapper ir-chart-tall"><canvas id="chartInternalFunnel"></canvas></div>
        </div>
        <div class="chart-container ir-chart-box">
          <div class="chart-header"><h3>Users by page category</h3><button class="chart-download" data-chart="chartInternalCategories">PNG</button></div>
          <div class="chart-wrapper ir-chart-tall"><canvas id="chartInternalCategories"></canvas></div>
        </div>
      </div>`;
  }

  function renderInternalReportingView(rawReport) {
    const root = document.getElementById('internalReportingRoot');
    if (!root || !rawReport) return;

    reportData = applyOverrides(rawReport);
    const { kpis, funnel, topPages, categories, filter, manualPeriod } = reportData;
    const rangeLabel = filter?.start && filter?.end ? `${filter.start} → ${filter.end}` : 'Selected date range';

    root.innerHTML = `
      <p class="ir-period-label">Reporting period: <strong>${rangeLabel}</strong> · ${report.allPagesCount || 0} pages from GA4 CSV</p>
      ${renderKpiCards(kpis)}
      ${renderEditPanel(kpis, manualPeriod)}
      <div class="ir-section-block">
        <h4 class="subsection-title">Conversion funnel — website to hire</h4>
        <p class="subsection-hint">Active users (GA4) → registrations → applications → selected. Rates shown between steps.</p>
        ${renderFunnel(funnel)}
        ${renderChartsContainers()}
      </div>
      <div class="ir-section-block">
        <h4 class="subsection-title">Top 10 pages by active users</h4>
        ${renderTopPagesTable(topPages)}
      </div>
    `;

    bindInternalReportingEvents();
    renderInternalCharts(funnel, categories);
  }

  let delegationBound = false;

  function bindInternalReportingEvents() {
    const section = document.getElementById('section-internal-reporting');
    if (!section || delegationBound) return;
    delegationBound = true;

    section.addEventListener('click', (e) => {
      const root = document.getElementById('internalReportingRoot');
      if (!root) return;

      if (e.target.closest('#irEditToggle')) {
        editPanelOpen = !editPanelOpen;
        const body = root.querySelector('#irEditBody');
        const btn = root.querySelector('#irEditToggle');
        if (body) body.style.display = editPanelOpen ? 'block' : 'none';
        if (btn) {
          btn.setAttribute('aria-expanded', String(editPanelOpen));
          btn.textContent = `${editPanelOpen ? '▼' : '▶'} Edit manual business metrics`;
        }
        return;
      }

      if (e.target.closest('#irResetManual')) {
        localStorage.removeItem(STORAGE_KEY);
        if (window.__lastInternalReportRaw) renderInternalReportingView(window.__lastInternalReportRaw);
        return;
      }

      const sortBtn = e.target.closest('.ir-sort-btn');
      if (sortBtn) {
        const col = sortBtn.dataset.sort;
        if (tableSort.col === col) {
          tableSort.dir = tableSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          tableSort.col = col;
          tableSort.dir = col === 'path' || col === 'category' ? 'asc' : 'desc';
        }
        if (window.__lastInternalReportRaw) renderInternalReportingView(window.__lastInternalReportRaw);
        return;
      }

      const dlBtn = e.target.closest('.chart-download');
      if (dlBtn && typeof downloadChart === 'function') {
        e.stopPropagation();
        downloadChart(dlBtn.dataset.chart);
      }
    });

    section.addEventListener('submit', (e) => {
      if (e.target.id !== 'irManualForm') return;
      e.preventDefault();
      saveManualOverrides({
        registrations: document.getElementById('irRegistrations')?.value,
        applications: document.getElementById('irApplications')?.value,
        selected: document.getElementById('irSelected')?.value,
      });
      if (window.__lastInternalReportRaw) renderInternalReportingView(window.__lastInternalReportRaw);
    });
  }

  function renderInternalCharts(funnel, categories) {
    if (typeof destroyChart !== 'function' || typeof Chart === 'undefined') return;

    destroyChart('chartInternalFunnel');
    const funnelCtx = document.getElementById('chartInternalFunnel');
    if (funnelCtx && funnel?.length) {
      charts.chartInternalFunnel = new Chart(funnelCtx, {
        type: 'bar',
        data: {
          labels: funnel.map((s) => s.label),
          datasets: [{
            label: 'Count',
            data: funnel.map((s) => s.value),
            backgroundColor: ['#4F8EF7', '#34d399', '#facc15', '#FF6B35'],
          }],
        },
        options: {
          ...chartDefaults(),
          indexAxis: 'y',
        },
      });
    }

    destroyChart('chartInternalCategories');
    const catCtx = document.getElementById('chartInternalCategories');
    if (catCtx && categories?.length) {
      charts.chartInternalCategories = new Chart(catCtx, {
        type: 'doughnut',
        data: {
          labels: categories.map((c) => c.category),
          datasets: [{
            data: categories.map((c) => c.users),
            backgroundColor: categories.map((c) => CATEGORY_CHART_COLORS[c.category] || '#8892b0'),
          }],
        },
        options: {
          ...chartDefaults(),
          plugins: {
            ...chartDefaults().plugins,
            legend: { position: 'right', labels: { color: COLORS.text, font: { size: 11 } } },
          },
        },
      });
    }
  }

  window.renderInternalReporting = function (report) {
    window.__lastInternalReportRaw = report;
    renderInternalReportingView(report);
  };
})();
