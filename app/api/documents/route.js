import { q, reapStaleScans } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { ingestDocument } from '@/lib/documents';
import { bad, handle, json, rateLimit } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  await reapStaleScans();
  return json({ documents: await q.all(
    `SELECT d.*, s.id scan_id, s.status scan_status, s.processed_batches, s.planned_batches, s.skipped_batches,
     (SELECT COUNT(*) FROM findings f WHERE f.doc_id=d.id) finding_count
     FROM documents d LEFT JOIN scans s ON s.id=(SELECT MAX(id) FROM scans WHERE doc_id=d.id) ORDER BY d.id DESC`) });
});

export const POST = handle(async (req) => {
  await rateLimit(req, 'upload', 20);
  const max = getConfig().maxUploadBytes;
  if (Number(req.headers.get('content-length') || 0) > max + 65536) throw bad('File too large', 413);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw bad('Attach a file in the "file" field');
  if (file.size > max) throw bad(`File too large (max ${max / 1048576} MB)`, 413);
  const doc = await ingestDocument({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
  return json({ document: doc }, 201);
});
