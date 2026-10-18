import { q, reapStaleScans } from './db.js';
import { usageSummary } from './budget.js';
import { getConfig } from './config.js';

export async function getStats() {
  await reapStaleScans();
  const latest = 'SELECT s.* FROM scans s JOIN (SELECT doc_id, MAX(id) mid FROM scans GROUP BY doc_id) m ON s.id=m.mid';
  const kv = (rows, k) => Object.fromEntries(rows.map((r) => [r[k], r.n]));
  const [documents, chunks, scansTotal, unscanned, docStatus, bySev, byCat, confirmed, earlyStops, agentRuns, calls, topDeny, emails, gemini, recentScans, recentRuns] = await Promise.all([
    q.get('SELECT COUNT(*) n FROM documents'), q.get('SELECT COUNT(*) n FROM chunks'), q.get('SELECT COUNT(*) n FROM scans'),
    q.get('SELECT COUNT(*) n FROM documents d WHERE NOT EXISTS (SELECT 1 FROM scans s WHERE s.doc_id=d.id)'),
    q.all(`SELECT status, COUNT(*) n FROM (${latest}) GROUP BY status`),
    q.all('SELECT severity, COUNT(*) n FROM findings GROUP BY severity'), q.all('SELECT category, COUNT(*) n FROM findings GROUP BY category'),
    q.get('SELECT COUNT(*) n FROM findings WHERE confirmed=1'),
    q.get("SELECT COUNT(*) n FROM scans WHERE status='threat_confirmed' AND skipped_batches>0"),
    q.get('SELECT COUNT(*) n FROM agent_runs'),
    q.all("SELECT decision, COUNT(*) n FROM audit_logs WHERE event='tool_call' GROUP BY decision"),
    q.all("SELECT rule, COUNT(*) n FROM audit_logs WHERE event='tool_call' AND decision='deny' GROUP BY rule ORDER BY n DESC LIMIT 6"),
    q.get('SELECT COUNT(*) n FROM outbox'), usageSummary(),
    q.all('SELECT s.id,s.doc_id,d.name,s.status,s.processed_batches,s.planned_batches,s.skipped_batches,s.finished_at FROM scans s JOIN documents d ON d.id=s.doc_id ORDER BY s.id DESC LIMIT 6'),
    q.all('SELECT id,ts,scenario_id,task,role,allowed,denied FROM agent_runs ORDER BY ts DESC LIMIT 6'),
  ]);
  const c = kv(calls, 'decision');
  return {
    documents: documents.n, chunks: chunks.n, scansTotal: scansTotal.n, unscanned: unscanned.n,
    docStatus: kv(docStatus, 'status'), findingsBySeverity: kv(bySev, 'severity'), findingsByCategory: kv(byCat, 'category'),
    confirmedThreats: confirmed.n, earlyStops: earlyStops.n, agentRuns: agentRuns.n,
    toolCalls: { allow: c.allow || 0, deny: c.deny || 0 }, topDenyRules: topDeny, emailsSent: emails.n,
    gemini, recentScans, recentRuns, persistence: getConfig().persistence,
  };
}
