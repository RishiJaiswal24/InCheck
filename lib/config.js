// Central config. Read lazily so tests can set process.env before first use.
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

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
    maxUploadBytes: int(e.MAX_UPLOAD_MB, 5) * 1024 * 1024,
    maxWords: 60000,
    dbPath: e.SENTINEL_DB || 'data/incheck.db',
    internalDomain: (e.INTERNAL_EMAIL_DOMAIN || 'northwind.example').toLowerCase(),
    allowExternalEmail: e.ALLOW_EXTERNAL_EMAIL === 'true',
  };
}
