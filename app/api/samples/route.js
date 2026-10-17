import { ensureSamples } from '@/lib/samples';
import { handle, json } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = handle(async () => json({ samples: await ensureSamples() }));
