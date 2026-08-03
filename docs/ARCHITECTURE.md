# Architecture

## Authority model

Khaos Nexus AI Core is a non-D&D intelligence service. It interprets bounded requests, ingests allowlisted public update metadata, compares installed-version snapshots supplied by Khaos Nexus, creates Discord-safe neutral responses, and prepares proposals. It never connects to Discord or game servers and never executes operational actions.

```text
Khaos Nexus Desktop / Nexus Bot
  ├── nexus.* request -> Khaos Nexus AI Core
  └── dnd.* request   -> Khaos Nexus D&D AI

Khaos Nexus Shared Scheduler
  └── explicit monitor poll -> AI Core provider adapters
```

The desktop and supervised Nexus Bot runtime remain authoritative for authentication, Discord permissions, context selection, confirmations, schedules, installed-version inventory, game adapters, update execution, moderation, persistence, and audits.

## D&D isolation

`Khaos-Krew/Khaos-Nexus-AI` is the sibling specialist for D&D. The services do not call each other. AI Core rejects `dnd.*`, a non-zero routing depth, and any target other than `nexus-ai-core`. They do not share credentials, memory, tools, databases, or provider configuration.

## Discord boundary

AI Core returns a neutral presentation model. It does not return raw Discord REST payloads. Nexus Bot is responsible for validating embed/component limits, choosing ephemeral or public delivery, rechecking permissions, applying allowed-mention restrictions, and sending the final response.

## Update ingestion boundary

AI Core supports strict provider source definitions for:

- GitHub published releases;
- Modrinth project versions;
- CurseForge mod files;
- Steam app news.

Provider URLs are constructed internally and limited to approved HTTPS origins. Optional provider credentials are read only from server-side environment configuration. The service supports bounded responses, conditional requests, retry/backoff, normalized event IDs, source failure isolation, and deduplication.

Steam news is intentionally labeled informational and cannot confirm a dedicated-server build. Khaos Nexus game and hosting adapters remain authoritative for installed, running, and remotely available server builds.

## Monitor state

The monitor store contains only source definitions, conditional-request metadata, health state, event identifiers, and webhook delivery identifiers. It does not contain provider credentials, download payloads, Discord credentials, RCON information, or raw private webhook bodies. File persistence is optional; without `MONITOR_STATE_FILE`, state is process-local.

## Webhook boundary

GitHub release webhooks are disabled by default. When enabled, AI Core validates the raw body with the server-side secret and `X-Hub-Signature-256`, verifies the registered repository and release policy, and deduplicates delivery and release IDs. Webhooks produce normalized events only; they never publish to Discord or start maintenance.

## Execution boundary

Downloads, file changes, server saves, backups, stops, updates, starts, health verification, staged rollout, and rollback remain the responsibility of registered Khaos Nexus modules and the shared scheduler.
