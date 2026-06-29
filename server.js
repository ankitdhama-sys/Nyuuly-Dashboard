const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { parse } = require('csv-parse/sync');
const { db, initDb } = require('./database/db');
const {
  prorateTrafficRows,
  proratePagesRows,
  prorateFunnelRows,
  trafficKpisFromRows,
} = require('./database/date-filter');
const {
  FILE_TYPES,
  FILE_TYPE_LABELS,
  COMPANY_LABELS,
  getJourneys,
  resolveCompany,
  aggregatePagesForJourney,
  aggregateJobDetails,
  getTopJobCategories,
  buildApplicationFunnel,
  buildGa4FunnelSteps,
  getLandingPages,
  isJobDetailPage,
  buildConsiderationInsights,
} = require('./journey-config');
const {
  VISA_TYPES,
  BARRIER_TYPES,
  getDashboardGuide,
} = require('./dashboard-structure');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

initDb();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: UPLOADS_DIR });

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  message: { error: 'Too many uploads. Max 40 per hour.' },
});

const MANUAL_FILE_TYPES = ['platform', 'applicants', 'geo', 'visa', 'nationality', 'barriers'];

const MONTH_NAME_TO_NUM = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function detectFileType(content) {
  const lines = content.split('\n').slice(0, 10).join('\n');
  if (/UNIQUE APPLICANTS/i.test(lines) && /SCREENING PASSES/i.test(lines)) {
    return 'applicants';
  }
  if (/MONTH.*PLATFORM.*REGISTRATION/i.test(lines) || /PLATFORM.*REGISTRATION.*ACTIVE/i.test(lines)) {
    return 'platform';
  }
  if (lines.includes('"Post ID"') || lines.includes('Post ID')) return 'social';
  if (lines.includes('Funnel') || lines.includes('Step,Device category,Active users')) return 'funnel';
  if (lines.includes('Session primary channel group')) return 'traffic';
  if (lines.includes('Page path and screen class')) return 'pages';
  return null;
}

function parseMonthLabel(val) {
  const s = String(val || '').trim();
  if (!s) return null;

  let match = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return {
      year,
      month,
      month_label: `${year} ${monthNames[month - 1] || month}`,
    };
  }

  match = s.match(/^(\d{4})\s+([A-Za-z]{3,9})$/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = MONTH_NAME_TO_NUM[match[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return { year, month, month_label: s };
  }

  match = s.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (match) {
    const year = parseInt(match[2], 10);
    const month = MONTH_NAME_TO_NUM[match[1].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return { year, month, month_label: `${year} ${match[1].slice(0, 3)}` };
  }

  return null;
}

function normalizePlatform(val) {
  const p = String(val || '').trim();
  if (!p) return p;
  const lower = p.toLowerCase();
  if (lower === 'web') return 'Web';
  if (lower === 'android') return 'Android';
  if (lower === 'ios') return 'iOS';
  return p;
}

function getRowValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
    const found = Object.keys(row).find((k) => k.trim().toLowerCase() === key.toLowerCase());
    if (found && row[found] !== undefined && row[found] !== '') return row[found];
  }
  return null;
}

function parseNum(val) {
  if (val === null || val === undefined || val === '' || val === '-') return 0;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function parseNullableNum(val) {
  if (val === null || val === undefined || val === '' || val === '-') return null;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function formatGa4Date(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return s;
}

function normalizeDevice(device) {
  if (!device) return device;
  const d = device.trim();
  if (d.toLowerCase() === 'total') return 'Total';
  if (d.toLowerCase() === 'desktop') return 'Desktop';
  if (d.toLowerCase() === 'mobile') return 'Mobile';
  if (d.toLowerCase() === 'tablet') return 'Tablet';
  return d;
}

function parsePublishTime(val) {
  if (!val) return null;
  const match = String(val).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!match) return val;
  const [, mm, dd, yyyy, hh, min] = match;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')} ${hh.padStart(2, '0')}:${min}:00`;
}

function parseSocialCsv(content, company) {
  const rows = parse(content, {
    columns: true,
    relax_column_count: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
  });

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO social_posts
    (company, post_id, account_name, account_username, description, post_type, publish_time, permalink,
     views, reach, likes, shares, follows, comments, saves)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  let skipped = 0;

  for (const row of rows) {
    const postId = row['Post ID'] || row['post_id'];
    if (!postId) continue;

    const result = stmt.run(
      company,
      String(postId),
      row['Account name'] || '',
      row['Account username'] || '',
      row['Description'] || '',
      row['Post type'] || '',
      parsePublishTime(row['Publish time']),
      row['Permalink'] || '',
      parseNum(row['Views']),
      parseNum(row['Reach']),
      parseNum(row['Likes']),
      parseNum(row['Shares']),
      parseNum(row['Follows']),
      parseNum(row['Comments']),
      parseNum(row['Saves'])
    );

    if (result.changes > 0) added++;
    else skipped++;
  }

  return { added, skipped };
}

function parseFunnelCsv(content, company) {
  const lines = content.split('\n');
  let dateRange = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/#\s*(\d{8})-(\d{8})/);
      if (match) {
        dateRange = `${match[1]}-${match[2]}`;
      }
    }
  }

  const dataLines = lines.filter((l) => !l.trim().startsWith('#') && l.trim() !== '');
  const csvContent = dataLines.join('\n');
  const rows = parse(csvContent, { columns: true, skip_empty_lines: true, bom: true });

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO funnel_data
    (company, date_range, step, device_category, active_users, completion_rate, abandonments, abandonment_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  let skipped = 0;

  for (const row of rows) {
    const step = row['Step'];
    if (!step) continue;

    const result = stmt.run(
      company,
      dateRange,
      step,
      normalizeDevice(row['Device category']),
      parseNum(row['Active users']),
      parseNullableNum(row['Completion rate']) ?? 0,
      parseNum(row['Abandonments']),
      parseNullableNum(row['Abandonment rate']) ?? 0
    );

    if (result.changes > 0) added++;
    else skipped++;
  }

  return { added, skipped };
}

function parseGa4Header(content) {
  const lines = content.split('\n');
  let startDate = null;
  let endDate = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# Start date:')) {
      startDate = formatGa4Date(trimmed.replace('# Start date:', '').trim());
    }
    if (trimmed.startsWith('# End date:')) {
      endDate = formatGa4Date(trimmed.replace('# End date:', '').trim());
    }
  }

  return { startDate, endDate };
}

