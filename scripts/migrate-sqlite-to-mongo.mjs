// One-off: copy an existing SQLite/libSQL database (the old storage) into MongoDB, keeping ids.
// Usage:  npm i --no-save @libsql/client   then
//         SQLITE_URL=file:data/incheck.db MONGODB_URI=mongodb://127.0.0.1:27017 npm run db:migrate-sqlite
// (for Turso: SQLITE_URL=libsql://... SQLITE_AUTH_TOKEN=...). Safe to re-run: existing rows are replaced by id.
import { createClient } from '@libsql/client';
import { MongoClient } from 'mongodb';

const src = createClient({ url: process.env.SQLITE_URL || 'file:data/incheck.db', authToken: process.env.SQLITE_AUTH_TOKEN || undefined });
const mongo = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
await mongo.connect();
const dest = mongo.db(process.env.MONGODB_DB || 'incheck');
const iso = (v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v) ? v.replace(' ', 'T') + '.000Z' : v);

// table -> [collection, id column]
const TABLES = { documents: ['documents', 'id'], chunks: ['chunks', 'id'], scans: ['scans', 'id'], findings: ['findings', 'id'], gemini_usage: ['gemini_usage', 'id'],
  gemini_cache: ['gemini_cache', 'key'], audit_logs: ['audit_logs', 'id'], agent_runs: ['agent_runs', 'id'], outbox: ['outbox', 'id'] };

for (const [table, [coll, idCol]] of Object.entries(TABLES)) {
  const rows = (await src.execute(`SELECT * FROM ${table}`).catch(() => ({ rows: [] }))).rows;
  if (!rows.length) { console.log(`${table}: 0 rows`); continue; }
  const docs = rows.map((r) => { const { [idCol]: id, ...rest } = { ...r }; return { _id: idCol === 'id' && typeof id === 'bigint' ? Number(id) : id, ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : iso(v)])) }; });
  await dest.collection(coll).bulkWrite(docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })));
  if (idCol === 'id' && typeof docs[0]._id === 'number') await dest.collection('counters').updateOne({ _id: coll }, { $max: { seq: Math.max(...docs.map((d) => d._id)) } }, { upsert: true });
  console.log(`${table}: ${docs.length} rows`);
}
// Rebuild the per-day Gemini cap counters from the usage rows so the daily limit keeps counting correctly.
const perDay = await dest.collection('gemini_usage').aggregate([{ $match: { status: { $ne: 'cached' } } }, { $group: { _id: '$day', count: { $sum: 1 } } }]).toArray();
for (const d of perDay) await dest.collection('usage_counters').replaceOne({ _id: d._id }, d, { upsert: true });
await mongo.close(); src.close();
console.log('Done.');
