# API v1

All authenticated POST requests use the common envelope:

```json
{
  "apiVersion": "1",
  "requestId": "UUID",
  "targetService": "nexus-ai-core",
  "routingDepth": 0,
  "capability": "nexus.help"
}
```

`dnd.*`, another target service, and non-zero routing depth are rejected. Add `Authorization: Bearer <service-token>` when service authentication is configured. `X-Khaos-Request-Id` may be sent and must match the body.

## Routes

- `GET /health`
- `GET /api/v1/capabilities`
- `GET /api/v1/monitor/state`
- `POST /api/v1/discord/assist`
- `POST /api/v1/updates/compare`
- `POST /api/v1/updates/analyze`
- `POST /api/v1/updates/evaluate`
- `POST /api/v1/updates/digest`
- `POST /api/v1/monitor/poll`
- `POST /api/v1/maintenance/plans`
- `POST /api/v1/incidents/summarize`
- `POST /api/v1/webhooks/github?sourceId=<registered-source-id>`

## Monitor poll

Use capability `nexus.update.poll` and provide one or more strict source definitions. The service constructs provider URLs internally; callers cannot provide arbitrary URLs or credentials. Polling is triggered by Khaos Nexus and its shared scheduler. AI Core has no internal recurring timer.

Supported source types:

- `github-release`
- `modrinth-project`
- `curseforge-mod`
- `steam-news`

## Impact evaluation

Use `POST /api/v1/updates/evaluate` with capability `nexus.update.evaluate`.

The request must provide:

- normalized provider `events`;
- local typed `resources` supplied by Khaos Nexus;
- explicit `bindings` from source/event to resource references;
- optional caller-authorized `subscriptions`.

```json
{
  "apiVersion": "1",
  "requestId": "00000000-0000-4000-8000-000000000000",
  "targetService": "nexus-ai-core",
  "routingDepth": 0,
  "capability": "nexus.update.evaluate",
  "events": [
    {
      "sourceId": "ark-release",
      "providerEventId": "release:101",
      "provider": "github-release",
      "eventType": "release",
      "version": "101",
      "releaseChannel": "stable",
      "title": "ARK update",
      "changelog": "Crash and performance fixes",
      "authoritative": true
    }
  ],
  "resources": [
    {
      "id": "server:rag:game",
      "name": "Ragnarok Server",
      "publicName": "Ragnarok",
      "type": "game",
      "gameKey": "ark",
      "installedVersion": "100",
      "runningVersion": "100",
      "availableVersion": "100",
      "allowedChannels": ["stable"]
    }
  ],
  "bindings": [
    {
      "sourceId": "ark-release",
      "resourceRefs": ["server:rag:game"]
    }
  ],
  "subscriptions": [
    {
      "id": "staff-updates",
      "authorized": true,
      "minimumSeverity": "attention",
      "gameKeys": ["ark"],
      "destination": {
        "id": "discord-channel-reference",
        "type": "channel",
        "visibility": "private"
      }
    }
  ]
}
```

The response includes deterministic alerts, confidence and severity, readiness findings, stable alert keys, caller-authorized delivery proposals, quiet-hour advice, public-safe projections, and local action proposals. It does not send Discord messages or grant permissions.

Informational Steam news cannot independently confirm an installable build or enable maintenance.

## Digest

Use `POST /api/v1/updates/digest` with capability `nexus.update.digest`. The request uses the same event/resource/binding/subscription model and may include:

- `audience`: `private` or `public`;
- `maxItems`: 1–50;
- `now`: ISO timestamp for deterministic quiet-hour evaluation.

The digest is a neutral Discord-safe presentation model with bounded text, grouped severity, empty allowed mentions, and review-only local action proposals.

## GitHub webhook

The webhook endpoint is disabled unless `GITHUB_WEBHOOKS_ENABLED=true`. Configure a GitHub release webhook URL containing a previously registered GitHub source ID:

```text
/api/v1/webhooks/github?sourceId=nexus-releases
```

Required headers:

- `X-Hub-Signature-256`
- `X-GitHub-Delivery`
- `X-GitHub-Event`

The raw payload is authenticated using the server-side `GITHUB_WEBHOOK_SECRET`. Bearer authentication is not used for this endpoint.

## Execution rule

Every response is advisory, observed provider metadata, a delivery proposal, or a maintenance proposal. AI Core does not send Discord messages, modify subscriptions or permissions, modify campaign data, execute server commands, download provider files, install updates, or create scheduler jobs.
