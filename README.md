# incheck — AI Agent Security

Scan documents for prompt injection / secrets / exfiltration, then watch an AI agent try to be tricked by them — and get stopped by a server-side policy gateway.

**Stack:** Next.js 15 App Router · JavaScript only · Tailwind CSS · MongoDB (official `mongodb` driver: local mongod in dev, Atlas in production) · `@google/genai` · `pdf-parse`.

## Setup

```bash
npm install
cp .env.example .env.local     # then add GEMINI_API_KEY (optional - everything works locally without it)
npm run dev                    # http://localhost:3000
npm test                       # 27 tests, no network or API key needed
```

Open the app → **Dashboard → Load sample documents** → **Documents** → scan → **Attack Playground → Run all**.

Requires Node 20+ (tested on Node 22). Locally you need a MongoDB server on `mongodb://127.0.0.1:27017` (or set `MONGODB_URI`). Collections and indexes are created automatically on first request.

## What happens during a scan

1. **Ingest** – validate (type, size, magic bytes, binary check), extract text (PDF per page / text per line), create overlapping ~180-word chunks keeping source refs (`p.2`, `lines 12-18`).
2. **Local detection on every chunk** – regex rules for prompt injection, policy override, secrets (redacted before storage), exfiltration. Content framed as training/examples is demoted to low severity.
3. **Rank** chunks by local suspicion + BM25 relevance to security terms, then **pack into batches** (10–15 chunks, token-capped, max 10 batches). Batches scale with document size (≈1,000 words → 1 request, ≈3,500 words → 3).
4. **Gemini, sequentially**, one batch per request, JSON-only, strictly validated (unknown chunk ids / enums are dropped; malformed output = failed batch). Responses are cached by content hash, so re-scans are free.
5. **Early stop** – a confirmed threat (non-educational, high/critical, confidence ≥ `CONFIRM_THRESHOLD`) from local rules *or* Gemini stops all further Gemini calls for that document. Evidence is saved; remaining batches are marked `skipped`.

Scan statuses: `clean` · `findings` (fully scanned, non-confirmed findings) · `threat_confirmed` · `partial`.
**`clean` is only possible when every chunk was analysed by Gemini.** No API key, budget exhausted, API errors, or skipped batches → `partial`, never safe.

## Policy gateway (`lib/policy.js`)

Every tool call — from the agent, the playground or the manual tester — goes through `executeToolCall`, which validates args, decides, writes the audit log, and only then runs the simulated tool.

| Rule | Effect |
|---|---|
| Sensitive tool requested by **document content** | deny (`policy.untrusted_origin`) |
| Model-initiated sensitive call in a run whose evidence was flagged | deny (`policy.tainted_context`) |
| `employee` role → employee records | deny |
| `manager` → only direct reports, safe fields only | else deny |
| SSN | never returned, even to `hr_admin` |
| External email recipient | deny unless `ALLOW_EXTERNAL_EMAIL=true` (default false) |
| Secrets / SSN-shaped data in email | deny (DLP) |
| Unknown tool, extra args, bad types | deny |

The LLM only *proposes* calls; role, userId and policy come from server code, never from model output. Emails are written to a local `outbox` table — nothing is ever sent.

The built-in agent planner is intentionally **over-compliant** (it obeys instructions found in documents) so the gateway has real attacks to stop. Flagged-as-critical chunks are quarantined from the final answer.

## Gemini cost protection

`GEMINI_API_KEY` is read only server-side (`.env.local` / Vercel env vars). The daily cap (`GEMINI_DAILY_LIMIT`, default 20, UTC day) is enforced by reserving a slot *before* each call in a single atomic conditional upsert on a per-day counter document, so concurrent serverless instances cannot overshoot it (failed calls count). Also: per-request input-token cap, output cap, cache, per-document batch cap, one scan per document at a time (DB-backed lock), usage table surfaced on the dashboard. The model is configurable via `GEMINI_MODEL` (default `gemini-2.5-flash`).

## Deploying to Vercel

Vercel's filesystem is read-only and per-instance, so production needs a hosted database: **MongoDB Atlas**.

