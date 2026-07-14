const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { parse } = require('csv-parse/sync');
const AdmZip = require('adm-zip');
const { db, initDb, dbPath, isRailway, isVolumeBacked } = require('./database/db');
const {
  prorateUsersRows,
  proratePagesRows,
  prorateFunnelRows,
  usersKpisFromRows,
  websiteUsersSourceBreakdown,
  websiteUsersSourceBreakdownFromChannelMap,
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
const { buildInternalReport } = require('./internal-reporting');

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

const MANUAL_FILE_TYPES = ['platform', 'applicants', 'geo', 'visa', 'nationality', 'barriers', 'social-channels'];

const SOCIAL_CHANNELS = ['Facebook', 'Instagram', 'TikTok', 'YouTube'];
const APP_DOWNLOAD_PLATFORMS = ['iOS', 'Android'];
const PLATFORM_REG_PLATFORMS = ['Web', 'Android', 'iOS'];

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
  if (lines.includes('First user primary channel group')) return 'users';
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

function parseFunnelCsv(content, company, override) {
  const lines = content.split('\n');
  let dateRange = override?.dateRange || null;

  if (!dateRange) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) {
        const match = trimmed.match(/#\s*(\d{8})-(\d{8})/);
        if (match) {
          dateRange = `${match[1]}-${match[2]}`;
        }
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

/**
 * Build explicit month-aligned dates from a 'YYYY-MM' key.
 * Used when the uploader picks a month, so the stored range is the whole
 * calendar month regardless of what the CSV header says.
 */
function monthRangeFromKey(month) {
  const m = /^(\d{4})-(\d{2})$/.exec((month || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const lastDay = new Date(year, mon, 0).getDate();
  const mm = String(mon).padStart(2, '0');
  const dd = String(lastDay).padStart(2, '0');
  return {
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${dd}`,
    dateRange: `${year}${mm}01-${year}${mm}${dd}`,
  };
}

/** GSC CSV CTR values are always percentages (e.g. "0.11%" → 0.0011 as a fraction). */
function parseGscPct(val) {
  if (val == null || val === '') return 0;
  const s = String(val).trim().replace('%', '');
  const n = parseFloat(s);
  if (Number.isNaN(n)) return 0;
  return n / 100;
}

function gscCtrFraction(clicks, impressions, storedCtr = null) {
  if (impressions > 0) return clicks / impressions;
  return storedCtr != null ? storedCtr : 0;
}

function normalizeGscStatRow(row) {
  return {
    ...row,
    ctr: gscCtrFraction(row.clicks, row.impressions, row.ctr),
  };
}

function zipEntryText(zip, name) {
  const entry = zip.getEntries().find((e) => e.entryName === name || e.entryName.endsWith(`/${name}`));
  if (!entry) return null;
  return entry.getData().toString('utf8');
}

function parseGscZip(buffer, company, override) {
  if (!override?.startDate || !override?.endDate) {
    throw new Error('Month is required for Search Console uploads');
  }

  const zip = new AdmZip(buffer);
  const chartText = zipEntryText(zip, 'Chart.csv');
  const queriesText = zipEntryText(zip, 'Queries.csv');
  const pagesText = zipEntryText(zip, 'Pages.csv');

  if (!chartText || !queriesText || !pagesText) {
    throw new Error('Zip must contain Chart.csv, Queries.csv, and Pages.csv');
  }

  const { startDate, endDate } = override;

  db.prepare(`
    DELETE FROM search_console_stats
    WHERE company = ? AND start_date = ? AND end_date = ?
  `).run(company, startDate, endDate);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO search_console_stats
    (company, start_date, end_date, dimension_type, dimension_value, clicks, impressions, ctr, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  let skipped = 0;

  const insertRows = (rows, dimensionType, valueKey) => {
    for (const row of rows) {
      const value = row[valueKey] || row[Object.keys(row).find((k) => k.toLowerCase().includes(valueKey.toLowerCase()))];
      if (!value) continue;
      const result = stmt.run(
        company,
        startDate,
        endDate,
        dimensionType,
        String(value),
        parseNum(row.Clicks),
        parseNum(row.Impressions),
        parseGscPct(row.CTR),
        parseNum(row.Position)
      );
      if (result.changes > 0) added++;
      else skipped++;
    }
  };

  insertRows(parse(chartText, { columns: true, skip_empty_lines: true, bom: true }), 'daily', 'Date');
  insertRows(parse(queriesText, { columns: true, skip_empty_lines: true, bom: true }), 'query', 'Top queries');
  insertRows(parse(pagesText, { columns: true, skip_empty_lines: true, bom: true }), 'page', 'Top pages');

  return { added, skipped };
}

function gscKpisFromRows(dailyRows) {
  let clicks = 0;
  let impressions = 0;
  let posWeighted = 0;
  for (const row of dailyRows) {
    clicks += row.clicks || 0;
    impressions += row.impressions || 0;
    posWeighted += (row.position || 0) * (row.impressions || 0);
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    avgPosition: impressions > 0 ? Math.round((posWeighted / impressions) * 100) / 100 : 0,
  };
}

function getSearchConsolePayload(company, start, end) {
  const coFilter = company && company !== 'all' ? 'company = ? AND' : '';
  const params = company && company !== 'all' ? [company, start, end] : [start, end];

  const rows = db.prepare(`
    SELECT * FROM search_console_stats
    WHERE ${coFilter} start_date = ? AND end_date = ?
  `).all(...params);

  const daily = rows.filter((r) => r.dimension_type === 'daily').sort((a, b) => a.dimension_value.localeCompare(b.dimension_value));
  const topQueries = rows.filter((r) => r.dimension_type === 'query').sort((a, b) => b.clicks - a.clicks).slice(0, 15)
    .map(normalizeGscStatRow);
  const topPages = rows.filter((r) => r.dimension_type === 'page').sort((a, b) => b.clicks - a.clicks).slice(0, 15)
    .map(normalizeGscStatRow);

  return {
    kpis: gscKpisFromRows(daily),
    daily,
    topQueries,
    topPages,
    hasData: rows.length > 0,
  };
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

function getUsersChannel(row) {
  const key = Object.keys(row).find((k) => k.toLowerCase().includes('first user primary channel group'));
  return key ? row[key] : null;
}

function parseUsersCsv(content, company, override) {
  const header = parseGa4Header(content);
  const startDate = override?.startDate || header.startDate;
  const endDate = override?.endDate || header.endDate;
  const lines = content.split('\n');
  const dataLines = lines.filter((l) => !l.trim().startsWith('#') && l.trim() !== '');
  const rows = parse(dataLines.join('\n'), { columns: true, skip_empty_lines: true, bom: true });

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO user_acquisition
    (company, start_date, end_date, channel_group, total_users, new_users, returning_users,
     avg_engagement_time, engaged_sessions_per_user, event_count, key_events, user_key_event_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  let skipped = 0;

  for (const row of rows) {
    const channel = getUsersChannel(row);
    if (!channel) continue;

    const result = stmt.run(
      company,
      startDate,
      endDate,
      channel,
      parseNum(row['Total users']),
      parseNum(row['New users']),
      parseNum(row['Returning users']),
      parseNum(row['Average engagement time per active user']),
      parseNum(row['Engaged sessions per active user']),
      parseNum(row['Event count']),
      parseNum(row['Key events']),
      parseNum(row['User key event rate'])
    );

    if (result.changes > 0) added++;
    else skipped++;
  }

  return { added, skipped };
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

function parsePagesCsv(content, company, override) {
  const header = parseGa4Header(content);
  const startDate = override?.startDate || header.startDate;
  const endDate = override?.endDate || header.endDate;
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

function parseCsv(content, fileType, company, override) {
  switch (fileType) {
    case 'social': return parseSocialCsv(content, company);
    case 'funnel': return parseFunnelCsv(content, company, override);
    case 'users': return parseUsersCsv(content, company, override);
    case 'pages': return parsePagesCsv(content, company, override);
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

/**
 * SQL expressions that derive a YYYY-MM month key from each source table.
 * Used for the Monthly comparison mode (whole-calendar-month uploads).
 */
const MONTH_KEY_SQL = {
  user_acquisition: `substr(start_date, 1, 7)`,
  pages_screens: `substr(start_date, 1, 7)`,
  funnel_data: `substr(date_range, 1, 4) || '-' || substr(date_range, 5, 2)`,
  social_posts: `strftime('%Y-%m', publish_time)`,
  search_console_stats: `substr(start_date, 1, 7)`,
  social_channel_views: `printf('%04d-%02d', year, month)`,
  app_downloads: `printf('%04d-%02d', year, month)`,
  nyuuly_commit_stats: `printf('%04d-%02d', year, month)`,
  nyuuly_proceed_stats: `printf('%04d-%02d', year, month)`,
  nyuuly_result_stats: `printf('%04d-%02d', year, month)`,
  brand_messages: `printf('%04d-%02d', year, month)`,
  campaign_stats: `printf('%04d-%02d', year, month)`,
  workjapan_profile_stats: `printf('%04d-%02d', year, month)`,
  monthly: `printf('%04d-%02d', year, month)`,
};

const MONTH_SHORT_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthKeyLabel(key) {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return key || '';
  const [year, month] = key.split('-').map(Number);
  return `${MONTH_SHORT_NAMES[month - 1] || month} ${year}`;
}

function companyClause(company, prefixWhere = true) {
  if (company && company !== 'all') {
    return { clause: `${prefixWhere ? 'WHERE ' : ''}company = ?`, params: [company] };
  }
  return { clause: prefixWhere ? 'WHERE 1=1' : '1=1', params: [] };
}

/** Distinct month keys (YYYY-MM) that have data in any source, sorted ascending. */
function getAvailableMonths(company) {
  const co = companyClause(company);
  const queries = [
    `SELECT DISTINCT ${MONTH_KEY_SQL.user_acquisition} AS mk FROM user_acquisition ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.pages_screens} AS mk FROM pages_screens ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.funnel_data} AS mk FROM funnel_data ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.social_posts} AS mk FROM social_posts ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.search_console_stats} AS mk FROM search_console_stats ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.social_channel_views} AS mk FROM social_channel_views ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.app_downloads} AS mk FROM app_downloads ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.nyuuly_commit_stats} AS mk FROM nyuuly_commit_stats ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.nyuuly_proceed_stats} AS mk FROM nyuuly_proceed_stats ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.nyuuly_result_stats} AS mk FROM nyuuly_result_stats ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.brand_messages} AS mk FROM brand_messages ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.campaign_stats} AS mk FROM campaign_stats ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.workjapan_profile_stats} AS mk FROM workjapan_profile_stats ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.monthly} AS mk FROM platform_stats ${co.clause}`,
    `SELECT DISTINCT ${MONTH_KEY_SQL.monthly} AS mk FROM applicant_stats ${co.clause}`,
  ];
  const set = new Set();
  for (const q of queries) {
    for (const row of db.prepare(q).all(...co.params)) {
      if (row.mk && /^\d{4}-\d{2}$/.test(row.mk)) set.add(row.mk);
    }
  }
  return [...set].sort();
}

function currentCalendarMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function previousCalendarMonthKey(fromKey = currentCalendarMonthKey()) {
  const [y, m] = fromKey.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** True when the month has at least one core weekly CSV source (not manual-only entry). */
function monthHasWeeklyCsvDataForCompany(company, monthKey) {
  if (!monthKey || !company) return false;
  const coAnd = 'company = ? AND ';
  const params = [company, monthKey];

  const checks = [
    `SELECT 1 FROM pages_screens WHERE ${coAnd}${MONTH_KEY_SQL.pages_screens} = ? LIMIT 1`,
    `SELECT 1 FROM user_acquisition WHERE ${coAnd}${MONTH_KEY_SQL.user_acquisition} = ? LIMIT 1`,
    `SELECT 1 FROM social_posts WHERE ${coAnd}${MONTH_KEY_SQL.social_posts} = ? LIMIT 1`,
    `SELECT 1 FROM funnel_data WHERE ${coAnd}${MONTH_KEY_SQL.funnel_data} = ? LIMIT 1`,
    `SELECT 1 FROM search_console_stats WHERE ${coAnd}${MONTH_KEY_SQL.search_console_stats} = ? LIMIT 1`,
  ];

  return checks.some((sql) => db.prepare(sql).get(...params));
}

function monthHasWeeklyCsvData(company, monthKey) {
  if (!monthKey) return false;
  if (company && company !== 'all') {
    return monthHasWeeklyCsvDataForCompany(company, monthKey);
  }
  return monthHasWeeklyCsvDataForCompany('workjapan', monthKey)
    || monthHasWeeklyCsvDataForCompany('nyuuly', monthKey);
}

/**
 * Default month for the dashboard filter.
 * Uses the latest month with data, unless that month is the current calendar month
 * and only manual/partial data exists — then falls back to the previous month.
 */
function getDefaultMonthKey(company, months) {
  if (!months?.length) return null;

  const latest = months[months.length - 1];
  const current = currentCalendarMonthKey();

  if (latest === current && !monthHasWeeklyCsvData(company, current)) {
    const prev = previousCalendarMonthKey(current);
    if (months.includes(prev)) return prev;
    if (months.length >= 2) return months[months.length - 2];
  }

  return latest;
}

function deltaPct(value, prevValue) {
  if (prevValue == null || prevValue === 0) return null;
  return Math.round(((value - prevValue) / prevValue) * 1000) / 10;
}

/** Aggregate every KPI for a single month key. Returns flat metric map. */
function monthlyKpisForMonth(company, monthKey) {
  const co = company && company !== 'all' ? company : null;
  const withCompany = (extra) => (co ? [co, monthKey] : [monthKey]);
  const coFilter = co ? 'company = ? AND' : '';

  const social = db.prepare(`
    SELECT
      COALESCE(SUM(views), 0) AS socialViews,
      COALESCE(SUM(reach), 0) AS socialReach,
      COALESCE(SUM(likes + comments + shares + saves), 0) AS socialEngagement,
      COUNT(*) AS postCount
    FROM social_posts
    WHERE ${coFilter} ${MONTH_KEY_SQL.social_posts} = ?
  `).get(...withCompany());

  const users = getWebsiteUsersKpisForMonth(company, monthKey);

  const pages = db.prepare(`
    SELECT
      COALESCE(SUM(views), 0) AS pageViews,
      COALESCE(SUM(active_users), 0) AS pageActiveUsers
    FROM pages_screens
    WHERE ${coFilter} ${MONTH_KEY_SQL.pages_screens} = ?
  `).get(...withCompany());

  const funnel = db.prepare(`
    SELECT
      COALESCE(AVG(completion_rate), 0) AS funnelCompletion,
      COALESCE(SUM(active_users), 0) AS funnelActiveUsers
    FROM funnel_data
    WHERE ${coFilter} device_category = 'Total' AND ${MONTH_KEY_SQL.funnel_data} = ?
  `).get(...withCompany());

  const platform = db.prepare(`
    SELECT
      COALESCE(SUM(registrations), 0) AS registrations,
      COALESCE(SUM(active_users), 0) AS platformActiveUsers
    FROM platform_stats
    WHERE ${coFilter} ${MONTH_KEY_SQL.monthly} = ?
  `).get(...withCompany());

  const applicants = db.prepare(`
    SELECT
      COALESCE(SUM(unique_applicants), 0) AS uniqueApplicants,
      COALESCE(SUM(screening_passes), 0) AS screeningPasses,
      COALESCE(SUM(total_applications), 0) AS totalApplications,
      COALESCE(SUM(interviews_fixed), 0) AS interviewsFixed,
      COALESCE(SUM(remaining_esp), 0) AS remainingEsp,
      COALESCE(SUM(selected), 0) AS selected
    FROM applicant_stats
    WHERE ${coFilter} ${MONTH_KEY_SQL.monthly} = ?
  `).get(...withCompany());

  const gscDaily = db.prepare(`
    SELECT clicks, impressions, position
    FROM search_console_stats
    WHERE ${coFilter} ${MONTH_KEY_SQL.search_console_stats} = ? AND dimension_type = 'daily'
  `).all(...withCompany());

  const gscKpis = gscKpisFromRows(gscDaily);

  const socialChannels = db.prepare(`
    SELECT COALESCE(SUM(views), 0) AS socialChannelViews
    FROM social_channel_views
    WHERE ${coFilter} ${MONTH_KEY_SQL.social_channel_views} = ?
  `).get(...withCompany());

  const appDownloads = db.prepare(`
    SELECT COALESCE(SUM(downloads), 0) AS appDownloads
    FROM app_downloads
    WHERE ${coFilter} ${MONTH_KEY_SQL.app_downloads} = ?
  `).get(...withCompany());

  const nyuulyCommit = db.prepare(`
    SELECT
      COALESCE(nyuuly_subscribe, 0) AS nyuulySubscribe,
      COALESCE(compass_started, 0) AS compassStarted
    FROM nyuuly_commit_stats
    WHERE ${coFilter} ${MONTH_KEY_SQL.nyuuly_commit_stats} = ?
  `).get(...withCompany());

  const nyuulyProceed = db.prepare(`
    SELECT
      COALESCE(add_to_cart, 0) AS addToCart,
      COALESCE(welcome_package_started, 0) AS welcomePackageStarted,
      COALESCE(compass_filled, 0) AS compassFilled
    FROM nyuuly_proceed_stats
    WHERE ${coFilter} ${MONTH_KEY_SQL.nyuuly_proceed_stats} = ?
  `).get(...withCompany());

  const nyuulyResult = db.prepare(`
    SELECT
      COALESCE(mobile_sim_purchased, 0) AS mobileSimPurchased,
      COALESCE(welcome_package_purchased, 0) AS welcomePackagePurchased,
      COALESCE(form_filled, 0) AS formFilled,
      COALESCE(ask_me_request, 0) AS askMeRequest
    FROM nyuuly_result_stats
    WHERE ${coFilter} ${MONTH_KEY_SQL.nyuuly_result_stats} = ?
  `).get(...withCompany());

  const wjProfile = db.prepare(`
    SELECT
      COALESCE(mobile_number_collected, 0) AS mobileNumberCollected,
      COALESCE(registered_visa_corrected, 0) AS registeredVisaCorrected,
      COALESCE(registered_station_name_corrected, 0) AS registeredStationNameCorrected,
      COALESCE(registered_age_collected, 0) AS registeredAgeCollected,
      COALESCE(jp_level_collected, 0) AS jpLevelCollected,
      COALESCE(rc_uploaded, 0) AS rcUploaded
    FROM workjapan_profile_stats
    WHERE ${coFilter} ${MONTH_KEY_SQL.workjapan_profile_stats} = ?
  `).get(...withCompany());

  return {
    ...social,
    ...users,
    ...pages,
    ...funnel,
    ...platform,
    ...applicants,
    ...appDownloads,
    nyuulySubscribe: nyuulyCommit?.nyuulySubscribe || 0,
    compassStarted: nyuulyCommit?.compassStarted || 0,
    addToCart: nyuulyProceed?.addToCart || 0,
    welcomePackageStarted: nyuulyProceed?.welcomePackageStarted || 0,
    compassFilled: nyuulyProceed?.compassFilled || 0,
    mobileSimPurchased: nyuulyResult?.mobileSimPurchased || 0,
    welcomePackagePurchased: nyuulyResult?.welcomePackagePurchased || 0,
    formFilled: nyuulyResult?.formFilled || 0,
    askMeRequest: nyuulyResult?.askMeRequest || 0,
    mobileNumberCollected: wjProfile?.mobileNumberCollected || 0,
    registeredVisaCorrected: wjProfile?.registeredVisaCorrected || 0,
    registeredStationNameCorrected: wjProfile?.registeredStationNameCorrected || 0,
    registeredAgeCollected: wjProfile?.registeredAgeCollected || 0,
    jpLevelCollected: wjProfile?.jpLevelCollected || 0,
    rcUploaded: wjProfile?.rcUploaded || 0,
    gscClicks: gscKpis.clicks,
    gscImpressions: gscKpis.impressions,
    gscCtr: gscKpis.ctr,
    gscAvgPosition: gscKpis.avgPosition,
    socialChannelViews: socialChannels?.socialChannelViews || 0,
  };
}

function monthKeyToDateRange(monthKey) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return null;
  const [y, m] = monthKey.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** GA4 user totals for a calendar month — overlaps + prorates exports like /api/users. */
function getWebsiteUsersKpisForMonth(company, monthKey) {
  const range = monthKeyToDateRange(monthKey);
  if (!range) return { totalUsers: 0, newUsers: 0, returningUsers: 0 };

  const { clause, params } = buildGa4DateQuery(company, range.start, range.end);
  const rawRows = db.prepare(`SELECT * FROM user_acquisition ${clause}`).all(...params);
  const rows = prorateUsersRows(rawRows, range.start, range.end);
  return usersKpisFromRows(rows);
}

function getWebsiteUsersForMonth(company, monthKey) {
  return getWebsiteUsersKpisForMonth(company, monthKey).totalUsers;
}

function saveSocialChannelRow(company, parsedMonth, channel, views) {
  db.prepare(`
    INSERT OR REPLACE INTO social_channel_views
    (company, month_label, year, month, channel, views)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    channel,
    parseNum(views)
  );
}

