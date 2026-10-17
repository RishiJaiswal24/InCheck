'use client';
import { useEffect, useRef, useState } from 'react';
import { Badge, Btn, Card, Details, Err, STATUS_LABEL, api } from './ui';

function ScanView({ scan }) {
  if (!scan) return <p className="text-sm text-slate-400">Not scanned yet.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm"><Badge kind={scan.status}>{STATUS_LABEL[scan.status]}</Badge>
        <span className="text-slate-400">{scan.processed_batches}/{scan.planned_batches} batches processed · {scan.skipped_batches} skipped · {scan.gemini_requests} Gemini requests · {scan.cache_hits} cache hits · {scan.chunks_analyzed}/{scan.chunks_total} chunks analysed by Gemini</span></div>
      {scan.stop_reason && <p className="text-xs text-slate-400">Stop reason: <code className="text-violet-300">{scan.stop_reason}</code>{scan.status !== 'clean' && ' — unprocessed content is NOT considered safe.'}</p>}
      <div className="flex flex-wrap gap-1.5">{scan.batches.map((b) => (<span key={b.index} title={`${b.chunkIds.length} chunks${b.reason ? ' · ' + b.reason : ''}`}><Badge kind={b.status}>batch {b.index} · {b.status}</Badge></span>))}{!scan.batches.length && <span className="text-xs text-slate-500">no batches planned</span>}</div>
      <table className="w-full text-left text-xs"><thead className="text-slate-500"><tr><th className="py-1">Severity</th><th>Category</th><th>Conf.</th><th>Source</th><th>Where</th><th>Explanation</th></tr></thead><tbody>
        {scan.findings.map((f) => (<tr key={f.id} className="border-t border-slate-800 align-top"><td className="py-1.5"><Badge kind={f.severity} />{f.confirmed ? <Badge kind="critical" className="ml-1">confirmed</Badge> : null}</td><td>{f.category}</td><td>{f.confidence}</td><td><Badge kind={f.source === 'gemini' ? 'cached' : 'info'}>{f.source}</Badge></td><td>{f.ref}</td><td className="text-slate-300">{f.explanation}<div className="font-mono text-[11px] text-slate-500">“{f.evidence}”</div></td></tr>))}
        {!scan.findings.length && <tr><td colSpan={6} className="py-3 text-slate-500">No findings.</td></tr>}</tbody></table>
    </div>
  );
}

export default function DocumentsPanel({ tick, bump }) {
  const [docs, setDocs] = useState([]); const [sel, setSel] = useState(null); const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(''); const [useGemini, setUseGemini] = useState(true); const fileRef = useRef();
  const load = () => api('/api/documents').then((d) => setDocs(d.documents)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [tick]);
  useEffect(() => { if (sel) api(`/api/documents/${sel}`).then(setDetail).catch((e) => setErr(e.message)); else setDetail(null); }, [sel, tick]);

  const run = async (label, fn) => { setErr(''); setBusy(label); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(''); bump(); } };
  const upload = (e) => { const f = e.target.files[0]; if (!f) return; run('upload', async () => { const fd = new FormData(); fd.append('file', f); const r = await api('/api/documents', { method: 'POST', body: fd }); setSel(r.document.id); }); e.target.value = ''; };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-3 lg:col-span-2">
        <Card title="Documents" right={<div className="flex gap-2"><Btn variant="ghost" disabled={!!busy} onClick={() => run('samples', () => api('/api/samples', { method: 'POST' }))}>Load samples</Btn><Btn disabled={!!busy} onClick={() => fileRef.current.click()}>{busy === 'upload' ? 'Uploading…' : 'Upload'}</Btn><input ref={fileRef} type="file" accept=".pdf,.txt,.md,.markdown" className="hidden" onChange={upload} /></div>}>
          <Err>{err}</Err>
          <ul className="mt-2 divide-y divide-slate-800">
            {docs.map((d) => (<li key={d.id}><button onClick={() => setSel(d.id)} className={`flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-sm hover:bg-slate-800/50 ${sel === d.id ? 'bg-slate-800/70' : ''}`}>
              <span className="min-w-0"><span className="block truncate font-medium">{d.name}</span><span className="text-xs text-slate-500">{d.type.toUpperCase()} · {d.words.toLocaleString()} words · {d.chunk_count} chunks</span></span>
              <Badge kind={d.scan_status || 'unscanned'}>{STATUS_LABEL[d.scan_status || 'unscanned']}</Badge></button></li>))}
            {!docs.length && <li className="py-4 text-sm text-slate-500">No documents. Upload PDF/TXT/MD or load the samples.</li>}
          </ul>
        </Card>
      </div>
      <div className="lg:col-span-3">
        {!detail ? <Card><p className="text-sm text-slate-400">Select a document to scan it and inspect findings.</p></Card> : (
          <Card title={detail.document.name} right={<div className="flex items-center gap-3"><label className="flex items-center gap-1.5 text-xs text-slate-400"><input type="checkbox" checked={useGemini} onChange={(e) => setUseGemini(e.target.checked)} />Use Gemini</label>
            <Btn disabled={!!busy} onClick={() => run('scan', async () => { await api(`/api/documents/${detail.document.id}/scan`, { method: 'POST', body: { useGemini } }); })}>{busy === 'scan' ? 'Scanning…' : 'Scan'}</Btn>
            <Btn variant="danger" disabled={!!busy} onClick={() => run('delete', async () => { await api(`/api/documents/${detail.document.id}`, { method: 'DELETE' }); setSel(null); })}>Delete</Btn></div>}>
            <ScanView scan={detail.scan} />
            <div className="mt-4"><Details summary={`Chunks with source references (${detail.chunks.length})`}><ul className="space-y-1 text-xs">{detail.chunks.map((c) => <li key={c.id} className="text-slate-400"><span className="mr-2 text-slate-500">#{c.id} · {c.ref}</span>{c.preview}…</li>)}</ul></Details></div>
          </Card>)}
      </div>
    </div>
  );
}
