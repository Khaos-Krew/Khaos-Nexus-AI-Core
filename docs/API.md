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

## Generation provider behavior

The public AI Core API does not accept provider credentials, provider base URLs, tool definitions, model overrides, conversation IDs, previous response IDs, or storage controls. These are server-owned configuration.

When `AI_PROVIDER=openai-responses`, AI Core sends a stateless server-to-server request to the fixed OpenAI Responses endpoint with:

- the same Khaos `requestId` as `X-Client-Request-Id`;
- the server-configured model;
- `store: false`;
- `background: false`;
- strict `json_schema` text output;
- `tools: []` and `tool_choice: none`;
- no conversation or previous-response state;
- bounded output tokens, timeout, retries, and response bytes.

The provider output is parsed and locally validated before it becomes a neutral Nexus response. Refusals, incomplete output, malformed JSON, schema violations, oversized output, and unexpected tool calls fail safely.

The neutral response presentation may include safe provider metadata:

```json
{
  "providerMetadata": {
    "provider": "openai-responses",
    "model": "configured-model",
    "providerRequestId": "redacted-provider-request-id",
    "latencyMs": 1234,
    "usage": {
      "inputTokens": 100,
      "outputTokens": 50,
      "totalTokens": 150
    },
    "store": false,
    "toolsUsed": 0,
    "fallback": null
  }
}
```

No provider key, request body, hidden instruction, or raw provider error is returned.

When `AI_PROVIDER_FALLBACK=deterministic`, only retryable network, timeout, rate-limit, or transient server failures may fall back. The response metadata records the source provider and reason code. Authentication failures, refusals, schema failures, unexpected tool output, incomplete responses, and budget exhaustion never silently fall back.

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
