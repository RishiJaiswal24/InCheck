import { runAgent } from '@/lib/agent';
import { ROLES } from '@/lib/policy';
import { bad, handle, json, rateLimit, readJson } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  await rateLimit(req, 'agent', 40);
  const b = await readJson(req);
  if (typeof b.task !== 'string') throw bad('task is required');
  if (b.role !== undefined && !ROLES.includes(b.role)) throw bad(`role must be one of ${ROLES.join(', ')}`);
  if (b.userId !== undefined && !/^E-\d{3}$/.test(b.userId)) throw bad('userId must look like E-101');
  return json({ run: await runAgent({ task: b.task, role: b.role, userId: b.userId, useLLM: b.useLLM === true }) });
});
