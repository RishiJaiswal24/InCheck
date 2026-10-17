// Server-side policy gateway. Every tool call is validated and authorised here, in plain code.
// The LLM can PROPOSE calls; it can never change these rules, roles, or the outcome.
import { getConfig } from './config.js';
import { audit } from './audit.js';
import { detectChunk } from './detection.js';
import { ALL_FIELDS, EMPLOYEES, SAFE_FIELDS, tools as defaultTools } from './tools.js';

export const SENSITIVE_TOOLS = new Set(['get_employee_records', 'send_email']);
export const ROLES = ['employee', 'manager', 'hr_admin'];
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const deny = (rule, reason) => ({ decision: 'deny', rule, reason });
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const onlyKeys = (o, keys) => Object.keys(o).every((k) => keys.includes(k));

function validateArgs(tool, a) {
  if (!isObj(a)) return 'arguments must be an object';
  if (tool === 'search_documents') {
    if (!onlyKeys(a, ['query', 'limit'])) return 'unexpected argument';
    if (typeof a.query !== 'string' || !a.query.trim() || a.query.length > 500) return 'query must be 1-500 chars';
    if (a.limit !== undefined && !(Number.isInteger(a.limit) && a.limit >= 1 && a.limit <= 10)) return 'limit must be 1-10';
    return null;
  }
  if (tool === 'get_employee_records') {
    if (!onlyKeys(a, ['employee_id', 'fields'])) return 'unexpected argument';
    if (typeof a.employee_id !== 'string' || !/^E-\d{3}$/.test(a.employee_id)) return 'employee_id must look like E-101';
    if (a.fields !== undefined && !(Array.isArray(a.fields) && a.fields.length && a.fields.length <= 10 && a.fields.every((f) => ALL_FIELDS.includes(f)))) return 'invalid fields';
    return null;
  }
  if (tool === 'send_email') {
    if (!onlyKeys(a, ['to', 'subject', 'body'])) return 'unexpected argument';
    if (!Array.isArray(a.to) || !a.to.length || a.to.length > 5 || !a.to.every((t) => typeof t === 'string' && EMAIL_RE.test(t) && t.length <= 254)) return 'to must be 1-5 valid email addresses';
    if (typeof a.subject !== 'string' || a.subject.length > 200) return 'subject must be a string <= 200 chars';
    if (typeof a.body !== 'string' || a.body.length > 5000) return 'body must be a string <= 5000 chars';
    return null;
  }
  return 'unknown tool';
}

/**
 * Pure decision function (no I/O). call = {tool, args, provenance: 'user'|'retrieved_content'|'model'}
 * ctx = {role, userId, tainted}
 */
export function evaluateToolCall(call, ctx = {}, cfg = getConfig()) {
  const { tool, provenance = 'model' } = call || {};
  if (!['search_documents', 'get_employee_records', 'send_email'].includes(tool)) return deny('policy.unknown_tool', `Tool "${tool}" is not registered.`);
  const bad = validateArgs(tool, call.args);
  if (bad) return deny('policy.invalid_arguments', `Invalid arguments: ${bad}.`);
  const role = ROLES.includes(ctx.role) ? ctx.role : 'employee';
  const args = { ...call.args };

  if (SENSITIVE_TOOLS.has(tool)) {
    if (provenance === 'retrieved_content') return deny('policy.untrusted_origin', 'Sensitive action was requested by document content, not by the user. Documents cannot authorise actions.');
    if (provenance !== 'user' && ctx.tainted) return deny('policy.tainted_context', 'Retrieved content contained suspected injection; model-initiated sensitive actions are blocked for this run.');
  }

  if (tool === 'get_employee_records') {
    const fields = args.fields ?? SAFE_FIELDS;
    args.fields = fields;
    const target = EMPLOYEES[args.employee_id];
    if (role === 'employee') return deny('policy.rbac_employee_records', 'Role "employee" may not read employee records.');
    if (role === 'manager') {
      if (!target || target.manager !== ctx.userId) return deny('policy.rbac_not_direct_report', 'Managers may only read their direct reports.');
      const restricted = fields.filter((f) => !SAFE_FIELDS.includes(f));
      if (restricted.length) return deny('policy.rbac_restricted_fields', `Managers may not read: ${restricted.join(', ')}.`);
    }
    if (role === 'hr_admin' && fields.includes('ssn')) return deny('policy.ssn_never', 'SSN is never exposed to agents, even for HR admins.');
    return { decision: 'allow', rule: 'policy.employee_records_ok', reason: `Role "${role}" authorised for requested fields.`, args };
  }

  if (tool === 'send_email') {
    const external = args.to.filter((t) => !t.toLowerCase().endsWith('@' + cfg.internalDomain));
    if (external.length && !cfg.allowExternalEmail) return deny('policy.external_email_blocked', `External recipients are blocked by default: ${external.join(', ')}.`);
    const leaks = detectChunk(`${args.subject}\n${args.body}`).filter((f) => f.category === 'secret_exposure');
    if (leaks.length) return deny('policy.dlp_secret_in_email', `Email body contains sensitive data (${leaks.map((l) => l.rule).join(', ')}).`);
    if (role === 'employee' && ctx.tainted && provenance !== 'user') return deny('policy.tainted_context', 'Blocked: run context is tainted.');
    return { decision: 'allow', rule: 'policy.internal_email_ok', reason: 'Internal recipients only; no sensitive data detected. (Simulated send.)', args };
  }

  return { decision: 'allow', rule: 'policy.search_ok', reason: 'Read-only document search.', args: { limit: 5, ...args } };
}

/** The ONLY path to tool execution. Evaluates, audits, and runs the tool only if allowed. */
export async function executeToolCall(call, ctx = {}, impl = defaultTools) {
  const verdict = evaluateToolCall(call, ctx);
  const row = audit({
    runId: ctx.runId ?? null, event: 'tool_call', tool: call?.tool ?? null, args: call?.args ?? null,
    decision: verdict.decision, rule: verdict.rule, reason: verdict.reason, detail: { provenance: call?.provenance ?? 'model', role: ctx.role },
  });
  if (verdict.decision !== 'allow') return { ...verdict, executed: false, result: null, audit: row };
  try {
    const result = await impl[call.tool](verdict.args, ctx);
    return { ...verdict, executed: true, result, audit: row };
  } catch (e) {
    return { ...verdict, executed: false, result: { error: String(e.message).slice(0, 200) }, audit: row };
  }
}
