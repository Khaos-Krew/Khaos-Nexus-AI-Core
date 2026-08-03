# Khaos Nexus AI Core

General-purpose AI orchestration, Discord-facing contracts, game/mod update intelligence, diagnostics, and safe operational proposals for Khaos Nexus.

## Boundaries

- **Khaos Nexus desktop and Nexus Bot are authoritative.** They own Discord connections, permissions, credentials, game adapters, confirmations, the shared scheduler, persistence, and audits.
- **D&D AI stays isolated.** `Khaos-Krew/Khaos-Nexus-AI` owns D&D campaign intelligence. AI Core rejects `dnd.*` and never calls or forwards to D&D AI.
- **AI Core never executes operations.** It returns information, neutral Discord presentation models, normalized update comparisons, and maintenance proposals.

## Included foundation

- Versioned health and capability discovery.
- Optional/required service-token authentication.
- Request IDs, idempotency, rate limiting, and bounded bodies.
- Protected credential-field rejection and output redaction.
- Discord mention safety and neutral response contracts.
- Game/mod version comparison, dependencies, release channels, platform readiness, and cluster drift.
- Update impact summaries and blocked/proposed maintenance plans.
- Deterministic local provider for development and CI.
- Node.js 22 tests and GitHub Actions CI.

## Run

```bash
cp .env.example .env
npm run check
npm start
```

The service listens on `127.0.0.1:8790` by default.

## Core routes

```text
GET  /health
GET  /api/v1/capabilities
POST /api/v1/discord/assist
POST /api/v1/updates/compare
POST /api/v1/updates/analyze
POST /api/v1/maintenance/plans
POST /api/v1/incidents/summarize
```

See [`docs/API.md`](docs/API.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and [`SECURITY.md`](SECURITY.md).