function getSocialChannelViewsForMonth(company, monthKey) {
  const coFilter = company && company !== 'all' ? 'company = ? AND' : '';
  const params = company && company !== 'all' ? [company, monthKey] : [monthKey];

  const total = db.prepare(`
    SELECT COALESCE(SUM(views), 0) AS totalViews
    FROM social_channel_views
    WHERE ${coFilter} printf('%04d-%02d', year, month) = ?
  `).get(...params);

  const channels = db.prepare(`
    SELECT channel, views
    FROM social_channel_views
    WHERE ${coFilter} printf('%04d-%02d', year, month) = ?
    ORDER BY views DESC
  `).all(...params);

  return {
    totalViews: total?.totalViews || 0,
    channels,
  };
}

function saveAppDownloadRow(company, parsedMonth, platform, downloads) {
  db.prepare(`
    INSERT OR REPLACE INTO app_downloads
    (company, month_label, year, month, platform, downloads)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    platform,
    parseNum(downloads)
  );
}

function getAppDownloadsForMonth(company, monthKey) {
  const coFilter = company && company !== 'all' ? 'company = ? AND' : '';
  const params = company && company !== 'all' ? [company, monthKey] : [monthKey];

  const total = db.prepare(`
    SELECT COALESCE(SUM(downloads), 0) AS totalDownloads
    FROM app_downloads
    WHERE ${coFilter} ${MONTH_KEY_SQL.app_downloads} = ?
  `).get(...params);

  const platforms = db.prepare(`
    SELECT platform, downloads
    FROM app_downloads
    WHERE ${coFilter} ${MONTH_KEY_SQL.app_downloads} = ?
    ORDER BY downloads DESC
  `).all(...params);

  return {
    totalDownloads: total?.totalDownloads || 0,
    platforms,
  };
}

function saveNyuulyCommitRow(company, parsedMonth, data) {
  db.prepare(`
    INSERT OR REPLACE INTO nyuuly_commit_stats
    (company, month_label, year, month, nyuuly_subscribe, compass_started)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    parseNum(data.nyuuly_subscribe),
    parseNum(data.compass_started)
  );
}

