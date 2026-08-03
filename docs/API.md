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
- `POST /api/v1/monitor/poll`
- `POST /api/v1/maintenance/plans`
- `POST /api/v1/incidents/summarize`
- `POST /api/v1/webhooks/github?sourceId=<registered-source-id>`

## Monitor poll

Use capability `nexus.update.poll` and provide one or more strict source definitions:

```json
{
  "apiVersion": "1",
  "requestId": "00000000-0000-4000-8000-000000000000",
  "targetService": "nexus-ai-core",
  "routingDepth": 0,
  "capability": "nexus.update.poll",
  "sources": [
    {
      "id": "nexus-releases",
      "provider": "github-release",
      "owner": "Khaos-Krew",
      "repo": "Khaos-Nexus",
      "allowedChannels": ["stable", "beta"]
    },
    {
      "id": "minecraft-mod",
      "provider": "modrinth-project",
      "project": "project-id-or-slug",
      "gameVersions": ["1.21.1"],
      "loaders": ["neoforge"]
    },
    {
      "id": "curseforge-mod",
      "provider": "curseforge-mod",
      "modId": 12345,
      "gameVersion": "1.21.1"
    },
    {
      "id": "steam-news",
      "provider": "steam-news",
      "appId": 346110,
      "keywords": ["update", "patch", "hotfix"]
    }
  ]
}
```

The service constructs provider URLs internally; callers cannot provide arbitrary URLs or credentials. Polling is triggered by Khaos Nexus and its shared scheduler. AI Core has no internal recurring timer.

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

Every response is advisory, observed provider metadata, or a proposal. AI Core does not send Discord messages, modify campaign data, execute server commands, download provider files, install updates, or create scheduler jobs.
