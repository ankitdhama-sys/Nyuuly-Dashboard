const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'analytics.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      post_id TEXT,
      account_name TEXT,
      account_username TEXT,
      description TEXT,
      post_type TEXT,
      publish_time TEXT,
      permalink TEXT,
      views INTEGER DEFAULT 0,
      reach INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      follows INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      saves INTEGER DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(post_id, company)
    );

    CREATE TABLE IF NOT EXISTS funnel_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      date_range TEXT,
      step TEXT,
      device_category TEXT,
      active_users INTEGER DEFAULT 0,
      completion_rate REAL DEFAULT 0,
      abandonments INTEGER DEFAULT 0,
      abandonment_rate REAL DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(company, date_range, step, device_category)
    );

    CREATE TABLE IF NOT EXISTS traffic_acquisition (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      channel_group TEXT,
      sessions INTEGER DEFAULT 0,
      engaged_sessions INTEGER DEFAULT 0,
      engagement_rate REAL DEFAULT 0,
      avg_engagement_time REAL DEFAULT 0,
      events_per_session REAL DEFAULT 0,
      event_count INTEGER DEFAULT 0,
      key_events INTEGER DEFAULT 0,
      session_key_event_rate REAL DEFAULT 0,
      total_revenue REAL DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(company, start_date, end_date, channel_group)
    );

    CREATE TABLE IF NOT EXISTS pages_screens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      page_path TEXT,
      views INTEGER DEFAULT 0,
      active_users INTEGER DEFAULT 0,
      views_per_user REAL DEFAULT 0,
      avg_engagement_time REAL DEFAULT 0,
      event_count INTEGER DEFAULT 0,
      key_events INTEGER DEFAULT 0,
      total_revenue REAL DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(company, start_date, end_date, page_path)
    );

    CREATE TABLE IF NOT EXISTS upload_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      company TEXT,
      file_type TEXT,
      rows_added INTEGER,
      rows_skipped INTEGER,
      uploaded_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

module.exports = { db, initDb, dbPath };
