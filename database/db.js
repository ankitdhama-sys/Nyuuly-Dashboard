const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

/** Prefer explicit DATABASE_PATH, then Railway volume mount, else local database/ folder. */
function resolveDbPath() {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'analytics.db');
  }
  return path.join(__dirname, 'analytics.db');
}

const dbPath = resolveDbPath();
const dbDir = path.dirname(dbPath);
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT);
const isVolumeBacked = Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH)
  || (isRailway && process.env.DATABASE_PATH?.startsWith('/'));

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

    CREATE TABLE IF NOT EXISTS user_acquisition (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      channel_group TEXT NOT NULL,
      total_users INTEGER DEFAULT 0,
      new_users INTEGER DEFAULT 0,
      returning_users INTEGER DEFAULT 0,
      avg_engagement_time REAL DEFAULT 0,
      engaged_sessions_per_user REAL DEFAULT 0,
      event_count INTEGER DEFAULT 0,
      key_events INTEGER DEFAULT 0,
      user_key_event_rate REAL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS platform_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      month_label TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      platform TEXT NOT NULL,
      registrations INTEGER DEFAULT 0,
      active_users INTEGER DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(company, month_label, platform)
    );

    CREATE TABLE IF NOT EXISTS applicant_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      month_label TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      unique_applicants INTEGER DEFAULT 0,
      screening_passes INTEGER DEFAULT 0,
      total_applications INTEGER DEFAULT 0,
      interviews_fixed INTEGER DEFAULT 0,
      remaining_esp INTEGER DEFAULT 0,
      selected INTEGER DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(company, month_label)
    );

    CREATE TABLE IF NOT EXISTS audience_geo_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      month_label TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      in_japan_visitors INTEGER DEFAULT 0,
      out_japan_visitors INTEGER DEFAULT 0,
      in_japan_registrations INTEGER DEFAULT 0,
      out_japan_registrations INTEGER DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(company, month_label)
    );

    CREATE TABLE IF NOT EXISTS visa_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      month_label TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      visa_type TEXT NOT NULL,
      registrations INTEGER DEFAULT 0,
      abandonments INTEGER DEFAULT 0,
      applications INTEGER DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(company, month_label, visa_type)
    );

    CREATE TABLE IF NOT EXISTS nationality_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      month_label TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      nationality TEXT NOT NULL,
      visitors INTEGER DEFAULT 0,
      registrations INTEGER DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(company, month_label, nationality)
    );

    CREATE TABLE IF NOT EXISTS barrier_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      month_label TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      barrier_name TEXT NOT NULL,
      users_reached INTEGER DEFAULT 0,
      users_dropped INTEGER DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(company, month_label, barrier_name)
    );

    CREATE TABLE IF NOT EXISTS search_console_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      dimension_type TEXT NOT NULL,
      dimension_value TEXT NOT NULL,
      clicks INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      ctr REAL DEFAULT 0,
      position REAL DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(company, start_date, end_date, dimension_type, dimension_value)
    );

    CREATE TABLE IF NOT EXISTS social_channel_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      month_label TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      channel TEXT NOT NULL,
      views INTEGER DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(company, month_label, channel)
    );

    CREATE TABLE IF NOT EXISTS app_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      month_label TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      platform TEXT NOT NULL,
      downloads INTEGER DEFAULT 0,
      upload_date TEXT DEFAULT (date('now')),
      UNIQUE(company, month_label, platform)
    );
  `);
}

module.exports = { db, initDb, dbPath, isRailway, isVolumeBacked };
