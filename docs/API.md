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
- `GET /api/v1/contracts`
- `GET /api/v1/provider/status`
- `GET /api/v1/monitor/state`
- `POST /api/v1/discord/assist`
- `POST /api/v1/updates/compare`
- `POST /api/v1/updates/analyze`
- `POST /api/v1/updates/evaluate`
- `POST /api/v1/updates/digest`
- `POST /api/v1/monitor/poll`
- `POST /api/v1/maintenance/plans`
- `POST /api/v1/incidents/summarize`
- `POST /api/v1/webhooks/github?sourceId=<registered-source-id>` in explicitly configured standalone mode only

There is no HTTP shutdown route. Sidecar lifecycle is supervised through IPC and operating-system signals.

## Contract discovery

`GET /api/v1/contracts` requires the service token and returns the canonical service contract, endpoint registry, compatibility policy, schema references, and authority boundaries. Schema bodies, credentials, prompts, generated content, and identities are not included inline.

The desktop bundle also contains:

- `contracts/service-manifest.json`
- `contracts/nexus-ai-core-v1.schema.json`
- `contracts/sidecar-manifest.json`

The authenticated response and bundled manifest must agree before the desktop enables a capability.

## Desktop sidecar transport

The sidecar listens only on `127.0.0.1` or `::1`, requires bearer authentication, and may use port `0` so the operating system selects an available port. Its endpoint is delivered through the supervised readiness contract after the listener is active.

Sidecar mode disables GitHub webhook intake. It does not create a polling timer; Khaos Nexus continues to own cadence through the shared scheduler.

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

Every deterministic or external provider result then passes a capability-aware local policy gate. The gate validates:

- allowed presentation type and severity;
- required review behavior;
- output length;
- execution or completion claims;
- D&D, Dungeon Master, or Co-DM leakage;
- credential-like values;
- hidden-instruction disclosures;
- provider-generated links;
- Discord mention neutralization.

Policy failures return stable `AI_OUTPUT_*` codes with HTTP 422. They are non-retryable, do not affect the provider circuit breaker, and never activate deterministic fallback.

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

No provider key, request body, hidden instruction, prompt, context, generated content, Discord identity, server identity, or raw provider error is returned through provider diagnostics.

When `AI_PROVIDER_FALLBACK=deterministic`, only retryable network, timeout, rate-limit, circuit-open, or transient server failures may fall back. The response metadata records the source provider and reason code. Authentication failures, refusals, policy/schema failures, unexpected tool output, incomplete responses, and budget exhaustion never silently fall back.

## Provider status

`GET /api/v1/provider/status` uses the existing service-token authentication model. It returns bounded operational aggregates:

- provider and model;
- readiness and fallback policy;
- budget snapshot;
- circuit state and transition count;
- request, success, failure, fallback, and short-circuit counts;
- average/max latency;
- token totals;
- bounded error-code and circuit-transition counters;
- `contentStored:false` and `identitiesStored:false`.

It never returns prompts, context, responses, request bodies, user/guild/channel/server IDs, provider keys, or raw provider errors.

Public `GET /health` and authenticated capability discovery expose only a reduced provider-readiness summary without detailed telemetry.

## Circuit breaker

Only retryable primary-provider failures count toward the circuit threshold. The circuit uses three states:

- `closed`: requests call the primary provider;
- `open`: requests fail fast or use explicitly enabled deterministic fallback;
- `half_open`: one probe is allowed after cooldown.

A successful probe closes the circuit. A retryable failed probe reopens it. A non-retryable provider or policy result does not count as a connectivity failure.

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

The webhook endpoint is disabled unless `GITHUB_WEBHOOKS_ENABLED=true` in standalone service mode. Configure a GitHub release webhook URL containing a previously registered GitHub source ID:

```text
/api/v1/webhooks/github?sourceId=nexus-releases
```

The raw payload is authenticated using the server-side webhook secret. Bearer authentication is not used for this endpoint. Sidecar mode always disables this intake path.

## Execution rule

Every response is advisory, observed provider metadata, a delivery proposal, or a maintenance proposal. AI Core does not send Discord messages, modify subscriptions or permissions, modify campaign data, execute server commands, download provider files, install updates, create scheduler jobs, or shut itself down through HTTP.