function getNyuulyCommitForMonth(company, monthKey) {
  const parsed = parseMonthLabel(monthKey);
  if (!parsed) {
    return { nyuulySubscribe: 0, compassStarted: 0, month_label: null };
  }
  const coFilter = company && company !== 'all' ? 'company = ? AND' : '';
  const params = company && company !== 'all'
    ? [company, parsed.year, parsed.month]
    : [parsed.year, parsed.month];

  const row = db.prepare(`
    SELECT nyuuly_subscribe, compass_started, month_label
    FROM nyuuly_commit_stats
    WHERE ${coFilter} year = ? AND month = ?
  `).get(...params);

  return {
    nyuulySubscribe: row?.nyuuly_subscribe || 0,
    compassStarted: row?.compass_started || 0,
    month_label: row?.month_label || parsed.month_label,
  };
}

function saveWorkJapanProfileRow(company, parsedMonth, data) {
  db.prepare(`
    INSERT OR REPLACE INTO workjapan_profile_stats
    (company, month_label, year, month, mobile_number_collected, registered_visa_corrected,
     registered_station_name_corrected, registered_age_collected, jp_level_collected, rc_uploaded)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    parseNum(data.mobile_number_collected),
    parseNum(data.registered_visa_corrected),
    parseNum(data.registered_station_name_corrected),
    parseNum(data.registered_age_collected),
    parseNum(data.jp_level_collected),
    parseNum(data.rc_uploaded),
  );
}

function getWorkJapanProfileForMonth(company, monthKey) {
  const parsed = parseMonthLabel(monthKey);
  if (!parsed) {
    return {
      mobileNumberCollected: 0,
      registeredVisaCorrected: 0,
      registeredStationNameCorrected: 0,
      registeredAgeCollected: 0,
      jpLevelCollected: 0,
      rcUploaded: 0,
      month_label: null,
    };
  }
  const coFilter = company && company !== 'all' ? 'company = ? AND' : '';
  const params = company && company !== 'all'
    ? [company, parsed.year, parsed.month]
    : [parsed.year, parsed.month];

  const row = db.prepare(`
    SELECT mobile_number_collected, registered_visa_corrected, registered_station_name_corrected,
           registered_age_collected, jp_level_collected, rc_uploaded, month_label
    FROM workjapan_profile_stats
    WHERE ${coFilter} year = ? AND month = ?
  `).get(...params);

  return {
    mobileNumberCollected: row?.mobile_number_collected || 0,
    registeredVisaCorrected: row?.registered_visa_corrected || 0,
    registeredStationNameCorrected: row?.registered_station_name_corrected || 0,
    registeredAgeCollected: row?.registered_age_collected || 0,
    jpLevelCollected: row?.jp_level_collected || 0,
    rcUploaded: row?.rc_uploaded || 0,
    month_label: row?.month_label || parsed.month_label,
  };
}

function saveNyuulyProceedRow(company, parsedMonth, data) {
  db.prepare(`
    INSERT OR REPLACE INTO nyuuly_proceed_stats
    (company, month_label, year, month, add_to_cart, welcome_package_started, compass_filled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    parseNum(data.add_to_cart),
    parseNum(data.welcome_package_started),
    parseNum(data.compass_filled)
  );
}

function getNyuulyProceedForMonth(company, monthKey) {
  const parsed = parseMonthLabel(monthKey);
  if (!parsed) {
    return { addToCart: 0, welcomePackageStarted: 0, compassFilled: 0, month_label: null };
  }
  const coFilter = company && company !== 'all' ? 'company = ? AND' : '';
  const params = company && company !== 'all'
    ? [company, parsed.year, parsed.month]
    : [parsed.year, parsed.month];

  const row = db.prepare(`
    SELECT add_to_cart, welcome_package_started, compass_filled, month_label
    FROM nyuuly_proceed_stats
    WHERE ${coFilter} year = ? AND month = ?
  `).get(...params);

  return {
    addToCart: row?.add_to_cart || 0,
    welcomePackageStarted: row?.welcome_package_started || 0,
    compassFilled: row?.compass_filled || 0,
    month_label: row?.month_label || parsed.month_label,
  };
}

function saveNyuulyResultRow(company, parsedMonth, data) {
  db.prepare(`
    INSERT OR REPLACE INTO nyuuly_result_stats
    (company, month_label, year, month, mobile_sim_purchased, welcome_package_purchased, form_filled, ask_me_request)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    parseNum(data.mobile_sim_purchased),
    parseNum(data.welcome_package_purchased),
    parseNum(data.form_filled),
    parseNum(data.ask_me_request)
  );
}

function getNyuulyResultForMonth(company, monthKey) {
  const parsed = parseMonthLabel(monthKey);
  if (!parsed) {
    return {
      mobileSimPurchased: 0,
      welcomePackagePurchased: 0,
      formFilled: 0,
      askMeRequest: 0,
      month_label: null,
    };
  }
  const coFilter = company && company !== 'all' ? 'company = ? AND' : '';
  const params = company && company !== 'all'
    ? [company, parsed.year, parsed.month]
    : [parsed.year, parsed.month];

  const row = db.prepare(`
    SELECT mobile_sim_purchased, welcome_package_purchased, form_filled, ask_me_request, month_label
    FROM nyuuly_result_stats
    WHERE ${coFilter} year = ? AND month = ?
  `).get(...params);

  return {
    mobileSimPurchased: row?.mobile_sim_purchased || 0,
    welcomePackagePurchased: row?.welcome_package_purchased || 0,
    formFilled: row?.form_filled || 0,
    askMeRequest: row?.ask_me_request || 0,
    month_label: row?.month_label || parsed.month_label,
  };
}

function saveBrandMessageRow(company, parsedMonth, message) {
  db.prepare(`
    INSERT OR REPLACE INTO brand_messages
    (company, month_label, year, month, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    company,
    parsedMonth.month_label,
    parsedMonth.year,
    parsedMonth.month,
    String(message || '').trim()
  );
}

function getBrandMessageForMonth(company, monthKey) {
  const parsed = parseMonthLabel(monthKey);
  if (!parsed) return { message: '', month_label: null };
  const coFilter = company && company !== 'all' ? 'company = ? AND' : '';
  const params = company && company !== 'all'
    ? [company, parsed.year, parsed.month]
    : [parsed.year, parsed.month];

  const row = db.prepare(`
    SELECT message, month_label
    FROM brand_messages
    WHERE ${coFilter} year = ? AND month = ?
  `).get(...params);

  return {
    message: row?.message || '',
    month_label: row?.month_label || null,
  };
}

function normalizeCampaignRow(row) {
  const monthlyCost = parseNum(row.monthly_cost ?? row.monthlyCost);
  const weeklyClicks = parseNum(row.weekly_clicks ?? row.weeklyClicks);
  const weeklyResult = parseNum(row.weekly_result ?? row.weeklyResult);
  const conversionRate = weeklyClicks > 0
    ? Math.round((weeklyResult / weeklyClicks) * 10000) / 100
    : null;
  const costPerClick = weeklyClicks > 0
    ? Math.round((monthlyCost / weeklyClicks) * 100) / 100
    : null;
  const costPerResult = weeklyResult > 0
    ? Math.round((monthlyCost / weeklyResult) * 100) / 100
    : null;

  return {
    placement: row.placement || '',
    campaignType: row.campaign_type || row.campaignType || '',
    locationDetail: row.location_detail || row.locationDetail || '',
    utmOrPromo: row.utm_or_promo || row.utmOrPromo || '',
    monthlyCost,
    weeklyClicks,
    weeklyResult,
    conversionRate,
    costPerClick,
    costPerResult,
  };
}

function campaignKpisFromRows(rows) {
  const totalCost = rows.reduce((sum, row) => sum + (row.monthlyCost || 0), 0);
  const totalClicks = rows.reduce((sum, row) => sum + (row.weeklyClicks || 0), 0);
  const totalResults = rows.reduce((sum, row) => sum + (row.weeklyResult || 0), 0);
  return {
    totalCost,
    totalClicks,
    totalResults,
    costPerClick: totalClicks > 0 ? Math.round((totalCost / totalClicks) * 100) / 100 : null,
    costPerResult: totalResults > 0 ? Math.round((totalCost / totalResults) * 100) / 100 : null,
    conversionRate: totalClicks > 0
      ? Math.round((totalResults / totalClicks) * 10000) / 100
      : null,
  };
}

function saveCampaignsForMonth(company, parsedMonth, campaigns) {
  db.prepare(`
    DELETE FROM campaign_stats
    WHERE company = ? AND month_label = ?
  `).run(company, parsedMonth.month_label);

  const insert = db.prepare(`
    INSERT INTO campaign_stats
    (company, month_label, year, month, placement, campaign_type, location_detail,
     utm_or_promo, monthly_cost, weekly_clicks, weekly_result)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let saved = 0;
  for (const row of campaigns) {
    const utm = String(row.utmOrPromo || row.utm_or_promo || '').trim();
    const placement = String(row.placement || '').trim();
    if (!placement && !utm) continue;
    insert.run(
      company,
      parsedMonth.month_label,
      parsedMonth.year,
      parsedMonth.month,
      placement,
      String(row.campaignType || row.campaign_type || '').trim(),
      String(row.locationDetail || row.location_detail || '').trim(),
      utm || `${placement}`.slice(0, 80),
      parseNum(row.monthlyCost ?? row.monthly_cost),
      parseNum(row.weeklyClicks ?? row.weekly_clicks),
      parseNum(row.weeklyResult ?? row.weekly_result),
    );
    saved++;
  }
  return saved;
}

function getCampaignsForMonth(company, monthKey) {
  const coFilter = company && company !== 'all' ? 'company = ? AND' : '';
  const params = company && company !== 'all' ? [company, monthKey] : [monthKey];

  const rows = db.prepare(`
    SELECT placement, campaign_type, location_detail, utm_or_promo,
           monthly_cost, weekly_clicks, weekly_result
    FROM campaign_stats
    WHERE ${coFilter} ${MONTH_KEY_SQL.campaign_stats} = ?
    ORDER BY monthly_cost DESC, placement ASC
  `).all(...params).map(normalizeCampaignRow);

  return {
    rows,
    kpis: campaignKpisFromRows(rows),
  };
}

const MOBILE_SIM_FLOW_STEPS = [
  { key: 'apply', label: 'Apply', path: '/mobile/sim/apply' },
  { key: 'verify', label: 'Verify', path: '/mobile/sim/apply/verify' },
  { key: 'identity', label: 'Identity', path: '/mobile/sim/apply/identity' },
  { key: 'payment', label: 'Payment', path: '/mobile/sim/apply/payment' },
  { key: 'confirm', label: 'Confirm', path: '/mobile/sim/apply/confirm' },
];

function normalizePagePath(path) {
  if (!path) return '';
  let p = String(path).trim();
  try {
    if (p.startsWith('http://') || p.startsWith('https://')) {
      p = new URL(p).pathname;
    }
  } catch (_) { /* keep raw path */ }
  if (!p.startsWith('/')) p = `/${p}`;
  return p.replace(/\/+$/, '') || '/';
}

function getPageActiveUsersForPaths(company, monthKey, paths) {
  const range = monthKeyToDateRange(monthKey);
  if (!range || !paths?.length) return 0;

  const targets = new Set(paths.map(normalizePagePath));
  const { clause, params } = buildGa4DateQuery(company, range.start, range.end);
  const rawRows = db.prepare(`
    SELECT page_path, active_users
    FROM pages_screens ${clause}
  `).all(...params);
  const rows = proratePagesRows(rawRows, range.start, range.end);

  let total = 0;
  for (const row of rows) {
    if (targets.has(normalizePagePath(row.page_path))) {
      total += row.active_users || 0;
    }
  }
  return total;
}

function getPageActiveUsersForPath(company, monthKey, path) {
  return getPageActiveUsersForPaths(company, monthKey, [path]);
}

function getPageUsersMapForMonth(company, monthKey) {
  const range = monthKeyToDateRange(monthKey);
  if (!range) return {};
  const { clause, params } = buildGa4DateQuery(company, range.start, range.end);
  const rawRows = db.prepare(`
    SELECT page_path, active_users
    FROM pages_screens ${clause}
  `).all(...params);
  const rows = proratePagesRows(rawRows, range.start, range.end);
  const map = {};
  for (const row of rows) {
    const p = normalizePagePath(row.page_path);
    map[p] = (map[p] || 0) + (row.active_users || 0);
  }
  return map;
}

const COMPASS_USES_ROOT = '/compass';

const COMPASS_USES_CATEGORIES = [
  { key: 'student', label: 'Student', path: '/compass/student' },
  { key: 'self-sponsored', label: 'Self-sponsored', path: '/compass/self-sponsored' },
  { key: 'company-sponsored', label: 'Company sponsored', path: '/compass/company-sponsored' },
  { key: 'family', label: 'Family', path: '/compass/family' },
  { key: 'askme', label: 'Ask me', path: '/compass/askme' },
  { key: 'others', label: 'Others', path: '/compass/others' },
];

function buildCompassUsesFlow(company, monthKey, prevMonthKey = null) {
  const pages = getPageUsersMapForMonth(company, monthKey);
  const prevPages = prevMonthKey ? getPageUsersMapForMonth(company, prevMonthKey) : {};

  const rootUsers = pages[COMPASS_USES_ROOT] || 0;
  const rootPrev = prevPages[COMPASS_USES_ROOT] ?? null;

  const categories = COMPASS_USES_CATEGORIES.map((cat) => {
    const activeUsers = pages[cat.path] || 0;
    const prevActiveUsers = prevPages[cat.path] ?? null;
    const prefix = `${cat.path}/`;
    const children = Object.entries(pages)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, users]) => ({
        path,
        segment: path.slice(prefix.length),
        label: path.replace(/^\/compass\//, ''),
        activeUsers: users,
        prevActiveUsers: prevPages[path] ?? null,
      }))
      .sort((a, b) => b.activeUsers - a.activeUsers);

    return {
      ...cat,
      url: `https://nyuuly.com${cat.path}`,
      activeUsers,
      prevActiveUsers,
      deltaPct: deltaPct(activeUsers, prevActiveUsers),
      fromCompassPct: rootUsers > 0 ? Math.round((activeUsers / rootUsers) * 1000) / 10 : null,
      children,
      childTotal: children.reduce((s, c) => s + c.activeUsers, 0),
    };
  });

  return {
    root: {
      path: COMPASS_USES_ROOT,
      label: 'Compass',
      url: 'https://nyuuly.com/compass',
      activeUsers: rootUsers,
      prevActiveUsers: rootPrev,
      deltaPct: deltaPct(rootUsers, rootPrev),
    },
    categories,
  };
}