1. **Create an Atlas cluster** (the free M0 tier is plenty), add a database user, and allow network access from Vercel (`0.0.0.0/0`, or use the Vercel Marketplace integration which sets this up and injects `MONGODB_URI`). Copy the connection string. Collections and indexes are created automatically on first request.
2. **Import the repo in Vercel** (framework: Next.js, Node 20+). No build settings to change.
3. **Set environment variables** (Project → Settings → Environment Variables):

| Variable | Notes |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` | **Required** on Vercel (`MONGODB_DB` defaults to `incheck`). Without a URI the API returns errors and the dashboard shows a warning banner. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional; without a key every scan is `partial` (local detection only). |
| `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` | **Strongly recommended.** The app has no user accounts; anyone with the URL can use your Gemini budget and see the shared data. |
| `GEMINI_DAILY_LIMIT` etc. | See `.env.example`. |

4. Deploy, then open `/api/health` — it should return `"db":"ok","persistence":"mongodb"`.

Production behaviour worth knowing:

- **Function time limit:** the scan route is capped at 60 s. The orchestrator stops starting new Gemini requests after `SCAN_TIME_BUDGET_MS` (40 s) and reports `partial`; press **Scan** again and it resumes — finished batches come from the cache, so they cost nothing.
- **Upload limit:** Vercel rejects bodies over 4.5 MB, so uploads are capped at 4 MB on Vercel regardless of `MAX_UPLOAD_MB`.
- **Rate limits:** per-IP, stored in the database (uploads 20, scans 15, agent runs 40 per 10 minutes, etc.).
- **Shared data:** there are no per-user accounts; all visitors share one workspace. Use Basic auth, or deploy one instance per team.
- **Security headers** are set in `next.config.mjs`. Secrets never reach the browser; audit logs redact credentials.

## Layout

```
lib/  config · db(MongoDB) · ratelimit(in http) · documents · retrieval(BM25) · detection · budget · gemini · orchestrator · policy · tools · agent · scenarios · samples · audit · stats
app/api/…  documents, documents/[id]/scan, samples, agent/run, agent/tool, scenarios, stats, audit
components/  Dashboard · DocumentsPanel · SandboxPanel · PlaygroundPanel · AuditPanel · AgentRunView
samples/  7 test documents (clean, poisoned, credentials, training, ambiguous, 3.5k-word handbook, PDF)
tests/    policy · orchestrator · documents   (node:test)
```

## Demo script (≈3 minutes)

1. Load samples; scan `vendor-report-q3.txt` → *Threat confirmed* locally, zero Gemini spend.
2. Scan `large-handbook.txt` (needs a key) → subtle "approvals no longer required" paragraph ranks into batch 1; if Gemini confirms, remaining batches are skipped.
3. Scan without a key / with "Use Gemini" off → `partial`, clearly not safe.
4. Playground → *Run all*: injection and exfil actions denied, benign + training scenarios allowed.
5. Sandbox → direct tool tester: try `get_employee_records` as `employee`, or `send_email` to an external address.
6. Audit Log → filter *denied*.

## Known limits

- Gemini calls are covered by tests with a fake client; the live API path was not exercised in the build environment (no network to Google). First thing to do with a real key: scan `ambiguous-meeting-notes.txt`.
- `pdf-parse` (pdf.js 1.x) handles typical text PDFs; scanned/image PDFs have no OCR and are rejected. The parser retries once because the first parse in a process can fail.
- Local rules are English-centric regexes; they are a fast first line, not a complete classifier.
- Single-process app (in-memory scan lock, one MongoDB database) – fine for a demo, not for horizontal scale.

## Migrating from the old SQLite/Turso storage

Existing data can be copied over once with `scripts/migrate-sqlite-to-mongo.mjs` (ids are preserved): `npm i --no-save @libsql/client`, then
`SQLITE_URL=file:data/incheck.db MONGODB_URI=... npm run db:migrate-sqlite`. Skip this if you are happy to start fresh.

## Tests

`npm test` starts a throwaway in-memory MongoDB (`mongodb-memory-server`, downloads a mongod binary on first run). To use your own server instead, set `TEST_MONGODB_URI`; each test file creates its own uniquely named database.
