// Async SQL layer on libSQL (@libsql/client): local file in dev, Turso in production. Works on Vercel (no native sqlite file needed).
import { createClient } from '@libsql/client';
import { getConfig } from './config.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER, words INTEGER, chunk_count INTEGER, sha256 TEXT, is_sample INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, idx INTEGER, text TEXT, ref TEXT, word_count INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id)`,
  `CREATE TABLE IF NOT EXISTS scans(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, status TEXT, stop_reason TEXT, planned_batches INTEGER DEFAULT 0, processed_batches INTEGER DEFAULT 0, skipped_batches INTEGER DEFAULT 0, gemini_requests INTEGER DEFAULT 0, cache_hits INTEGER DEFAULT 0, chunks_total INTEGER, chunks_analyzed INTEGER, batches_json TEXT, started_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_scans_doc ON scans(doc_id)`,
  `CREATE TABLE IF NOT EXISTS findings(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER, scan_id INTEGER, chunk_id INTEGER, source TEXT, category TEXT, severity TEXT, confidence REAL, rule TEXT, explanation TEXT, evidence TEXT, ref TEXT, confirmed INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_scan ON findings(scan_id)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_doc ON findings(doc_id)`,
  `CREATE TABLE IF NOT EXISTS gemini_usage(id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT, purpose TEXT, doc_id INTEGER, scan_id INTEGER, batch INTEGER, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, status TEXT, ts TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_day ON gemini_usage(day)`,
  `CREATE TABLE IF NOT EXISTS gemini_cache(key TEXT PRIMARY KEY, response TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT CURRENT_TIMESTAMP, run_id TEXT, event TEXT, tool TEXT, args TEXT, decision TEXT, rule TEXT, reason TEXT, detail TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_logs(run_id)`,
  `CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY, ts TEXT DEFAULT CURRENT_TIMESTAMP, scenario_id TEXT, task TEXT, role TEXT, allowed INTEGER, denied INTEGER, result TEXT)`,
  `CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT CURRENT_TIMESTAMP, run_id TEXT, to_addr TEXT, subject TEXT, body TEXT, simulated INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, window_start INTEGER, count INTEGER)`,
];

async function client() {
  let st = globalThis.__incheckDb;
  if (!st) {
    const cfg = getConfig();
    const c = createClient({ url: cfg.dbUrl, authToken: cfg.dbAuthToken || undefined });
    st = globalThis.__incheckDb = { c, ready: c.batch(SCHEMA, 'write').then(() => true) };
    st.ready.catch(() => { globalThis.__incheckDb = undefined; }); // retry init on next request
  }
  await st.ready;
  return st.c;
}

const toRows = (rs) => rs.rows.map((r) => ({ ...r }));

/** Tiny query helper: q.run / q.get / q.all / q.batch([[sql, args], ...]) (batch is atomic). */
export const q = {
  async run(sql, args = []) {
    const r = await (await client()).execute({ sql, args });
    return { changes: r.rowsAffected, id: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
  },
  async get(sql, args = []) { return toRows(await (await client()).execute({ sql, args }))[0] ?? null; },
  async all(sql, args = []) { return toRows(await (await client()).execute({ sql, args })); },
  async batch(stmts) {
    if (!stmts.length) return;
    await (await client()).batch(stmts.map(([sql, args = []]) => ({ sql, args })), 'write');
  },
};

export const today = () => new Date().toISOString().slice(0, 10);

/** Scans stuck in "running" (function killed mid-scan) become "partial/interrupted" - never silently safe. */
export const reapStaleScans = () => q.run("UPDATE scans SET status='partial', stop_reason='interrupted', finished_at=CURRENT_TIMESTAMP WHERE status='running' AND started_at < datetime('now','-3 minutes')");
