import { listAudit } from '@/lib/audit';
import { handle, json } from '@/lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const decision = ['allow', 'deny'].includes(u.searchParams.get('decision')) ? u.searchParams.get('decision') : null;
  return json({ logs: await listAudit({ limit: u.searchParams.get('limit'), decision }) });
});
