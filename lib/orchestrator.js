// Adaptive batching + sequential Gemini analysis + early stopping.
// Invariant: content that was not analysed is NEVER reported as safe ("partial" instead).
import { getConfig } from './config.js';
import { db, isDuplicateKey, nowIso, reapStaleScans } from './db.js';
import { getChunks, getDocument } from './documents.js';
import { detectChunk, isConfirmed, suspicionScore } from './detection.js';
import { bm25Rank, SECURITY_QUERY } from './retrieval.js';
import { estimateTokens, reserve, settle } from './budget.js';
import { SCAN_SYSTEM, MAX_CHUNK_CHARS, buildScanPrompt, cacheGet, cacheKey, cachePut, createGeminiClient, validateAnalysis } from './gemini.js';
import { audit } from './audit.js';

const PROMPT_OVERHEAD_TOKENS = 450;

/** Rank chunks: local suspicion first, BM25 relevance to security terms as tie-breaker. */
export function rankChunks(chunks, localByChunk) {
  const bm = new Map(bm25Rank(chunks, SECURITY_QUERY, { k: chunks.length }).map((r) => [r.chunk.id, r.score]));
  const maxBm = Math.max(1e-9, ...bm.values(), 0);
  return chunks.map((c) => ({ c, s: suspicionScore(localByChunk.get(c.id) || []) * 10 + (bm.get(c.id) || 0) / maxBm }))
    .sort((a, b) => b.s - a.s || a.c.idx - b.c.idx).map((x) => x.c);
}

/** Pack ranked chunks into batches (<= batchChunks and <= token budget); at most maxBatches. */
export function planBatches(ranked, cfg = getConfig()) {
  const budget = cfg.maxInputTokens - PROMPT_OVERHEAD_TOKENS;
  const batches = []; let cur = [], tok = 0;
  const uncovered = [];
  for (const c of ranked) {
    if (c.text.length > MAX_CHUNK_CHARS) uncovered.push(c); // would be truncated -> not fully analysable
    const t = estimateTokens(c.text.slice(0, MAX_CHUNK_CHARS)) + 20;
    if (cur.length && (cur.length >= cfg.batchChunks || tok + t > budget)) { batches.push(cur); cur = []; tok = 0; }
    cur.push(c); tok += t;
  }
  if (cur.length) batches.push(cur);
  const kept = batches.slice(0, cfg.maxBatches);
  batches.slice(cfg.maxBatches).forEach((b) => uncovered.push(...b));
  return { batches: kept, uncovered };
}