function getTrafficChannel(row) {
  const key = Object.keys(row).find((k) => k.toLowerCase().includes('session primary channel group'));
  return key ? row[key] : null;
}

function parseTrafficCsv(content, company) {
  const { startDate, endDate } = parseGa4Header(content);
  const lines = content.split('\n');
  const dataLines = lines.filter((l) => !l.trim().startsWith('#') && l.trim() !== '');
  const rows = parse(dataLines.join('\n'), { columns: true, skip_empty_lines: true, bom: true });

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO traffic_acquisition
    (company, start_date, end_date, channel_group, sessions, engaged_sessions, engagement_rate,
     avg_engagement_time, events_per_session, event_count, key_events, session_key_event_rate, total_revenue)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  let skipped = 0;

  for (const row of rows) {
    const channel = getTrafficChannel(row);
    if (!channel) continue;

    const result = stmt.run(
      company,
      startDate,
      endDate,
      channel,
      parseNum(row['Sessions']),
      parseNum(row['Engaged sessions']),
      parseNum(row['Engagement rate']),
      parseNum(row['Average engagement time per session']),
      parseNum(row['Events per session']),
      parseNum(row['Event count']),
      parseNum(row['Key events']),
      parseNum(row['Session key event rate']),
      parseNum(row['Total revenue'])
    );

    if (result.changes > 0) added++;
    else skipped++;
  }

  return { added, skipped };
}

function parsePagesCsv(content, company) {
  const { startDate, endDate } = parseGa4Header(content);
  const lines = content.split('\n');
  const dataLines = lines.filter((l) => !l.trim().startsWith('#') && l.trim() !== '');
  const rows = parse(dataLines.join('\n'), { columns: true, skip_empty_lines: true, bom: true });

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO pages_screens
    (company, start_date, end_date, page_path, views, active_users, views_per_user,
     avg_engagement_time, event_count, key_events, total_revenue)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  let skipped = 0;

  for (const row of rows) {
    const pagePath = row['Page path and screen class'];
    if (!pagePath) continue;

    const result = stmt.run(
      company,
      startDate,
      endDate,
      pagePath,
      parseNum(row['Views']),
      parseNum(row['Active users']),
      parseNum(row['Views per active user']),
      parseNum(row['Average engagement time per active user']),
      parseNum(row['Event count']),
      parseNum(row['Key events']),
      parseNum(row['Total revenue'])
    );

    if (result.changes > 0) added++;
    else skipped++;
  }

  return { added, skipped };
}

function parsePlatformCsv(content, company) {
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  });

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO platform_stats
    (company, month_label, year, month, platform, registrations, active_users)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  let skipped = 0;

  for (const row of rows) {
    const monthVal = getRowValue(row, ['MONTH', 'Month', 'month']);
    const platform = normalizePlatform(getRowValue(row, ['PLATFORM', 'Platform', 'platform']));
    if (!monthVal || !platform) continue;

    const parsedMonth = parseMonthLabel(monthVal);
    if (!parsedMonth) {
      skipped++;
      continue;
    }

    const registrations = parseNum(getRowValue(row, ['REGISTRATION', 'REGISTRATIONS', 'Registration', 'registrations']));
    const activeUsers = parseNum(getRowValue(row, ['ACTIVE', 'ACTIVE_USERS', 'Active', 'active_users']));

    stmt.run(
      company,
      parsedMonth.month_label,
      parsedMonth.year,
      parsedMonth.month,
      platform,
      registrations,
      activeUsers
    );
    added++;
  }

  return { added, skipped };
}

function parseApplicantsCsv(content, company) {
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  });

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO applicant_stats
    (company, month_label, year, month, unique_applicants, screening_passes,
     total_applications, interviews_fixed, remaining_esp, selected)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  let skipped = 0;

  for (const row of rows) {
    const monthVal = getRowValue(row, ['MONTH', 'Month', 'month']);
    if (!monthVal) continue;

    const parsedMonth = parseMonthLabel(monthVal);
    if (!parsedMonth) {
      skipped++;
      continue;
    }

    stmt.run(
      company,
      parsedMonth.month_label,
      parsedMonth.year,
      parsedMonth.month,
      parseNum(getRowValue(row, ['UNIQUE APPLICANTS', 'Unique Applicants', 'unique_applicants'])),
      parseNum(getRowValue(row, ['SCREENING PASSES', 'Screening Passes', 'screening_passes'])),
      parseNum(getRowValue(row, ['TOTAL APPLICATIONS', 'Total Applications', 'total_applications'])),
      parseNum(getRowValue(row, ['INTERVIEWS FIXED', 'Interviews Fixed', 'interviews_fixed'])),
      parseNum(getRowValue(row, ['REMAINING ESP', 'Remaining ESP', 'remaining_esp'])),
      parseNum(getRowValue(row, ['SELECTED', 'Selected', 'selected']))
    );
    added++;
  }

  return { added, skipped };
}

function parseCsv(content, fileType, company) {
  switch (fileType) {
    case 'social': return parseSocialCsv(content, company);
    case 'funnel': return parseFunnelCsv(content, company);
    case 'traffic': return parseTrafficCsv(content, company);
    case 'pages': return parsePagesCsv(content, company);
    case 'platform': return parsePlatformCsv(content, company);
    case 'applicants': return parseApplicantsCsv(content, company);
    default: throw new Error('Unknown file type');
  }
}

function companyFilter(company, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (!company || company === 'all') return { clause: '', params: [] };
  return { clause: ` AND ${prefix}company = ?`, params: [company] };
}

function dateToYmd(dateStr) {
  if (!dateStr) return null;
  return dateStr.split(' ')[0];
}

function buildSocialQuery(company, start, end) {
  let clause = 'WHERE 1=1';
  const params = [];

  if (company && company !== 'all') {
    clause += ' AND company = ?';
    params.push(company);
  }
  if (start) {
    clause += ' AND date(publish_time) >= ?';
    params.push(start);
  }
  if (end) {
    clause += ' AND date(publish_time) <= ?';
    params.push(end);
  }

  return { clause, params };
}

