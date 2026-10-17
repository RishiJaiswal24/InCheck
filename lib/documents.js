// Upload validation, text extraction, overlapping chunking with source references.
import crypto from 'node:crypto';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { getConfig } from './config.js';
import { getDb } from './db.js';

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
  const db = getDb();
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const tx = db.transaction(() => {
    const d = db.prepare('INSERT INTO documents(name,type,size,words,chunk_count,sha256,is_sample) VALUES(?,?,?,?,?,?,?)')
      .run(v.name, v.type, buffer.length, tokens.length, chunks.length, sha, isSample ? 1 : 0);
    const ins = db.prepare('INSERT INTO chunks(doc_id,idx,text,ref,word_count) VALUES(?,?,?,?,?)');
    chunks.forEach((c, i) => ins.run(d.lastInsertRowid, i, c.text, c.ref, c.wordCount));
    return d.lastInsertRowid;
  });
  return getDocument(tx());
}

export const getDocument = (id) => getDb().prepare('SELECT * FROM documents WHERE id=?').get(id);
export const getChunks = (docId) => getDb().prepare('SELECT * FROM chunks WHERE doc_id=? ORDER BY idx').all(docId);
export function deleteDocument(id) {
  const db = getDb();
  db.prepare('DELETE FROM findings WHERE doc_id=?').run(id);
  db.prepare('DELETE FROM scans WHERE doc_id=?').run(id);
  db.prepare('DELETE FROM documents WHERE id=?').run(id);
}
