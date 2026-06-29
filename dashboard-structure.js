/** Dashboard layout, funnel stages, and guide copy for each company. */

const VISA_TYPES = ['Spouse Visa', 'Gijinkoku', 'Tokuteigino', 'Other'];
const BARRIER_TYPES = ['Japanese phone number (CV step)'];

const WORKJAPAN_FUNNEL_STAGES = [
  {
    id: 'awareness',
    number: 1,
    label: 'Awareness',
    question: 'How do job seekers discover WORK JAPAN?',
    summary: 'Social content performance (Instagram, YouTube, Facebook, etc.) and which channels drive users to the website.',
    anchor: 'stage-awareness',
    dataSources: ['Social CSV (Meta / IG exports)', 'Traffic CSV (GA4)'],
    journeyIds: ['awareness'],
    sectionIds: ['section-social'],
  },
  {
    id: 'consideration',
    number: 2,
    label: 'Consideration',
    question: 'Where do users come from, what pages do they view, and where do they drop off?',
    summary: 'Traffic sources, page navigation, job browsing, and the biggest drop-offs before registration.',
    anchor: 'stage-consideration',
    dataSources: ['Traffic CSV', 'Pages CSV', 'Funnel CSV', 'Platform registrations (manual, month-to-date)'],
    journeyIds: ['browse-jobs', 'job-detail'],
    sectionIds: ['section-internal-reporting', 'section-traffic', 'section-pages', 'consideration-dropoffs'],
  },
  {
    id: 'commit',
    number: 3,
    label: 'Commit (CV / Register)',
    question: 'Who registers — and who abandons at CV because of barriers like the Japanese phone number?',
    summary: 'Registration funnel, session quality, platform sign-ups, and conversion barriers (in-Japan vs abroad, visa type).',
    anchor: 'stage-commit',
    dataSources: ['Funnel CSV', 'Platform stats (manual)', 'Customer intelligence (manual)'],
    journeyIds: ['register-apply'],
    sectionIds: ['section-funnel', 'section-platform', 'commit-barriers'],
  },
  {
    id: 'proceed',
    number: 4,
    label: 'Proceed (Apply)',
    question: 'How many registered users actually apply to jobs?',
    summary: 'Application path from homepage → job listings → job detail → register → applicant dashboard, plus monthly application volume.',
    anchor: 'stage-proceed',
    dataSources: ['Pages CSV', 'Applicant stats (manual)'],
    journeyIds: ['seeker-application'],
    sectionIds: ['section-applicants-proceed'],
  },
  {
    id: 'result',
    number: 5,
    label: 'Result',
    question: 'What outcomes do applicants achieve?',
    summary: 'Screening, interviews, selections, and ESP pipeline — the recruitment result stage.',
    anchor: 'stage-result',
    dataSources: ['Applicant stats (manual)'],
    journeyIds: [],
    sectionIds: ['section-applicants-result'],
  },
];

const WORKJAPAN_PILLARS = [
  {
    id: 'employer',
    label: 'Employer Intelligence',
    question: 'How are employers engaging? (Separate from job seekers)',
    summary: 'Employers follow a different journey — hire pages, job posting dashboard, billing. This is not part of the job seeker funnel above.',
    anchor: 'pillar-employer',
    journeyIds: ['employer'],
    note: 'Employer conversion and drop-off tracking is limited to web analytics today. Backend employer metrics can be added via manual entry later.',
  },
  {
    id: 'intelligence',
    label: 'Customer Intelligence',
    question: 'Who are our users and what trends matter right now?',
    summary: 'Nationality, visa type, in-Japan vs abroad, and month-over-month vs 6-month average — a snapshot of what is happening in Japan.',
    anchor: 'pillar-intelligence',
    dataSources: ['Customer intelligence (manual monthly entry)'],
  },
];

const WORKJAPAN_GUIDE = {
  title: 'How to read this dashboard',
  intro: 'This dashboard is organized around the **job seeker funnel** (5 stages) plus two separate areas: **Employer Intelligence** and **Customer Intelligence**. You do not need to click through every tab — use the stage navigator below to jump directly to the question you care about.',
  pillars: [
    {
      title: 'Job seeker funnel (5 stages)',
      body: 'Awareness → Consideration → Commit (CV) → Proceed (Apply) → Result. Each stage groups the metrics that answer one business question.',
    },
    {
      title: 'Employer intelligence (separate)',
      body: 'Employers are a different customer. Their journey (hire pages, job dashboard) is tracked separately and is not mixed into the job seeker funnel.',
    },
    {
      title: 'Customer intelligence',
      body: 'Metadata trends — nationality, visa type, geography, conversion barriers — compared to the last 6-month average. Entered monthly on the upload page.',
    },
    {
      title: 'Weekly CSV data',
      body: 'Four weekly exports power web analytics: Social, Traffic, Pages, and Funnel. Manual monthly entry covers registrations, applications, and intelligence metrics.',
    },
  ],
  dataLegend: [
    { label: 'Weekly CSV', desc: 'Uploaded each week — social, traffic, pages, funnel' },
    { label: 'Manual monthly', desc: 'Platform registrations, applications, customer intelligence' },
    { label: 'Computed', desc: 'Drop-offs and funnel steps calculated from page paths' },
  ],
};

const NYUULY_GUIDE = {
  title: 'How to read this dashboard',
  intro: 'NyuuLy analytics are organized by **customer journey tabs** and four weekly CSV sections. Use the journey tabs to explore awareness, browsing, and conversion paths.',
  pillars: [
    { title: 'Customer journeys', body: 'Tab-based deep dives built from your 4 weekly CSV exports.' },
    { title: 'Weekly CSV sections', body: 'Social, Traffic, Pages, and Funnel — raw data behind the journeys.' },
  ],
  dataLegend: [
    { label: 'Weekly CSV', desc: 'Social, traffic, pages, funnel exports' },
  ],
};

function getDashboardGuide(company) {
  if (company === 'workjapan') {
    return {
      ...WORKJAPAN_GUIDE,
      funnelStages: WORKJAPAN_FUNNEL_STAGES,
      pillars_extra: WORKJAPAN_PILLARS,
    };
  }
  return {
    ...NYUULY_GUIDE,
    funnelStages: [],
    pillars_extra: [],
  };
}

function getFunnelStageForJourney(journeyId, company = 'workjapan') {
  if (company !== 'workjapan') return null;
  return WORKJAPAN_FUNNEL_STAGES.find((s) => s.journeyIds.includes(journeyId)) || null;
}

module.exports = {
  VISA_TYPES,
  BARRIER_TYPES,
  WORKJAPAN_FUNNEL_STAGES,
  WORKJAPAN_PILLARS,
  WORKJAPAN_GUIDE,
  NYUULY_GUIDE,
  getDashboardGuide,
  getFunnelStageForJourney,
};
