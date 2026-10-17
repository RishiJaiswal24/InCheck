import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './db.js';
import { ingestDocument } from './documents.js';

const DIR = path.join(process.cwd(), 'samples');

/** Ingest bundled sample docs once. Returns {filename: docId}. */
export async function ensureSamples() {
  const db = getDb();
  const map = {};
  if (!fs.existsSync(DIR)) return map;
  for (const f of fs.readdirSync(DIR).sort()) {
    if (!/\.(txt|md|pdf)$/i.test(f)) continue;
    let row = db.prepare('SELECT id FROM documents WHERE name=? AND is_sample=1').get(f);
    if (!row) row = await ingestDocument({ name: f, buffer: fs.readFileSync(path.join(DIR, f)), isSample: true });
    map[f] = row.id;
  }
  return map;
}
