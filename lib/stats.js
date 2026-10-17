import { getDb } from './db.js';
import { usageSummary } from './budget.js';

export function getStats() {
  const db = getDb();
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const latest = 'SELECT s.* FROM scans s JOIN (SELECT doc_id, MAX(id) mid FROM scans GROUP BY doc_id) m ON s.id=m.mid';
  const calls = Object.fromEntries(all("SELECT decision, COUNT(*) n FROM audit_logs WHERE event='tool_call' GROUP BY decision").map((r) => [r.decision, r.n]));
  return {
    documents: one('SELECT COUNT(*) n FROM documents').n,
    chunks: one('SELECT COUNT(*) n FROM chunks').n,
    scansTotal: one('SELECT COUNT(*) n FROM scans').n,
    unscanned: one('SELECT COUNT(*) n FROM documents d WHERE NOT EXISTS (SELECT 1 FROM scans s WHERE s.doc_id=d.id)').n,
    docStatus: Object.fromEntries(all(`SELECT status, COUNT(*) n FROM (${latest}) GROUP BY status`).map((r) => [r.status, r.n])),
    findingsBySeverity: Object.fromEntries(all('SELECT severity, COUNT(*) n FROM findings GROUP BY severity').map((r) => [r.severity, r.n])),
    findingsByCategory: Object.fromEntries(all('SELECT category, COUNT(*) n FROM findings GROUP BY category').map((r) => [r.category, r.n])),
    confirmedThreats: one('SELECT COUNT(*) n FROM findings WHERE confirmed=1').n,
    earlyStops: one("SELECT COUNT(*) n FROM scans WHERE status='threat_confirmed' AND skipped_batches>0").n,
    agentRuns: one('SELECT COUNT(*) n FROM agent_runs').n,
    toolCalls: { allow: calls.allow || 0, deny: calls.deny || 0 },
    topDenyRules: all("SELECT rule, COUNT(*) n FROM audit_logs WHERE event='tool_call' AND decision='deny' GROUP BY rule ORDER BY n DESC LIMIT 6"),
    emailsSent: one('SELECT COUNT(*) n FROM outbox').n,
    gemini: usageSummary(),
    recentScans: all('SELECT s.id,s.doc_id,d.name,s.status,s.processed_batches,s.planned_batches,s.skipped_batches,s.finished_at FROM scans s JOIN documents d ON d.id=s.doc_id ORDER BY s.id DESC LIMIT 6'),
    recentRuns: all('SELECT id,ts,scenario_id,task,role,allowed,denied FROM agent_runs ORDER BY ts DESC LIMIT 6'),
  };
}
