(function initOnboardingTour() {
  const STORAGE_KEY = 'analyticsDashboardTourV1';

  const NAV_STEPS = [
    {
      selector: 'a[href="/weekly"].nav-pill',
      title: 'Weekly Brief',
      body: 'Start here for weekly meetings. See the top KPI declines to fix and the biggest gains vs last month — for both WORK JAPAN and Nyuuly.',
    },
    {
      selector: 'a[href="/combined"].nav-pill',
      title: 'Combined',
      body: 'View Nyuuly and WORK JAPAN together in one five-stage funnel. Useful when you want a single picture of both businesses.',
    },
    {
      selector: 'a[href="/"].nav-pill, a[href="/index.html"].nav-pill',
      title: 'Dashboard',
      body: 'Deep dive by company. Explore Awareness → Consideration → Commit → Proceed → Result with charts, tables, and month-over-month deltas.',
    },
    {
      selector: 'a[href="/campaigns"].nav-pill',
      title: 'Campaigns',
      body: 'Track paid and digital campaigns — spend, clicks, results, and trends by placement and UTM code.',
    },
  ];

  const PAGE_STEPS = {
    '/': [
      {
        selector: '#companyTabs',
        title: 'Pick a company',
        body: 'Switch between WORK JAPAN and Nyuuly. Metrics, funnel stages, and upload fields change based on the company you select.',
      },
      {
        selector: '#monthSelect',
        title: 'Pick a month',
        body: 'All KPIs and charts follow this month. Compare performance month-over-month using the same selector everywhere.',
      },
      {
        selector: '#section-funnel-overview',
        title: 'Funnel at a glance',
        body: 'Five stages in one strip: Awareness, Consideration, Commit, Proceed, and Result. Each card shows this month’s total and how it moved from the previous step.',
      },
      {
        selector: '#funnelNav',
        title: 'Jump to a stage',
        body: 'Use this navigator to scroll straight to Awareness, Consideration, Commit, Proceed, or Result without hunting through the page.',
      },
      {
        selector: '#stage-awareness',
        title: 'Awareness sections',
        body: 'Social media, organic search (GSC), and brand message live here — how people discover the brand.',
      },
      {
        selector: '#stage-consideration',
        title: 'Consideration sections',
        body: 'Website users, app downloads, page paths, and drop-offs — where traffic comes from and how people browse.',
      },
      {
        selector: '.nav-pill-upload',
        title: 'Upload data',
        body: 'Add or update monthly CSV exports and manual metrics. New uploads power the dashboard on the next refresh.',
      },
    ],
    '/weekly': [
      {
        selector: '.weekly-section-attention',
        title: 'Needs attention',
        body: 'Red highlights show the five biggest KPI drops per company. Each line links to the detailed dashboard section.',
      },
      {
        selector: '.weekly-section-wins',
        title: 'What\'s improving',
        body: 'Green highlights celebrate the five strongest month-over-month gains. Use Print / PDF to share in meetings.',
      },
    ],
    '/combined': [
      {
        selector: '#combinedPipeline',
        title: 'Combined funnel',
        body: 'Both companies in one view. Compare Awareness through Result and see WORK JAPAN vs Nyuuly contribution.',
      },
    ],
    '/campaigns': [
      {
        selector: '#campaignKpis',
        title: 'Campaign KPIs',
        body: 'Spend, clicks, results, and efficiency metrics for the selected company and month.',
      },
    ],
    '/upload': [
      {
        selector: '.upload-header',
        title: 'Upload hub',
        body: 'Upload weekly CSV files and enter manual monthly metrics. Pick the company first — WORK JAPAN and Nyuuly have different fields.',
      },
    ],
  };

  let root;
  let spotlight;
  let popover;
  let steps = [];
  let index = 0;

  function pathnameKey() {
    const p = window.location.pathname.replace(/\/index\.html$/, '') || '/';
    return p;
  }

  function buildSteps() {
    const path = pathnameKey();
    const pageSteps = PAGE_STEPS[path] || [];
    return [...NAV_STEPS, ...pageSteps];
  }

  function createTourDom() {
    if (document.getElementById('onboardingTour')) return;

    root = document.createElement('div');
    root.id = 'onboardingTour';
    root.className = 'tour-root tour-hidden';
    root.innerHTML = `
      <div class="tour-backdrop" aria-hidden="true"></div>
      <div class="tour-spotlight" aria-hidden="true"></div>
      <div class="tour-popover" role="dialog" aria-modal="true" aria-labelledby="tourTitle">
        <div class="tour-popover-top">
          <span class="tour-step-count" id="tourStepCount"></span>
          <button type="button" class="tour-skip" id="tourSkipBtn">Skip tour</button>
        </div>
        <h3 class="tour-title" id="tourTitle"></h3>
        <p class="tour-body" id="tourBody"></p>
        <div class="tour-popover-actions">
          <button type="button" class="tour-back" id="tourBackBtn">Back</button>
          <button type="button" class="tour-next" id="tourNextBtn">Next</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    spotlight = root.querySelector('.tour-spotlight');
    popover = root.querySelector('.tour-popover');

    root.querySelector('#tourSkipBtn').addEventListener('click', finishTour);
    root.querySelector('#tourBackBtn').addEventListener('click', prevStep);
    root.querySelector('#tourNextBtn').addEventListener('click', nextStep);
    root.querySelector('.tour-backdrop').addEventListener('click', finishTour);

    document.addEventListener('keydown', (e) => {
      if (root.classList.contains('tour-hidden')) return;
      if (e.key === 'Escape') finishTour();
      if (e.key === 'ArrowRight') nextStep();
      if (e.key === 'ArrowLeft') prevStep();
    });

    window.addEventListener('resize', () => {
      if (!root.classList.contains('tour-hidden')) showStep(index);
    });
  }

  function addRestartButton() {
    document.querySelectorAll('.nav-actions').forEach((actions) => {
      if (actions.querySelector('.tour-restart-btn')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tour-restart-btn';
      btn.textContent = 'Tour';
      btn.title = 'Replay the guided tour';
      btn.addEventListener('click', () => startTour(true));
      const upload = actions.querySelector('.nav-pill-upload');
      if (upload) actions.insertBefore(btn, upload);
      else actions.prepend(btn);
    });
  }

  function findTarget(selector) {
    if (selector.includes(',')) {
      const parts = selector.split(',').map((s) => s.trim());
      for (const part of parts) {
        const el = document.querySelector(part);
        if (el) return el;
      }
      return null;
    }
    return document.querySelector(selector);
  }

  function positionTour(target) {
    const pad = 10;
    const rect = target.getBoundingClientRect();
    const scrollY = window.scrollY || document.documentElement.scrollTop;

    spotlight.style.display = 'block';
    spotlight.style.top = `${Math.max(8, rect.top - pad)}px`;
    spotlight.style.left = `${Math.max(8, rect.left - pad)}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;

    const popRect = popover.getBoundingClientRect();
    let top = rect.bottom + 16;
    let left = Math.min(
      Math.max(16, rect.left),
      window.innerWidth - popRect.width - 16,
    );

    if (top + popover.offsetHeight > window.innerHeight - 16) {
      top = Math.max(16, rect.top - popover.offsetHeight - 16);
    }

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  function showStep(i) {
    const step = steps[i];
    const target = findTarget(step.selector);

    document.getElementById('tourTitle').textContent = step.title;
    document.getElementById('tourBody').textContent = step.body;
    document.getElementById('tourStepCount').textContent = `Step ${i + 1} of ${steps.length}`;

    const backBtn = document.getElementById('tourBackBtn');
    const nextBtn = document.getElementById('tourNextBtn');
    backBtn.disabled = i === 0;
    nextBtn.textContent = i === steps.length - 1 ? 'Done' : 'Next';

    if (!target) {
      spotlight.style.display = 'none';
      popover.style.top = '50%';
      popover.style.left = '50%';
      popover.style.transform = 'translate(-50%, -50%)';
      return;
    }

    popover.style.transform = 'none';
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    window.setTimeout(() => positionTour(target), 320);
  }

  function startTour(force) {
    if (!force && localStorage.getItem(STORAGE_KEY) === 'done') return;

    createTourDom();
    steps = buildSteps();
    index = 0;
    root.classList.remove('tour-hidden');
    document.body.classList.add('tour-active');
    showStep(index);
  }

  function finishTour() {
    if (!root) return;
    root.classList.add('tour-hidden');
    document.body.classList.remove('tour-active');
    localStorage.setItem(STORAGE_KEY, 'done');
  }

  function nextStep() {
    if (index >= steps.length - 1) {
      finishTour();
      return;
    }
    index += 1;
    showStep(index);
  }

  function prevStep() {
    if (index <= 0) return;
    index -= 1;
    showStep(index);
  }

  function maybeDelayedStart() {
    const path = pathnameKey();
    const delay = path === '/' ? 1200 : 200;
    window.setTimeout(() => startTour(false), delay);
  }

  document.addEventListener('DOMContentLoaded', () => {
    createTourDom();
    addRestartButton();
    if (!localStorage.getItem(STORAGE_KEY)) {
      maybeDelayedStart();
    }
  });

  window.AnalyticsTour = { start: () => startTour(true) };
})();
