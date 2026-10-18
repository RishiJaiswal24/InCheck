// Upload validation, text extraction, overlapping chunking with source references.
import crypto from 'node:crypto';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { getConfig } from './config.js';
import { db } from './db.js';

const TYPES = { '.pdf': 'pdf', '.txt': 'txt', '.md': 'md', '.markdown': 'md' };
export class ValidationError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

export function sanitizeName(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '').trim().slice(0, 120);
  if (!base) throw new ValidationError('Missing file name');
  return base;
}

export function validateUpload(name, buffer) {
  const cfg = getConfig();
  const clean = sanitizeName(name);
  const ext = clean.includes('.') ? clean.slice(clean.lastIndexOf('.')).toLowerCase() : '';
  const type = TYPES[ext];
  if (!type) throw new ValidationError('Unsupported file type. Use PDF, TXT or Markdown.');
  if (!buffer || !buffer.length) throw new ValidationError('File is empty');
  if (buffer.length > cfg.maxUploadBytes) throw new ValidationError(`File too large (max ${cfg.maxUploadBytes / 1048576} MB)`, 413);
  if (type === 'pdf' && buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ValidationError('File is not a valid PDF');
  if (type !== 'pdf' && buffer.includes(0)) throw new ValidationError('Text file contains binary data');
  return { name: clean, type };
}

const cleanText = (s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');

/** Returns word tokens [{w, loc}] where loc is the page (pdf) or line number (txt/md). */
export async function extractTokens(buffer, type) {
  const tokens = [];
  if (type === 'pdf') {
    let pages = [];
    // pdf.js 1.x (bundled with pdf-parse) can fail on the very first parse in a process; one retry is reliable.
    for (let attempt = 0; ; attempt++) {
      pages = [];
      try {
        await pdfParse(buffer, {
          max: 300,
          pagerender: async (page) => {
            const tc = await page.getTextContent({ normalizeWhitespace: true });
            const t = tc.items.map((i) => i.str).join(' ');
            pages.push(t);
            return t;
          },
        });
        break;
      } catch (e) {
        if (attempt >= 1) throw new ValidationError('Could not parse PDF (corrupt, encrypted or unsupported)');
      }
    }
    pages.forEach((t, i) => cleanText(t).split(/\s+/).filter(Boolean).forEach((w) => tokens.push({ w, loc: i + 1 })));
  } else {
    cleanText(buffer.toString('utf8')).split(/\r?\n/).forEach((line, i) =>
      line.split(/\s+/).filter(Boolean).forEach((w) => tokens.push({ w, loc: i + 1 })));
  }
  return tokens;
}

export function chunkTokens(tokens, type, { size, overlap } = getConfig() && { size: getConfig().chunkWords, overlap: getConfig().overlapWords }) {
  const step = Math.max(1, size - Math.min(overlap, size - 1));
  const chunks = [];
  for (let start = 0; start < tokens.length; start += step) {
    const slice = tokens.slice(start, start + size);
    const a = slice[0].loc, b = slice[slice.length - 1].loc;
    const ref = type === 'pdf' ? (a === b ? `p.${a}` : `p.${a}-${b}`) : (a === b ? `line ${a}` : `lines ${a}-${b}`);
    chunks.push({ text: slice.map((t) => t.w).join(' '), ref, wordCount: slice.length });
    if (start + size >= tokens.length) break;
  }
  return chunks;
}

export async function ingestDocument({ name, buffer, isSample = false }) {
  const cfg = getConfig();
  const v = validateUpload(name, buffer);
  const tokens = await extractTokens(buffer, v.type);
  if (!tokens.length) throw new ValidationError('No extractable text found (scanned PDFs are not supported)');
  if (tokens.length > cfg.maxWords) throw new ValidationError(`Document too long (max ${cfg.maxWords} words)`, 413);
  const chunks = chunkTokens(tokens, v.type);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const d = await db.insert('documents', { name: v.name, type: v.type, size: buffer.length, words: tokens.length, chunk_count: chunks.length, sha256: sha, is_sample: isSample ? 1 : 0 });
  try {
    await db.insertMany('chunks', chunks.map((c, i) => ({ doc_id: d.id, idx: i, text: c.text, ref: c.ref, word_count: c.wordCount })));
  } catch (e) {
    // On failure nothing is left half-written.
    await db.deleteMany('chunks', { doc_id: d.id }).catch(() => {});
    await db.deleteMany('documents', { _id: d.id });
    throw e;
  }
  return d;
}

export const getDocument = (id) => db.get('documents', { _id: id });
export const getChunks = (docId) => db.all('chunks', { doc_id: docId }, { sort: { idx: 1 } });
export async function deleteDocument(id) {
  await db.deleteMany('findings', { doc_id: id });
  await db.deleteMany('scans', { doc_id: id });
  await db.deleteMany('chunks', { doc_id: id });
  await db.deleteMany('documents', { _id: id });
}

/** Documents newest first, each with its latest scan summary and finding count (what the UI list needs). */
export async function listDocuments() {
  const [docs, latest, counts] = await Promise.all([
    db.all('documents', {}, { sort: { _id: -1 } }),
    db.aggregate('scans', [{ $sort: { _id: -1 } }, { $group: { _id: '$doc_id', s: { $first: '$$ROOT' } } }]),
    db.aggregate('findings', [{ $group: { _id: '$doc_id', n: { $sum: 1 } } }]),
  ]);
  const scanBy = new Map(latest.map((r) => [r._id, r.s])), countBy = new Map(counts.map((r) => [r._id, r.n]));
  return docs.map((d) => {
    const s = scanBy.get(d.id);
    return { ...d, scan_id: s?._id ?? null, scan_status: s?.status ?? null, processed_batches: s?.processed_batches ?? null,
      planned_batches: s?.planned_batches ?? null, skipped_batches: s?.skipped_batches ?? null, finding_count: countBy.get(d.id) ?? 0 };
  });
}
