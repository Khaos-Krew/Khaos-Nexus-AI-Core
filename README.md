# Khaos Nexus AI Core

General-purpose AI orchestration, Discord-facing contracts, game/mod update intelligence, diagnostics, and safe operational proposals for Khaos Nexus.

## Boundaries

- **Khaos Nexus desktop and Nexus Bot are authoritative.** They own Discord connections, permissions, credentials, installed-version inventory, game adapters, confirmations, subscriptions, the shared scheduler, persistence, update execution, and audits.
- **D&D AI stays isolated.** `Khaos-Krew/Khaos-Nexus-AI` owns D&D campaign intelligence. AI Core rejects `dnd.*` and never calls or forwards to D&D AI.
- **AI Core never executes operations.** It returns information, neutral Discord presentation models, provider update events, deterministic impact findings, delivery proposals, digests, and maintenance proposals.
- **Provider credentials stay server-side.** Khaos Nexus desktop never stores or submits the general AI provider key.
- **Observability stores aggregates only.** Prompts, context, responses, Discord identities, server identities, campaign data, and provider keys are never retained in provider telemetry.
- **The desktop sidecar is supervised and local.** It requires per-launch authentication, binds only to loopback, selects a free port when requested, disables webhook intake, and exposes no HTTP shutdown endpoint.

## Current capabilities

- Versioned health, contract, and capability discovery.
- Hardened dependency-free `NexusAiCoreClient` for Electron main-process use.
- Optional or required service-token authentication.
- Supervised Windows/Linux sidecar startup with IPC readiness and graceful shutdown.
- Dynamic loopback port allocation and credential-free readiness files.
- Deterministic sidecar bundle generation with SHA-256 integrity verification.
- Request IDs, idempotency, rate limiting, and bounded bodies.
- Protected credential-field rejection and output redaction.
- Discord mention safety and neutral response contracts.
- Deterministic local provider enabled by default.
- Optional verified OpenAI Responses provider using `store:false`, strict JSON Schema, no tools, no background mode, no provider conversation state, and explicit model configuration.
- Capability-aware post-generation policy validation for execution claims, D&D leakage, credential-like output, internal-instruction disclosure, links, presentation types, severity, review requirements, and output length.
- Bounded provider timeout, response size, retries, daily request/token budgets, usage metadata, and opt-in visible deterministic fallback for retryable failures.
- Configurable provider circuit breaker with closed, open, and half-open states.
- Authenticated provider-status endpoint with redacted request, error, latency, token, fallback, budget, and circuit aggregates.
- Offline provider evaluation corpus and `npm run eval`; normal CI makes no external model call.
- Game/mod version comparison, dependencies, release channels, platform readiness, and cluster drift.
- Provider-backed update ingestion for GitHub releases, Modrinth project versions, CurseForge files, and Steam app news.
- ETag and Last-Modified conditional polling, source backoff, failure isolation, event deduplication, and optional metadata persistence.
- Optional GitHub release webhooks with HMAC-SHA256 signature validation and delivery deduplication in standalone mode only.
- Explicit source-to-resource impact evaluation with confirmed/likely/possible/unknown confidence.
- Deterministic informational, attention, urgent, and critical severity classification.
- Caller-authorized subscription matching, quiet-hour delivery advice, stable alert/delivery keys, and public-safe projections.
- Discord-safe update alerts and grouped public or private digests with empty allowed mentions.
- Update impact summaries and blocked or proposed maintenance plans.
- Fixture-based tests and GitHub Actions CI.

Steam news is informational only. Khaos Nexus game adapters remain authoritative for installed and running dedicated-server builds. AI Core does not grant Discord permissions or store subscriptions; it only evaluates caller-provided authorized destinations.

## Desktop sidecar

The intended Khaos Nexus integration uses the unpublished sidecar bundle and the hardened client. The desktop launches `src/sidecar.js` with a protected service token, `HOST=127.0.0.1`, and `PORT=0`. The sidecar announces its selected endpoint only after the listener is active. The desktop validates the startup nonce and authority boundaries, constructs `NexusAiCoreClient`, and performs capability negotiation before enabling a feature.

