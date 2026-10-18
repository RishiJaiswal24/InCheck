// Gemini cost protection: daily request cap, token estimation, usage tracking.
import { getConfig } from './config.js';
import { db, isDuplicateKey, today } from './db.js';

export const estimateTokens = (s) => Math.ceil(String(s).length / 4);

export const usedToday = () => db.count('gemini_usage', { day: today(), status: { $ne: 'cached' } });

/**
 * Reserve one request slot BEFORE calling Gemini (failed calls still count).
 * The cap check and the increment are ONE atomic conditional upsert on a per-day counter, so concurrent serverless
 * instances cannot overshoot the limit: once count >= limit the filter no longer matches, the upsert tries to insert
 * the existing _id and fails with a duplicate-key error, which means "limit reached".
 */
export async function reserve({ purpose, docId = null, scanId = null, batch = null, inputTokens = 0 }) {
  const cfg = getConfig();
  if (!cfg.geminiApiKey) return { ok: false, reason: 'no_api_key' };
  if (inputTokens > cfg.maxInputTokens) return { ok: false, reason: 'input_too_large' };
  const day = today();
  const counters = await db.col('usage_counters');
  try {
    await counters.updateOne({ _id: day, count: { $lt: cfg.dailyLimit } }, { $inc: { count: 1 } }, { upsert: true });
  } catch (e) {
    if (isDuplicateKey(e)) return { ok: false, reason: 'daily_limit_reached' };
    throw e;
  }
  const r = await db.insert('gemini_usage', { day, purpose, doc_id: docId, scan_id: scanId, batch, input_tokens: inputTokens, output_tokens: 0, status: 'reserved' });
  return { ok: true, id: r.id, limit: cfg.dailyLimit };
}

export const settle = (id, { outputTokens = 0, inputTokens = null, status = 'ok' }) =>
  db.updateOne('gemini_usage', { _id: id }, { output_tokens: outputTokens, status, ...(inputTokens != null && { input_tokens: inputTokens }) });

export async function usageSummary() {
  const cfg = getConfig(), day = today();
  const [used, i, o, errors, cache, total] = await Promise.all([
    usedToday(), db.sum('gemini_usage', 'input_tokens', { day }), db.sum('gemini_usage', 'output_tokens', { day }),
    db.count('gemini_usage', { day, status: 'error' }), db.sum('scans', 'cache_hits'), db.count('gemini_usage', { status: { $ne: 'cached' } }),
  ]);
  return {
    day, enabled: !!cfg.geminiApiKey, model: cfg.model, used, limit: cfg.dailyLimit, remaining: Math.max(0, cfg.dailyLimit - used),
    inputTokens: i, outputTokens: o, errors, cacheHits: cache, totalRequests: total,
    maxInputTokens: cfg.maxInputTokens, maxOutputTokens: cfg.maxOutputTokens,
  };
}
