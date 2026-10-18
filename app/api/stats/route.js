import { getStats } from '@/lib/stats';
import { handle, json } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handle(async () => json(await getStats()));
