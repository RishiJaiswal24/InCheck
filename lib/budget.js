// Gemini cost protection: daily request cap, token estimation, usage tracking.
import { getConfig } from './config.js';
import { q, today } from './db.js';

export const estimateTokens = (s) => Math.ceil(String(s).length / 4);

export async function usedToday() {
  return (await q.get("SELECT COUNT(*) n FROM gemini_usage WHERE day=? AND status!='cached'", [today()])).n;
}

/**
 * Reserve one request slot BEFORE calling Gemini (failed calls still count).
 * The cap check and the insert are ONE atomic statement, so concurrent serverless instances cannot overshoot the limit.
 */
export async function reserve({ purpose, docId = null, scanId = null, batch = null, inputTokens = 0 }) {
  const cfg = getConfig();
  if (!cfg.geminiApiKey) return { ok: false, reason: 'no_api_key' };
  if (inputTokens > cfg.maxInputTokens) return { ok: false, reason: 'input_too_large' };
  const day = today();
  const r = await q.run(
    `INSERT INTO gemini_usage(day,purpose,doc_id,scan_id,batch,input_tokens,status)
     SELECT ?,?,?,?,?,?,'reserved' WHERE (SELECT COUNT(*) FROM gemini_usage WHERE day=? AND status!='cached') < ?`,
    [day, purpose, docId, scanId, batch, inputTokens, day, cfg.dailyLimit]);
  if (!r.changes) return { ok: false, reason: 'daily_limit_reached' };
  return { ok: true, id: r.id, limit: cfg.dailyLimit };
}

export const settle = (id, { outputTokens = 0, inputTokens = null, status = 'ok' }) =>
  q.run('UPDATE gemini_usage SET output_tokens=?, input_tokens=COALESCE(?,input_tokens), status=? WHERE id=?', [outputTokens, inputTokens, status, id]);

export async function usageSummary() {
  const cfg = getConfig(), day = today();
  const used = await usedToday();
  const t = await q.get('SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o FROM gemini_usage WHERE day=?', [day]);
  const errs = (await q.get("SELECT COUNT(*) n FROM gemini_usage WHERE day=? AND status='error'", [day])).n;
  const cache = (await q.get('SELECT COALESCE(SUM(cache_hits),0) hits FROM scans')).hits;
  const total = (await q.get("SELECT COUNT(*) n FROM gemini_usage WHERE status!='cached'")).n;
  return {
    day, enabled: !!cfg.geminiApiKey, model: cfg.model, used, limit: cfg.dailyLimit, remaining: Math.max(0, cfg.dailyLimit - used),
    inputTokens: t.i, outputTokens: t.o, errors: errs, cacheHits: cache, totalRequests: total,
    maxInputTokens: cfg.maxInputTokens, maxOutputTokens: cfg.maxOutputTokens,
  };
}
