# Khaos Nexus AI Core

General-purpose AI orchestration, Discord-facing contracts, game/mod update intelligence, diagnostics, and safe operational proposals for Khaos Nexus.

## Boundaries

- **Khaos Nexus desktop and Nexus Bot are authoritative.** They own Discord connections, permissions, credentials, installed-version inventory, game adapters, confirmations, subscriptions, the shared scheduler, persistence, update execution, and audits.
- **D&D AI stays isolated.** `Khaos-Krew/Khaos-Nexus-AI` owns D&D campaign intelligence. AI Core rejects `dnd.*` and never calls or forwards to D&D AI.
- **AI Core never executes operations.** It returns information, neutral Discord presentation models, provider update events, deterministic impact findings, delivery proposals, digests, and maintenance proposals.
- **Provider credentials stay server-side.** Khaos Nexus desktop never stores or submits the general AI provider key.

## Current capabilities

- Versioned health and capability discovery.
- Optional or required service-token authentication.
- Request IDs, idempotency, rate limiting, and bounded bodies.
- Protected credential-field rejection and output redaction.
- Discord mention safety and neutral response contracts.
- Deterministic local provider enabled by default.
- Optional verified OpenAI Responses provider using `store:false`, strict JSON Schema, no tools, no background mode, no provider conversation state, and pinned caller configuration.
- Bounded provider timeout, response size, retries, daily request/token budgets, usage metadata, and opt-in visible deterministic fallback for retryable failures.
- Game/mod version comparison, dependencies, release channels, platform readiness, and cluster drift.
- Provider-backed update ingestion for GitHub releases, Modrinth project versions, CurseForge files, and Steam app news.
- ETag and Last-Modified conditional polling, source backoff, failure isolation, event deduplication, and optional metadata persistence.
- Optional GitHub release webhooks with HMAC-SHA256 signature validation and delivery deduplication.
- Explicit source-to-resource impact evaluation with confirmed/likely/possible/unknown confidence.
- Deterministic informational, attention, urgent, and critical severity classification.
- Caller-authorized subscription matching, quiet-hour delivery advice, stable alert/delivery keys, and public-safe projections.
- Discord-safe update alerts and grouped public or private digests with empty allowed mentions.
- Update impact summaries and blocked or proposed maintenance plans.
- Fixture-based tests and GitHub Actions CI.

Steam news is informational only. Khaos Nexus game adapters remain authoritative for installed and running dedicated-server builds. AI Core does not grant Discord permissions or store subscriptions; it only evaluates caller-provided authorized destinations.

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

`AI_PROVIDER_FALLBACK=deterministic` permits visible fallback only for retryable provider outages. Authentication failures, refusals, schema violations, tool output, incomplete responses, and budget exhaustion do not silently fall back.

The adapter always uses the fixed `https://api.openai.com/v1/responses` endpoint, `store:false`, strict structured output, `tools:[]`, and no conversation state. Model aliases and snapshots are selected explicitly through `OPENAI_MODEL`; AI Core does not silently change the configured model.

## Run

```bash
cp .env.example .env
npm run check
npm start
```

The service listens on `127.0.0.1:8790` by default. Provider credentials are optional and remain server-side. Set `CURSEFORGE_API_KEY` to enable CurseForge, and set `MONITOR_STATE_FILE` to persist credential-free monitor metadata.

## Core routes

```text
GET  /health
GET  /api/v1/capabilities
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

The webhook route is disabled by default and authenticates with `X-Hub-Signature-256`, not the desktop service token.

See [`docs/API.md`](docs/API.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and [`SECURITY.md`](SECURITY.md).
