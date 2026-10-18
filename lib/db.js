// MongoDB data layer (official `mongodb` driver). Works with a local mongod and with Atlas (serverless friendly: one cached client).
// Rows keep the same shape the SQL version returned (numeric `id`, snake_case fields, ISO timestamps) so routes and UI are unchanged.
// Numeric ids are allocated from a `counters` collection and stored as `_id`, which also makes them unique-indexed for free.
import { MongoClient } from 'mongodb';
import { getConfig } from './config.js';

export const nowIso = () => new Date().toISOString();
export const today = () => nowIso().slice(0, 10);

/** Timestamp field that SQL used to fill with DEFAULT CURRENT_TIMESTAMP; applied automatically on insert. */
const STAMP = { documents: 'created_at', findings: 'created_at', gemini_usage: 'ts', gemini_cache: 'created_at', audit_logs: 'ts', agent_runs: 'ts', outbox: 'ts', scans: 'started_at' };

async function ensureIndexes(d) {
  const ix = (name, specs) => d.collection(name).createIndexes(specs);
  await Promise.all([
    ix('documents', [{ key: { name: 1, is_sample: 1 } }]),
    ix('chunks', [{ key: { doc_id: 1, idx: 1 } }]),
    ix('scans', [
      { key: { doc_id: 1, _id: -1 } },
      // Atomic scan lock: at most one "running" scan per document, enforced by the database itself.
      { key: { doc_id: 1 }, name: 'one_running_scan_per_doc', unique: true, partialFilterExpression: { status: 'running' } },
    ]),
    ix('findings', [{ key: { scan_id: 1 } }, { key: { doc_id: 1 } }]),
    ix('gemini_usage', [{ key: { day: 1, status: 1 } }]),
    ix('audit_logs', [{ key: { run_id: 1 } }, { key: { decision: 1, _id: -1 } }]),
    ix('agent_runs', [{ key: { ts: -1 } }]),
  ]);
}

async function connect() {
  let st = globalThis.__incheckMongo;
  if (!st) {
    const cfg = getConfig();
    if (!cfg.mongoUri) throw new Error('MONGODB_URI is not set');
    const client = new MongoClient(cfg.mongoUri, { maxPoolSize: 10, serverSelectionTimeoutMS: 5000 });
    const ready = client.connect().then(async () => { const d = client.db(cfg.mongoDb); await ensureIndexes(d); return d; });
    st = globalThis.__incheckMongo = { client, ready };
    ready.catch(() => { globalThis.__incheckMongo = undefined; client.close().catch(() => {}); }); // retry init on next request
  }
  return st.ready;
}

export async function closeDb() {
  const st = globalThis.__incheckMongo;
  globalThis.__incheckMongo = undefined;
  if (st) await st.client.close().catch(() => {});
}

/** Mongo doc -> API row: `_id` becomes `id`. */
const row = (d) => { if (!d) return null; const { _id, ...rest } = d; return { id: _id, ...rest }; };
const asUpdate = (u) => (Object.keys(u).some((k) => k.startsWith('$')) ? u : { $set: u });
export const isDuplicateKey = (e) => e?.code === 11000;

export const db = {
  col: async (name) => (await connect()).collection(name),
  ping: async () => { await (await connect()).command({ ping: 1 }); },

  /** Reserve `n` consecutive numeric ids for a collection. */
  async nextIds(name, n = 1) {
    const r = await (await db.col('counters')).findOneAndUpdate({ _id: name }, { $inc: { seq: n } }, { upsert: true, returnDocument: 'after' });
    return Array.from({ length: n }, (_, i) => r.seq - n + 1 + i);
  },
  /** Insert one document; returns the stored row. Pass `id` to choose the id (e.g. agent run ids). */
  async insert(name, doc, id) {
    const _id = id ?? (await db.nextIds(name, 1))[0];
    const full = { ...(STAMP[name] && { [STAMP[name]]: nowIso() }), ...doc, _id };
    await (await db.col(name)).insertOne(full);
    return row(full);
  },
  /** Insert many documents in one round trip. Returns how many were stored. */
  async insertMany(name, docs) {
    if (!docs.length) return 0;
    const ids = await db.nextIds(name, docs.length), ts = nowIso();
    await (await db.col(name)).insertMany(docs.map((d, i) => ({ ...(STAMP[name] && { [STAMP[name]]: ts }), ...d, _id: ids[i] })));
    return docs.length;
  },
  async get(name, filter = {}, { sort, projection } = {}) {
    return row(await (await db.col(name)).findOne(filter, { sort, projection }));
  },
  async all(name, filter = {}, { sort, limit, projection } = {}) {
    let c = (await db.col(name)).find(filter, { projection });
    if (sort) c = c.sort(sort);
    if (limit) c = c.limit(limit);
    return (await c.toArray()).map(row);
  },
  async count(name, filter = {}) { return (await db.col(name)).countDocuments(filter); },
  async updateOne(name, filter, update) { return (await (await db.col(name)).updateOne(filter, asUpdate(update))).modifiedCount; },
  async updateMany(name, filter, update) { return (await (await db.col(name)).updateMany(filter, asUpdate(update))).modifiedCount; },
  async deleteMany(name, filter) { return (await (await db.col(name)).deleteMany(filter)).deletedCount; },
  /** Raw aggregation; results keep `_id` as returned. */
  async aggregate(name, pipeline) { return (await (await db.col(name)).aggregate(pipeline)).toArray(); },
  /** GROUP BY field -> [{[field]: value, n}] ordered by count desc. */
  async group(name, field, match = {}, limit = 0) {
    const rows = await db.aggregate(name, [{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, ...(limit ? [{ $limit: limit }] : [])]);
    return rows.map((r) => ({ [field]: r._id, n: r.n }));
  },
  async sum(name, field, match = {}) {
    const [r] = await db.aggregate(name, [{ $match: match }, { $group: { _id: null, total: { $sum: `$${field}` } } }]);
    return r?.total ?? 0;
  },
};

/** Scans stuck in "running" (function killed mid-scan) become "partial/interrupted" - never silently safe. */
export const reapStaleScans = () => db.updateMany('scans',
  { status: 'running', started_at: { $lt: new Date(Date.now() - 3 * 60 * 1000).toISOString() } },
  { status: 'partial', stop_reason: 'interrupted', finished_at: nowIso() });
