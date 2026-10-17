'use client';
import { Badge, Card, Details, Mono } from './ui';

export default function AgentRunView({ run }) {
  if (!run) return null;
  const flagged = run.evidence.filter((e) => e.findings.length);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-ink-900/80 p-3 text-sm">
        <span className="text-slate-400">Run</span><code className="text-cyan-300">{run.runId}</code>
        <Badge kind="allow">{run.allowed} allowed</Badge><Badge kind="deny">{run.denied} denied</Badge>
        {run.tainted && <Badge kind="high">context tainted</Badge>}
        <span className="text-xs text-slate-500">{run.planNote}</span>
      </div>

      <Card title={`1 · Retrieved evidence (${run.evidence.length})`}>
        {!run.evidence.length && <p className="text-sm text-slate-400">No documents matched. Load samples or upload documents first.</p>}
        <div className="space-y-2">
          {run.evidence.map((e) => (
            <div key={e.chunk_id} className={`rounded-lg border p-3 text-sm ${e.quarantined ? 'border-red-500/50 bg-red-500/5' : 'border-slate-800 bg-black/20'}`}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-400"><span className="font-medium text-slate-200">{e.doc_name}</span><span>{e.ref}</span><span>bm25 {e.score}</span>
                {e.quarantined && <Badge kind="critical">quarantined</Badge>}
                {e.findings.map((f) => <Badge key={f.rule} kind={f.severity}>{f.category.replace('_', ' ')}{f.educational ? ' · educational' : ''}</Badge>)}</div>
              <p className="line-clamp-3 text-slate-300">{e.text}</p>
            </div>))}
        </div>
      </Card>

      <Card title={`2 · Detection findings (${flagged.reduce((n, e) => n + e.findings.length, 0)})`}>
        {!flagged.length ? <p className="text-sm text-slate-400">No suspicious content in retrieved evidence.</p> : (
          <table className="w-full text-left text-xs"><thead className="text-slate-500"><tr><th className="py-1">Severity</th><th>Category</th><th>Conf.</th><th>Source</th><th>Explanation / evidence</th></tr></thead><tbody>
            {flagged.flatMap((e) => e.findings.map((f) => (
              <tr key={e.chunk_id + f.rule} className="border-t border-slate-800 align-top"><td className="py-1.5"><Badge kind={f.severity} /></td><td>{f.category}</td><td>{f.confidence}</td><td>{e.doc_name} · {e.ref}</td><td className="text-slate-300">{f.explanation}<div className="mt-0.5 font-mono text-[11px] text-slate-500">“{f.evidence}”</div></td></tr>)))}
          </tbody></table>)}
      </Card>

      <Card title={`3 · Proposed actions → policy gateway (${run.actions.length})`}>
        {!run.actions.length && <p className="text-sm text-slate-400">The agent proposed no sensitive actions.</p>}
        <div className="space-y-2">
          {run.actions.map((a, i) => (
            <div key={i} className={`rounded-lg border p-3 text-sm ${a.decision === 'deny' ? 'border-red-500/40 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
              <div className="flex flex-wrap items-center gap-2"><Badge kind={a.decision}>{a.decision.toUpperCase()}</Badge><code className="text-cyan-300">{a.tool}</code>
                <span className="text-xs text-slate-500">origin: {a.provenance}</span><span className="text-xs text-slate-500">rule: {a.rule}</span>{a.executed ? <Badge kind="processed">executed (simulated)</Badge> : <Badge kind="skipped">not executed</Badge>}</div>
              <p className="mt-1 text-slate-300">{a.reason}</p>
              <div className="mt-1"><Details summary="arguments / result"><Mono>{{ args: a.args, result: a.result }}</Mono></Details></div>
            </div>))}
        </div>
      </Card>

      <Card title="4 · Agent answer (quarantined content excluded)"><pre className="whitespace-pre-wrap text-sm text-slate-200">{run.answer}</pre></Card>

      <Card title={`5 · Audit trace (${run.trace.length} events)`}>
        <ol className="space-y-1 text-xs">{run.trace.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 border-b border-slate-800/60 py-1"><span className="text-slate-500">#{t.id}</span><code className="text-slate-300">{t.event}</code>{t.tool && <code className="text-cyan-300">{t.tool}</code>}{t.decision && <Badge kind={t.decision}>{t.decision}</Badge>}{t.rule && <span className="text-slate-500">{t.rule}</span>}</li>))}</ol>
      </Card>
    </div>
  );
}
