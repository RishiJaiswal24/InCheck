'use client';
import { useState } from 'react';
import AuditPanel from '@/components/AuditPanel';
import Dashboard from '@/components/Dashboard';
import DocumentsPanel from '@/components/DocumentsPanel';
import PlaygroundPanel from '@/components/PlaygroundPanel';
import SandboxPanel from '@/components/SandboxPanel';

const TABS = [['dashboard', 'Dashboard'], ['documents', 'Documents'], ['sandbox', 'Agent Sandbox'], ['playground', 'Attack Playground'], ['audit', 'Audit Log']];

export default function Home() {
  const [tab, setTab] = useState('dashboard');
  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500/15 text-lg text-emerald-400 ring-1 ring-emerald-500/40">⬡</div>
          <div><h1 className="text-lg font-semibold tracking-tight text-white">incheck</h1><p className="text-xs text-slate-500">AI agent security · document scanning · policy gateway</p></div></div>
        <nav className="flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-ink-900/70 p-1">
          {TABS.map(([k, label]) => (<button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm transition ${tab === k ? 'bg-slate-700/70 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{label}</button>))}
        </nav>
      </header>
      <main>
        {tab === 'dashboard' && <Dashboard tick={tick} bump={bump} />}
        {tab === 'documents' && <DocumentsPanel tick={tick} bump={bump} />}
        {tab === 'sandbox' && <SandboxPanel bump={bump} />}
        {tab === 'playground' && <PlaygroundPanel bump={bump} />}
        {tab === 'audit' && <AuditPanel tick={tick} />}
      </main>
    </div>
  );
}
