const COLORS = {
  nyuuly: '#4F8EF7',
  workjapan: '#FF6B35',
  grid: 'rgba(136, 146, 176, 0.15)',
  text: '#8892b0',
  palette: ['#4F8EF7', '#FF6B35', '#34d399', '#a78bfa', '#fbbf24', '#f472b6', '#38bdf8', '#fb923c'],
};

const charts = {};
let state = { month: null, months: [] };

function formatNum(n) {
  if (n == null) return '0';
  const num = Number(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 10_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function formatPct(n) {
  if (n == null) return '0%';
  return `${Number(n).toFixed(1)}%`;
}

function deltaBadge(metric) {
  if (!metric) return '';
  const d = metric.deltaPct;
  if (d == null) return '<span class="kpi-delta kpi-delta-flat">— vs last month</span>';
  if (d > 0) return `<span class="kpi-delta kpi-delta-up">▲ ${Math.abs(d).toFixed(1)}% vs last month</span>`;
  if (d < 0) return `<span class="kpi-delta kpi-delta-down">▼ ${Math.abs(d).toFixed(1)}% vs last month</span>`;
  return '<span class="kpi-delta kpi-delta-flat">0.0% vs last month</span>';
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

function periodHint(data) {
  if (!data?.monthLabel) return '';
  const prev = data.prevMonthLabel ? ` · compared to ${data.prevMonthLabel}` : '';
  return `<span class="consideration-audience-period">This month: ${data.monthLabel}${prev}</span>`;
}

function pipelineMetric(metric) {
  if (!metric) return null;
  return metric.total?.value != null && metric.total?.deltaPct !== undefined
    ? metric.total
    : metric;
}

function conversionFromPrevious(current, previous) {
  if (previous == null || previous <= 0) return null;
  return current / previous;
}

function formatPctPoints(n) {
  if (n == null) return '0%';
  return `${Number(n).toFixed(1)}%`;
}

function funnelStepConversionPlain(pct, description) {
  if (pct == null) return '';
  return `<div class="funnel-step-conversion">
    <span class="funnel-step-conversion-pct">${formatPct(pct)}</span>
    <span class="funnel-step-conversion-desc">${description}</span>
  </div>`;
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

function renderAwarenessMetricsHtml(gsc, social, gscMetric, socialMetric) {
  return `
    <div class="pipeline-awareness-metrics">
      <div class="pipeline-awareness-metric">
        <div class="pipeline-awareness-value">${formatNum(gsc)}</div>
        <div class="pipeline-awareness-label">Google search impressions</div>
        <div class="pipeline-awareness-hint">Times we appeared in search results</div>
        ${deltaBadge(gscMetric)}
      </div>
      <div class="pipeline-awareness-metric">
        <div class="pipeline-awareness-value">${formatNum(social)}</div>
        <div class="pipeline-awareness-label">Social media views</div>
        <div class="pipeline-awareness-hint">Views on Facebook, Instagram, etc.</div>
        ${deltaBadge(socialMetric)}
      </div>
    </div>
  `;
}

function renderPipeline(data) {
  const el = document.getElementById('combinedPipeline');
  if (!el || !data?.pipeline) return;
  const p = data.pipeline;
  const awarenessStage = data.stages?.awareness;
  const stages = [
    {
      num: 1,
      label: 'Awareness',
      anchor: 'stage-awareness',
      awarenessMetrics: {
        gsc: awarenessStage?.gscImpressions?.total?.value || 0,
        social: awarenessStage?.socialChannelViews?.total?.value || 0,
        gscMetric: awarenessStage?.gscImpressions?.total,
        socialMetric: awarenessStage?.socialChannelViews?.total,
      },
    },
    {
      num: 2,
      label: 'Consideration',
      anchor: 'stage-consideration',
      raw: pipelineMetric(p.consideration)?.value || 0,
      metric: p.consideration,
      sourceBreakdown: data.stages?.consideration?.sourceBreakdown,
    },
    {
      num: 3,
      label: 'Commit',
      anchor: 'stage-commit',
      raw: pipelineMetric(p.commit)?.value || 0,
      metric: p.commit,
      conversionHint: 'of website visitors signed up or subscribed',
    },
    {
      num: 4,
      label: 'Proceed',
      anchor: 'stage-proceed',
      raw: pipelineMetric(p.proceed)?.value || 0,
      metric: p.proceed,
      conversionHint: 'of sign-ups moved on to apply or use a product',
    },
    {
      num: 5,
      label: 'Result',
      anchor: 'stage-result',
      raw: pipelineMetric(p.result)?.value || 0,
      metric: p.result,
      conversionHint: 'of total applications were selected (job offer)',
    },
  ];
  el.innerHTML = stages.map((s, i) => {
    const m = pipelineMetric(s.metric);
    const prev = i > 0 ? stages[i - 1] : null;
    const convLine = s.sourceBreakdown
      ? funnelConsiderationSourcesHtml(s.sourceBreakdown)
      : s.awarenessMetrics
        ? ''
        : funnelStepConversionPlain(
          prev ? conversionFromPrevious(s.raw, prev.raw) : null,
          s.conversionHint || 'moved to this step from the previous one',
        );
    const valueBlock = s.awarenessMetrics
      ? renderAwarenessMetricsHtml(
        s.awarenessMetrics.gsc,
        s.awarenessMetrics.social,
        s.awarenessMetrics.gscMetric,
        s.awarenessMetrics.socialMetric,
      )
      : `
      <div class="pipeline-value">${formatNum(s.raw)}</div>
      ${deltaBadge(m)}
    `;
    return `
    <a href="#${s.anchor}" class="pipeline-stage${s.awarenessMetrics ? ' pipeline-stage-awareness' : ''}">
      <div class="pipeline-num">${s.num}</div>
      <div class="pipeline-label">${s.label}</div>
      ${valueBlock}
      ${convLine}
    </a>
    ${i < stages.length - 1 ? '<div class="pipeline-arrow">→</div>' : ''}
  `;
  }).join('');
}

function renderSplitChart(id, wj, ny, labels = ['WORK JAPAN', 'Nyuuly']) {
  destroyChart(id);
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const total = (wj || 0) + (ny || 0);
  if (total <= 0) return;
  charts[id] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: [wj || 0, ny || 0],
        backgroundColor: [COLORS.workjapan, COLORS.nyuuly],
        borderWidth: 0,
      }],
    },
    options: {
      ...chartDefaults(),
      plugins: {
        legend: { position: 'bottom', labels: { color: COLORS.text } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw || 0;
              const pct = total > 0 ? ((v / total) * 100).toFixed(1) : 0;
              return `${ctx.label}: ${formatNum(v)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function renderBreakdownTable(title, rows) {
  if (!rows?.length) return `<p class="empty-state">No data for this month.</p>`;
  return `
    <h4 class="subsection-title">${title}</h4>
    <div class="table-wrap">
      <table class="data-table combined-breakdown-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>WORK JAPAN</th>
            <th>Nyuuly</th>
            <th>Total</th>
            <th>WJ share</th>
            <th>Nyuuly share</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${r.label}</td>
              <td>${formatNum(r.workjapan?.value ?? r.workjapan)}</td>
              <td>${formatNum(r.nyuuly?.value ?? r.nyuuly)}</td>
              <td><strong>${formatNum(r.total?.value ?? r.total)}</strong></td>
              <td>${formatPct(r.workjapanPct ?? (r.total?.value > 0 ? ((r.workjapan?.value ?? r.workjapan) / (r.total?.value ?? r.total)) * 100 : 0))}</td>
              <td>${formatPct(r.nyuulyPct ?? (r.total?.value > 0 ? ((r.nyuuly?.value ?? r.nyuuly) / (r.total?.value ?? r.total)) * 100 : 0))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderStageItemsTable(title, items) {
  if (!items?.length) return `<p class="empty-state">No data for this month.</p>`;
  return `
    <h4 class="subsection-title">${title}</h4>
    <div class="table-wrap">
      <table class="data-table combined-breakdown-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Company</th>
            <th>Value</th>
            <th>Share of stage</th>
            <th>MoM</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${item.label}</td>
              <td><span class="company-tag company-tag-${item.company === 'Nyuuly' ? 'nyuuly' : 'wj'}">${item.company}</span></td>
              <td><strong>${formatNum(item.value)}</strong></td>
              <td>${formatPct(item.pct)}</td>
              <td>${deltaBadge(item)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderAwareness(data) {
  const s = data.stages.awareness;
  const el = document.getElementById('awarenessKpis');
  el.innerHTML = `
    ${periodHint(data)}
    <div class="kpi-card kpi-card-combined">
      <div class="label">GSC search impressions</div>
      <div class="value">${formatNum(s.gscImpressions.total.value)}</div>
      ${deltaBadge(s.gscImpressions.total)}
    </div>
    <div class="kpi-card kpi-card-combined">
      <div class="label">Social channel views</div>
      <div class="value">${formatNum(s.socialChannelViews.total.value)}</div>
      ${deltaBadge(s.socialChannelViews.total)}
      <div class="kpi-sub">Manual entry — separate from search impressions</div>
    </div>
    <div class="kpi-card">
      <div class="label">WORK JAPAN — search impressions</div>
      <div class="value">${formatNum(s.gscImpressions.workjapan.value)}</div>
      <div class="kpi-sub">${formatPct(s.gscImpressions.workjapanPct)} of combined GSC</div>
    </div>
    <div class="kpi-card">
      <div class="label">Nyuuly — search impressions</div>
      <div class="value">${formatNum(s.gscImpressions.nyuuly.value)}</div>
      <div class="kpi-sub">${formatPct(s.gscImpressions.nyuulyPct)} of combined GSC</div>
    </div>
  `;

  renderSplitChart('chartAwarenessSplit', s.gscImpressions.workjapan.value, s.gscImpressions.nyuuly.value);

  destroyChart('chartAwarenessComponents');
  const compCtx = document.getElementById('chartAwarenessComponents');
  if (compCtx) {
    const gsc = s.gscImpressions.total.value;
    const social = s.socialChannelViews.total.value;
    if (gsc + social > 0) {
      charts.chartAwarenessComponents = new Chart(compCtx, {
        type: 'bar',
        data: {
          labels: ['GSC impressions', 'Social channel views'],
          datasets: [
            {
              label: 'WORK JAPAN',
              data: [s.gscImpressions.workjapan.value, s.socialChannelViews.workjapan.value],
              backgroundColor: COLORS.workjapan,
            },
            {
              label: 'Nyuuly',
              data: [s.gscImpressions.nyuuly.value, s.socialChannelViews.nyuuly.value],
              backgroundColor: COLORS.nyuuly,
            },
          ],
        },
        options: {
          ...chartDefaults(),
          scales: {
            x: { stacked: true, ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
            y: { stacked: true, ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, beginAtZero: true },
          },
        },
      });
    }
  }

  document.getElementById('awarenessBreakdown').innerHTML = renderBreakdownTable('Awareness breakdown', [
    { label: 'GSC search impressions', ...s.gscImpressions, total: s.gscImpressions.total },
    { label: 'Social channel views (manual)', ...s.socialChannelViews, total: s.socialChannelViews.total },
    { label: 'Social post views (CSV)', ...s.socialPostViews, total: s.socialPostViews.total },
  ]);

  const brandEl = document.getElementById('combinedBrandMessages');
  if (brandEl) {
    const msgs = s.brandMessages || {};
    const blocks = [
      { company: 'WORK JAPAN', message: msgs.workjapan, cls: 'wj' },
      { company: 'Nyuuly', message: msgs.nyuuly, cls: 'nyuuly' },
    ].filter((b) => b.message?.trim());
    brandEl.innerHTML = blocks.length
      ? `
        <h4 class="subsection-title">Brand messages — key awareness themes</h4>
        <div class="combined-brand-grid">
          ${blocks.map((b) => `
            <div class="brand-message-card brand-message-card-${b.cls}">
              <div class="brand-message-company">${b.company}</div>
              <blockquote class="brand-message-quote">${escapeHtml(b.message.trim())}</blockquote>
            </div>
          `).join('')}
        </div>
      `
      : '';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderConsideration(data) {
  const s = data.stages.consideration;
  const el = document.getElementById('considerationKpis');
  el.innerHTML = `
    ${periodHint(data)}
    <div class="kpi-card kpi-card-combined">
      <div class="label">Total website users</div>
      <div class="value">${formatNum(s.totalUsers.total.value)}</div>
      ${deltaBadge(s.totalUsers.total)}
    </div>
    <div class="kpi-card">
      <div class="label">WORK JAPAN</div>
      <div class="value">${formatNum(s.totalUsers.workjapan.value)}</div>
      <div class="kpi-sub">${formatPct(s.totalUsers.workjapanPct)} of total</div>
    </div>
    <div class="kpi-card">
      <div class="label">Nyuuly</div>
      <div class="value">${formatNum(s.totalUsers.nyuuly.value)}</div>
      <div class="kpi-sub">${formatPct(s.totalUsers.nyuulyPct)} of total</div>
    </div>
  `;

  renderSplitChart('chartUsersSplit', s.totalUsers.workjapan.value, s.totalUsers.nyuuly.value);

  destroyChart('chartUsersByMedium');
  const medCtx = document.getElementById('chartUsersByMedium');
  const channels = s.channels?.filter((c) => c.total > 0).slice(0, 10) || [];
  if (medCtx && channels.length) {
    charts.chartUsersByMedium = new Chart(medCtx, {
      type: 'bar',
      data: {
        labels: channels.map((c) => c.channel),
        datasets: [
          {
            label: 'WORK JAPAN',
            data: channels.map((c) => c.workjapan),
            backgroundColor: COLORS.workjapan,
          },
          {
            label: 'Nyuuly',
            data: channels.map((c) => c.nyuuly),
            backgroundColor: COLORS.nyuuly,
          },
        ],
      },
      options: {
        ...chartDefaults(),
        indexAxis: 'y',
        scales: {
          x: { stacked: true, ticks: { color: COLORS.text }, grid: { color: COLORS.grid }, beginAtZero: true },
          y: { stacked: true, ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
        },
        plugins: {
          legend: { labels: { color: COLORS.text } },
          tooltip: {
            callbacks: {
              footer: (items) => {
                const total = items.reduce((sum, i) => sum + (i.raw || 0), 0);
                const all = s.totalUsers.total.value;
                const pct = all > 0 ? ((total / all) * 100).toFixed(1) : 0;
                return `Medium total: ${formatNum(total)} (${pct}% of all users)`;
              },
            },
          },
        },
      },
    });
  }

  const channelRows = channels.map((c) => ({
    label: c.channel,
    workjapan: c.workjapan,
    nyuuly: c.nyuuly,
    total: c.total,
    workjapanPct: c.total > 0 ? Math.round((c.workjapan / c.total) * 1000) / 10 : 0,
    nyuulyPct: c.total > 0 ? Math.round((c.nyuuly / c.total) * 1000) / 10 : 0,
  }));
  document.getElementById('considerationBreakdown').innerHTML = renderBreakdownTable('Users by acquisition medium', channelRows);
}

function renderCommit(data) {
  const s = data.stages.commit;
  const el = document.getElementById('commitKpis');
  el.innerHTML = `
    ${periodHint(data)}
    <div class="kpi-card kpi-card-combined">
      <div class="label">Total sign-ups</div>
      <div class="value">${formatNum(s.totalSignUps.total.value)}</div>
      ${deltaBadge(s.totalSignUps.total)}
      <div class="kpi-sub">WJ registrations + Nyuuly Subscribe</div>
    </div>
    <div class="kpi-card kpi-card-combined">
      <div class="label">Total app downloads</div>
      <div class="value">${formatNum(s.totalAppDownloads.total.value)}</div>
      ${deltaBadge(s.totalAppDownloads.total)}
    </div>
    <div class="kpi-card">
      <div class="label">Compass started (Nyuuly)</div>
      <div class="value">${formatNum(s.compassStarted.nyuuly.value)}</div>
    </div>
  `;

  renderSplitChart('chartSignUpsSplit', s.totalSignUps.workjapan.value, s.totalSignUps.nyuuly.value, ['WJ Registrations', 'Nyuuly Subscribe']);
  renderSplitChart('chartAppDownloadsSplit', s.totalAppDownloads.workjapan.value, s.totalAppDownloads.nyuuly.value);

  document.getElementById('commitBreakdown').innerHTML = renderBreakdownTable('Commit breakdown', [
    { label: 'Sign-ups (WJ registrations / Nyuuly Subscribe)', ...s.totalSignUps, total: s.totalSignUps.total },
    { label: 'App downloads (iOS + Android)', ...s.totalAppDownloads, total: s.totalAppDownloads.total },
  ]);
}

function renderStageMetrics(data, stageKey, kpiElId, shareChartId, valuesChartId, breakdownElId, totalLabel) {
  const stage = data.stages[stageKey];
  const el = document.getElementById(kpiElId);
  el.innerHTML = `
    ${periodHint(data)}
    <div class="kpi-card kpi-card-combined">
      <div class="label">${totalLabel}</div>
      <div class="value">${formatNum(stage.total.value)}</div>
      ${deltaBadge(stage.total)}
    </div>
    ${stage.items.slice(0, 3).map((item) => `
      <div class="kpi-card">
        <div class="label">${item.label}</div>
        <div class="value">${formatNum(item.value)}</div>
        <div class="kpi-sub">${formatPct(item.pct)} of stage · ${item.company}</div>
      </div>
    `).join('')}
  `;

  destroyChart(shareChartId);
  const shareCtx = document.getElementById(shareChartId);
  const items = stage.items.filter((i) => i.value > 0);
  if (shareCtx && items.length) {
    charts[shareChartId] = new Chart(shareCtx, {
      type: 'doughnut',
      data: {
        labels: items.map((i) => i.label),
        datasets: [{
          data: items.map((i) => i.value),
          backgroundColor: items.map((_, idx) => COLORS.palette[idx % COLORS.palette.length]),
          borderWidth: 0,
        }],
      },
      options: {
        ...chartDefaults(),
        plugins: {
          legend: { position: 'bottom', labels: { color: COLORS.text, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const item = items[ctx.dataIndex];
                return `${item.label}: ${formatNum(item.value)} (${formatPct(item.pct)})`;
              },
            },
          },
        },
      },
    });
  }

  destroyChart(valuesChartId);
  const valCtx = document.getElementById(valuesChartId);
  if (valCtx && stage.items.length) {
    charts[valuesChartId] = new Chart(valCtx, {
      type: 'bar',
      data: {
        labels: stage.items.map((i) => i.label),
        datasets: [{
          label: 'This month',
          data: stage.items.map((i) => i.value),
          backgroundColor: stage.items.map((i) => (i.company === 'Nyuuly' ? COLORS.nyuuly : COLORS.workjapan)),
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

  document.getElementById(breakdownElId).innerHTML = renderStageItemsTable(`${totalLabel} — all metrics`, stage.items);
}

function renderProceed(data) {
  renderStageMetrics(
    data, 'proceed', 'proceedKpis', 'chartProceedShare', 'chartProceedValues', 'proceedBreakdown',
    'Total proceed actions',
  );
}

function renderResult(data) {
  renderStageMetrics(
    data, 'result', 'resultKpis', 'chartResultShare', 'chartResultValues', 'resultBreakdown',
    'Total result outcomes',
  );
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

async function loadMonths() {
  const res = await fetch('/api/combined-funnel/months');
  const data = await res.json();
  state.months = data.months || [];
  state.month = data.defaultMonth || data.latest || (state.months.length ? state.months[state.months.length - 1].key : null);

  const sel = document.getElementById('monthSelect');
  sel.innerHTML = state.months.map((m) =>
    `<option value="${m.key}"${m.key === state.month ? ' selected' : ''}>${m.label}</option>`,
  ).join('');
}

async function loadCombined() {
  if (!state.month) {
    document.getElementById('filterLabel').textContent = 'No data available';
    return;
  }

  document.body.classList.add('is-loading');
  try {
    const res = await fetch(`/api/combined-funnel?month=${encodeURIComponent(state.month)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load');

    document.getElementById('filterLabel').textContent =
      `${data.monthLabel}${data.prevMonthLabel ? ` · vs ${data.prevMonthLabel}` : ''}`;

    renderPipeline(data);
    renderAwareness(data);
    renderConsideration(data);
    renderCommit(data);
    renderProceed(data);
    renderResult(data);
  } catch (err) {
    console.error(err);
    document.getElementById('filterLabel').textContent = `Error: ${err.message}`;
  } finally {
    document.body.classList.remove('is-loading');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  loadLastUpdated();
  await loadMonths();
  await loadCombined();

  document.getElementById('monthSelect').addEventListener('change', (e) => {
    state.month = e.target.value;
    loadCombined();
  });
});