function buildMobileSimFlowSteps(company, monthKey, prevMonthKey = null) {
  const currentValues = MOBILE_SIM_FLOW_STEPS.map((step) => ({
    ...step,
    activeUsers: getPageActiveUsersForPath(company, monthKey, step.path),
  }));

  const prevValues = prevMonthKey
    ? Object.fromEntries(MOBILE_SIM_FLOW_STEPS.map((step) => [
      step.key,
      getPageActiveUsersForPath(company, prevMonthKey, step.path),
    ]))
    : {};

  return currentValues.map((step, index) => {
    const prevActiveUsers = prevValues[step.key] ?? null;
    const prevStepUsers = index > 0 ? currentValues[index - 1].activeUsers : null;
    const fromPrevStepPct = index > 0 && prevStepUsers > 0
      ? Math.round((step.activeUsers / prevStepUsers) * 1000) / 10
      : null;
    return {
      key: step.key,
      label: step.label,
      path: step.path,
      url: `https://nyuuly.com${step.path}`,
      activeUsers: step.activeUsers,
      prevActiveUsers,
      deltaPct: deltaPct(step.activeUsers, prevActiveUsers),
      fromPrevStepPct,
    };
  });
}

function getMobileSimFlowForMonth(company, monthKey) {
  return { steps: buildMobileSimFlowSteps(company, monthKey) };
}

function getPlatformRegistrationsForMonth(company, monthKey) {
  const parsed = parseMonthLabel(monthKey);
  if (!parsed) return { totalRegistrations: 0, platforms: [] };

  const coFilter = company && company !== 'all' ? 'company = ? AND' : '';
  const params = company && company !== 'all' ? [company, parsed.year, parsed.month] : [parsed.year, parsed.month];

  const rows = db.prepare(`
    SELECT platform, registrations, active_users
    FROM platform_stats
    WHERE ${coFilter} year = ? AND month = ?
  `).all(...params);

  const platformMap = Object.fromEntries(
    PLATFORM_REG_PLATFORMS.map((p) => [p, { platform: p, registrations: 0, active_users: 0 }])
  );
  for (const row of rows) {
    if (platformMap[row.platform]) {
      platformMap[row.platform].registrations = row.registrations || 0;
      platformMap[row.platform].active_users = row.active_users || 0;
    }
  }
  const platforms = PLATFORM_REG_PLATFORMS.map((p) => platformMap[p]);
  return {
    totalRegistrations: platforms.reduce((s, p) => s + p.registrations, 0),
    platforms,
  };
}

function getApplicantStatsForMonth(company, monthKey) {
  const parsed = parseMonthLabel(monthKey);
  if (!parsed) {
    return { uniqueApplicants: 0, totalApplications: 0 };
  }
  const coFilter = company && company !== 'all' ? 'company = ? AND' : '';
  const params = company && company !== 'all'
    ? [company, parsed.year, parsed.month]
    : [parsed.year, parsed.month];

  const row = db.prepare(`
    SELECT unique_applicants, screening_passes, total_applications,
           interviews_fixed, remaining_esp, selected
    FROM applicant_stats
    WHERE ${coFilter} year = ? AND month = ?
  `).get(...params);

  return {
    uniqueApplicants: row?.unique_applicants || 0,
    screeningPasses: row?.screening_passes || 0,
    totalApplications: row?.total_applications || 0,
    interviewsFixed: row?.interviews_fixed || 0,
    remainingEsp: row?.remaining_esp || 0,
    selected: row?.selected || 0,
  };
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

  const socialChannelRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM social_channel_views WHERE company = ?
  `).get(company);

  const appDownloadRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM app_downloads WHERE company = ?
  `).get(company);

  const nyuulyCommitRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM nyuuly_commit_stats WHERE company = ?
  `).get(company);

  const nyuulyProceedRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM nyuuly_proceed_stats WHERE company = ?
  `).get(company);

  const nyuulyResultRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM nyuuly_result_stats WHERE company = ?
  `).get(company);

  const brandMessageRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM brand_messages WHERE company = ?
  `).get(company);

  const campaignRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM campaign_stats WHERE company = ?
  `).get(company);

  const wjProfileRows = db.prepare(`
    SELECT COUNT(*) as count, MAX(month_label) as latestMonth, MAX(upload_date) as lastUpdated
    FROM workjapan_profile_stats WHERE company = ?
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
    'social-channels': statusBlock(socialChannelRows),
    'app-downloads': statusBlock(appDownloadRows),
    'nyuuly-commit': statusBlock(nyuulyCommitRows),
    'nyuuly-proceed': statusBlock(nyuulyProceedRows),
    'nyuuly-result': statusBlock(nyuulyResultRows),
    'brand-message': statusBlock(brandMessageRows),
    campaigns: statusBlock(campaignRows),
    'workjapan-profile': statusBlock(wjProfileRows),
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

function hasDataForMonth(company, fileType, monthKey) {
  const co = company && company !== 'all' ? 'company = ? AND' : '';
  const baseParams = company && company !== 'all' ? [company] : [];

  switch (fileType) {
    case 'users':
      return db.prepare(`
        SELECT COUNT(*) AS c FROM user_acquisition
        WHERE ${co} ${MONTH_KEY_SQL.user_acquisition} = ?
      `).get(...baseParams, monthKey).c > 0;
    case 'pages':
      return db.prepare(`
        SELECT COUNT(*) AS c FROM pages_screens
        WHERE ${co} ${MONTH_KEY_SQL.pages_screens} = ?
      `).get(...baseParams, monthKey).c > 0;
    case 'funnel':
      return db.prepare(`
        SELECT COUNT(*) AS c FROM funnel_data
        WHERE ${co} ${MONTH_KEY_SQL.funnel_data} = ?
      `).get(...baseParams, monthKey).c > 0;
    case 'social':
      return db.prepare(`
        SELECT COUNT(*) AS c FROM social_posts
        WHERE ${co} ${MONTH_KEY_SQL.social_posts} = ?
      `).get(...baseParams, monthKey).c > 0;
    case 'gsc':
      return db.prepare(`
        SELECT COUNT(*) AS c FROM search_console_stats
        WHERE ${co} ${MONTH_KEY_SQL.search_console_stats} = ?
      `).get(...baseParams, monthKey).c > 0;
    default:
      return false;
  }
}

