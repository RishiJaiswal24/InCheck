'use client';
import { useState } from 'react';

export async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined, body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const TONE = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/40', high: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/40', low: 'bg-sky-500/15 text-sky-300 border-sky-500/40', info: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
  threat_confirmed: 'bg-red-500/15 text-red-300 border-red-500/40', findings: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  partial: 'bg-violet-500/15 text-violet-300 border-violet-500/40', clean: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  unscanned: 'bg-slate-500/15 text-slate-400 border-slate-600/40', allow: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', deny: 'bg-red-500/15 text-red-300 border-red-500/40',
  processed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', cached: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40', skipped: 'bg-slate-600/30 text-slate-400 border-slate-600/40', failed: 'bg-red-500/20 text-red-300 border-red-500/40', pending: 'bg-slate-700/30 text-slate-400 border-slate-600/40',
};
export const STATUS_LABEL = { threat_confirmed: 'Threat confirmed', findings: 'Findings (fully scanned)', partial: 'Partially scanned', clean: 'Clean', unscanned: 'Not scanned' };

export const Badge = ({ kind, children, className = '' }) => (
  <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none ${TONE[kind] || TONE.info} ${className}`}>{children ?? kind}</span>
);
export const Card = ({ title, right, children, className = '' }) => (
  <section className={`rounded-xl border border-slate-800 bg-ink-900/80 ${className}`}>
    {(title || right) && <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5"><h3 className="text-sm font-semibold text-slate-100">{title}</h3>{right}</header>}
    <div className="p-4">{children}</div>
  </section>
);
export const Btn = ({ children, variant = 'primary', className = '', ...p }) => (
  <button {...p} className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variant === 'primary' ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : variant === 'danger' ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30' : 'border border-slate-700 text-slate-200 hover:bg-slate-800'} ${className}`}>{children}</button>
);
export const Stat = ({ label, value, sub, tone = 'text-slate-100' }) => (
  <div className="rounded-xl border border-slate-800 bg-ink-900/80 p-4"><div className="text-xs uppercase tracking-wide text-slate-400">{label}</div><div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>{sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}</div>
);
export const Bar = ({ value, max, tone = 'bg-emerald-500' }) => (
  <div className="h-2 w-full rounded bg-slate-800"><div className={`h-2 rounded ${tone}`} style={{ width: `${Math.min(100, max ? (value / max) * 100 : 0)}%` }} /></div>
);
export const Err = ({ children }) => children ? <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{children}</div> : null;
export const Select = (p) => <select {...p} className="rounded-md border border-slate-700 bg-ink-800 px-2 py-1.5 text-sm text-slate-200" />;
export const Details = ({ summary, children }) => { const [o, setO] = useState(false); return (<div><button onClick={() => setO(!o)} className="text-xs text-cyan-400 hover:underline">{o ? '▾' : '▸'} {summary}</button>{o && <div className="mt-2">{children}</div>}</div>); };
export const Mono = ({ children }) => <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 text-[11px] text-slate-300">{typeof children === 'string' ? children : JSON.stringify(children, null, 2)}</pre>;
