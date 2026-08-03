# Architecture

## Authority model

Khaos Nexus AI Core is a non-D&D intelligence service. It interprets bounded requests, compares normalized update data, creates Discord-safe neutral responses, and prepares proposals. It never connects to Discord or game servers and never executes operational actions.

```text
Khaos Nexus Desktop / Nexus Bot
  ├── nexus.* request -> Khaos Nexus AI Core
  └── dnd.* request   -> Khaos Nexus D&D AI
```

The desktop and supervised Nexus Bot runtime remain authoritative for authentication, Discord permissions, context selection, confirmations, scheduling, server adapters, updates, moderation, persistence, and audits.

## D&D isolation

`Khaos-Krew/Khaos-Nexus-AI` is the sibling specialist for D&D. The services do not call each other. AI Core rejects `dnd.*`, a non-zero routing depth, and any target other than `nexus-ai-core`. They do not share credentials, memory, tools, databases, or provider configuration.

## Discord boundary

AI Core returns a neutral presentation model. It does not return raw Discord REST payloads. Nexus Bot is responsible for validating embed/component limits, choosing ephemeral or public delivery, rechecking permissions, applying allowed-mention restrictions, and sending the final response.

## Update boundary

The initial service accepts normalized game/mod inventories from Khaos Nexus and returns deterministic comparison results. Provider adapters, polling, webhooks, downloads, file changes, server restarts, and rollback execution remain outside this service and must be performed by registered Khaos Nexus modules and the shared scheduler.
