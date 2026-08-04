# Khaos Nexus Client Integration

## Intended consumer

`NexusAiCoreClient` is intended for the Khaos Nexus Electron main process and cross-repository integration tests. It must not be exposed directly to renderer code, Discord interactions, or untrusted plugins.

The desktop remains responsible for:

- protected service-token storage;
- user, guild, role, channel, module, and server authorization;
- context construction and redaction;
- the shared scheduler and polling cadence;
- Discord delivery and component validation;
- installed/running game and mod inventory;
- confirmations, updates, backups, restarts, rollback, and audit history;
- routing `dnd.*` only to the separate D&D AI service.

## Creating the client

```js
import { NexusAiCoreClient } from "./src/client.js";

const client = new NexusAiCoreClient({
  endpoint: "http://127.0.0.1:8790",
  serviceToken: protectedServiceToken,
  timeoutMs: 15_000,
});
```

Loopback HTTP is allowed for local service operation. Non-loopback endpoints require HTTPS. The constructor rejects:

- embedded usernames or passwords;
- query parameters or fragments;
- unexpected path prefixes;
- unsupported protocols;
- non-loopback HTTP.

The service token is held in a private class field and is sent only in the Authorization header. It is not included in `status()`, serialization, URLs, or client errors.

## Negotiating capabilities

Before enabling a desktop workflow, negotiate the exact capabilities it requires:

```js
await client.negotiate({
  requiredCapabilities: [
    "nexus.update.poll",
    "nexus.update.evaluate",
    "nexus.update.digest",
  ],
  requireProvider: false,
});
```

Negotiation verifies:

- API version `1`;
- target service `nexus-ai-core`;
- no `dnd.*` capabilities;
- no direct execution, forwarding, or Discord authority;
- every required capability;
- provider readiness when explicitly required.

Unknown additive capabilities may be ignored unless the desktop requires them. A breaking API change requires a new API major.

## Fixed client methods

The client intentionally provides no generic arbitrary URL method.

```text
health
capabilities
contracts
providerStatus
monitorState
assist
compareUpdates
analyzeUpdates
evaluateUpdates
digestUpdates
pollMonitor
proposeMaintenance
summarizeIncident
```

Each POST method generates a UUID and sends the fixed routing envelope:

```json
{
  "apiVersion": "1",
  "requestId": "uuid",
  "targetService": "nexus-ai-core",
  "routingDepth": 0,
  "capability": "nexus.*"
}
```

The matching request ID is sent in `X-Khaos-Request-Id`. The client rejects a mismatched response ID.

## Transport behavior

The client uses:

- JSON requests and responses only;
- bounded timeout and response bytes;
- redirect rejection;
- omitted browser credentials/cookies;
- no referrer;
- no automatic retry;
- stable redacted errors.

Retry policy remains with the desktop and shared scheduler because read, generation, polling, and maintenance-proposal workflows have different safety requirements.

## Error handling

`NexusAiCoreClientError` exposes only:

- `status`;
- stable `code`;
- optional safe `field`;
- `retryable`;
- optional provider request ID from a response header.

Network errors, timeouts, malformed JSON, redirects, non-JSON responses, oversized responses, and request-ID mismatches use local `CLIENT_*` codes. Tokens and raw network error details are not propagated.

## Contract synchronization

Machine-readable artifacts:

- `contracts/service-manifest.json`
- `contracts/nexus-ai-core-v1.schema.json`

Source registry:

- `src/service-contract.js`

Verification:

```bash
npm run contracts
```

CI fails if service constants, package versions, capabilities, endpoint paths, client methods, schema references, authority boundaries, or static artifacts drift.

## Forbidden integration patterns

Do not:

- place the service token in renderer state, public configuration, URLs, logs, backups, diagnostics, or Nexus Bot bootstrap data;
- call AI Core directly from Discord handlers without existing permission checks;
- use the client as a scheduler or background monitor;
- retry protected or disruptive proposals automatically;
- convert an AI proposal into an action without local validation and confirmation;
- route campaign context or `dnd.*` requests to AI Core;
- store provider credentials in Khaos Nexus;
- expose a generic client request function to renderer code.
