'use client';
import { useEffect, useState } from 'react';
import AgentRunView from './AgentRunView';
import { Badge, Btn, Card, Err, api } from './ui';

export default function PlaygroundPanel({ bump }) {
  const [scs, setScs] = useState([]); const [results, setResults] = useState({}); const [sel, setSel] = useState(null); const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { api('/api/scenarios').then((d) => setScs(d.scenarios)).catch((e) => setErr(e.message)); }, []);
  const run = async (id) => { setBusy(id); setErr(''); try { const r = await api('/api/scenarios', { method: 'POST', body: { id } }); setResults((p) => ({ ...p, [id]: r })); setSel(id); bump(); } catch (e) { setErr(e.message); } finally { setBusy(''); } };
  const runAll = async () => { for (const s of scs) await run(s.id); };
  const cur = sel && results[sel];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><p className="text-sm text-slate-400">Five scripted scenarios against the sample documents. The simulated agent is deliberately over-compliant, so the policy gateway is what stops the attacks.</p><Btn onClick={runAll} disabled={!!busy}>{busy ? 'Running…' : 'Run all'}</Btn></div>
      <Err>{err}</Err>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {scs.map((s) => { const r = results[s.id]; return (
          <button key={s.id} onClick={() => (r ? setSel(s.id) : run(s.id))} className={`rounded-xl border p-3 text-left transition hover:bg-slate-800/40 ${sel === s.id ? 'border-emerald-500/60' : 'border-slate-800'} bg-ink-900/80`}>
            <div className="mb-1 flex items-center justify-between"><Badge kind={s.kind === 'attack' ? 'high' : 'clean'}>{s.kind}</Badge>{r && <Badge kind={r.pass ? 'allow' : 'deny'}>{r.pass ? 'as expected' : 'UNEXPECTED'}</Badge>}</div>
            <div className="text-sm font-semibold text-slate-100">{s.title}</div><p className="mt-1 text-xs text-slate-400">{s.description}</p>
            <div className="mt-2 text-xs text-slate-500">{busy === s.id ? 'Running…' : r ? `${r.run.allowed} allowed · ${r.run.denied} denied` : 'Click to run'}</div></button>); })}
      </div>
      {cur && <div className="space-y-2"><div className="rounded-xl border border-slate-800 bg-ink-900/80 p-3 text-sm"><span className="text-slate-400">Task:</span> {cur.run.task} <span className="text-slate-500">· role {cur.run.role}</span></div><AgentRunView run={cur.run} /></div>}
    </div>
  );
}
