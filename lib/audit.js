import { db } from './db.js';
import { redactSecrets } from './detection.js';

/** Append-only audit log. Secrets are redacted before persisting. Returns the stored row. */
export async function audit({ runId = null, event, tool = null, args = null, decision = null, rule = null, reason = null, detail = null }) {
  const a = args == null ? null : redactSecrets(JSON.stringify(args)).slice(0, 4000);
  const d = detail == null ? null : redactSecrets(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 4000);
  return db.insert('audit_logs', { run_id: runId, event, tool, args: a, decision, rule, reason, detail: d });
}

export async function listAudit({ limit = 200, decision = null, runId = null } = {}) {
  const filter = {};
  if (decision) filter.decision = decision;
  if (runId) filter.run_id = runId;
  return db.all('audit_logs', filter, { sort: { _id: -1 }, limit: Math.min(Math.max(+limit || 200, 1), 1000) });
}
