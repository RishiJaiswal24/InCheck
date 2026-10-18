// Import first in every test file: isolated throwaway MongoDB + deterministic env.
// Uses MONGODB_URI if you set one (a unique database is created per test file); otherwise starts mongodb-memory-server.
import { after } from 'node:test';
import crypto from 'node:crypto';
import { closeDb } from '../lib/db.js';

let mongod = null;
if (process.env.TEST_MONGODB_URI) process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
else {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
}
process.env.MONGODB_DB = `incheck_test_${crypto.randomBytes(4).toString('hex')}`;
process.env.GEMINI_API_KEY = 'test-key-not-real';
process.env.GEMINI_DAILY_LIMIT = '20';
delete process.env.ALLOW_EXTERNAL_EMAIL;
delete process.env.VERCEL;
after(async () => { await closeDb(); await mongod?.stop(); });
export const filler = (seed, words) => Array.from({ length: words }, (_, i) => `w${seed}x${i % 97}`).join(' ');