function buildGa4DateQuery(company, start, end, alias = '') {
  let clause = 'WHERE 1=1';
  const params = [];
  const p = alias ? `${alias}.` : '';

  if (company && company !== 'all') {
    clause += ` AND ${p}company = ?`;
    params.push(company);
  }
  if (start && end) {
    clause += ` AND ${p}start_date <= ? AND ${p}end_date >= ?`;
    params.push(end, start);
  }

  return { clause, params };
}

function buildPlatformQuery(company, start, end) {
  return buildMonthlyStatsQuery(company, start, end);
}

function buildMonthlyStatsQuery(company, start, end) {
  let clause = 'WHERE 1=1';
  const params = [];

  if (company && company !== 'all') {
    clause += ' AND company = ?';
    params.push(company);
  }

  if (start && end) {
    clause += ` AND date(printf('%04d-%02d-01', year, month)) <= date(?)
      AND date(printf('%04d-%02d-01', year, month), '+1 month', '-1 day') >= date(?)`;
    params.push(end, start);
  }

  return { clause, params };
}

function logUpload(filename, company, fileType, rowsAdded, rowsSkipped) {
  db.prepare(`
    INSERT INTO upload_history (filename, company, file_type, rows_added, rows_skipped)
    VALUES (?, ?, ?, ?, ?)
  `).run(filename, company, fileType, rowsAdded, rowsSkipped);
}

function savePlatformRow(company, parsedMonth, platform, registrations, activeUsers) {
  db.prepare(`
    INSERT OR REPLACE INTO platform_stats
    (company, month_label, year, month, platform, registrations, active_users)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    normalizePlatform(platform),
    parseNum(registrations),
    parseNum(activeUsers)
  );
}

function saveApplicantRow(company, parsedMonth, data) {
  db.prepare(`
    INSERT OR REPLACE INTO applicant_stats
    (company, month_label, year, month, unique_applicants, screening_passes,
     total_applications, interviews_fixed, remaining_esp, selected)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    parseNum(data.unique_applicants),
    parseNum(data.screening_passes),
    parseNum(data.total_applications),
    parseNum(data.interviews_fixed),
    parseNum(data.remaining_esp),
    parseNum(data.selected)
  );
}

function getManualDataStatus(company) {
  const platformRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM platform_stats WHERE company = ?
  `).get(company);

  const applicantRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM applicant_stats WHERE company = ?
  `).get(company);

  const geoRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM audience_geo_stats WHERE company = ?
  `).get(company);

  const visaRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM visa_stats WHERE company = ?
  `).get(company);

  const nationalityRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM nationality_stats WHERE company = ?
  `).get(company);

  const barrierRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM barrier_stats WHERE company = ?
  `).get(company);

  const statusBlock = (rows) => ({
    uploaded: rows.count > 0,
    rowsAdded: rows.count,
    latestMonth: rows.latestMonth,
    uploadedAt: rows.lastUpdated,
  });

  return {
    platform: statusBlock(platformRows),
    applicants: statusBlock(applicantRows),
    geo: statusBlock(geoRows),
    visa: statusBlock(visaRows),
    nationality: statusBlock(nationalityRows),
    barriers: statusBlock(barrierRows),
  };
}

function saveGeoRow(company, parsedMonth, data) {
  db.prepare(`
    INSERT OR REPLACE INTO audience_geo_stats
    (company, month_label, year, month, in_japan_visitors, out_japan_visitors,
     in_japan_registrations, out_japan_registrations)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    parseNum(data.in_japan_visitors),
    parseNum(data.out_japan_visitors),
    parseNum(data.in_japan_registrations),
    parseNum(data.out_japan_registrations)
  );
}

function saveVisaRow(company, parsedMonth, visaType, data) {
  db.prepare(`
    INSERT OR REPLACE INTO visa_stats
    (company, month_label, year, month, visa_type, registrations, abandonments, applications)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    visaType,
    parseNum(data.registrations),
    parseNum(data.abandonments),
    parseNum(data.applications)
  );
}

function saveNationalityRow(company, parsedMonth, nationality, visitors, registrations) {
  db.prepare(`
    INSERT OR REPLACE INTO nationality_stats
    (company, month_label, year, month, nationality, visitors, registrations)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    String(nationality || '').trim(),
    parseNum(visitors),
    parseNum(registrations)
  );
}

function saveBarrierRow(company, parsedMonth, barrierName, usersReached, usersDropped) {
  db.prepare(`
    INSERT OR REPLACE INTO barrier_stats
    (company, month_label, year, month, barrier_name, users_reached, users_dropped)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    barrierName,
    parseNum(usersReached),
    parseNum(usersDropped)
  );
}

function monthSortKey(row) {
  return (row.year || 0) * 12 + (row.month || 0);
}

function computeSixMonthAvg(rows, valueFn, excludeLatest = true) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => monthSortKey(a) - monthSortKey(b));
  const pool = excludeLatest && sorted.length > 1 ? sorted.slice(0, -1) : sorted;
  const window = pool.slice(-6);
  if (!window.length) return null;
  const sum = window.reduce((s, r) => s + valueFn(r), 0);
  return Math.round((sum / window.length) * 10) / 10;
}

function pctChange(current, average) {
  if (average == null || average === 0) return null;
  return Math.round(((current - average) / average) * 1000) / 10;
}

// --- Routes ---

