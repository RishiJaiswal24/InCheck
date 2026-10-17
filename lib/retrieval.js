// Local BM25 retrieval (TF-IDF family). No external services.
const STOP = new Set('a an the and or of to in on for with is are was were be by at as it this that from i me my you your'.split(' '));
export const tokenize = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 1 && !STOP.has(t));

/** Rank chunks ({id,text,...}) against a query. Returns [{chunk, score}] (score > 0 only), best first. */
export function bm25Rank(chunks, query, { k = 10, k1 = 1.5, b = 0.75 } = {}) {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !chunks.length) return [];
  const docs = chunks.map((c) => { const t = tokenize(c.text); const tf = new Map(); t.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1)); return { c, tf, len: t.length }; });
  const avg = docs.reduce((s, d) => s + d.len, 0) / docs.length || 1;
  const N = docs.length;
  const df = new Map(q.map((w) => [w, docs.reduce((n, d) => n + (d.tf.has(w) ? 1 : 0), 0)]));
  const scored = docs.map((d) => {
    let score = 0;
    for (const w of q) {
      const f = d.tf.get(w); if (!f) continue;
      const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.len / avg))));
    }
    return { chunk: d.c, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score).slice(0, k);
}

/** Query used to surface security-relevant chunks for prioritisation. */
export const SECURITY_QUERY = 'ignore previous instructions system prompt override bypass password secret api key token credentials send email forward upload employee records salary confidential admin access approval';
