import { q } from './db.js';
import { redactSecrets } from './detection.js';

/** Append-only audit log. Secrets are redacted before persisting. Returns the stored row. */
export async function audit({ runId = null, event, tool = null, args = null, decision = null, rule = null, reason = null, detail = null }) {
  const a = args == null ? null : redactSecrets(JSON.stringify(args)).slice(0, 4000);
  const d = detail == null ? null : redactSecrets(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 4000);
  const r = await q.run('INSERT INTO audit_logs(run_id,event,tool,args,decision,rule,reason,detail) VALUES(?,?,?,?,?,?,?,?)', [runId, event, tool, a, decision, rule, reason, d]);
  return q.get('SELECT * FROM audit_logs WHERE id=?', [r.id]);
}

export async function listAudit({ limit = 200, decision = null, runId = null } = {}) {
  const where = [], params = [];
  if (decision) { where.push('decision=?'); params.push(decision); }
  if (runId) { where.push('run_id=?'); params.push(runId); }
  return q.all(`SELECT * FROM audit_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`, [...params, Math.min(Math.max(+limit || 200, 1), 1000)]);
}