app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.post('/api/upload', uploadLimiter, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const company = req.body.company;
    if (!company || !['nyuuly', 'workjapan'].includes(company)) {
      return res.status(400).json({ error: 'Invalid company. Use nyuuly or workjapan.' });
    }

    const expectedType = req.body.expectedType;
    if (expectedType && !FILE_TYPES.includes(expectedType) && !MANUAL_FILE_TYPES.includes(expectedType)) {
      return res.status(400).json({ error: 'Invalid expected file type' });
    }

    const content = fs.readFileSync(req.file.path, 'utf-8');
    const fileType = detectFileType(content);

    if (!fileType) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Could not detect CSV file type' });
    }

    if (expectedType && fileType !== expectedType) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: `Wrong file type. This slot expects ${FILE_TYPE_LABELS[expectedType]}, but the file looks like ${FILE_TYPE_LABELS[fileType]}.`,
        detectedType: fileType,
        expectedType,
      });
    }

    const { added, skipped } = parseCsv(content, fileType, company);
    logUpload(req.file.originalname, company, fileType, added, skipped);
    fs.unlinkSync(req.file.path);

    res.json({
      rowsAdded: added,
      rowsSkipped: skipped,
      fileType,
      company,
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual/platform', uploadLimiter, (req, res) => {
  try {
    const { company, month, platforms } = req.body;
    if (company !== 'workjapan') {
      return res.status(400).json({ error: 'Platform data entry is only available for WORK JAPAN' });
    }
    if (!month) return res.status(400).json({ error: 'Month is required' });
    if (!Array.isArray(platforms) || !platforms.length) {
      return res.status(400).json({ error: 'At least one platform row is required' });
    }

    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });

    let saved = 0;
    for (const row of platforms) {
      if (!row.platform) continue;
      savePlatformRow(company, parsedMonth, row.platform, row.registrations, row.active_users);
      saved++;
    }

    if (!saved) return res.status(400).json({ error: 'No valid platform rows to save' });

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'platform', saved, 0);
    res.json({ success: true, rowsAdded: saved, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual/applicants', uploadLimiter, (req, res) => {
  try {
    const { company, month, unique_applicants, screening_passes, total_applications,
      interviews_fixed, remaining_esp, selected } = req.body;

    if (company !== 'workjapan') {
      return res.status(400).json({ error: 'Applicant data entry is only available for WORK JAPAN' });
    }
    if (!month) return res.status(400).json({ error: 'Month is required' });

    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });

    saveApplicantRow(company, parsedMonth, {
      unique_applicants,
      screening_passes,
      total_applications,
      interviews_fixed,
      remaining_esp,
      selected,
    });

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'applicants', 1, 0);
    res.json({ success: true, rowsAdded: 1, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/social', (req, res) => {
  const { company, start, end } = req.query;
  const { clause, params } = buildSocialQuery(company, start, end);

  const posts = db.prepare(`SELECT * FROM social_posts ${clause} ORDER BY publish_time DESC`).all(...params);

  const kpis = db.prepare(`
    SELECT
      COALESCE(SUM(views), 0) as totalViews,
      COALESCE(SUM(reach), 0) as totalReach,
      COALESCE(SUM(likes), 0) as totalLikes,
      COALESCE(SUM(likes + comments + shares + saves), 0) as totalEngagement
    FROM social_posts ${clause}
  `).get(...params);

  const timeSeries = db.prepare(`
    SELECT date(publish_time) as date, company,
      SUM(views) as views, SUM(reach) as reach
    FROM social_posts ${clause}
    GROUP BY date(publish_time), company
    ORDER BY date
  `).all(...params);

  const topPosts = db.prepare(`
    SELECT *, (likes + comments + shares + saves) as engagement,
      CASE WHEN reach > 0 THEN ROUND(CAST(likes + comments + shares + saves AS REAL) / reach * 100, 2) ELSE 0 END as engagement_rate
    FROM social_posts ${clause}
    ORDER BY views DESC
    LIMIT 10
  `).all(...params);

  const postTypes = db.prepare(`
    SELECT post_type, COUNT(*) as count
    FROM social_posts ${clause}
    GROUP BY post_type
    ORDER BY count DESC
  `).all(...params);

  const byAccount = db.prepare(`
    SELECT
      COALESCE(NULLIF(account_name, ''), NULLIF(account_username, ''), 'Unknown') as account,
      account_username,
      COUNT(*) as posts,
      COALESCE(SUM(views), 0) as views,
      COALESCE(SUM(reach), 0) as reach,
      COALESCE(SUM(likes + comments + shares + saves), 0) as engagement
    FROM social_posts ${clause}
    GROUP BY account_username, account_name
    ORDER BY views DESC
  `).all(...params);

  const allPosts = db.prepare(`
    SELECT *, (likes + comments + shares + saves) as engagement,
      CASE WHEN reach > 0 THEN ROUND(CAST(likes + comments + shares + saves AS REAL) / reach * 100, 2) ELSE 0 END as engagement_rate
    FROM social_posts ${clause}
    ORDER BY views DESC
  `).all(...params);

  res.json({ kpis, timeSeries, topPosts, postTypes, byAccount, posts: allPosts, filter: { company, start, end } });
});

app.get('/api/funnel', (req, res) => {
  const { company, start, end } = req.query;
  let clause = 'WHERE 1=1';
  const params = [];

  if (company && company !== 'all') {
    clause += ' AND company = ?';
    params.push(company);
  }

  if (start && end) {
    const startCompact = start.replace(/-/g, '');
    const endCompact = end.replace(/-/g, '');
    clause += ` AND (
      (substr(date_range, 1, 8) <= ? AND substr(date_range, 10, 8) >= ?)
      OR date_range IS NULL
    )`;
    params.push(endCompact, startCompact);
  }

  const rawRows = db.prepare(`SELECT * FROM funnel_data ${clause} ORDER BY step, device_category`).all(...params);
  const rows = start && end ? prorateFunnelRows(rawRows, start, end) : rawRows;

  const step1Devices = rows.filter(
    (r) => r.step && r.step.includes('First open') && r.device_category !== 'Total'
  );

  res.json({ rows, step1Devices, filter: { company, start, end } });
});

app.get('/api/traffic', (req, res) => {
  const { company, start, end } = req.query;
  const { clause, params } = buildGa4DateQuery(company, start, end);

  const rawRows = db.prepare(`SELECT * FROM traffic_acquisition ${clause} ORDER BY sessions DESC`).all(...params);
  const rows = start && end ? prorateTrafficRows(rawRows, start, end) : rawRows;
  const kpis = trafficKpisFromRows(rows);

  res.json({ rows, kpis, filter: { company, start, end } });
});

app.get('/api/pages', (req, res) => {
  const { company, start, end } = req.query;
  const { clause, params } = buildGa4DateQuery(company, start, end);

  const rawRows = db.prepare(`SELECT * FROM pages_screens ${clause} ORDER BY views DESC`).all(...params);
  const rows = start && end ? proratePagesRows(rawRows, start, end) : rawRows;

  res.json({ rows, filter: { company, start, end } });
});

