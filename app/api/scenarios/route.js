import { runAgent } from '@/lib/agent';
import { SCENARIOS, resolveScenario } from '@/lib/scenarios';
import { bad, handle, json, readJson } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async () => json({ scenarios: SCENARIOS }));
export const POST = handle(async (req) => {
  const b = await readJson(req);
  const sc = await resolveScenario(b.id);
  if (!sc) throw bad('Unknown scenario', 404);
  const run = await runAgent({ task: sc.task, role: sc.role, scenarioId: sc.id, docIds: sc.docIds });
  const pass = sc.expect === 'all_allowed' ? run.denied === 0 : run.denied > 0 && !run.actions.some((a) => a.executed && a.tool !== 'search_documents');
  return json({ scenario: { id: sc.id, title: sc.title, expect: sc.expect }, pass, run });
});
