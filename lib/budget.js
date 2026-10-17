// Gemini cost protection: daily request cap, token estimation, usage tracking.
import { getConfig } from './config.js';
import { getDb, today } from './db.js';

export const estimateTokens = (s) => Math.ceil(String(s).length / 4);

export function usedToday() {
  return getDb().prepare("SELECT COUNT(*) n FROM gemini_usage WHERE day=? AND status!='cached'").get(today()).n;
}

/** Reserve one request slot BEFORE calling Gemini (failed calls still count). */
export function reserve({ purpose, docId = null, scanId = null, batch = null, inputTokens = 0 }) {
  const cfg = getConfig();
  if (!cfg.geminiApiKey) return { ok: false, reason: 'no_api_key' };
  const used = usedToday();
  if (used >= cfg.dailyLimit) return { ok: false, reason: 'daily_limit_reached' };
  if (inputTokens > cfg.maxInputTokens) return { ok: false, reason: 'input_too_large' };
  const r = getDb().prepare("INSERT INTO gemini_usage(day,purpose,doc_id,scan_id,batch,input_tokens,status) VALUES(?,?,?,?,?,?,'reserved')")
    .run(today(), purpose, docId, scanId, batch, inputTokens);
  return { ok: true, id: r.lastInsertRowid, used: used + 1, limit: cfg.dailyLimit };
}

export function settle(id, { outputTokens = 0, inputTokens = null, status = 'ok' }) {
  getDb().prepare('UPDATE gemini_usage SET output_tokens=?, input_tokens=COALESCE(?,input_tokens), status=? WHERE id=?')
    .run(outputTokens, inputTokens, status, id);
}

export function usageSummary() {
  const cfg = getConfig(), db = getDb(), day = today();
  const used = usedToday();
  const t = db.prepare("SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o FROM gemini_usage WHERE day=?").get(day);
  const errs = db.prepare("SELECT COUNT(*) n FROM gemini_usage WHERE day=? AND status='error'").get(day).n;
  const cache = db.prepare('SELECT COALESCE(SUM(cache_hits),0) hits FROM scans').get().hits;
  const total = db.prepare("SELECT COUNT(*) n FROM gemini_usage WHERE status!='cached'").get().n;
  return {
    day, enabled: !!cfg.geminiApiKey, model: cfg.model, used, limit: cfg.dailyLimit, remaining: Math.max(0, cfg.dailyLimit - used),
    inputTokens: t.i, outputTokens: t.o, errors: errs, cacheHits: cache, totalRequests: total,
    maxInputTokens: cfg.maxInputTokens, maxOutputTokens: cfg.maxOutputTokens,
  };
}