app.get('/api/platform-stats', (req, res) => {
  const { company, start, end } = req.query;
  const { clause, params } = buildPlatformQuery(company, start, end);

  const rows = db.prepare(`
    SELECT * FROM platform_stats ${clause}
    ORDER BY year, month, platform
  `).all(...params);

  const kpis = db.prepare(`
    SELECT
      COALESCE(SUM(registrations), 0) as totalRegistrations,
      COALESCE(SUM(active_users), 0) as totalActiveUsers
    FROM platform_stats ${clause}
  `).get(...params);

  const months = [...new Set(rows.map((r) => r.month_label))].sort((a, b) => {
    const ra = rows.find((r) => r.month_label === a);
    const rb = rows.find((r) => r.month_label === b);
    return (ra.year * 12 + ra.month) - (rb.year * 12 + rb.month);
  });

  const platforms = [...new Set(rows.map((r) => r.platform))].sort();

  const byMonth = months.map((monthLabel) => {
    const monthRows = rows.filter((r) => r.month_label === monthLabel);
    return {
      month_label: monthLabel,
      year: monthRows[0]?.year,
      month: monthRows[0]?.month,
      registrations: monthRows.reduce((s, r) => s + r.registrations, 0),
      active_users: monthRows.reduce((s, r) => s + r.active_users, 0),
      platforms: monthRows.map((r) => ({
        platform: r.platform,
        registrations: r.registrations,
        active_users: r.active_users,
      })),
    };
  });

  const byPlatform = platforms.map((platform) => {
    const platformRows = rows.filter((r) => r.platform === platform);
    return {
      platform,
      registrations: platformRows.reduce((s, r) => s + r.registrations, 0),
      active_users: platformRows.reduce((s, r) => s + r.active_users, 0),
    };
  });

  res.json({
    rows,
    byMonth,
    byPlatform,
    months,
    platforms,
    kpis,
    filter: { company, start, end },
  });
});

app.get('/api/applicant-stats', (req, res) => {
  const { company, start, end } = req.query;
  const { clause, params } = buildMonthlyStatsQuery(company, start, end);

  const rows = db.prepare(`
    SELECT * FROM applicant_stats ${clause}
    ORDER BY year, month
  `).all(...params);

  const kpis = db.prepare(`
    SELECT
      COALESCE(SUM(unique_applicants), 0) as uniqueApplicants,
      COALESCE(SUM(screening_passes), 0) as screeningPasses,
      COALESCE(SUM(total_applications), 0) as totalApplications,
      COALESCE(SUM(interviews_fixed), 0) as interviewsFixed,
      COALESCE(SUM(remaining_esp), 0) as remainingEsp,
      COALESCE(SUM(selected), 0) as selected
    FROM applicant_stats ${clause}
  `).get(...params);

  const latest = rows.length ? rows[rows.length - 1] : null;

  const funnelSteps = latest ? [
    { label: 'Unique Applicants', value: latest.unique_applicants },
    { label: 'Screening Passes', value: latest.screening_passes },
    { label: 'Total Applications', value: latest.total_applications },
    { label: 'Interviews Fixed', value: latest.interviews_fixed },
    { label: 'Selected', value: latest.selected },
  ] : [];

  res.json({
    rows,
    kpis,
    latest,
    funnelSteps,
    filter: { company, start, end },
  });
});

app.get('/api/dashboard-guide', (req, res) => {
  const company = resolveCompany(req.query.company || 'workjapan');
  res.json(getDashboardGuide(company));
});

app.get('/api/intelligence', (req, res) => {
  const { company, start, end } = req.query;
  if (company !== 'workjapan') {
    return res.json({
      geo: { rows: [], latest: null },
      visa: { rows: [], byType: [], latestMonth: null },
      nationality: { rows: [], top: [] },
      barriers: { rows: [], latest: null },
      topJobs: [],
      filter: { company, start, end },
    });
  }

  const { clause, params } = buildMonthlyStatsQuery(company, start, end);

  const geoRows = db.prepare(`
    SELECT * FROM audience_geo_stats ${clause} ORDER BY year, month
  `).all(...params);

  const visaRows = db.prepare(`
    SELECT * FROM visa_stats ${clause} ORDER BY year, month, visa_type
  `).all(...params);

  const nationalityRows = db.prepare(`
    SELECT * FROM nationality_stats ${clause} ORDER BY year, month, visitors DESC
  `).all(...params);

  const barrierRows = db.prepare(`
    SELECT * FROM barrier_stats ${clause} ORDER BY year, month
  `).all(...params);

  const latestGeo = geoRows.length ? geoRows[geoRows.length - 1] : null;
  const latestBarrier = barrierRows.length ? barrierRows[barrierRows.length - 1] : null;

  const visaMonths = [...new Set(visaRows.map((r) => r.month_label))].sort(
    (a, b) => monthSortKey(visaRows.find((r) => r.month_label === a))
      - monthSortKey(visaRows.find((r) => r.month_label === b))
  );
  const latestVisaMonth = visaMonths.length ? visaMonths[visaMonths.length - 1] : null;
  const latestVisaRows = latestVisaMonth
    ? visaRows.filter((r) => r.month_label === latestVisaMonth)
    : [];

  const visaByType = VISA_TYPES.map((visaType) => {
    const typeRows = visaRows.filter((r) => r.visa_type === visaType);
    const latest = latestVisaRows.find((r) => r.visa_type === visaType);
    const avgAbandon = computeSixMonthAvg(typeRows, (r) => {
      const total = (r.registrations || 0) + (r.abandonments || 0);
      return total > 0 ? (r.abandonments / total) * 100 : 0;
    });
    const latestAbandon = latest
      ? ((latest.abandonments || 0) / Math.max(1, (latest.registrations || 0) + (latest.abandonments || 0))) * 100
      : null;
    return {
      visa_type: visaType,
      latest,
      abandonmentRate: latestAbandon != null ? Math.round(latestAbandon * 10) / 10 : null,
      avgAbandonmentRate6mo: avgAbandon,
      vsAvgPct: pctChange(latestAbandon, avgAbandon),
      rows: typeRows,
    };
  });

  const nationalityByMonth = {};
  for (const row of nationalityRows) {
    if (!nationalityByMonth[row.month_label]) nationalityByMonth[row.month_label] = [];
    nationalityByMonth[row.month_label].push(row);
  }
  const nationalityMonths = Object.keys(nationalityByMonth).sort(
    (a, b) => monthSortKey(nationalityRows.find((r) => r.month_label === a))
      - monthSortKey(nationalityRows.find((r) => r.month_label === b))
  );
  const latestNatMonth = nationalityMonths.length ? nationalityMonths[nationalityMonths.length - 1] : null;
  const topNationalities = latestNatMonth
    ? [...nationalityByMonth[latestNatMonth]]
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, 10)
      .map((n) => {
        const natRows = nationalityRows.filter((r) => r.nationality === n.nationality);
        const avgVisitors = computeSixMonthAvg(natRows, (r) => r.visitors || 0);
        return {
          ...n,
          avgVisitors6mo: avgVisitors,
          vsAvgPct: pctChange(n.visitors, avgVisitors),
        };
      })
    : [];

  const ga4Q = buildGa4DateQuery(company, start, end);
  const rawPages = db.prepare(`
    SELECT * FROM pages_screens ${ga4Q.clause} ORDER BY views DESC
  `).all(...ga4Q.params);
  const pages = start && end ? proratePagesRows(rawPages, start, end) : rawPages;
  const topJobs = pages
    .filter((p) => isJobDetailPage(p.page_path))
    .slice(0, 15)
    .map((p) => ({
      path: p.page_path,
      views: p.views,
      users: p.active_users,
      avgTime: p.avg_engagement_time,
    }));

  const geoComparisons = latestGeo ? {
    inJapanVisitors: {
      current: latestGeo.in_japan_visitors,
      avg6mo: computeSixMonthAvg(geoRows, (r) => r.in_japan_visitors || 0),
      vsAvgPct: pctChange(latestGeo.in_japan_visitors, computeSixMonthAvg(geoRows, (r) => r.in_japan_visitors || 0)),
    },
    outJapanVisitors: {
      current: latestGeo.out_japan_visitors,
      avg6mo: computeSixMonthAvg(geoRows, (r) => r.out_japan_visitors || 0),
      vsAvgPct: pctChange(latestGeo.out_japan_visitors, computeSixMonthAvg(geoRows, (r) => r.out_japan_visitors || 0)),
    },
  } : null;

  res.json({
    geo: { rows: geoRows, latest: latestGeo, comparisons: geoComparisons },
    visa: { rows: visaRows, byType: visaByType, latestMonth: latestVisaMonth },
    nationality: { rows: nationalityRows, top: topNationalities, latestMonth: latestNatMonth },
    barriers: {
      rows: barrierRows,
      latest: latestBarrier,
      dropOffRate: latestBarrier && latestBarrier.users_reached > 0
        ? Math.round((latestBarrier.users_dropped / latestBarrier.users_reached) * 1000) / 10
        : null,
    },
    topJobs,
    filter: { company, start, end },
  });
});