export async function scanDocument(docId, { client, useGemini = true } = {}) {
  const cfg = getConfig();
  const startedAt = Date.now();
  const doc = await getDocument(docId);
  if (!doc) throw Object.assign(new Error('Document not found'), { status: 404 });
  await reapStaleScans();
  // DB-backed lock (an in-memory Set does not work across serverless instances). The partial unique index on
  // scans(doc_id) where status='running' makes the insert below the real, race-free lock; this check just fails fast.
  const locked = () => Object.assign(new Error('A scan for this document is already running'), { status: 409 });
  if (await db.get('scans', { doc_id: docId, status: 'running' })) throw locked();
  const chunks = await getChunks(docId);
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const geminiClient = useGemini ? (client === undefined ? createGeminiClient() : client) : null;

  let scanId;
  try {
    scanId = (await db.insert('scans', { doc_id: docId, status: 'running', stop_reason: null, planned_batches: 0, processed_batches: 0, skipped_batches: 0,
      gemini_requests: 0, cache_hits: 0, chunks_total: chunks.length, chunks_analyzed: null, batches_json: null, finished_at: null })).id;
  } catch (e) { throw isDuplicateKey(e) ? locked() : e; }
  const findingDoc = (chunk, f, source) => ({ doc_id: docId, scan_id: scanId, chunk_id: chunk.id, source, category: f.category, severity: f.severity, confidence: f.confidence,
    rule: f.rule ?? 'gemini', explanation: f.explanation, evidence: f.evidence, ref: chunk.ref, confirmed: isConfirmed(f) ? 1 : 0 });

  try {
    // 1) Local detection over EVERY chunk (replaces previous findings; the scan lock above prevents concurrent scans of this document).
    const localByChunk = new Map(), local = [];
    for (const c of chunks) {
      const fs = detectChunk(c.text);
      localByChunk.set(c.id, fs);
      fs.forEach((f) => local.push(findingDoc(c, f, 'local')));
    }
    await db.deleteMany('findings', { doc_id: docId });
    await db.insertMany('findings', local);
    const localConfirmed = [...localByChunk.values()].flat().some((f) => isConfirmed(f));

    // 2) Plan batches.
    const ranked = rankChunks(chunks, localByChunk);
    const { batches, uncovered } = planBatches(ranked, cfg);
    const plan = batches.map((b, i) => ({ index: i + 1, chunkIds: b.map((c) => c.id), status: 'pending', reason: null, inputTokens: null }));
    const st = { stopReason: null, requests: 0, cacheHits: 0, analyzed: 0, confirmed: localConfirmed };
    const skipRest = (from, reason) => plan.forEach((p, i) => { if (i >= from && p.status === 'pending') { p.status = 'skipped'; p.reason = reason; } });

    await audit({ event: 'scan_started', detail: { docId, scanId, chunks: chunks.length, plannedBatches: plan.length, gemini: !!geminiClient } });

    if (localConfirmed) {
      st.stopReason = 'local_high_confidence_threat'; // early stop before spending any Gemini budget
      skipRest(0, 'early_stop');
    } else if (!geminiClient) {
      st.stopReason = useGemini ? 'gemini_unavailable_no_api_key' : 'gemini_disabled_by_request';
      skipRest(0, 'gemini_unavailable');
    } else {
      let failures = 0;
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        const bChunks = p.chunkIds.map((id) => byId.get(id));
        const prompt = buildScanPrompt(bChunks);
        p.inputTokens = estimateTokens(prompt) + estimateTokens(SCAN_SYSTEM);
        let text, fromCache = false;
        const key = cacheKey(prompt);
        const cached = await cacheGet(key);
        if (cached) { text = cached; fromCache = true; st.cacheHits++; }
        else {
          // Serverless time limit: stop starting new requests; completed batches are cached, so a re-scan resumes here.
          if (Date.now() - startedAt > cfg.scanTimeBudgetMs) { st.stopReason = 'time_budget_rescan_to_continue'; skipRest(i, 'time_budget'); break; }
          const slot = await reserve({ purpose: 'scan', docId, scanId, batch: p.index, inputTokens: p.inputTokens });
          if (!slot.ok) { st.stopReason = `budget_${slot.reason}`; skipRest(i, slot.reason); break; }
          try {
            const res = await geminiClient.generateJson({ system: SCAN_SYSTEM, prompt });
            text = res.text; st.requests++;
            validateAnalysis(text, p.chunkIds); // only cache well-formed responses
            await settle(slot.id, { outputTokens: res.outputTokens ?? 0, inputTokens: res.inputTokens ?? null, status: 'ok' });
            await cachePut(key, text);
          } catch (e) {
            await settle(slot.id, { status: 'error' });
            p.status = 'failed'; p.reason = String(e.message).slice(0, 120); failures++;
            if (failures >= 2) { st.stopReason = 'gemini_errors'; skipRest(i + 1, 'gemini_errors'); break; }
            continue;
          }
        }
        let findings;
        try { findings = validateAnalysis(text, p.chunkIds); } catch (e) { p.status = 'failed'; p.reason = 'invalid_response'; continue; }
        p.status = fromCache ? 'cached' : 'processed';
        st.analyzed += bChunks.length;
        await db.insertMany('findings', findings.map((f) => findingDoc(byId.get(f.chunk_id), f, 'gemini')));
        if (findings.some((f) => isConfirmed(f))) {
          // Early stop: threat confirmed -> no more Gemini calls for this document. Remaining content stays "unprocessed".
          st.confirmed = true; st.stopReason = 'gemini_confirmed_threat';
          skipRest(i + 1, 'early_stop');
          await audit({ event: 'early_stop', detail: { docId, scanId, batch: p.index, skipped: plan.length - i - 1 } });
          break;
        }
      }
    }

    const done = plan.filter((p) => p.status === 'processed' || p.status === 'cached').length;
    const allDone = plan.length > 0 && done === plan.length && uncovered.length === 0;
    const hasFindings = (await db.count('findings', { scan_id: scanId, severity: { $ne: 'info' } })) > 0;
    const status = st.confirmed ? 'threat_confirmed' : !allDone ? 'partial' : hasFindings ? 'findings' : 'clean';
    if (status === 'partial' && !st.stopReason) st.stopReason = uncovered.length ? 'chunks_not_covered' : 'batch_failures';
    const skipped = plan.filter((p) => p.status === 'skipped').length;
    await db.updateOne('scans', { _id: scanId }, { status, stop_reason: st.stopReason, planned_batches: plan.length, processed_batches: done, skipped_batches: skipped,
      gemini_requests: st.requests, cache_hits: st.cacheHits, chunks_analyzed: st.analyzed, batches_json: JSON.stringify(plan), finished_at: nowIso() });
    await audit({ event: 'scan_finished', detail: { docId, scanId, status, stopReason: st.stopReason } });
  } catch (e) {
    // Never leave a scan "running" or imply it was safe.
    await db.updateOne('scans', { _id: scanId }, { status: 'partial', stop_reason: 'internal_error', finished_at: nowIso() }).catch(() => {});
    throw e;
  }
  return getScanResult(scanId);
}

export async function getScanResult(scanId) {
  const s = await db.get('scans', { _id: scanId });
  if (!s) return null;
  const findings = await db.all('findings', { scan_id: scanId }, { sort: { confirmed: -1, confidence: -1, _id: 1 } });
  return { ...s, batches: JSON.parse(s.batches_json || '[]'), findings };
}

export const latestScan = async (docId) => {
  const row = await db.get('scans', { doc_id: docId }, { sort: { _id: -1 }, projection: { _id: 1 } });
  return row ? getScanResult(row.id) : null;
};
