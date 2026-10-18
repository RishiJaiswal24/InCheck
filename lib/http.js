import { q } from './db.js';
export const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
/** Wrap a route handler: consistent JSON errors, no stack traces leaked. */
export const handle = (fn) => async (req, ctx) => {
  try { return await fn(req, ctx); }
  catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    if (status === 500) console.error('[api]', e);
    return json({ error: status === 500 ? 'Internal error' : e.message }, status);
  }
};
export const readJson = async (req) => { try { const b = await req.json(); return b && typeof b === 'object' ? b : {}; } catch { return {}; } };
export const bad = (m, status = 400) => Object.assign(new Error(m), { status });

export const docId = async (params) => {
  const { id } = await params;
  const n = Number(id);

  if (!Number.isInteger(n) || n < 1) {
    throw bad("Invalid document id");
  }

  return n;
};


export const clientIp = (req) => (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'local').split(',')[0].trim().slice(0, 64);

/** Fixed-window rate limit stored in the DB (shared across serverless instances). Throws 429 when exceeded. */
export async function rateLimit(req, name, max, windowSec = 600) {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return;
  const now = Date.now(), win = windowSec * 1000;
  const r = await q.get(
    `INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1)
     ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END, window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END
     RETURNING count, window_start`, [`${name}:${clientIp(req)}`, now, now - win, now - win, now]);
  if (r.count > max) throw bad(`Rate limit exceeded. Try again in ${Math.ceil((r.window_start + win - now) / 1000)}s.`, 429);
}