app.post('/api/manual/geo', uploadLimiter, (req, res) => {
  try {
    const { company, month, in_japan_visitors, out_japan_visitors,
      in_japan_registrations, out_japan_registrations } = req.body;
    if (company !== 'workjapan') {
      return res.status(400).json({ error: 'Geography data is only available for WORK JAPAN' });
    }
    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });

    saveGeoRow(company, parsedMonth, {
      in_japan_visitors, out_japan_visitors,
      in_japan_registrations, out_japan_registrations,
    });
    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'geo', 1, 0);
    res.json({ success: true, rowsAdded: 1, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual/visa', uploadLimiter, (req, res) => {
  try {
    const { company, month, visas } = req.body;
    if (company !== 'workjapan') {
      return res.status(400).json({ error: 'Visa data is only available for WORK JAPAN' });
    }
    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });
    if (!Array.isArray(visas) || !visas.length) {
      return res.status(400).json({ error: 'At least one visa row is required' });
    }

    let saved = 0;
    for (const row of visas) {
      if (!row.visa_type) continue;
      saveVisaRow(company, parsedMonth, row.visa_type, row);
      saved++;
    }
    if (!saved) return res.status(400).json({ error: 'No valid visa rows to save' });

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'visa', saved, 0);
    res.json({ success: true, rowsAdded: saved, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual/nationality', uploadLimiter, (req, res) => {
  try {
    const { company, month, nationalities } = req.body;
    if (company !== 'workjapan') {
      return res.status(400).json({ error: 'Nationality data is only available for WORK JAPAN' });
    }
    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });
    if (!Array.isArray(nationalities) || !nationalities.length) {
      return res.status(400).json({ error: 'At least one nationality row is required' });
    }

    let saved = 0;
    for (const row of nationalities) {
      if (!row.nationality) continue;
      saveNationalityRow(company, parsedMonth, row.nationality, row.visitors, row.registrations);
      saved++;
    }
    if (!saved) return res.status(400).json({ error: 'No valid nationality rows to save' });

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'nationality', saved, 0);
    res.json({ success: true, rowsAdded: saved, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual/barriers', uploadLimiter, (req, res) => {
  try {
    const { company, month, barriers } = req.body;
    if (company !== 'workjapan') {
      return res.status(400).json({ error: 'Barrier data is only available for WORK JAPAN' });
    }
    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });
    if (!Array.isArray(barriers) || !barriers.length) {
      return res.status(400).json({ error: 'At least one barrier row is required' });
    }

    let saved = 0;
    for (const row of barriers) {
      if (!row.barrier_name) continue;
      saveBarrierRow(company, parsedMonth, row.barrier_name, row.users_reached, row.users_dropped);
      saved++;
    }
    if (!saved) return res.status(400).json({ error: 'No valid barrier rows to save' });

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'barriers', saved, 0);
    res.json({ success: true, rowsAdded: saved, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/summary', (req, res) => {
  const { company, start, end } = req.query;
  const socialQ = buildSocialQuery(company, start, end);
  const ga4Q = buildGa4DateQuery(company, start, end);

  const social = db.prepare(`
    SELECT company,
      COALESCE(SUM(views), 0) as views,
      COALESCE(SUM(reach), 0) as reach,
      COALESCE(SUM(likes + comments + shares + saves), 0) as engagement
    FROM social_posts ${socialQ.clause}
    GROUP BY company
  `).all(...socialQ.params);

  const traffic = db.prepare(`
    SELECT company,
      COALESCE(SUM(sessions), 0) as sessions,
      COALESCE(SUM(engaged_sessions), 0) as engagedSessions,
      CASE WHEN SUM(sessions) > 0 THEN ROUND(CAST(SUM(engaged_sessions) AS REAL) / SUM(sessions) * 100, 1) ELSE 0 END as engagementRate,
      CASE WHEN SUM(sessions) > 0 THEN ROUND(SUM(avg_engagement_time * sessions) / SUM(sessions), 1) ELSE 0 END as avgEngagementTime
    FROM traffic_acquisition ${ga4Q.clause}
    GROUP BY company
  `).all(...ga4Q.params);

  const funnel = db.prepare(`
    SELECT company, step, completion_rate, active_users
    FROM funnel_data
    WHERE device_category = 'Total'
    ${company && company !== 'all' ? 'AND company = ?' : ''}
    ORDER BY step DESC
  `).all(...(company && company !== 'all' ? [company] : []));

  const topPages = db.prepare(`
    SELECT company, page_path, views
    FROM pages_screens ${ga4Q.clause}
    ORDER BY views DESC
    LIMIT 1
  `).all(...ga4Q.params);

  res.json({ social, traffic, funnel, topPages });
});

