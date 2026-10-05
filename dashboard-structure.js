/** Dashboard layout, funnel stages, and guide copy for each company. */

const VISA_TYPES = ['Spouse Visa', 'Gijinkoku', 'Tokuteigino', 'Other'];
const BARRIER_TYPES = ['Japanese phone number (CV step)'];

const WORKJAPAN_FUNNEL_STAGES = [
  {
    id: 'awareness',
    number: 1,
    label: 'Awareness',
    question: 'How do job seekers discover WORK JAPAN?',
    summary: 'Social content performance plus organic search impressions and manual social channel views (Facebook, Instagram, TikTok, YouTube).',
    anchor: 'stage-awareness',
    dataSources: ['Social CSV (Meta / IG exports)', 'Search Console zip (GSC Performance)', 'Social channel views (manual)'],
    journeyIds: ['awareness'],
    sectionIds: ['section-brand-message', 'section-social'],
  },
  {
    id: 'consideration',
    number: 2,
    label: 'Consideration',
    question: 'Where do users come from, what pages do they view, and where do they drop off?',
    summary: 'Total website users (User Acquisition CSV), plus page navigation, job browsing, and drop-offs before registration.',
    anchor: 'stage-consideration',
    dataSources: ['User Acquisition CSV (GA4)', 'Pages CSV', 'Funnel CSV', 'Search Console zip (GSC)', 'Platform registrations (manual, month-to-date)'],
    journeyIds: ['browse-jobs', 'job-detail'],
    sectionIds: ['section-users', 'section-pages', 'consideration-dropoffs'],
  },
  {
    id: 'commit',
    number: 3,
    label: 'Commit (CV / Register)',
    question: 'Who registers — and who abandons at CV because of barriers like the Japanese phone number?',
    summary: 'Registration funnel, platform sign-ups, and conversion barriers (in-Japan vs abroad, visa type).',
    anchor: 'stage-commit',
    dataSources: ['Funnel CSV', 'Platform stats (manual)', 'Customer intelligence (manual)', 'Profile steps (manual)'],
    journeyIds: ['register-apply'],
    sectionIds: ['commit-registration', 'section-workjapan-profile', 'section-platform', 'commit-barriers'],
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

const WORKJAPAN_PILLARS = [];

const NYUULY_FUNNEL_STAGES = [
  {
    id: 'awareness',
    number: 1,
    label: 'Awareness',
    question: 'How do users discover Nyuuly?',
    summary: 'Social content performance plus organic search impressions and manual social channel views.',
    anchor: 'stage-awareness',
    dataSources: ['Social CSV', 'Search Console zip (GSC Performance)', 'Social channel views (manual)'],
    journeyIds: ['awareness'],
    sectionIds: ['section-brand-message', 'section-social', 'section-gsc-awareness'],
  },
  {
    id: 'consideration',
    number: 2,
    label: 'Consideration',
    question: 'Where do users come from and what pages do they view?',
    summary: 'Total website users (User Acquisition CSV), app downloads, and page navigation from GA4 exports.',
    anchor: 'stage-consideration',
    dataSources: ['User Acquisition CSV (GA4)', 'Pages CSV', 'Search Console zip (GSC)', 'App store downloads (manual)'],
    journeyIds: ['browse-jobs', 'job-detail', 'explore-no-action'],
    sectionIds: ['consideration-audience', 'consideration-insights', 'section-users', 'section-pages'],
  },
  {
    id: 'commit',
    number: 3,
    label: 'Commit',
    question: 'How many users subscribe and start Compass?',
    summary: 'Monthly Nyuuly Subscribe and Compass started counts from manual entry.',
    anchor: 'stage-commit',
    dataSources: ['Nyuuly Commit stats (manual monthly)'],
    journeyIds: ['explore-convert', 'nyuuly-application'],
    sectionIds: ['section-nyuuly-commit'],
  },
  {
    id: 'proceed',
    number: 4,
    label: 'Proceed (Uses)',
    question: 'How many users move through Mobile Sim apply and Compass page paths?',
    summary: 'Mobile Sim funnel (Apply → Confirm) from Pages CSV page views; Compass path exploration from active users.',
    anchor: 'stage-proceed-nyuuly',
    dataSources: ['Pages CSV (GA4)'],
    journeyIds: ['welcome-package', 'nyuuly-application'],
    sectionIds: ['section-nyuuly-proceed'],
  },
  {
    id: 'result',
    number: 5,
    label: 'Result',
    question: 'How many users purchase Mobile Sim and Welcome package, fill forms, and submit Ask me requests?',
    summary: 'Monthly Mobile Sim purchased, Welcome package purchased, Form filled, and Ask me request from manual entry.',
    anchor: 'stage-result-nyuuly',
    dataSources: ['Nyuuly Result stats (manual monthly)'],
    journeyIds: ['welcome-package', 'nyuuly-application'],
    sectionIds: ['section-nyuuly-result'],
  },
];

const WORKJAPAN_GUIDE = {
  title: 'How to read this dashboard',
  intro: 'This dashboard is organized around the **job seeker funnel** (5 stages). Use the stage navigator below to jump directly to the question you care about.',
  pillars: [
    {
      title: 'Job seeker funnel (5 stages)',
      body: 'Awareness → Consideration → Commit (CV) → Proceed (Apply) → Result. Each stage groups the metrics that answer one business question.',
    },
    {
      title: 'Weekly CSV data',
      body: 'Four weekly exports power web analytics: Social, User Acquisition, Pages, and Funnel. Manual monthly entry covers registrations, applications, and intelligence metrics.',
    },
  ],
  dataLegend: [
    { label: 'Weekly CSV', desc: 'Uploaded each week — social, user acquisition, pages, funnel' },
    { label: 'Manual monthly', desc: 'Platform registrations, applications, customer intelligence' },
    { label: 'Computed', desc: 'Drop-offs and funnel steps calculated from page paths' },
  ],
};

const NYUULY_GUIDE = {
  title: 'How to read this dashboard',
  intro: 'Nyuuly analytics follow the **Awareness → Consideration → Commit → Proceed (Uses) → Result** funnel. Upload Nyuuly-specific CSVs and manual entries on the upload page — data is kept separate from WORK JAPAN.',
  pillars: [
    {
      title: 'Awareness → Result',
      body: 'Awareness and Consideration use GA4 CSVs. Commit covers Subscribe and Compass started. Proceed (Uses) covers Mobile Sim page flow and Compass path exploration from Pages CSV. Result covers Mobile Sim purchased, Welcome package purchased, Form filled, and Ask me request.',
    },
    {
      title: 'Weekly CSV data',
      body: 'Four weekly exports power web analytics: Social, User Acquisition, Pages, and Funnel. Manual monthly entry covers social channel views, app downloads, Commit, and Result metrics.',
    },
  ],
  dataLegend: [
    { label: 'Weekly CSV', desc: 'Social, user acquisition, pages, funnel exports (Nyuuly company)' },
    { label: 'Manual monthly', desc: 'Social channel views, app downloads, Commit, and Result metrics' },
  ],
};

const GTM_MARKETS = ['nepal', 'vietnam', 'taiwan'];

const GTM_FUNNEL_STAGES = [
  {
    id: 'awareness',
    number: 1,
    label: 'Awareness',
    question: 'How do users discover this market?',
    summary: 'Social content performance, organic search impressions, and manual social channel views.',
    anchor: 'stage-awareness',
    dataSources: ['Social CSV', 'Search Console zip (GSC Performance)', 'Social channel views (manual)'],
    journeyIds: ['awareness'],
    sectionIds: ['section-brand-message', 'section-social', 'section-gsc-awareness'],
  },
  {
    id: 'consideration',
    number: 2,
    label: 'Consideration',
    question: 'Where do users come from and what pages do they view?',
    summary: 'Website users from GA4 User Acquisition, page navigation, and funnel drop-offs.',
    anchor: 'stage-consideration',
    dataSources: ['User Acquisition CSV (GA4)', 'Pages CSV', 'Funnel CSV', 'Search Console zip (GSC)', 'App downloads (manual)'],
    journeyIds: ['browse-jobs', 'job-detail'],
    sectionIds: ['section-users', 'section-pages', 'considerationInsights'],
  },
];

const GTM_GUIDE = {
  title: 'How to read this dashboard',
  intro: 'GTM market analytics follow **Awareness → Consideration**. Upload monthly CSVs and manual entries on the upload page — data is kept separate from Nyuuly and WORK JAPAN.',
  pillars: [
    {
      title: 'Awareness → Consideration',
      body: 'Awareness covers social content, organic search, and manual channel views. Consideration covers website users, page navigation, and where users drop off before converting.',
    },
    {
      title: 'Monthly CSV data',
      body: 'Five uploads per month: Social, Funnel, User Acquisition, Pages, and Search Console. Manual entry covers social channel views, brand message, and app downloads.',
    },
  ],
  dataLegend: [
    { label: 'Monthly CSV', desc: 'Social, funnel, user acquisition, pages, GSC zip' },
    { label: 'Manual monthly', desc: 'Social channel views, brand message, app downloads' },
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
  if (GTM_MARKETS.includes(company)) {
    return {
      ...GTM_GUIDE,
      funnelStages: GTM_FUNNEL_STAGES,
      pillars_extra: [],
    };
  }
  return {
    ...NYUULY_GUIDE,
    funnelStages: NYUULY_FUNNEL_STAGES,
    pillars_extra: [],
  };
}

function getFunnelStageForJourney(journeyId, company = 'workjapan') {
  let stages = NYUULY_FUNNEL_STAGES;
  if (company === 'workjapan') stages = WORKJAPAN_FUNNEL_STAGES;
  else if (GTM_MARKETS.includes(company)) stages = GTM_FUNNEL_STAGES;
  return stages.find((s) => s.journeyIds.includes(journeyId)) || null;
}

module.exports = {
  VISA_TYPES,
  BARRIER_TYPES,
  WORKJAPAN_FUNNEL_STAGES,
  NYUULY_FUNNEL_STAGES,
  GTM_FUNNEL_STAGES,
  GTM_MARKETS,
  WORKJAPAN_PILLARS,
  WORKJAPAN_GUIDE,
  NYUULY_GUIDE,
  GTM_GUIDE,
  getDashboardGuide,
  getFunnelStageForJourney,
};