function getUploadStatusByMonth(company) {
  const allMonths = getAvailableMonths(company);
  const months = allMonths.length > 6 ? allMonths.slice(-6) : allMonths;
  const grid = {};
  for (const monthKey of months) {
    grid[monthKey] = {};
    for (const type of FILE_TYPES) {
      grid[monthKey][type] = hasDataForMonth(company, type, monthKey);
    }
  }
  return { months, grid };
}

function getCombinedAvailableMonths() {
  const set = new Set([
    ...getAvailableMonths('workjapan'),
    ...getAvailableMonths('nyuuly'),
  ]);
  return [...set].sort();
}

function getUsersByChannelForMonth(company, monthKey) {
  const range = monthKeyToDateRange(monthKey);
  if (!range) return {};
  const { clause, params } = buildGa4DateQuery(company, range.start, range.end);
  const rawRows = db.prepare(`
    SELECT channel_group, total_users
    FROM user_acquisition ${clause}
  `).all(...params);
  const rows = prorateUsersRows(rawRows, range.start, range.end);
  const map = {};
  for (const row of rows) {
    const ch = row.channel_group || 'Unknown';
    map[ch] = (map[ch] || 0) + (row.total_users || 0);
  }
  return map;
}

function metricBlock(value, prevValue) {
  const v = value || 0;
  const p = prevValue ?? null;
  return { value: v, prevValue: p, deltaPct: deltaPct(v, p) };
}

function companySplit(wjVal, nyVal, wjPrev, nyPrev) {
  const total = (wjVal || 0) + (nyVal || 0);
  const prevTotal = wjPrev != null || nyPrev != null
    ? (wjPrev || 0) + (nyPrev || 0)
    : null;
  return {
    total: metricBlock(total, prevTotal),
    workjapan: { value: wjVal || 0, prevValue: wjPrev ?? null },
    nyuuly: { value: nyVal || 0, prevValue: nyPrev ?? null },
    workjapanPct: total > 0 ? Math.round(((wjVal || 0) / total) * 1000) / 10 : 0,
    nyuulyPct: total > 0 ? Math.round(((nyVal || 0) / total) * 1000) / 10 : 0,
  };
}

function buildStageMetricItems(items, prevResolver) {
  const enriched = items.map((item) => {
    const value = (item.workjapan || 0) + (item.nyuuly || 0);
    const prevValue = prevResolver ? prevResolver(item) : null;
    return { ...item, value, ...metricBlock(value, prevValue) };
  });
  const total = enriched.reduce((s, i) => s + i.value, 0);
  const prevTotal = enriched.every((i) => i.prevValue == null)
    ? null
    : enriched.reduce((s, i) => s + (i.prevValue || 0), 0);
  enriched.forEach((item) => {
    item.pct = total > 0 ? Math.round((item.value / total) * 1000) / 10 : 0;
  });
  return {
    total: metricBlock(total, prevTotal),
    items: enriched,
  };
}

function buildCombinedFunnelData(monthKey) {
  const wj = monthlyKpisForMonth('workjapan', monthKey);
  const ny = monthlyKpisForMonth('nyuuly', monthKey);
  const months = getCombinedAvailableMonths();
  const idx = months.indexOf(monthKey);
  const prevKey = idx > 0 ? months[idx - 1] : null;
  const wjPrev = prevKey ? monthlyKpisForMonth('workjapan', prevKey) : null;
  const nyPrev = prevKey ? monthlyKpisForMonth('nyuuly', prevKey) : null;

  const wjChannels = getUsersByChannelForMonth('workjapan', monthKey);
  const nyChannels = getUsersByChannelForMonth('nyuuly', monthKey);
  const channelSet = new Set([...Object.keys(wjChannels), ...Object.keys(nyChannels)]);
  const totalUsersVal = (wj.totalUsers || 0) + (ny.totalUsers || 0);
  const channels = [...channelSet].map((ch) => {
    const w = wjChannels[ch] || 0;
    const n = nyChannels[ch] || 0;
    const t = w + n;
    return {
      channel: ch,
      workjapan: w,
      nyuuly: n,
      total: t,
      pct: totalUsersVal > 0 ? Math.round((t / totalUsersVal) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.total - a.total);

  const awareness = {
    gscImpressions: companySplit(wj.gscImpressions, ny.gscImpressions, wjPrev?.gscImpressions, nyPrev?.gscImpressions),
    socialChannelViews: companySplit(wj.socialChannelViews, ny.socialChannelViews, wjPrev?.socialChannelViews, nyPrev?.socialChannelViews),
    socialPostViews: companySplit(wj.socialViews, ny.socialViews, wjPrev?.socialViews, nyPrev?.socialViews),
    brandMessages: {
      workjapan: getBrandMessageForMonth('workjapan', monthKey).message,
      nyuuly: getBrandMessageForMonth('nyuuly', monthKey).message,
    },
  };

  const consideration = {
    totalUsers: companySplit(wj.totalUsers, ny.totalUsers, wjPrev?.totalUsers, nyPrev?.totalUsers),
    channels,
    sourceBreakdown: websiteUsersSourceBreakdownFromChannelMap(
      Object.fromEntries(channels.map((c) => [c.channel, c.total])),
    ),
  };

  const commit = {
    totalSignUps: companySplit(wj.registrations, ny.nyuulySubscribe, wjPrev?.registrations, nyPrev?.nyuulySubscribe),
    totalAppDownloads: companySplit(wj.appDownloads, ny.appDownloads, wjPrev?.appDownloads, nyPrev?.appDownloads),
    compassStarted: companySplit(0, ny.compassStarted, 0, nyPrev?.compassStarted),
  };

  const nyMobileSim = getMobileSimFlowForMonth('nyuuly', monthKey).steps;
  const nyMobileSimPrev = prevKey ? getMobileSimFlowForMonth('nyuuly', prevKey).steps : [];
  const nyStep = (key) => nyMobileSim.find((s) => s.key === key)?.activeUsers || 0;
  const nyStepPrev = (key) => nyMobileSimPrev.find((s) => s.key === key)?.activeUsers || 0;

  const proceed = buildStageMetricItems([
    { key: 'totalApplications', label: 'Applications', company: 'WORK JAPAN', workjapan: wj.totalApplications || 0, nyuuly: 0 },
    { key: 'mobileSimApply', label: 'Mobile Sim — Apply', company: 'Nyuuly', workjapan: 0, nyuuly: nyStep('apply') },
    { key: 'mobileSimVerify', label: 'Mobile Sim — Verify', company: 'Nyuuly', workjapan: 0, nyuuly: nyStep('verify') },
    { key: 'mobileSimIdentity', label: 'Mobile Sim — Identity', company: 'Nyuuly', workjapan: 0, nyuuly: nyStep('identity') },
    { key: 'mobileSimPayment', label: 'Mobile Sim — Payment', company: 'Nyuuly', workjapan: 0, nyuuly: nyStep('payment') },
    { key: 'mobileSimConfirm', label: 'Mobile Sim — Confirm', company: 'Nyuuly', workjapan: 0, nyuuly: nyStep('confirm') },
  ], (item) => {
    if (!prevKey) return null;
    if (item.key === 'totalApplications') return wjPrev?.totalApplications || 0;
    const stepMap = {
      mobileSimApply: 'apply',
      mobileSimVerify: 'verify',
      mobileSimIdentity: 'identity',
      mobileSimPayment: 'payment',
      mobileSimConfirm: 'confirm',
    };
    return nyStepPrev(stepMap[item.key] || item.key);
  });

  const result = buildStageMetricItems([
    { key: 'selected', label: 'Selected', company: 'WORK JAPAN', workjapan: wj.selected || 0, nyuuly: 0 },
    { key: 'interviewsFixed', label: 'Interviews fixed', company: 'WORK JAPAN', workjapan: wj.interviewsFixed || 0, nyuuly: 0 },
    { key: 'screeningPasses', label: 'Screening passes', company: 'WORK JAPAN', workjapan: wj.screeningPasses || 0, nyuuly: 0 },
    { key: 'remainingEsp', label: 'Remaining ESP', company: 'WORK JAPAN', workjapan: wj.remainingEsp || 0, nyuuly: 0 },
    { key: 'mobileSimPurchased', label: 'Mobile Sim purchased', company: 'Nyuuly', workjapan: 0, nyuuly: ny.mobileSimPurchased || 0 },
    { key: 'welcomePackagePurchased', label: 'Welcome package purchased', company: 'Nyuuly', workjapan: 0, nyuuly: ny.welcomePackagePurchased || 0 },
    { key: 'formFilled', label: 'Form filled', company: 'Nyuuly', workjapan: 0, nyuuly: ny.formFilled || 0 },
    { key: 'askMeRequest', label: 'Ask me request', company: 'Nyuuly', workjapan: 0, nyuuly: ny.askMeRequest || 0 },
  ], (item) => {
    if (!prevKey) return null;
    if (item.company === 'WORK JAPAN') return wjPrev?.[item.key] || 0;
    return nyPrev?.[item.key] || 0;
  });

  return {
    month: monthKey,
    monthLabel: monthKeyLabel(monthKey),
    prevMonth: prevKey,
    prevMonthLabel: prevKey ? monthKeyLabel(prevKey) : null,
    pipeline: {
      awareness: {
        gscImpressions: awareness.gscImpressions,
        socialChannelViews: awareness.socialChannelViews,
      },
      consideration: consideration.totalUsers,
      commit: commit.totalSignUps,
      proceed: proceed.total,
      result: result.total,
    },
    stages: { awareness, consideration, commit, proceed, result },
    months: months.map((key) => ({ key, label: monthKeyLabel(key) })),
  };
}

// --- Routes ---

app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.get('/combined', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'combined.html'));
});

