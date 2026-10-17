'use client';
import { useEffect, useState } from 'react';
import { Badge, Bar, Btn, Card, Err, Stat, STATUS_LABEL, api } from './ui';

export default function Dashboard({ tick, bump }) {
  const [s, setS] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api('/api/stats').then(setS).catch((e) => setErr(e.message)); }, [tick]);
  if (err) return <Err>{err}</Err>;
  if (!s) return <p className="text-slate-400">Loading metrics…</p>;
  const g = s.gemini, maxSev = Math.max(1, ...Object.values(s.findingsBySeverity)), maxCat = Math.max(1, ...Object.values(s.findingsByCategory));
  const empty = s.documents === 0 && s.agentRuns === 0;
  return (
    <div className="space-y-5">
      {empty && (
        <Card title="Welcome to incheck"><p className="mb-3 text-sm text-slate-300">No data yet. Load the bundled sample documents (clean, poisoned, credentials, training material, a large handbook and a PDF), then scan them and run the attack playground.</p>
          <Btn onClick={async () => { await api('/api/samples', { method: 'POST' }); bump(); }}>Load sample documents</Btn></Card>)}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Documents" value={s.documents} sub={`${s.chunks} chunks · ${s.unscanned} unscanned`} />
        <Stat label="Scans run" value={s.scansTotal} sub={`${s.earlyStops} early stops`} />
        <Stat label="Confirmed threats" value={s.confirmedThreats} tone={s.confirmedThreats ? 'text-red-400' : 'text-slate-100'} />
        <Stat label="Partial scans" value={s.docStatus.partial || 0} tone={s.docStatus.partial ? 'text-violet-300' : 'text-slate-100'} sub="never treated as safe" />
        <Stat label="Tool calls allowed" value={s.toolCalls.allow} tone="text-emerald-400" sub={`${s.agentRuns} agent runs`} />
        <Stat label="Tool calls denied" value={s.toolCalls.deny} tone="text-red-400" sub={`${s.emailsSent} emails sent (simulated)`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Gemini usage today" right={<Badge kind={g.enabled ? 'allow' : 'partial'}>{g.enabled ? g.model : 'no API key · local only'}</Badge>}>
          <div className="mb-1 flex justify-between text-sm"><span>{g.used} / {g.limit} requests</span><span className="text-slate-400">{g.remaining} left</span></div>
          <Bar value={g.used} max={g.limit} tone={g.remaining === 0 ? 'bg-red-500' : g.remaining <= 3 ? 'bg-amber-500' : 'bg-emerald-500'} />
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs text-slate-400">
            <dt>Input tokens</dt><dd className="text-right text-slate-200">{g.inputTokens.toLocaleString()}</dd>
            <dt>Output tokens</dt><dd className="text-right text-slate-200">{g.outputTokens.toLocaleString()}</dd>
            <dt>Cache hits (free)</dt><dd className="text-right text-slate-200">{g.cacheHits}</dd>
            <dt>Errors today</dt><dd className="text-right text-slate-200">{g.errors}</dd>
            <dt>Per-request input cap</dt><dd className="text-right text-slate-200">{g.maxInputTokens} tok</dd>
          </dl>
        </Card>
        <Card title="Document status (latest scan)">
          {['threat_confirmed', 'findings', 'partial', 'clean'].map((k) => (<div key={k} className="mb-2"><div className="mb-1 flex justify-between text-xs"><span>{STATUS_LABEL[k]}</span><span>{s.docStatus[k] || 0}</span></div><Bar value={s.docStatus[k] || 0} max={Math.max(1, s.documents)} tone={{ threat_confirmed: 'bg-red-500', findings: 'bg-amber-500', partial: 'bg-violet-500', clean: 'bg-emerald-500' }[k]} /></div>))}
        </Card>
        <Card title="Findings">
          {['critical', 'high', 'medium', 'low'].map((k) => (<div key={k} className="mb-2 flex items-center gap-2"><Badge kind={k} className="w-16 justify-center" /><div className="flex-1"><Bar value={s.findingsBySeverity[k] || 0} max={maxSev} tone="bg-slate-400" /></div><span className="w-6 text-right text-xs">{s.findingsBySeverity[k] || 0}</span></div>))}
          <div className="mt-3 border-t border-slate-800 pt-2 text-xs text-slate-400">{Object.entries(s.findingsByCategory).map(([k, v]) => <div key={k} className="flex items-center justify-between py-0.5"><span>{k}</span><span className="text-slate-200">{v}</span></div>)}{!Object.keys(s.findingsByCategory).length && 'No findings yet.'}</div>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Recent scans"><ul className="space-y-2 text-sm">{s.recentScans.map((r) => (<li key={r.id} className="flex items-center justify-between gap-2"><span className="truncate">{r.name}</span><span className="flex items-center gap-2 text-xs text-slate-500">{r.processed_batches}/{r.planned_batches} batches{r.skipped_batches ? ` · ${r.skipped_batches} skipped` : ''}<Badge kind={r.status}>{STATUS_LABEL[r.status]}</Badge></span></li>))}{!s.recentScans.length && <li className="text-slate-500">No scans yet.</li>}</ul></Card>
        <Card title="Recent agent runs"><ul className="space-y-2 text-sm">{s.recentRuns.map((r) => (<li key={r.id} className="flex items-center justify-between gap-2"><span className="truncate">{r.scenario_id || r.task}</span><span className="flex gap-1"><Badge kind="allow">{r.allowed}</Badge><Badge kind="deny">{r.denied}</Badge></span></li>))}{!s.recentRuns.length && <li className="text-slate-500">No runs yet.</li>}</ul></Card>
        <Card title="Top policy denials"><ul className="space-y-2 text-sm">{s.topDenyRules.map((r) => (<li key={r.rule} className="flex justify-between"><code className="text-xs text-red-300">{r.rule}</code><span>{r.n}</span></li>))}{!s.topDenyRules.length && <li className="text-slate-500">No denials yet.</li>}</ul></Card>
      </div>
    </div>
  );
}
