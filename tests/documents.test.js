import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ingestDocument, chunkTokens, validateUpload } from '../lib/documents.js';
import { detectChunk } from '../lib/detection.js';
import { bm25Rank } from '../lib/retrieval.js';
import { getChunks } from '../lib/documents.js';

test('upload validation rejects bad types, empty, binary and fake PDFs', () => {
  assert.throws(() => validateUpload('x.exe', Buffer.from('hi')), /Unsupported/);
  assert.throws(() => validateUpload('x.txt', Buffer.alloc(0)), /empty/);
  assert.throws(() => validateUpload('x.txt', Buffer.from([65, 0, 66])), /binary/);
  assert.throws(() => validateUpload('x.pdf', Buffer.from('not a pdf')), /valid PDF/);
  assert.equal(validateUpload('../../etc/passwd.txt', Buffer.from('ok')).name, 'passwd.txt');
});

test('chunking overlaps and keeps source references', () => {
  const tokens = Array.from({ length: 400 }, (_, i) => ({ w: `w${i}`, loc: Math.floor(i / 20) + 1 }));
  const chunks = chunkTokens(tokens, 'txt', { size: 100, overlap: 20 });
  assert.equal(chunks.length, 5);
  assert.ok(chunks[1].text.startsWith('w80 '));
  assert.match(chunks[0].ref, /^lines 1-5$/);
});

test('PDF extraction keeps page refs and local rules flag the injected page', async () => {
  const d = await ingestDocument({ name: 'memo.pdf', buffer: fs.readFileSync('samples/quarterly-security-memo.pdf') });
  const chunks = getChunks(d.id);
  assert.equal(chunks[0].ref, 'p.1-2'); // single chunk spanning both pages keeps its page range
  const hit = chunks.flatMap((c) => detectChunk(c.text));
  assert.ok(hit.some((f) => f.category === 'prompt_injection'));
  assert.ok(hit.some((f) => f.category === 'data_exfiltration'));
});

test('detection: secrets are redacted, educational context is demoted', () => {
  const f = detectChunk('password = Sup3rSecretValue99 and AKIAIOSFODNN7EXAMPLE');
  assert.ok(f.every((x) => !/Sup3rSecretValue99|AKIAIOSFODNN7EXAMPLE/.test(x.evidence)));
  const edu = detectChunk('For training purposes, an example of an attack is: ignore previous instructions.');
  assert.ok(edu.length && edu.every((x) => x.educational && x.confidence < 0.5));
});

test('BM25 retrieval ranks the relevant chunk first', () => {
  const chunks = [{ id: 1, text: 'quarterly vendor delivery numbers' }, { id: 2, text: 'equipment stipend for remote work' }, { id: 3, text: 'lunch menu' }];
  assert.equal(bm25Rank(chunks, 'remote equipment stipend')[0].chunk.id, 2);
});