```text
NEXUS_AI_CORE_SERVICE_TOKEN=<high-entropy-token>
NEXUS_AI_CORE_STARTUP_NONCE=<desktop-nonce>
NEXUS_AI_CORE_PARENT_PID=<desktop-pid>
NEXUS_AI_CORE_READY_FILE=<absolute-private-path>
HOST=127.0.0.1
PORT=0
```

Build and verify the self-contained source bundle:

```bash
npm run bundle:sidecar
npm run verify:sidecar
npm run smoke:sidecar
```

The output is `dist/sidecar/khaos-nexus-ai-core-<version>/`. Building does not publish a GitHub release, tag, updater entry, or deployment.

## Provider selection

Deterministic behavior is the default:

```text
AI_PROVIDER=deterministic-local
```

To enable the verified OpenAI Responses adapter, configure the AI Core service environment—not the desktop renderer or Nexus Bot bootstrap:

```text
AI_PROVIDER=openai-responses
OPENAI_API_KEY=<server-side key>
OPENAI_MODEL=<explicit model or pinned snapshot>
AI_PROVIDER_FALLBACK=disabled
```

`AI_PROVIDER_FALLBACK=deterministic` permits visible fallback only for retryable provider outages. Authentication failures, refusals, schema violations, policy violations, tool output, incomplete responses, and budget exhaustion do not silently fall back.

The adapter always uses the fixed `https://api.openai.com/v1/responses` endpoint, `store:false`, strict structured output, `tools:[]`, and no conversation state. Model aliases and snapshots are selected explicitly through `OPENAI_MODEL`; AI Core does not silently change the configured model.

Provider circuit defaults can be adjusted server-side:

```text
AI_PROVIDER_CIRCUIT_FAILURE_THRESHOLD=5
AI_PROVIDER_CIRCUIT_FAILURE_WINDOW_MS=60000
AI_PROVIDER_CIRCUIT_COOLDOWN_MS=30000
```

While the circuit is open, AI Core fails fast or uses the explicitly enabled deterministic fallback without contacting the external provider. A successful half-open probe closes the circuit.

## Validation

```bash
npm run build
npm test
npm run eval
npm run contracts
npm run bundle:sidecar
npm run verify:sidecar
npm run check
```

`npm run eval` uses only the deterministic provider and the versioned fixtures in `evals/provider-fixtures.json`. `npm run contracts` verifies API, client, package, service-manifest, and sidecar-manifest synchronization. `npm run check` includes the deterministic bundle build and integrity verification.

## Run

Standalone service:

```bash
cp .env.example .env
npm run check
npm start
```

Supervised sidecar:

```bash
NEXUS_AI_CORE_SERVICE_TOKEN=<token> HOST=127.0.0.1 PORT=0 npm run sidecar
```

The standalone service listens on `127.0.0.1:8790` by default. The sidecar requires authentication and defaults to an operating-system-selected loopback port.

## Core routes

```text
GET  /health
GET  /api/v1/capabilities
GET  /api/v1/contracts
GET  /api/v1/provider/status
GET  /api/v1/monitor/state
POST /api/v1/discord/assist
POST /api/v1/updates/compare
POST /api/v1/updates/analyze
POST /api/v1/updates/evaluate
POST /api/v1/updates/digest
POST /api/v1/monitor/poll
POST /api/v1/maintenance/plans
POST /api/v1/incidents/summarize
POST /api/v1/webhooks/github?sourceId=<registered-source-id>
```

The webhook route is available only to explicitly configured standalone deployments. Sidecar mode disables webhook intake.

See [`docs/API.md`](docs/API.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/CLIENT_INTEGRATION.md`](docs/CLIENT_INTEGRATION.md), [`docs/SIDECAR.md`](docs/SIDECAR.md), [`docs/EVALUATIONS.md`](docs/EVALUATIONS.md), and [`SECURITY.md`](SECURITY.md).