app.get('/campaigns', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'campaigns.html'));
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

    const isZip = req.file.originalname.toLowerCase().endsWith('.zip') || expectedType === 'gsc';

    if (isZip) {
      if (expectedType && expectedType !== 'gsc') {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Zip uploads are only supported for Search Console (gsc).' });
      }

      const override = req.body.month ? monthRangeFromKey(req.body.month) : null;
      if (!override) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Month is required for Search Console uploads. Use format YYYY-MM.' });
      }

      const buffer = fs.readFileSync(req.file.path);
      const { added, skipped } = parseGscZip(buffer, company, override);
      logUpload(req.file.originalname, company, 'gsc', added, skipped);
      fs.unlinkSync(req.file.path);

      return res.json({
        rowsAdded: added,
        rowsSkipped: skipped,
        fileType: 'gsc',
        company,
        month: req.body.month,
      });
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

    let override = null;
    if (req.body.month) {
      override = monthRangeFromKey(req.body.month);
      if (!override) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid month. Use format YYYY-MM.' });
      }
    }

    const { added, skipped } = parseCsv(content, fileType, company, override);
    logUpload(req.file.originalname, company, fileType, added, skipped);
    fs.unlinkSync(req.file.path);

    res.json({
      rowsAdded: added,
      rowsSkipped: skipped,
      fileType,
      company,
      month: override ? req.body.month : null,
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

app.post('/api/manual/social-channels', uploadLimiter, (req, res) => {
  try {
    const { company, month, channels } = req.body;
    if (!company || !['nyuuly', 'workjapan'].includes(company)) {
      return res.status(400).json({ error: 'Invalid company' });
    }
    if (!month) return res.status(400).json({ error: 'Month is required' });
    if (!Array.isArray(channels) || !channels.length) {
      return res.status(400).json({ error: 'At least one channel row is required' });
    }

    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });

    let saved = 0;
    for (const row of channels) {
      if (!row.channel || !SOCIAL_CHANNELS.includes(row.channel)) continue;
      if (row.views === '' || row.views == null) continue;
      saveSocialChannelRow(company, parsedMonth, row.channel, row.views);
      saved++;
    }

    if (!saved) return res.status(400).json({ error: 'No valid channel rows to save' });

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'social-channels', saved, 0);
    res.json({ success: true, rowsAdded: saved, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual/brand-message', uploadLimiter, (req, res) => {
  try {
    const { company, month, message } = req.body;
    if (!company || !['nyuuly', 'workjapan'].includes(company)) {
      return res.status(400).json({ error: 'Invalid company' });
    }
    if (!month) return res.status(400).json({ error: 'Month is required' });
    if (message == null || String(message).trim() === '') {
      return res.status(400).json({ error: 'Brand message is required' });
    }

    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });

    saveBrandMessageRow(company, parsedMonth, message);

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'brand-message', 1, 0);
    res.json({ success: true, rowsAdded: 1, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual/campaigns', uploadLimiter, (req, res) => {
  try {
    const { company, month, campaigns } = req.body;
    if (!company || !['nyuuly', 'workjapan'].includes(company)) {
      return res.status(400).json({ error: 'Invalid company' });
    }
    if (!month) return res.status(400).json({ error: 'Month is required' });
    if (!Array.isArray(campaigns)) {
      return res.status(400).json({ error: 'Campaign rows are required' });
    }

    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });

    const saved = saveCampaignsForMonth(company, parsedMonth, campaigns);
    if (!saved) return res.status(400).json({ error: 'Add at least one campaign with placement or UTM/promo code' });

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'campaigns', saved, 0);
    res.json({ success: true, rowsAdded: saved, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual/app-downloads', uploadLimiter, (req, res) => {
  try {
    const { company, month, platforms } = req.body;
    if (!company || !['nyuuly', 'workjapan'].includes(company)) {
      return res.status(400).json({ error: 'Invalid company' });
    }
    if (!month) return res.status(400).json({ error: 'Month is required' });
    if (!Array.isArray(platforms) || !platforms.length) {
      return res.status(400).json({ error: 'At least one platform row is required' });
    }

    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });

    let saved = 0;
    for (const row of platforms) {
      if (!row.platform || !APP_DOWNLOAD_PLATFORMS.includes(row.platform)) continue;
      if (row.downloads === '' || row.downloads == null) continue;
      saveAppDownloadRow(company, parsedMonth, row.platform, row.downloads);
      saved++;
    }

    if (!saved) return res.status(400).json({ error: 'No valid platform rows to save' });

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'app-downloads', saved, 0);
    res.json({ success: true, rowsAdded: saved, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual/nyuuly-proceed', uploadLimiter, (req, res) => {
  try {
    const { company, month, add_to_cart, welcome_package_started, compass_filled } = req.body;
    if (company !== 'nyuuly') {
      return res.status(400).json({ error: 'Nyuuly proceed data is only available for Nyuuly' });
    }
    if (!month) return res.status(400).json({ error: 'Month is required' });

    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });

    if (add_to_cart === '' && welcome_package_started === '' && compass_filled === '') {
      return res.status(400).json({ error: 'Enter at least one metric' });
    }

    saveNyuulyProceedRow(company, parsedMonth, {
      add_to_cart: add_to_cart ?? 0,
      welcome_package_started: welcome_package_started ?? 0,
      compass_filled: compass_filled ?? 0,
    });

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'nyuuly-proceed', 1, 0);
    res.json({ success: true, rowsAdded: 1, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual/nyuuly-result', uploadLimiter, (req, res) => {
  try {
    const {
      company,
      month,
      mobile_sim_purchased,
      welcome_package_purchased,
      form_filled,
      ask_me_request,
    } = req.body;
    if (company !== 'nyuuly') {
      return res.status(400).json({ error: 'Nyuuly result data is only available for Nyuuly' });
    }
    if (!month) return res.status(400).json({ error: 'Month is required' });

    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });

    if (
      mobile_sim_purchased === ''
      && welcome_package_purchased === ''
      && form_filled === ''
      && ask_me_request === ''
    ) {
      return res.status(400).json({ error: 'Enter at least one metric' });
    }

    saveNyuulyResultRow(company, parsedMonth, {
      mobile_sim_purchased: mobile_sim_purchased ?? 0,
      welcome_package_purchased: welcome_package_purchased ?? 0,
      form_filled: form_filled ?? 0,
      ask_me_request: ask_me_request ?? 0,
    });

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'nyuuly-result', 1, 0);
    res.json({ success: true, rowsAdded: 1, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual/nyuuly-commit', uploadLimiter, (req, res) => {
  try {
    const { company, month, nyuuly_subscribe, compass_started } = req.body;
    if (company !== 'nyuuly') {
      return res.status(400).json({ error: 'Nyuuly commit data is only available for Nyuuly' });
    }
    if (!month) return res.status(400).json({ error: 'Month is required' });

    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });

    if (nyuuly_subscribe === '' && compass_started === '') {
      return res.status(400).json({ error: 'Enter at least one metric' });
    }

    saveNyuulyCommitRow(company, parsedMonth, {
      nyuuly_subscribe: nyuuly_subscribe ?? 0,
      compass_started: compass_started ?? 0,
    });

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'nyuuly-commit', 1, 0);
    res.json({ success: true, rowsAdded: 1, month: parsedMonth.month_label, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/manual/workjapan-profile', uploadLimiter, (req, res) => {
  try {
    const { company, month, mobile_number_collected, registered_visa_corrected,
      registered_station_name_corrected, registered_age_collected, jp_level_collected, rc_uploaded } = req.body;
    if (company !== 'workjapan') {
      return res.status(400).json({ error: 'Profile step data is only available for WORK JAPAN' });
    }
    if (!month) return res.status(400).json({ error: 'Month is required' });

    const parsedMonth = parseMonthLabel(month);
    if (!parsedMonth) return res.status(400).json({ error: 'Invalid month format' });

    const values = [mobile_number_collected, registered_visa_corrected, registered_station_name_corrected,
      registered_age_collected, jp_level_collected, rc_uploaded];
    if (values.every((v) => v === '' || v == null)) {
      return res.status(400).json({ error: 'Enter at least one profile step count' });
    }

    saveWorkJapanProfileRow(company, parsedMonth, {
      mobile_number_collected: mobile_number_collected ?? 0,
      registered_visa_corrected: registered_visa_corrected ?? 0,
      registered_station_name_corrected: registered_station_name_corrected ?? 0,
      registered_age_collected: registered_age_collected ?? 0,
      jp_level_collected: jp_level_collected ?? 0,
      rc_uploaded: rc_uploaded ?? 0,
    });

    logUpload(`Manual entry — ${parsedMonth.month_label}`, company, 'workjapan-profile', 1, 0);
    res.json({ success: true, rowsAdded: 1, month: parsedMonth.month_label, company });
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

app.get('/api/users', (req, res) => {
  const { company, start, end } = req.query;
  const { clause, params } = buildGa4DateQuery(company, start, end);

  const rawRows = db.prepare(`SELECT * FROM user_acquisition ${clause} ORDER BY total_users DESC`).all(...params);
  const rows = start && end ? prorateUsersRows(rawRows, start, end) : rawRows;
  const kpis = usersKpisFromRows(rows);
  const sourceBreakdown = websiteUsersSourceBreakdown(rows);

  res.json({ rows, kpis, sourceBreakdown, filter: { company, start, end } });
});

app.get('/api/pages', (req, res) => {
  const { company, start, end } = req.query;
  const { clause, params } = buildGa4DateQuery(company, start, end);

  const rawRows = db.prepare(`SELECT * FROM pages_screens ${clause} ORDER BY views DESC`).all(...params);
  const rows = start && end ? proratePagesRows(rawRows, start, end) : rawRows;

  res.json({ rows, filter: { company, start, end } });
});

app.get('/api/social-channels/history', (req, res) => {
  const { company } = req.query;
  const months = getAvailableMonths(company).slice(-6);
  const history = months.map((monthKey) => {
    const data = getSocialChannelViewsForMonth(company, monthKey);
    const channelMap = Object.fromEntries(SOCIAL_CHANNELS.map((c) => [c, 0]));
    for (const row of data.channels) channelMap[row.channel] = row.views;
    return {
      month: monthKey,
      label: monthKeyLabel(monthKey),
      totalViews: data.totalViews,
      channels: SOCIAL_CHANNELS.map((channel) => ({ channel, views: channelMap[channel] || 0 })),
    };
  });
  res.json({ history, filter: { company } });
});

app.get('/api/users/history', (req, res) => {
  const { company } = req.query;
  const months = getAvailableMonths(company).slice(-6);
  const history = months.map((monthKey) => ({
    month: monthKey,
    label: monthKeyLabel(monthKey),
    totalUsers: getWebsiteUsersForMonth(company, monthKey),
  }));
  res.json({ history, filter: { company } });
});

app.get('/api/app-downloads/history', (req, res) => {
  const { company } = req.query;
  const months = getAvailableMonths(company).slice(-6);
  const history = months.map((monthKey) => {
    const data = getAppDownloadsForMonth(company, monthKey);
    const platformMap = Object.fromEntries(APP_DOWNLOAD_PLATFORMS.map((p) => [p, 0]));
    for (const row of data.platforms) platformMap[row.platform] = row.downloads;
    return {
      month: monthKey,
      label: monthKeyLabel(monthKey),
      totalDownloads: data.totalDownloads,
      platforms: APP_DOWNLOAD_PLATFORMS.map((platform) => ({
        platform,
        downloads: platformMap[platform] || 0,
      })),
    };
  });
  res.json({ history, filter: { company } });
});

app.get('/api/compass-uses-flow', (req, res) => {
  const { company, start, end } = req.query;
  if (company !== 'nyuuly') {
    return res.status(400).json({ error: 'Compass uses flow is only available for Nyuuly' });
  }
  const monthKey = start?.slice(0, 7);
  if (!monthKey) {
    return res.json({
      root: { path: COMPASS_USES_ROOT, label: 'Compass', activeUsers: 0, deltaPct: null },
      categories: COMPASS_USES_CATEGORIES.map((c) => ({ ...c, activeUsers: 0, children: [], deltaPct: null })),
      filter: { company, start, end },
    });
  }

  const months = getAvailableMonths(company);
  const idx = months.indexOf(monthKey);
  const prevKey = idx > 0 ? months[idx - 1] : null;
  const flow = buildCompassUsesFlow(company, monthKey, prevKey);

  res.json({
    ...flow,
    filter: { company, start, end, month: monthKey },
    prevMonth: prevKey,
    prevMonthLabel: prevKey ? monthKeyLabel(prevKey) : null,
  });
});

app.get('/api/compass-uses-flow/history', (req, res) => {
  const { company } = req.query;
  if (company !== 'nyuuly') {
    return res.status(400).json({ error: 'Compass uses flow is only available for Nyuuly' });
  }
  const months = getAvailableMonths(company).slice(-6);
  const history = months.map((monthKey) => {
    const { root, categories } = buildCompassUsesFlow(company, monthKey);
    const entry = {
      month: monthKey,
      label: monthKeyLabel(monthKey),
      compass: root.activeUsers,
    };
    for (const cat of categories) {
      entry[cat.key] = cat.activeUsers;
    }
    return entry;
  });
  res.json({ history, filter: { company } });
});

app.get('/api/platform-stats/history', (req, res) => {
  const { company } = req.query;
  const months = getAvailableMonths(company).slice(-6);
  const history = months.map((monthKey) => {
    const data = getPlatformRegistrationsForMonth(company, monthKey);
    return {
      month: monthKey,
      label: monthKeyLabel(monthKey),
      totalRegistrations: data.totalRegistrations,
      platforms: data.platforms,
    };
  });
  res.json({ history, filter: { company } });
});

app.get('/api/applicant-stats/history', (req, res) => {
  const { company } = req.query;
  const months = getAvailableMonths(company).slice(-6);
  const history = months.map((monthKey) => {
    const data = getApplicantStatsForMonth(company, monthKey);
    return {
      month: monthKey,
      label: monthKeyLabel(monthKey),
      uniqueApplicants: data.uniqueApplicants,
      screeningPasses: data.screeningPasses,
      totalApplications: data.totalApplications,
      interviewsFixed: data.interviewsFixed,
      remainingEsp: data.remainingEsp,
      selected: data.selected,
    };
  });
  res.json({ history, filter: { company } });
});

app.get('/api/mobile-sim-flow', (req, res) => {
  const { company, start, end } = req.query;
  if (company !== 'nyuuly') {
    return res.status(400).json({ error: 'Mobile Sim flow is only available for Nyuuly' });
  }
  const monthKey = start?.slice(0, 7);
  if (!monthKey) {
    return res.json({
      steps: MOBILE_SIM_FLOW_STEPS.map((s) => ({ ...s, activeUsers: 0, prevActiveUsers: null, deltaPct: null, fromPrevStepPct: null })),
      filter: { company, start, end },
    });
  }

  const months = getAvailableMonths(company);
  const idx = months.indexOf(monthKey);
  const prevKey = idx > 0 ? months[idx - 1] : null;
  const steps = buildMobileSimFlowSteps(company, monthKey, prevKey);

  res.json({
    steps,
    filter: { company, start, end, month: monthKey },
    prevMonth: prevKey,
    prevMonthLabel: prevKey ? monthKeyLabel(prevKey) : null,
  });
});

app.get('/api/mobile-sim-flow/history', (req, res) => {
  const { company } = req.query;
  if (company !== 'nyuuly') {
    return res.status(400).json({ error: 'Mobile Sim flow is only available for Nyuuly' });
  }
  const months = getAvailableMonths(company).slice(-6);
  const history = months.map((monthKey) => {
    const { steps } = getMobileSimFlowForMonth(company, monthKey);
    const entry = {
      month: monthKey,
      label: monthKeyLabel(monthKey),
    };
    for (const step of steps) {
      entry[step.key] = step.activeUsers;
    }
    return entry;
  });
  res.json({ history, filter: { company } });
});

app.get('/api/nyuuly-commit-stats', (req, res) => {
  const { company, start, end } = req.query;
  if (company !== 'nyuuly') {
    return res.status(400).json({ error: 'Nyuuly commit stats are only available for Nyuuly' });
  }
  const monthKey = start?.slice(0, 7);
  if (!monthKey) {
    return res.json({
      kpis: { nyuulySubscribe: 0, compassStarted: 0 },
      latest: null,
      filter: { company, start, end },
    });
  }
  const data = getNyuulyCommitForMonth(company, monthKey);
  res.json({
    kpis: { nyuulySubscribe: data.nyuulySubscribe, compassStarted: data.compassStarted },
    latest: data.month_label ? {
      month_label: data.month_label,
      nyuuly_subscribe: data.nyuulySubscribe,
      compass_started: data.compassStarted,
    } : null,
    filter: { company, start, end, month: monthKey },
  });
});

app.get('/api/nyuuly-commit-stats/history', (req, res) => {
  const { company } = req.query;
  if (company !== 'nyuuly') {
    return res.status(400).json({ error: 'Nyuuly commit stats are only available for Nyuuly' });
  }
  const months = getAvailableMonths(company).slice(-6);
  const history = months.map((monthKey) => {
    const data = getNyuulyCommitForMonth(company, monthKey);
    return {
      month: monthKey,
      label: monthKeyLabel(monthKey),
      nyuulySubscribe: data.nyuulySubscribe,
      compassStarted: data.compassStarted,
    };
  });
  res.json({ history, filter: { company } });
});

app.get('/api/workjapan-profile-stats', (req, res) => {
  const { company, start, end } = req.query;
  if (company !== 'workjapan') {
    return res.status(400).json({ error: 'Profile step stats are only available for WORK JAPAN' });
  }
  const monthKey = start?.slice(0, 7);
  if (!monthKey) {
    return res.json({
      kpis: {
        mobileNumberCollected: 0,
        registeredVisaCorrected: 0,
        registeredStationNameCorrected: 0,
        registeredAgeCollected: 0,
        jpLevelCollected: 0,
        rcUploaded: 0,
      },
      latest: null,
      filter: { company, start, end },
    });
  }
  const data = getWorkJapanProfileForMonth(company, monthKey);
  res.json({
    kpis: {
      mobileNumberCollected: data.mobileNumberCollected,
      registeredVisaCorrected: data.registeredVisaCorrected,
      registeredStationNameCorrected: data.registeredStationNameCorrected,
      registeredAgeCollected: data.registeredAgeCollected,
      jpLevelCollected: data.jpLevelCollected,
      rcUploaded: data.rcUploaded,
    },
    latest: data.month_label ? {
      month_label: data.month_label,
      mobile_number_collected: data.mobileNumberCollected,
      registered_visa_corrected: data.registeredVisaCorrected,
      registered_station_name_corrected: data.registeredStationNameCorrected,
      registered_age_collected: data.registeredAgeCollected,
      jp_level_collected: data.jpLevelCollected,
      rc_uploaded: data.rcUploaded,
    } : null,
    filter: { company, start, end, month: monthKey },
  });
});

app.get('/api/workjapan-profile-stats/history', (req, res) => {
  const { company } = req.query;
  if (company !== 'workjapan') {
    return res.status(400).json({ error: 'Profile step stats are only available for WORK JAPAN' });
  }
  const months = getAvailableMonths(company).slice(-6);
  const history = months.map((monthKey) => {
    const data = getWorkJapanProfileForMonth(company, monthKey);
    return {
      month: monthKey,
      label: monthKeyLabel(monthKey),
      mobileNumberCollected: data.mobileNumberCollected,
      registeredVisaCorrected: data.registeredVisaCorrected,
      registeredStationNameCorrected: data.registeredStationNameCorrected,
      registeredAgeCollected: data.registeredAgeCollected,
      jpLevelCollected: data.jpLevelCollected,
      rcUploaded: data.rcUploaded,
    };
  });
  res.json({ history, filter: { company } });
});

app.get('/api/nyuuly-proceed-stats', (req, res) => {
  const { company, start, end } = req.query;
  if (company !== 'nyuuly') {
    return res.status(400).json({ error: 'Nyuuly proceed stats are only available for Nyuuly' });
  }
  const monthKey = start?.slice(0, 7);
  if (!monthKey) {
    return res.json({
      kpis: { addToCart: 0, welcomePackageStarted: 0, compassFilled: 0 },
      latest: null,
      filter: { company, start, end },
    });
  }
  const data = getNyuulyProceedForMonth(company, monthKey);
  res.json({
    kpis: {
      addToCart: data.addToCart,
      welcomePackageStarted: data.welcomePackageStarted,
      compassFilled: data.compassFilled,
    },
    latest: data.month_label ? {
      month_label: data.month_label,
      add_to_cart: data.addToCart,
      welcome_package_started: data.welcomePackageStarted,
      compass_filled: data.compassFilled,
    } : null,
    filter: { company, start, end, month: monthKey },
  });
});

app.get('/api/nyuuly-proceed-stats/history', (req, res) => {
  const { company } = req.query;
  if (company !== 'nyuuly') {
    return res.status(400).json({ error: 'Nyuuly proceed stats are only available for Nyuuly' });
  }
  const months = getAvailableMonths(company).slice(-6);
  const history = months.map((monthKey) => {
    const data = getNyuulyProceedForMonth(company, monthKey);
    return {
      month: monthKey,
      label: monthKeyLabel(monthKey),
      addToCart: data.addToCart,
      welcomePackageStarted: data.welcomePackageStarted,
      compassFilled: data.compassFilled,
    };
  });
  res.json({ history, filter: { company } });
});

app.get('/api/nyuuly-result-stats', (req, res) => {
  const { company, start, end } = req.query;
  if (company !== 'nyuuly') {
    return res.status(400).json({ error: 'Nyuuly result stats are only available for Nyuuly' });
  }
  const monthKey = start?.slice(0, 7);
  if (!monthKey) {
    return res.json({
      kpis: {
        mobileSimPurchased: 0,
        welcomePackagePurchased: 0,
        formFilled: 0,
        askMeRequest: 0,
      },
      latest: null,
      filter: { company, start, end },
    });
  }
  const data = getNyuulyResultForMonth(company, monthKey);
  res.json({
    kpis: {
      mobileSimPurchased: data.mobileSimPurchased,
      welcomePackagePurchased: data.welcomePackagePurchased,
      formFilled: data.formFilled,
      askMeRequest: data.askMeRequest,
    },
    latest: data.month_label ? {
      month_label: data.month_label,
      mobile_sim_purchased: data.mobileSimPurchased,
      welcome_package_purchased: data.welcomePackagePurchased,
      form_filled: data.formFilled,
      ask_me_request: data.askMeRequest,
    } : null,
    filter: { company, start, end, month: monthKey },
  });
});

app.get('/api/nyuuly-result-stats/history', (req, res) => {
  const { company } = req.query;
  if (company !== 'nyuuly') {
    return res.status(400).json({ error: 'Nyuuly result stats are only available for Nyuuly' });
  }
  const months = getAvailableMonths(company).slice(-6);
  const history = months.map((monthKey) => {
    const data = getNyuulyResultForMonth(company, monthKey);
    return {
      month: monthKey,
      label: monthKeyLabel(monthKey),
      mobileSimPurchased: data.mobileSimPurchased,
      welcomePackagePurchased: data.welcomePackagePurchased,
      formFilled: data.formFilled,
      askMeRequest: data.askMeRequest,
    };
  });
  res.json({ history, filter: { company } });
});

app.get('/api/app-downloads', (req, res) => {
  const { company, start, end } = req.query;
  const monthKey = start?.slice(0, 7);
  if (!monthKey) {
    return res.json({ totalDownloads: 0, platforms: [], filter: { company, start, end } });
  }
  const data = getAppDownloadsForMonth(company, monthKey);
  res.json({
    ...data,
    filter: { company, start, end, month: monthKey },
  });
});

app.get('/api/brand-message', (req, res) => {
  const { company, start, end } = req.query;
  if (!company || !['nyuuly', 'workjapan'].includes(company)) {
    return res.status(400).json({ error: 'Invalid company' });
  }
  const monthKey = start?.slice(0, 7);
  if (!monthKey) {
    return res.json({ message: '', latest: null, filter: { company, start, end } });
  }
  const data = getBrandMessageForMonth(company, monthKey);
  res.json({
    message: data.message,
    latest: data.month_label ? { month_label: data.month_label, message: data.message } : null,
    filter: { company, start, end, month: monthKey },
  });
});

app.get('/api/social-channels', (req, res) => {
  const { company, start, end } = req.query;
  const monthKey = start?.slice(0, 7);
  if (!monthKey) {
    return res.json({ totalViews: 0, channels: [], kpis: { totalViews: 0 }, filter: { company, start, end } });
  }
  const data = getSocialChannelViewsForMonth(company, monthKey);
  res.json({
    ...data,
    kpis: { totalViews: data.totalViews },
    filter: { company, start, end, month: monthKey },
  });
});

app.get('/api/campaigns', (req, res) => {
  const { company, start, end } = req.query;
  const monthKey = start?.slice(0, 7);
  if (!monthKey) {
    return res.json({ rows: [], kpis: campaignKpisFromRows([]), filter: { company, start, end } });
  }
  const data = getCampaignsForMonth(company, monthKey);
  res.json({
    ...data,
    filter: { company, start, end, month: monthKey },
  });
});

app.get('/api/campaigns/history', (req, res) => {
  const { company } = req.query;
  const months = getAvailableMonths(company).slice(-6);
  const history = months.map((monthKey) => {
    const data = getCampaignsForMonth(company, monthKey);
    return {
      month: monthKey,
      label: monthKeyLabel(monthKey),
      ...data.kpis,
      campaigns: data.rows,
    };
  });
  res.json({ history, filter: { company } });
});

app.get('/api/campaigns/months', (req, res) => {
  const { company } = req.query;
  const months = getAvailableMonths(company).filter((key) => {
    const coFilter = company && company !== 'all' ? 'company = ? AND' : '';
    const params = company && company !== 'all' ? [company, key] : [key];
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM campaign_stats
      WHERE ${coFilter} ${MONTH_KEY_SQL.campaign_stats} = ?
    `).get(...params);
    return row?.count > 0;
  });
  res.json({
    months: months.map((key) => ({ key, label: monthKeyLabel(key) })),
    latest: months.length ? months[months.length - 1] : null,
    defaultMonth: getDefaultMonthKey(company, months),
  });
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

app.get('/api/internal-reporting', (req, res) => {
  const { company, start, end } = req.query;
  if (company !== 'workjapan') {
    return res.json({
      kpis: {},
      topPages: [],
      categories: [],
      funnel: [],
      filter: { company, start, end },
    });
  }

  const ga4Q = buildGa4DateQuery(company, start, end);
  const rawPages = db.prepare(`
    SELECT * FROM pages_screens ${ga4Q.clause} ORDER BY views DESC
  `).all(...ga4Q.params);
  const pages = start && end ? proratePagesRows(rawPages, start, end) : rawPages;

  const platformQuery = buildMonthlyStatsQuery(company, start, end);
  const platformRows = db.prepare(`
    SELECT * FROM platform_stats ${platformQuery.clause} ORDER BY year, month, platform
  `).all(...platformQuery.params);

  const applicantQuery = buildMonthlyStatsQuery(company, start, end);
  const applicantRows = db.prepare(`
    SELECT * FROM applicant_stats ${applicantQuery.clause} ORDER BY year, month
  `).all(...applicantQuery.params);

  const report = buildInternalReport(pages, platformRows, applicantRows, { company, start, end });
  res.json(report);
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

app.get('/api/available-months', (req, res) => {
  const { company } = req.query;
  const months = getAvailableMonths(company);
  res.json({
    months: months.map((key) => ({ key, label: monthKeyLabel(key) })),
    latest: months.length ? months[months.length - 1] : null,
    defaultMonth: getDefaultMonthKey(company, months),
  });
});

app.get('/api/monthly', (req, res) => {
  const { company } = req.query;
  const months = getAvailableMonths(company);
  const month = req.query.month || getDefaultMonthKey(company, months);

  if (!month) {
    return res.json({ month: null, prevMonth: null, kpis: {}, months: [] });
  }

  const idx = months.indexOf(month);
  const prevMonth = idx > 0 ? months[idx - 1] : null;

  const current = monthlyKpisForMonth(company, month);
  const previous = prevMonth ? monthlyKpisForMonth(company, prevMonth) : null;

  const kpis = {};
  for (const key of Object.keys(current)) {
    const value = current[key] || 0;
    const prevValue = previous ? (previous[key] || 0) : null;
    kpis[key] = { value, prevValue, deltaPct: deltaPct(value, prevValue) };
  }

  res.json({
    month,
    monthLabel: monthKeyLabel(month),
    prevMonth,
    prevMonthLabel: prevMonth ? monthKeyLabel(prevMonth) : null,
    kpis,
    months: months.map((key) => ({ key, label: monthKeyLabel(key) })),
    filter: { company, month },
  });
});

app.get('/api/combined-funnel', (req, res) => {
  try {
    const months = getCombinedAvailableMonths();
    const month = req.query.month || getDefaultMonthKey(null, months);
    if (!month) {
      return res.json({ month: null, months: [], stages: null, pipeline: null });
    }
    res.json(buildCombinedFunnelData(month));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/combined-funnel/months', (req, res) => {
  const months = getCombinedAvailableMonths();
  res.json({
    months: months.map((key) => ({ key, label: monthKeyLabel(key) })),
    latest: months.length ? months[months.length - 1] : null,
    defaultMonth: getDefaultMonthKey(null, months),
  });
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

  const users = db.prepare(`
    SELECT company,
      COALESCE(SUM(total_users), 0) as totalUsers,
      COALESCE(SUM(new_users), 0) as newUsers,
      COALESCE(SUM(returning_users), 0) as returningUsers,
      CASE WHEN SUM(total_users) > 0 THEN ROUND(CAST(SUM(new_users) AS REAL) / SUM(total_users) * 100, 1) ELSE 0 END as newUserRate,
      CASE WHEN SUM(total_users) > 0 THEN ROUND(SUM(avg_engagement_time * total_users) / SUM(total_users), 1) ELSE 0 END as avgEngagementTime
    FROM user_acquisition ${ga4Q.clause}
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

  res.json({ social, users, funnel, topPages });
});

app.get('/api/upload-history', (req, res) => {
  const history = db.prepare(`
    SELECT * FROM upload_history ORDER BY uploaded_at DESC LIMIT 20
  `).all();

  const lastUpdated = history.length > 0 ? history[0].uploaded_at : null;

  res.json({ history, lastUpdated });
});

app.get('/api/upload-status-by-month', (req, res) => {
  const company = req.query.company || 'nyuuly';
  if (!['nyuuly', 'workjapan'].includes(company)) {
    return res.status(400).json({ error: 'Invalid company' });
  }
  res.json(getUploadStatusByMonth(company));
});

app.get('/api/search-console', (req, res) => {
  const { company, start, end } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: 'start and end are required' });
  }
  const payload = getSearchConsolePayload(company, start, end);
  res.json({
    ...payload,
    filter: { company, start, end },
  });
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
      'social-channels': 'Social Channel Views (Manual)',
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

  const searchConsole = getSearchConsolePayload(company, start, end);

  const rawUserRows = db.prepare(`
    SELECT * FROM user_acquisition ${ga4Q.clause} ORDER BY total_users DESC
  `).all(...ga4Q.params);
  const userRows = start && end
    ? prorateUsersRows(rawUserRows, start, end)
    : rawUserRows;
  const usersKpis = usersKpisFromRows(userRows);

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
  const funnelEntryUsers = ga4Funnel[0]?.users || usersKpis.totalUsers || 0;
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
      const monthKey = start?.slice(0, 7);
      const socialChannels = monthKey ? getSocialChannelViewsForMonth(company, monthKey) : { totalViews: 0, channels: [] };
      const gscImpressions = searchConsole.kpis.impressions || 0;

      return {
        ...base,
        kpis: {
          socialViews: socialKpis.totalViews,
          socialReach: socialKpis.totalReach,
          socialEngagement: socialKpis.totalEngagement,
          postCount: socialKpis.postCount,
          gscClicks: searchConsole.kpis.clicks,
          gscImpressions,
          gscCtr: searchConsole.kpis.ctr,
          gscAvgPosition: searchConsole.kpis.avgPosition,
          socialChannelViews: socialChannels.totalViews || 0,
          socialChannels: socialChannels.channels || [],
        },
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
        entryChannels: userRows.slice(0, 5).map((r) => ({
          channel: r.channel_group,
          totalUsers: r.total_users,
          newUsers: r.new_users,
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
    users: usersKpis.totalUsers > 0,
    pages: pages.length > 0,
    gsc: searchConsole.hasData,
  };

  const landingPages = getLandingPages(pages, journeyCompany);
  const seekerJourney = journeys.find((j) => j.id === 'seeker-application');
  const browseJourney = journeys.find((j) => j.id === 'browse-jobs');
  const jobDetailJourney = journeys.find((j) => j.id === 'job-detail');

  const platformQuery = buildMonthlyStatsQuery(company, start, end);
  const platformRows = journeyCompany === 'workjapan'
    ? db.prepare(`
        SELECT * FROM platform_stats ${platformQuery.clause}
        ORDER BY year, month, platform
      `).all(...platformQuery.params)
    : [];

  const consideration = journeyCompany === 'workjapan'
    ? buildConsiderationInsights({
        seekerFunnel: seekerJourney?.applicationFunnel,
        browse: browseJourney,
        jobDetail: jobDetailJourney,
        landingPages,
        trafficRows: userRows,
        topJobCategories,
        ga4Funnel,
        funnelEntryUsers,
        platformRows,
        searchConsole,
      })
    : null;

  res.json({
    journeys,
    landingPages,
    consideration,
    searchConsole,
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

  const allowedTables = ['social_posts', 'funnel_data', 'traffic_acquisition', 'user_acquisition', 'pages_screens', 'search_console_stats', 'social_channel_views', 'app_downloads', 'nyuuly_commit_stats', 'nyuuly_proceed_stats', 'nyuuly_result_stats', 'brand_messages', 'campaign_stats', 'workjapan_profile_stats', 'platform_stats', 'applicant_stats'];
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
  console.log(`Database: ${dbPath}${isVolumeBacked ? ' (persistent volume)' : isRailway ? ' (WARNING: not on a volume — data may be lost on redeploy)' : ' (local)'}`);
});
