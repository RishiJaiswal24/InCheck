// Central config. Read lazily so tests can set process.env before first use.
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** MongoDB: MONGODB_URI (Atlas in production). Locally falls back to a mongod on 127.0.0.1; on Vercel there is no fallback. */
function dbConfig(e) {
  const mongoDb = e.MONGODB_DB || 'incheck';
  if (e.MONGODB_URI) return { mongoUri: e.MONGODB_URI, mongoDb, persistence: 'mongodb' };
  if (e.VERCEL) return { mongoUri: '', mongoDb, persistence: 'unconfigured' };
  return { mongoUri: 'mongodb://127.0.0.1:27017', mongoDb, persistence: 'local-mongodb' };
}

export function getConfig() {
  const e = process.env;
  return {
    geminiApiKey: e.GEMINI_API_KEY || '',
    model: e.GEMINI_MODEL || 'gemini-2.5-flash',
    dailyLimit: int(e.GEMINI_DAILY_LIMIT, 20),
    maxInputTokens: int(e.GEMINI_MAX_INPUT_TOKENS, 6000),
    maxOutputTokens: int(e.GEMINI_MAX_OUTPUT_TOKENS, 1500),
    batchChunks: clamp(int(e.GEMINI_BATCH_CHUNKS, 12), 10, 15),
    maxBatches: clamp(int(e.GEMINI_MAX_BATCHES, 10), 1, 10),
    confirmThreshold: parseFloat(e.CONFIRM_THRESHOLD) || 0.85,
    chunkWords: int(e.CHUNK_WORDS, 180),
    overlapWords: int(e.CHUNK_OVERLAP_WORDS, 30),
    // Vercel rejects request bodies > 4.5 MB before our code runs, so default to 4 MB.
    maxUploadBytes: Math.min(int(e.MAX_UPLOAD_MB, 4), e.VERCEL ? 4 : Infinity) * 1024 * 1024,
    geminiTimeoutMs: int(e.GEMINI_TIMEOUT_MS, 15000),
    // Stop starting new Gemini batches after this long (serverless functions have a hard time limit). Re-scan resumes via cache.
    scanTimeBudgetMs: int(e.SCAN_TIME_BUDGET_MS, 40000),
    maxWords: 60000,
    ...dbConfig(e),
    internalDomain: (e.INTERNAL_EMAIL_DOMAIN || 'northwind.example').toLowerCase(),
    allowExternalEmail: e.ALLOW_EXTERNAL_EMAIL === 'true',
  };
}
