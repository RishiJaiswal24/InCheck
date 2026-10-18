import { scanDocument } from '@/lib/orchestrator';
import { docId, handle, json, rateLimit, readJson } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Must stay within the Vercel plan limit. The orchestrator stops starting new Gemini requests after SCAN_TIME_BUDGET_MS
// (default 40s); completed batches are cached, so scanning again resumes where it stopped.
export const maxDuration = 60;

export const POST = handle(async (req, { params }) => {
  const id = await docId(params);
  await rateLimit(req, 'scan', 15);
  const body = await readJson(req);
  return json({ scan: await scanDocument(id, { useGemini: body.useGemini !== false }) });
});
