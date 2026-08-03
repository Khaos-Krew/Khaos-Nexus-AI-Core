# API v1

All POST requests use the common envelope:

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
- `POST /api/v1/discord/assist`
- `POST /api/v1/updates/compare`
- `POST /api/v1/updates/analyze`
- `POST /api/v1/maintenance/plans`
- `POST /api/v1/incidents/summarize`

## Execution rule

Every response is advisory or a proposal. AI Core does not send Discord messages, modify campaign data, execute server commands, download updates, or create scheduler jobs.
