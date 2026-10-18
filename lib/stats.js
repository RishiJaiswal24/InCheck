import { db, reapStaleScans } from './db.js';
import { usageSummary } from './budget.js';
import { getConfig } from './config.js';

export async function getStats() {
  await reapStaleScans();
  const kv = (rows, k) => Object.fromEntries(rows.map((r) => [r[k], r.n]));
  const [documents, chunks, scansTotal, unscanned, docStatus, bySev, byCat, confirmed, earlyStops, agentRuns, calls, topDeny, emails, gemini, recentScansRaw, recentRuns] = await Promise.all([
    db.count('documents'), db.count('chunks'), db.count('scans'),
    db.aggregate('documents', [{ $lookup: { from: 'scans', localField: '_id', foreignField: 'doc_id', as: 's' } }, { $match: { s: { $size: 0 } } }, { $count: 'n' }]).then((r) => r[0]?.n ?? 0),
    // status of each document's latest scan
    db.aggregate('scans', [{ $sort: { _id: -1 } }, { $group: { _id: '$doc_id', status: { $first: '$status' } } }, { $group: { _id: '$status', n: { $sum: 1 } } }])
      .then((rows) => rows.map((r) => ({ status: r._id, n: r.n }))),
    db.group('findings', 'severity'), db.group('findings', 'category'),
    db.count('findings', { confirmed: 1 }),
    db.count('scans', { status: 'threat_confirmed', skipped_batches: { $gt: 0 } }),
    db.count('agent_runs'),
    db.group('audit_logs', 'decision', { event: 'tool_call' }),
    db.group('audit_logs', 'rule', { event: 'tool_call', decision: 'deny' }, 6),
    db.count('outbox'), usageSummary(),
    db.all('scans', {}, { sort: { _id: -1 }, limit: 6 }),
    db.all('agent_runs', {}, { sort: { ts: -1 }, limit: 6, projection: { scenario_id: 1, task: 1, role: 1, allowed: 1, denied: 1, ts: 1 } }),
  ]);
  const names = new Map((await db.all('documents', { _id: { $in: [...new Set(recentScansRaw.map((s) => s.doc_id))] } }, { projection: { name: 1 } })).map((d) => [d.id, d.name]));
  const recentScans = recentScansRaw.filter((s) => names.has(s.doc_id)).map((s) => ({ id: s.id, doc_id: s.doc_id, name: names.get(s.doc_id), status: s.status,
    processed_batches: s.processed_batches, planned_batches: s.planned_batches, skipped_batches: s.skipped_batches, finished_at: s.finished_at }));
  const c = kv(calls, 'decision');
  return {
    documents, chunks, scansTotal, unscanned,
    docStatus: kv(docStatus, 'status'), findingsBySeverity: kv(bySev, 'severity'), findingsByCategory: kv(byCat, 'category'),
    confirmedThreats: confirmed, earlyStops, agentRuns,
    toolCalls: { allow: c.allow || 0, deny: c.deny || 0 }, topDenyRules: topDeny, emailsSent: emails,
    gemini, recentScans, recentRuns, persistence: getConfig().persistence,
  };
}
