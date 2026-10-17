import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER, words INTEGER, chunk_count INTEGER, sha256 TEXT, is_sample INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, idx INTEGER, text TEXT, ref TEXT, word_count INTEGER);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
CREATE TABLE IF NOT EXISTS scans(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, status TEXT, stop_reason TEXT, planned_batches INTEGER DEFAULT 0, processed_batches INTEGER DEFAULT 0, skipped_batches INTEGER DEFAULT 0, gemini_requests INTEGER DEFAULT 0, cache_hits INTEGER DEFAULT 0, chunks_total INTEGER, chunks_analyzed INTEGER, batches_json TEXT, started_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT);
CREATE TABLE IF NOT EXISTS findings(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER, scan_id INTEGER, chunk_id INTEGER, source TEXT, category TEXT, severity TEXT, confidence REAL, rule TEXT, explanation TEXT, evidence TEXT, ref TEXT, confirmed INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS gemini_usage(id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT, purpose TEXT, doc_id INTEGER, scan_id INTEGER, batch INTEGER, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, status TEXT, ts TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS gemini_cache(key TEXT PRIMARY KEY, response TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT CURRENT_TIMESTAMP, run_id TEXT, event TEXT, tool TEXT, args TEXT, decision TEXT, rule TEXT, reason TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY, ts TEXT DEFAULT CURRENT_TIMESTAMP, scenario_id TEXT, task TEXT, role TEXT, allowed INTEGER, denied INTEGER, result TEXT);
CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT CURRENT_TIMESTAMP, run_id TEXT, to_addr TEXT, subject TEXT, body TEXT, simulated INTEGER DEFAULT 1);
`;

export function getDb() {
  if (globalThis.__sentinelDb) return globalThis.__sentinelDb;
  const p = getConfig().dbPath;
  if (p !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  const db = new Database(p);
  if (p !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  globalThis.__sentinelDb = db;
  return db;
}

export const today = () => new Date().toISOString().slice(0, 10);