app.get('/api/upload-history', (req, res) => {
  const history = db.prepare(`
    SELECT * FROM upload_history ORDER BY uploaded_at DESC LIMIT 20
  `).all();

  const lastUpdated = history.length > 0 ? history[0].uploaded_at : null;

  res.json({ history, lastUpdated });
});

app.get('/api/upload-status', (req, res) => {
  const company = req.query.company || 'nyuuly';
  if (!['nyuuly', 'workjapan'].includes(company)) {
    return res.status(400).json({ error: 'Invalid company' });
  }

  const history = db.prepare(`
    SELECT * FROM upload_history
    WHERE company = ?
    ORDER BY uploaded_at DESC
  `).all(company);

  const files = {};
  for (const type of FILE_TYPES) {
    const latest = history.find((h) => h.file_type === type);
    files[type] = latest
      ? {
          uploaded: true,
          filename: latest.filename,
          uploadedAt: latest.uploaded_at,
          rowsAdded: latest.rows_added,
          rowsSkipped: latest.rows_skipped,
        }
      : { uploaded: false };
  }

  const uploadedCount = FILE_TYPES.filter((t) => files[t].uploaded).length;
  const manualFiles = getManualDataStatus(company);

  res.json({
    company,
    files,
    manualFiles,
    uploadedCount,
    totalRequired: FILE_TYPES.length,
    allComplete: uploadedCount === FILE_TYPES.length,
    fileTypeLabels: {
      ...FILE_TYPE_LABELS,
      platform: 'Platform Registrations (Manual)',
      applicants: 'Job Seeker Applications (Manual)',
      geo: 'Audience Geography (Manual)',
      visa: 'Visa Intelligence (Manual)',
      nationality: 'Nationality Trends (Manual)',
      barriers: 'Conversion Barriers (Manual)',
    },
  });
});

