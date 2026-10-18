import { db } from '@/lib/db';
import { getConfig } from '@/lib/config';
import { handle, json } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Uptime/readiness probe. Never returns secrets. */
export const GET = handle(async () => {
  const cfg = getConfig();
  try { await db.ping(); }
  catch { return json({ ok: false, db: 'unreachable', persistence: cfg.persistence }, 503); }
  return json({ ok: true, db: 'ok', persistence: cfg.persistence, gemini: cfg.geminiApiKey ? 'configured' : 'not_configured', auth: process.env.BASIC_AUTH_USER ? 'basic' : 'none' });
});
