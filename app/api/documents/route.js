import { getDb } from '@/lib/db';
import { ingestDocument } from '@/lib/documents';
import { bad, handle, json } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async () => json({ documents: getDb().prepare(
  `SELECT d.*, s.id scan_id, s.status scan_status, s.processed_batches, s.planned_batches, s.skipped_batches,
   (SELECT COUNT(*) FROM findings f WHERE f.doc_id=d.id) finding_count
   FROM documents d LEFT JOIN scans s ON s.id=(SELECT MAX(id) FROM scans WHERE doc_id=d.id) ORDER BY d.id DESC`).all() }));

export const POST = handle(async (req) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw bad('Attach a file in the "file" field');
  if (file.size > Number(process.env.MAX_UPLOAD_MB || 5) * 1048576) throw bad('File too large', 413);
  const doc = await ingestDocument({ name: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
  return json({ document: doc }, 201);
});
