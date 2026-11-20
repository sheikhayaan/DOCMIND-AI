# Admin Command Center & autonomous APM

This implementation is integrated into **DocMind's existing FastAPI/Python backend and Next.js 16/TypeScript frontend**. It does not add an unused Express service, fabricated candidate data, or an external monitoring dependency. No new npm or pip packages are required.

## Open the console

1. Keep the existing backend credentials in `backend/.env`:
   - `AUTH_SECRET`: a stable, strong signing secret (required in production).
   - `ADMIN_EMAIL`: the owner email used to issue the admin session.
   - `ADMIN_ACCESS_TOKEN`: a strong operator secret (required in production).
   - Existing Groq, Pinecone, queue, encryption, and upload-scanner configuration still applies.
2. Set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` to the backend origin.
3. Configure the allowed frontend origin using backend `FRONTEND_URL` when deploying across domains. Do not use wildcard credentialed CORS.
4. Optionally set `NEXT_PUBLIC_ADMIN_EMAIL` to prefill the login form. The email is not an authorization mechanism. **Never** put the admin access token, auth signing secret, or provider keys in a `NEXT_PUBLIC_*` variable.
5. Run the existing services and open `/admin`:

   ```powershell
   # Terminal 1
   cd backend
   .\venv\Scripts\python.exe -m uvicorn main:app --reload

   # Terminal 2
   cd frontend
   npm run dev
   ```

The original visitor/IP/device, security audit, limits, and Web Vitals console is preserved at **`/admin/security`**. The new architecture tab links to it.

## Implementation map

| Requested responsibility | Integrated implementation |
| --- | --- |
| Telemetry tracker / `getSnapshot()` | `backend/apm/telemetry.py`, `resources.py`, `middleware.py` |
| Real Node RSS, V8 heap, CPU, loop delay | `frontend/lib/server/runtime-telemetry.ts`, `app/api/admin/runtime/route.ts` |
| Incident tracker | `backend/apm/incidents.py` |
| Autonomous self-healing | `backend/apm/healing.py`, `runtime.py` |
| Real database pools and query timing | `backend/apm/database.py`; existing security, session, and ingestion stores now lease these connections |
| LLM routing and circuit breakers | `backend/apm/gateway.py`, integrated into `backend/query.py` |
| Durable analytics, reviews, critical audit | `backend/apm/store.py` |
| `protect` + `requireAdmin` equivalent | FastAPI `protect` and `require_admin` dependencies in `backend/apm/routes.py` |
| Four-tab dashboard | `frontend/components/admin-dashboard-page.tsx`, `components/admin/`, `app/admin/page.tsx` |
| Mobile speech, prompt guards, stepping | `components/read-aloud-button.tsx`, `lib/text-safety.ts`, `app/chat/page.tsx` |
| Optional real session reviews | `components/session-rating.tsx`, authenticated feedback routes |

The existing Next.js response-header middleware is now `frontend/proxy.ts`, following Next.js 16's supported convention. Its CSP and security headers are retained. Microphone permission is restricted to `self` rather than categorically disabled; a browser permission grant is still required.

## API

All new endpoints return the project envelope:

```json
{ "success": true, "data": {}, "error": null }
```

Every `/api/admin/*` backend endpoint verifies the signed bearer token, checks the current database role, rejects suspended accounts, and applies request limits. Editing local storage or supplying a role/email in a request does not grant access. The Next.js Node-runtime endpoint calls the protected backend verifier before exposing any process measurements; unavailable verification fails closed.

| Method | Endpoint | Details |
| --- | --- | --- |
| GET | `/api/admin/overview` | Durable users/activity/sessions, verified review average, current alerts, observed MTTR |
| GET | `/api/admin/users` | `search`, `role=user|admin`, `status=active|suspended`, `rated=rated|unrated`, `page`, `pageSize` (1–100) |
| GET | `/api/admin/users/{id}` | Safe account projection and up to 20 recent sessions; no password hashes or private chat contents |
| POST | `/api/admin/users/{id}/suspension` | `{ "suspended": true, "notes": "Auditable explanation" }`; protects the current administrator and all admin accounts |
| GET | `/api/admin/incidents` | `severity`, `autoMitigated=true|false`, `unresolved=true|false`, `page`, `pageSize`; includes recent repair audit and persistence health |
| POST | `/api/admin/incidents/{id}/resolve` | `{ "notes": "What was repaired and how recovery was checked" }`; records a **human** resolution |
| POST | `/api/admin/self-healing/execute` | `{}` diagnoses current issues; `{ "incidentId": "..." }` selects a relevant safe remedy; optional `actions` accepts only the five allowlisted actions |
| GET | `/api/admin/telemetry` | Real API-worker resource, HTTP, SQL, and gateway state |
| GET | `/api/admin/runtime` **on Next.js** | Separately authenticated Node-process CPU, RSS, V8 heap, and event-loop measurements |
| GET | `/api/sessions/{id}/feedback` | Authenticated owner only; reads a real answered-session review |
| POST | `/api/sessions/{id}/review` | `{ "stars": 1 }` through `{ "stars": 5 }`; integer-only, no client-controlled `verified` flag |
| POST | `/api/sessions/{id}/complete` | Completes an owned answered session without adding a rating |

Admin reads allow 300 requests/minute/IP to accommodate dashboard polling; administrative mutations allow 12/minute/IP. The UI polls every five seconds while visible, cancels superseded reads, stops on authorization failures, and does not blindly replay mutations. Tokens use the `token` storage key with compatibility for existing `docmind_access_token` sessions; sign-out clears both.

## Data semantics: no fabricated ratings or scores

- A tracked session begins when `/query` successfully produces an answer. Creating an auth token or uploading a PDF does **not** count as a completed session.
- Completion is explicit, using either the completion or review endpoint. Subsequent questions after completion receive a new session ID.
- Session IDs are checked against the authenticated owner before retrieval. Another user's session cannot be used as a document-selection shortcut.
- There is one review per answered session. Updates replace that review instead of inflating the count. Ownership, completion, verification, and range checks are enforced server-side.
- Global ratings average the **individual verified reviews**, not averages-of-user-averages. Zero reviews produce `0.0` in the overview.
- Unrated users have `averageRating: null` and display **Not rated yet**. Skipping feedback creates no review and no default stars.
- This application has no candidate exam/interview scoring subsystem. Interview counts and diagnostic scores are explicitly `null`/N/A. Retrieval confidence is not misrepresented as a candidate score.
- Session/review analytics start with the additive migration; historical sessions are not guessed or backfilled from unrelated counters.

## Telemetry and retention

- HTTP percentiles use a 900-second sliding window and nearest-rank P50/P95/P99. Empty windows return null percentiles, not invented zero latency.
- Latency samples are capped at 100,000. `samplesTruncated` discloses saturation. Independent one-second request buckets preserve volume even if latency samples fill; bucket-boundary resolution is one second.
- Throughput is rolling volume divided by elapsed window time, capped at 900 seconds. Both lifetime and rolling status counts are included. HTTP metrics include admin polling traffic.
- SQL counters measure statement/batch execution, not stored query text, parameters, or private rows. Fetch/materialization time is not a separate SQL metric.
- CPU is process CPU time divided by elapsed wall time and CPU count. Native host utilization and current RSS are available on Windows and Linux; unsupported sensors remain null.
- Python allocated heap tracing is opt-in because tracing allocations has real overhead. **Python heap is not labeled as V8 heap.** Node measurements come from the actual Next.js process via built-in Node/V8 APIs.
- Resource sampling runs every second. CPU ≥90%, RSS ≥90% of the configured budget, or API event-loop lag ≥250 ms must persist for three samples before generating a threshold incident.
- The live incident ring retains 200 records. Same-category/same-endpoint bursts coalesce for 60 seconds and increment `occurrences`.
- Critical incidents are queued for durable writes, retried off the request path, and restored at startup. The durable critical archive retains 5,000 records; repair audit retains 1,000. Dashboard audit shows the most recent 30 runs.
- Critical-write retries are capped at 200; repair-report retries at 100. Persistence degradation and overflow are surfaced instead of claiming that memory-only records are durable.
- All APM sampling/persistence/healing loops belong to FastAPI's lifespan and stop on shutdown. Connections are committed/rolled back and returned to bounded pools instead of being leaked after every SQLite context. PID changes recreate pool leases/locks and telemetry identity, so prefork workers do not reuse inherited connections or report parent-process counters.

### Deployment scope

Live telemetry, circuit state, action cooldowns, and noncritical incidents are **per API worker**, not cluster totals. Node metrics are per Next.js instance, and serverless instances can rotate. The UI labels these scopes and resets its graph when the API worker changes.

Usage/reviews and persisted audit are durable where the SQLite volume is shared. For multiple machines/replicas, use a supported durable database and shared metrics/incident transport before making cluster-wide claims; do not put SQLite WAL on an unsupported network filesystem. Worker-local caches and circuit states are not magically synchronized across processes.

## Self-healing behavior

The autonomous evaluator runs every five seconds, in addition to the manual button. Executions are mutually exclusive per worker. Every action has a configurable cooldown that manual requests cannot bypass.

| Action | What actually happens | Verification / safety boundary |
| --- | --- | --- |
| `CONNECTION_POOL_RESET` | Stops new leases briefly, waits for active leases to drain, opens a replacement, then retires idle connections | Never force-closes an active transaction. Readiness includes `BEGIN IMMEDIATE` + `SELECT 1` + rollback, so a WAL writer lock cannot masquerade as healthy |
| `TRANSIENT_CACHE_FLUSH` | Clears the bounded, recomputable document-statistics cache | Leaves local document banks, ownership, auth tokens, rate-limit buckets, and uploaded data intact |
| `CIRCUIT_BREAKER_RESET` | Performs real half-open provider probes **after backoff**, then restores a recovered primary | No unconditional state reset. Failed probes extend bounded backoff |
| `MEMORY_COMPACT_DRAIN` | Runs Python GC, evicts expired metadata, releases finished inline-task handles | Does not discard queued Redis jobs, in-progress uploads, live requests, or documents. RSS must actually return below budget to claim memory recovery |
| `CIRCUIT_FALLBACK_CASCADE` | Selects a recently verified fallback model or probes one; otherwise enables grounded local extracts when present | Local document-bank existence is not proof every request recovered, so offline-only availability does not automatically resolve a provider incident |

Groq clients use a ten-second timeout and disable SDK-level retries so the gateway owns the retry budget. Requests try a different configured fallback rather than sleeping and repeatedly hammering an unhealthy model. Only one half-open request is admitted per recovering circuit.

Public rate limits, auth anomalies, generic 5xx errors, slow SQL, and unknown provider failures are not “fixed” by clearing unrelated security or database state. Incidents without a demonstrably relevant safe remedy remain for investigation. Account suspension takes effect for already-issued tokens on the next authenticated request.

A report includes `status`, `actionsExecuted`, `durationMs`, `checks`, `verifiedNominal`, and `latencySavingsMs`. Outcomes can be success, partial, failed, noop, busy, or cooldown. **A command having run is not proof of recovery.** `verifiedNominal` is true only when every reported readiness/resource check passes.

`latencySavingsMs` is null unless identical before/after database readiness probes provide a comparison. It is not a guessed HTTP improvement. MTTR is calculated separately from incident detection to verified resolution. **Sub-120 ms recovery is a target, not an asserted achievement**; five-second detection cadence, network probes, draining, and GC all take real time. The portfolio generator explicitly preserves that distinction.

## Optional configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `APM_AUTO_HEALING_ENABLED` | `true` | Operator kill switch for autonomous actions; manual diagnostics remain available |
| `APM_HEALING_COOLDOWN_SECONDS` | `60` | Per-action cooldown, bounded to 1–3600 seconds |
| `APM_MEMORY_LIMIT_MB` | `1024` | API-worker memory budget; set this to your actual deployment allowance |
| `APM_TRACE_HEAP` | `false` | Enable Python `tracemalloc` (measured allocations since tracer start, not total native process memory) |
| `APM_DB_POOL_SIZE` | `4` | Per-database, per-process maximum leases, bounded to 1–32 |
| `APM_CIRCUIT_FAILURE_THRESHOLD` | `2` | Consecutive failures before a model circuit opens |
| `APM_CIRCUIT_BACKOFF_SECONDS` | `30` | Initial model backoff; exponential delay is capped at 600 seconds |
| `GROQ_PRIMARY_MODEL` | `llama-3.1-8b-instant` | Primary text-generation model |
| `GROQ_FALLBACK_MODELS` | `llama-3.3-70b-versatile` | Comma-separated fallback model IDs; only use models your account supports |
| `INGESTION_INLINE_MAX_WORKERS` | `4` | Bounded local development ingestion concurrency; production should retain Celery/Redis |
| `API_INTERNAL_URL` (Next server) | `NEXT_PUBLIC_API_URL` | Optional private backend URL for the protected Node telemetry verifier |

## The five edge-case protocols

1. **Unrated data:** verified-review SQL aggregates, nullable roster ratings, zero-review overview `0.0`, and an unselected rating UI are covered by backend/frontend tests.
2. **Raw fetch / cross-domain auth:** all authenticated requests, including Web Vitals and the Next.js runtime verifier, explicitly send bearer authorization, JSON content type, and `credentials: 'include'`. Multipart upload lets the browser set its boundary. Public token-issuance endpoints intentionally do not require an existing bearer.
3. **Mobile speech:** every answer and rehearsal question has a visible **Listen / Read Aloud** button. `speak()` runs synchronously from that button's handler, never an effect. The utterance is retained in both a `useRef` and `window._activeUtterance`, then released on completion/cancellation/unmount. Twelve-word previews aim for roughly 3–5 seconds; actual duration depends on the device voice.
4. **Forward progress:** both chat and finite interview rehearsal always provide **Next / Skip**. Skipping aborts client waiting, detaches microphone callbacks, advances the index, and ignores late responses. Fixed, non-intercepting toast styles prevent notifications from squeezing the chat layout or covering tap controls. Already-running server work can finish separately; the UI does not claim it cancelled Python thread work.
5. **Defensive strings/prompts:** stored messages and history are validated and bounded. String accesses use guards. Explicit grading rubrics are separated into expandable details and excluded from speech previews. Missing, null, or malformed text does not enter the renderer as an object.

## Verification

```powershell
# Backend (use a disposable DOCMIND_DATA_DIR / SECURITY_DB_PATH for local test runs)
cd backend
.\venv\Scripts\python.exe -m pytest tests/ -q

# Frontend
cd frontend
npm test
npx tsc --noEmit
npm run lint
npm run build

# Optional real Chrome smoke test (Node 22+, Chrome, existing backend environment)
npm run test:browser
```

The browser smoke runner starts its own backend, frontend, Chrome profile, random test credentials, free local ports, and disposable SQLite files. It stops only its own processes and writes screenshots/logs to the reported temporary directory. Override `PYTHON_BIN` or `CHROME_PATH` with local executable paths if needed.

It exercises desktop/mobile tabs, actual backend admin verification, unrated roster data, user inspection, diagnostics and persisted audit, manual incident resolution, trusted-tap speech invocation, retained utterances, failed microphones, forward skipping, and stale-response suppression. Speech output and microphone failure are deliberately simulated; **physical audio playback still needs an iOS Safari / Android Chrome check**. No live Groq/Pinecone account or test interview scores are fabricated for these checks.

Existing isolation tests now use deterministic offline embedding/provider doubles rather than loading native transformer models or contacting external services just to test document ownership and deletion. Integration with live provider credentials, production volumes, queue infrastructure, and hardware audio should be validated in staging before a production rollout.
