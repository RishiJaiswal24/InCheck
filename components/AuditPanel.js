'use client';
import { useEffect, useState } from 'react';
import { Badge, Card, Err, Select, api } from './ui';

export default function AuditPanel({ tick }) {
  const [logs, setLogs] = useState([]); const [f, setF] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { api(`/api/audit?limit=300${f ? `&decision=${f}` : ''}`).then((d) => setLogs(d.logs)).catch((e) => setErr(e.message)); }, [tick, f]);
  return (
    <Card title="Audit log (append-only, secrets redacted)" right={<Select value={f} onChange={(e) => setF(e.target.value)}><option value="">all events</option><option value="deny">denied</option><option value="allow">allowed</option></Select>}>
      <Err>{err}</Err>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-500"><tr><th className="py-1">#</th><th>Time (UTC)</th><th>Run</th><th>Event</th><th>Tool</th><th>Decision</th><th>Rule</th><th>Detail</th></tr></thead><tbody>
        {logs.map((l) => (<tr key={l.id} className="border-t border-slate-800 align-top"><td className="py-1.5 text-slate-500">{l.id}</td><td className="whitespace-nowrap text-slate-400">{l.ts}</td><td className="text-slate-400">{l.run_id}</td><td>{l.event}</td><td className="text-cyan-300">{l.tool}</td><td>{l.decision && <Badge kind={l.decision}>{l.decision}</Badge>}</td><td className="text-slate-400">{l.rule}</td><td className="max-w-md break-words text-slate-300">{l.reason}{l.args && <div className="font-mono text-[11px] text-slate-500">{l.args.slice(0, 160)}</div>}</td></tr>))}
        {!logs.length && <tr><td colSpan={8} className="py-4 text-slate-500">No audit events yet.</td></tr>}</tbody></table></div>
    </Card>
  );
}
