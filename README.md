# incheck — AI Agent Security (hackathon MVP)

Scan documents for prompt injection / secrets / exfiltration, then watch an AI agent try to be tricked by them — and get stopped by a server-side policy gateway.

**Stack:** Next.js 14 App Router · JavaScript only · Tailwind CSS · SQLite (`better-sqlite3`) · `@google/genai` · `pdf-parse`. No other runtime dependencies.

## Setup

```bash
npm install
cp .env.example .env.local     # then add GEMINI_API_KEY (optional - everything works locally without it)
npm run dev                    # http://localhost:3000
npm test                       # 19 tests, no network or API key needed
```

Open the app → **Dashboard → Load sample documents** → **Documents** → scan → **Attack Playground → Run all**.

Requires Node 18.18+ (tested on Node 22). The SQLite file lives in `data/` (git-ignored).

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

`GEMINI_API_KEY` is read only server-side (`.env.local`). Daily cap (`GEMINI_DAILY_LIMIT`, default 20, UTC day) is enforced by reserving a slot *before* each call (failed calls count). Also: per-request input-token cap, output cap, cache, per-document batch cap, one scan per document at a time, usage table surfaced on the dashboard. The model is configurable via `GEMINI_MODEL` (default `gemini-2.5-flash`).

## Layout

```
lib/  config · db · documents · retrieval(BM25) · detection · budget · gemini · orchestrator · policy · tools · agent · scenarios · samples · audit · stats
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
- Single-process app (in-memory scan lock, one SQLite file) – fine for a demo, not for horizontal scale.
