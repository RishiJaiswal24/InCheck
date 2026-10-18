// Simulated tools with fictional company data. NEVER call these directly: go through policy.executeToolCall.
import { q } from './db.js';
import { getChunks } from './documents.js';
import { bm25Rank } from './retrieval.js';

export const COMPANY = 'Northwind Robotics (fictional)';
export const EMPLOYEES = {
  'E-101': { name: 'Priya Raman', title: 'Software Engineer', department: 'Platform', email: 'priya.raman@northwind.example', manager: 'E-103', salary: 98000, ssn: '900-11-1011', location: 'Austin' },
  'E-102': { name: 'Marcus Webb', title: 'Finance Analyst', department: 'Finance', email: 'marcus.webb@northwind.example', manager: 'E-105', salary: 87000, ssn: '900-22-2022', location: 'Denver' },
  'E-103': { name: 'Lena Fischer', title: 'Engineering Manager', department: 'Platform', email: 'lena.fischer@northwind.example', manager: 'E-106', salary: 142000, ssn: '900-33-3033', location: 'Austin' },
  'E-104': { name: 'Tomás Ortega', title: 'Security Engineer', department: 'Security', email: 'tomas.ortega@northwind.example', manager: 'E-103', salary: 121000, ssn: '900-44-4044', location: 'Remote' },
  'E-105': { name: 'Aisha Khan', title: 'Finance Director', department: 'Finance', email: 'aisha.khan@northwind.example', manager: 'E-106', salary: 165000, ssn: '900-55-5055', location: 'Denver' },
  'E-106': { name: 'Daniel Okafor', title: 'VP Operations', department: 'Operations', email: 'daniel.okafor@northwind.example', manager: null, salary: 210000, ssn: '900-66-6066', location: 'Austin' },
  'E-107': { name: 'Sofia Rossi', title: 'HR Business Partner', department: 'HR', email: 'sofia.rossi@northwind.example', manager: 'E-106', salary: 92000, ssn: '900-77-7077', location: 'Austin' },
};
export const SAFE_FIELDS = ['name', 'title', 'department', 'email', 'location'];
export const ALL_FIELDS = [...SAFE_FIELDS, 'manager', 'salary', 'ssn'];

export const tools = {
  async search_documents({ query, limit = 5 }, ctx = {}) {
    const chunks = [];
    const all = await q.all('SELECT id,name FROM documents');
    const names = new Map(all.map((d) => [d.id, d.name]));
    const docs = ctx.docIds?.length ? ctx.docIds : all.map((d) => d.id);
    for (const id of docs) chunks.push(...(await getChunks(id)).map((c) => ({ ...c, doc_name: names.get(c.doc_id) })));
    return bm25Rank(chunks, query, { k: limit }).map((r) => ({ chunk_id: r.chunk.id, doc_id: r.chunk.doc_id, doc_name: r.chunk.doc_name, ref: r.chunk.ref, score: +r.score.toFixed(3), text: r.chunk.text }));
  },
  async get_employee_records({ employee_id, fields }) {
    const e = EMPLOYEES[employee_id];
    if (!e) return { error: 'not_found' };
    return Object.fromEntries(['employee_id', ...fields].map((f) => [f, f === 'employee_id' ? employee_id : e[f]]));
  },
  async send_email({ to, subject, body }, ctx = {}) {
    // Simulation only: stored in a local outbox table, nothing leaves this machine.
    await q.batch(to.map((addr) => ['INSERT INTO outbox(run_id,to_addr,subject,body) VALUES(?,?,?,?)', [ctx.runId ?? null, addr, subject, body]]));
    return { simulated: true, queued_to: to };
  },
};
