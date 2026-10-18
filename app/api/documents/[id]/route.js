import { deleteDocument, getChunks, getDocument } from '@/lib/documents';
import { latestScan } from '@/lib/orchestrator';
import { bad, docId, handle, json } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (_req, { params }) => {
  const id = await docId(params);
  const document = await getDocument(id);
  if (!document) throw bad('Document not found', 404);
  const chunks = await getChunks(id);
  return json({ document, scan: await latestScan(id), chunks: chunks.map((c) => ({ id: c.id, idx: c.idx, ref: c.ref, word_count: c.word_count, preview: c.text.slice(0, 160) })) });
});
export const DELETE = handle(async (_req, { params }) => {
  const id = await docId(params);
  if (!(await getDocument(id))) throw bad('Document not found', 404);
  await deleteDocument(id);
  return json({ ok: true });
});
