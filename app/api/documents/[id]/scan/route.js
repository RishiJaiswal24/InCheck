import { scanDocument } from '@/lib/orchestrator';
import { docId, handle, json, readJson } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const running = new Set(); // one scan per document at a time

export const POST = handle(async (req, { params }) => {
  const id =await docId(params);
  const body = await readJson(req);
  if (running.has(id)) return json({ error: 'A scan for this document is already running' }, 409);
  running.add(id);
  try { return json({ scan: await scanDocument(id, { useGemini: body.useGemini !== false }) }); }
  finally { running.delete(id); }
});
