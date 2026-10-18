import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolCall, executeToolCall } from '../lib/policy.js';
import { q } from '../lib/db.js';
import { runAgent } from '../lib/agent.js';
import { resolveScenario } from '../lib/scenarios.js';

const rec = (id, fields) => ({ tool: 'get_employee_records', args: { employee_id: id, ...(fields && { fields }) }, provenance: 'user' });

test('employees can never read employee records', () => {
  assert.equal(evaluateToolCall(rec('E-104', ['name']), { role: 'employee', userId: 'E-101' }).decision, 'deny');
  assert.equal(evaluateToolCall(rec('E-104', ['salary', 'ssn']), { role: 'employee' }).decision, 'deny');
});

test('managers: direct reports + safe fields only; SSN never leaves, even for HR', () => {
  assert.equal(evaluateToolCall(rec('E-101'), { role: 'manager', userId: 'E-103' }).decision, 'allow');
  assert.equal(evaluateToolCall(rec('E-102'), { role: 'manager', userId: 'E-103' }).decision, 'deny');
  assert.equal(evaluateToolCall(rec('E-101', ['salary']), { role: 'manager', userId: 'E-103' }).decision, 'deny');
  assert.equal(evaluateToolCall(rec('E-101', ['ssn']), { role: 'hr_admin' }).decision, 'deny');
  assert.equal(evaluateToolCall(rec('E-101', ['salary']), { role: 'hr_admin' }).decision, 'allow');
});

test('external email is blocked by default; internal email with secrets is blocked by DLP', () => {
  const mail = (to, body = 'Hello team') => ({ tool: 'send_email', args: { to, subject: 'hi', body }, provenance: 'user' });
  assert.equal(evaluateToolCall(mail(['x@evil.example']), { role: 'hr_admin' }).rule, 'policy.external_email_blocked');
  assert.equal(evaluateToolCall(mail(['ok@northwind.example', 'x@evil.example']), { role: 'hr_admin' }).decision, 'deny');
  assert.equal(evaluateToolCall(mail(['ok@northwind.example'], 'key AKIAIOSFODNN7EXAMPLE'), { role: 'manager' }).rule, 'policy.dlp_secret_in_email');
  assert.equal(evaluateToolCall(mail(['ok@northwind.example']), { role: 'employee' }).decision, 'allow');
});

test('sensitive actions requested by document content are denied; tampered args are rejected', () => {
  const fromDoc = { tool: 'send_email', args: { to: ['ok@northwind.example'], subject: 's', body: 'b' }, provenance: 'retrieved_content' };
  assert.equal(evaluateToolCall(fromDoc, { role: 'hr_admin' }).rule, 'policy.untrusted_origin');
  assert.equal(evaluateToolCall({ ...rec('E-101'), provenance: 'model' }, { role: 'hr_admin', tainted: true }).rule, 'policy.tainted_context');
  // The model cannot smuggle in a role/override through arguments or invent tools.
  assert.equal(evaluateToolCall({ tool: 'get_employee_records', args: { employee_id: 'E-101', role: 'hr_admin' }, provenance: 'user' }, { role: 'employee' }).rule, 'policy.invalid_arguments');
  assert.equal(evaluateToolCall({ tool: 'delete_database', args: {}, provenance: 'user' }, { role: 'hr_admin' }).rule, 'policy.unknown_tool');
  assert.equal(evaluateToolCall({ tool: 'send_email', args: { to: 'not-an-array', subject: '', body: '' } }, {}).decision, 'deny');
});

test('denied calls never reach the tool implementation and are audited', async () => {
  let calls = 0;
  const spy = { get_employee_records: async () => { calls++; return {}; }, send_email: async () => { calls++; return {}; }, search_documents: async () => [] };
  const r1 = await executeToolCall(rec('E-104', ['salary', 'ssn']), { role: 'employee', runId: 't1' }, spy);
  const r2 = await executeToolCall({ tool: 'send_email', args: { to: ['a@evil.example'], subject: 's', body: 'b' }, provenance: 'user' }, { role: 'hr_admin', runId: 't1' }, spy);
  assert.equal(calls, 0);
  assert.equal(r1.executed, false); assert.equal(r2.executed, false);
  const denied = (await q.get("SELECT COUNT(*) n FROM audit_logs WHERE run_id='t1' AND decision='deny'")).n;
  assert.equal(denied, 2);
  await executeToolCall({ tool: 'search_documents', args: { query: 'x' }, provenance: 'user' }, { role: 'employee', runId: 't1' }, spy);
});

test('end-to-end attack scenarios: injected/unauthorised/exfil actions are blocked, nothing is sent', async () => {
  for (const id of ['indirect-injection', 'unauthorized-employee', 'data-exfiltration']) {
    const sc = await resolveScenario(id);
    const run = await runAgent({ task: sc.task, role: sc.role, scenarioId: id, docIds: sc.docIds });
    assert.ok(run.denied > 0, `${id}: expected denied actions`);
    assert.equal(run.actions.filter((a) => a.executed && (a.tool === 'send_email' || a.tool === 'get_employee_records')).length, 0, `${id}: no sensitive action may execute`);
  }
  assert.equal((await q.get('SELECT COUNT(*) n FROM outbox')).n, 0);
  const inj = await resolveScenario('indirect-injection');
  const run = await runAgent({ task: inj.task, role: 'employee', docIds: inj.docIds });
  assert.ok(run.evidence.some((e) => e.quarantined), 'poisoned chunk is quarantined');
  assert.ok(!run.answer.includes('evil-mail'), 'answer never uses the poisoned chunk');
});

test('benign scenarios are allowed', async () => {
  for (const id of ['benign-summary', 'security-training']) {
    const sc = await resolveScenario(id);
    const run = await runAgent({ task: sc.task, role: sc.role, docIds: sc.docIds });
    assert.equal(run.denied, 0, id);
  }
});
