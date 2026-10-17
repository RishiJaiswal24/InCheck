import { executeToolCall, ROLES } from '@/lib/policy';
import { bad, handle, json, readJson } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const PROV = ['user', 'model', 'retrieved_content'];

/** Manual tool tester: still goes through the same gateway (nothing here can skip policy). */
export const POST = handle(async (req) => {
  const b = await readJson(req);
  if (typeof b.tool !== 'string') throw bad('tool is required');
  const role = b.role ?? 'employee', provenance = b.provenance ?? 'user';
  if (!ROLES.includes(role)) throw bad('invalid role');
  if (!PROV.includes(provenance)) throw bad('invalid provenance');
  const userId = /^E-\d{3}$/.test(b.userId ?? '') ? b.userId : 'E-101';
  const r = await executeToolCall({ tool: b.tool, args: b.args, provenance }, { role, userId, tainted: b.tainted === true, runId: 'manual' });
  return json({ result: r });
});