app.get('/api/journeys', (req, res) => {
  const { company, start, end } = req.query;
  const journeyCompany = resolveCompany(company);
  const journeysConfig = getJourneys(journeyCompany);
  const socialQ = buildSocialQuery(company, start, end);
  const ga4Q = buildGa4DateQuery(company, start, end);

  const socialKpis = db.prepare(`
    SELECT
      COALESCE(SUM(views), 0) as totalViews,
      COALESCE(SUM(reach), 0) as totalReach,
      COALESCE(SUM(likes + comments + shares + saves), 0) as totalEngagement,
      COUNT(*) as postCount
    FROM social_posts ${socialQ.clause}
  `).get(...socialQ.params);

  const rawTrafficRows = db.prepare(`
    SELECT * FROM traffic_acquisition ${ga4Q.clause} ORDER BY sessions DESC
  `).all(...ga4Q.params);
  const trafficRows = start && end
    ? prorateTrafficRows(rawTrafficRows, start, end)
    : rawTrafficRows;
  const trafficKpis = trafficKpisFromRows(trafficRows);

  const rawPages = db.prepare(`
    SELECT * FROM pages_screens ${ga4Q.clause} ORDER BY views DESC
  `).all(...ga4Q.params);
  const pages = start && end ? proratePagesRows(rawPages, start, end) : rawPages;

  let funnelClause = 'WHERE 1=1';
  const funnelParams = [];
  if (company && company !== 'all') {
    funnelClause += ' AND company = ?';
    funnelParams.push(company);
  }
  if (start && end) {
    const startCompact = start.replace(/-/g, '');
    const endCompact = end.replace(/-/g, '');
    funnelClause += ` AND (
      (substr(date_range, 1, 8) <= ? AND substr(date_range, 10, 8) >= ?)
      OR date_range IS NULL
    )`;
    funnelParams.push(endCompact, startCompact);
  }

  const rawFunnelRows = db.prepare(`
    SELECT * FROM funnel_data ${funnelClause} ORDER BY step, device_category
  `).all(...funnelParams);
  const funnelRows = start && end ? prorateFunnelRows(rawFunnelRows, start, end) : rawFunnelRows;

  const ga4Funnel = buildGa4FunnelSteps(funnelRows);
  const funnelEntryUsers = ga4Funnel[0]?.users || trafficKpis.totalSessions || 0;
  const jobDetailAgg = aggregateJobDetails(pages);
  const topJobCategories = journeyCompany === 'workjapan' ? getTopJobCategories(pages) : [];

  const journeys = journeysConfig.map((j) => {
    const base = {
      id: j.id,
      title: j.title,
      subtitle: j.subtitle,
      description: j.description,
      status: j.status,
      sources: j.sources,
      company: journeyCompany,
    };

    if (j.id === 'awareness') {
      return {
        ...base,
        kpis: {
          socialViews: socialKpis.totalViews,
          socialReach: socialKpis.totalReach,
          socialEngagement: socialKpis.totalEngagement,
          postCount: socialKpis.postCount,
          sessions: trafficKpis.totalSessions,
          engagedSessions: trafficKpis.totalEngagedSessions,
          engagementRate: trafficKpis.engagementRate,
        },
        topChannels: trafficRows.slice(0, 8).map((r) => ({
          channel: r.channel_group,
          sessions: r.sessions,
          engagedSessions: r.engaged_sessions,
          engagementRate: r.engagement_rate,
        })),
      };
    }

    if (j.id === 'browse-jobs' || j.id === 'explore-no-action') {
      const agg = aggregatePagesForJourney(pages, j);
      const convertJourney = journeysConfig.find((x) => x.id === 'register-apply' || x.id === 'explore-convert');
      const convertAgg = convertJourney ? aggregatePagesForJourney(pages, convertJourney) : { totalUsers: 0 };
      const browseOnlyUsers = Math.max(0, funnelEntryUsers - convertAgg.totalUsers);
      return {
        ...base,
        kpis: {
          pageViews: agg.totalViews,
          activeUsers: agg.totalUsers,
          estimatedBrowseOnly: browseOnlyUsers,
          browseRate: funnelEntryUsers > 0
            ? Math.round((browseOnlyUsers / funnelEntryUsers) * 1000) / 10
            : 0,
        },
        topPages: agg.pages.slice(0, 10).map((p) => ({
          path: p.page_path,
          views: p.views,
          users: p.active_users,
          avgTime: p.avg_engagement_time,
        })),
        ga4Funnel: ga4Funnel.slice(0, 3),
        entryChannels: trafficRows.slice(0, 5).map((r) => ({
          channel: r.channel_group,
          sessions: r.sessions,
        })),
      };
    }

    if (j.id === 'job-detail') {
      const agg = jobDetailAgg;
      return {
        ...base,
        kpis: {
          pageViews: agg.totalViews,
          activeUsers: agg.totalUsers,
          uniqueJobPages: agg.pages.length,
          viewsPerUser: agg.totalUsers > 0
            ? Math.round((agg.totalViews / agg.totalUsers) * 10) / 10
            : 0,
        },
        topPages: agg.pages.slice(0, 10).map((p) => ({
          path: p.page_path,
          views: p.views,
          users: p.active_users,
          avgTime: p.avg_engagement_time,
        })),
        topJobCategories,
      };
    }

    if (j.id === 'register-apply' || j.id === 'explore-convert') {
      const agg = aggregatePagesForJourney(pages, j);
      return {
        ...base,
        kpis: {
          pageViews: agg.totalViews,
          activeUsers: agg.totalUsers,
          keyEvents: agg.totalKeyEvents,
          conversionRate: funnelEntryUsers > 0
            ? Math.round((agg.totalUsers / funnelEntryUsers) * 1000) / 10
            : 0,
        },
        topPages: agg.pages.slice(0, 10).map((p) => ({
          path: p.page_path,
          views: p.views,
          users: p.active_users,
          keyEvents: p.key_events,
          avgTime: p.avg_engagement_time,
        })),
        ga4Funnel,
      };
    }

    if (j.id === 'employer') {
      const agg = aggregatePagesForJourney(pages, j);
      return {
        ...base,
        kpis: {
          pageViews: agg.totalViews,
          activeUsers: agg.totalUsers,
        },
        topPages: agg.pages.slice(0, 10).map((p) => ({
          path: p.page_path,
          views: p.views,
          users: p.active_users,
          avgTime: p.avg_engagement_time,
        })),
      };
    }

    if (j.id === 'welcome-package') {
      const agg = aggregatePagesForJourney(pages, j);
      return {
        ...base,
        kpis: {
          pageViews: agg.totalViews,
          activeUsers: agg.totalUsers,
          keyEvents: agg.totalKeyEvents,
        },
        topPages: agg.pages.slice(0, 5).map((p) => ({
          path: p.page_path,
          views: p.views,
          users: p.active_users,
        })),
        ga4Funnel: ga4Funnel.filter((s) => s.stepLabel.toLowerCase().includes('purchase')),
      };
    }

    if (j.id === 'seeker-application' || j.id === 'nyuuly-application' || j.id === 'wj-application') {
      const applicationFunnel = buildApplicationFunnel(pages, j.applicationSteps);
      const biggestDrop = applicationFunnel.reduce(
        (max, step, i) => (i > 0 && step.dropOffPct > (max?.dropOffPct || 0) ? step : max),
        null
      );
      return {
        ...base,
        kpis: {
          started: applicationFunnel[0]?.users || applicationFunnel[0]?.views || 0,
          completed: applicationFunnel[applicationFunnel.length - 1]?.users
            || applicationFunnel[applicationFunnel.length - 1]?.views || 0,
          overallCompletion: (applicationFunnel[0]?.users || applicationFunnel[0]?.views) > 0
            ? Math.round(
                ((applicationFunnel[applicationFunnel.length - 1].users
                  || applicationFunnel[applicationFunnel.length - 1].views)
                  / (applicationFunnel[0].users || applicationFunnel[0].views)) * 1000
              ) / 10
            : 0,
          biggestDropOffStep: biggestDrop?.label || '—',
          biggestDropOffPct: biggestDrop?.dropOffPct || 0,
        },
        applicationFunnel,
        ga4Funnel,
        topJobCategories: j.id === 'seeker-application' ? topJobCategories.slice(0, 5) : undefined,
      };
    }

    return base;
  });

  const dataCompleteness = {
    social: socialKpis.totalViews > 0 || socialKpis.totalReach > 0,
    funnel: funnelRows.length > 0,
    traffic: trafficKpis.totalSessions > 0,
    pages: pages.length > 0,
  };

  const landingPages = getLandingPages(pages, journeyCompany);
  const seekerJourney = journeys.find((j) => j.id === 'seeker-application');
  const browseJourney = journeys.find((j) => j.id === 'browse-jobs');
  const jobDetailJourney = journeys.find((j) => j.id === 'job-detail');

  const consideration = journeyCompany === 'workjapan'
    ? buildConsiderationInsights({
        seekerFunnel: seekerJourney?.applicationFunnel,
        browse: browseJourney,
        jobDetail: jobDetailJourney,
        landingPages,
        trafficRows,
        topJobCategories,
        ga4Funnel,
        funnelEntryUsers,
      })
    : null;

  res.json({
    journeys,
    landingPages,
    consideration,
    dataCompleteness,
    completenessCount: Object.values(dataCompleteness).filter(Boolean).length,
    company: journeyCompany,
    companyLabel: COMPANY_LABELS[journeyCompany],
    filter: { company, start, end },
  });
});

app.delete('/api/data', (req, res) => {
  const { company, table, confirm } = req.query;

  if (confirm !== 'yes') {
    return res.status(400).json({ error: 'Must pass confirm=yes' });
  }

  const allowedTables = ['social_posts', 'funnel_data', 'traffic_acquisition', 'pages_screens', 'platform_stats', 'applicant_stats'];
  if (!allowedTables.includes(table)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }

  if (company && company !== 'all') {
    db.prepare(`DELETE FROM ${table} WHERE company = ?`).run(company);
  } else {
    db.prepare(`DELETE FROM ${table}`).run();
  }

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Analytics dashboard running on http://localhost:${PORT}`);
});
