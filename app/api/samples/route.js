import { ensureSamples } from '@/lib/samples';
import { handle, json, rateLimit } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = handle(async (req) => { await rateLimit(req, 'samples', 10); return json({ samples: await ensureSamples() }); });
