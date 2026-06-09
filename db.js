const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// DATA_DIR permite montar un disco persistente en Render (ej: /var/data)
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'reportes.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL,
    description TEXT    NOT NULL,
    lat         REAL    NOT NULL,
    lng         REAL    NOT NULL,
    occurred_at TEXT    NOT NULL,
    drive_link  TEXT,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ip_hash     TEXT    NOT NULL,
    device_id   TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    body       TEXT    NOT NULL,
    drive_link TEXT,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ip_hash    TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS votes (
    report_id  INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    device_id  TEXT    NOT NULL,
    ip_hash    TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (report_id, device_id)
  );

  CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_report ON comments(report_id);
`);

module.exports = db;
