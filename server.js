const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const basicAuth = require('basic-auth');
const rateLimit = require('express-rate-limit');
const { parse } = require('csv-parse/sync');
const { db, initDb } = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || 'changeme';
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
  max: 10,
  message: { error: 'Too many uploads. Max 10 per hour.' },
});

function requireAuth(req, res, next) {
  const credentials = basicAuth(req);
  if (!credentials || credentials.name !== 'admin' || credentials.pass !== UPLOAD_PASSWORD) {
    res.set('WWW-Authenticate', 'Basic realm="Upload"');
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

function requireAuthPage(req, res, next) {
  const credentials = basicAuth(req);
  if (!credentials || credentials.name !== 'admin' || credentials.pass !== UPLOAD_PASSWORD) {
    res.set('WWW-Authenticate', 'Basic realm="Upload"');
    return res.status(401).send('Authentication required');
  }
  next();
}

function detectFileType(content) {
  const lines = content.split('\n').slice(0, 10).join('\n');
  if (lines.includes('"Post ID"') || lines.includes('Post ID')) return 'social';
  if (lines.includes('Funnel') || lines.includes('Step,Device category,Active users')) return 'funnel';
  if (lines.includes('Session primary channel group')) return 'traffic';
  if (lines.includes('Page path and screen class')) return 'pages';
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
    const channel = row['Session primary channel group (Default channel group)'];
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

function parseCsv(content, fileType, company) {
  switch (fileType) {
    case 'social': return parseSocialCsv(content, company);
    case 'funnel': return parseFunnelCsv(content, company);
    case 'traffic': return parseTrafficCsv(content, company);
    case 'pages': return parsePagesCsv(content, company);
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

function logUpload(filename, company, fileType, rowsAdded, rowsSkipped) {
  db.prepare(`
    INSERT INTO upload_history (filename, company, file_type, rows_added, rows_skipped)
    VALUES (?, ?, ?, ?, ?)
  `).run(filename, company, fileType, rowsAdded, rowsSkipped);
}

// --- Routes ---

app.get('/upload', requireAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.post('/api/upload', uploadLimiter, requireAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const company = req.body.company;
    if (!company || !['nyuuly', 'workjapan'].includes(company)) {
      return res.status(400).json({ error: 'Invalid company. Use nyuuly or workjapan.' });
    }

    const content = fs.readFileSync(req.file.path, 'utf-8');
    const fileType = detectFileType(content);

    if (!fileType) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Could not detect CSV file type' });
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

  const allPosts = db.prepare(`
    SELECT *, (likes + comments + shares + saves) as engagement,
      CASE WHEN reach > 0 THEN ROUND(CAST(likes + comments + shares + saves AS REAL) / reach * 100, 2) ELSE 0 END as engagement_rate
    FROM social_posts ${clause}
    ORDER BY views DESC
  `).all(...params);

  res.json({ kpis, timeSeries, topPosts, postTypes, posts: allPosts });
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

  const rows = db.prepare(`SELECT * FROM funnel_data ${clause} ORDER BY step, device_category`).all(...params);

  const step1Devices = rows.filter(
    (r) => r.step && r.step.includes('First open') && r.device_category !== 'Total'
  );

  res.json({ rows, step1Devices });
});

app.get('/api/traffic', (req, res) => {
  const { company, start, end } = req.query;
  const { clause, params } = buildGa4DateQuery(company, start, end);

  const rows = db.prepare(`SELECT * FROM traffic_acquisition ${clause} ORDER BY sessions DESC`).all(...params);

  const kpis = db.prepare(`
    SELECT
      COALESCE(SUM(sessions), 0) as totalSessions,
      COALESCE(SUM(engaged_sessions), 0) as totalEngagedSessions,
      CASE WHEN SUM(sessions) > 0 THEN ROUND(CAST(SUM(engaged_sessions) AS REAL) / SUM(sessions) * 100, 1) ELSE 0 END as engagementRate
    FROM traffic_acquisition ${clause}
  `).get(...params);

  res.json({ rows, kpis });
});

app.get('/api/pages', (req, res) => {
  const { company, start, end } = req.query;
  const { clause, params } = buildGa4DateQuery(company, start, end);

  const rows = db.prepare(`SELECT * FROM pages_screens ${clause} ORDER BY views DESC`).all(...params);

  res.json({ rows });
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

app.delete('/api/data', requireAuth, (req, res) => {
  const { company, table, confirm } = req.query;

  if (confirm !== 'yes') {
    return res.status(400).json({ error: 'Must pass confirm=yes' });
  }

  const allowedTables = ['social_posts', 'funnel_data', 'traffic_acquisition', 'pages_screens'];
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
