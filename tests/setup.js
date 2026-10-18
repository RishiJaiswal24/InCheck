// Import first in every test file: isolated in-memory DB + deterministic env.
process.env.SENTINEL_DB = ':memory:';
process.env.GEMINI_API_KEY = 'test-key-not-real';
process.env.GEMINI_DAILY_LIMIT = '20';
delete process.env.ALLOW_EXTERNAL_EMAIL;
delete process.env.TURSO_DATABASE_URL;
delete process.env.VERCEL;
export const filler = (seed, words) => Array.from({ length: words }, (_, i) => `w${seed}x${i % 97}`).join(' ');
