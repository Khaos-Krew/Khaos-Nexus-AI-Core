# Khaos Nexus Client Integration

## Intended consumer

`NexusAiCoreClient` is intended for the Khaos Nexus Electron main process and cross-repository integration tests. It must not be exposed directly to renderer code, Discord interactions, or untrusted plugins.

The desktop remains responsible for:

- protected service-token storage;
- sidecar process supervision and startup-nonce validation;
- user, guild, role, channel, module, and server authorization;
- context construction and redaction;
- the shared scheduler and polling cadence;
- Discord delivery and component validation;
- installed/running game and mod inventory;
- confirmations, updates, backups, restarts, rollback, and audit history;
- routing `dnd.*` only to the separate D&D AI service.

## Recommended sidecar launch

Use the v0.7 sidecar bundle documented in `docs/SIDECAR.md`. The Electron main process should:

1. Generate or retrieve a protected high-entropy service token.
2. Generate a bounded startup nonce.
3. Spawn `src/sidecar.js` with an IPC channel, `HOST=127.0.0.1`, and `PORT=0`.
4. Pass the desktop process ID for orphan detection.
5. Validate the IPC readiness object and matching nonce.
6. Construct `NexusAiCoreClient` from the announced loopback endpoint and protected token.
7. Call `contracts()` and `negotiate()` before enabling features.
8. Route all polling through the existing shared scheduler.
9. Shut down with the IPC message `{ "type": "nexus-ai-core.shutdown" }`.

Do not infer readiness from process existence, fixed delays, or an assumed port. The sidecar emits readiness only after the listener is accepting requests.

## Creating the client

```js
import { NexusAiCoreClient } from "khaos-nexus-ai-core/client";

const client = new NexusAiCoreClient({
  endpoint: readiness.endpoint,
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

The service token is held in a private class field and is sent only in the Authorization header. It is not included in `status()`, serialization, URLs, readiness data, or client errors.

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

The desktop should also compare the authenticated `contracts()` response with the bundled `contracts/service-manifest.json` and `contracts/sidecar-manifest.json`. Unknown additive capabilities may be ignored unless the desktop requires them. A breaking API change requires a new API major.

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

Sidecar process exit codes are documented in `docs/SIDECAR.md`. Configuration and startup failures should be shown as service-unavailable states rather than disabling Nexus Bot or the D&D AI service.

## Contract synchronization

Machine-readable artifacts:

- `contracts/service-manifest.json`
- `contracts/nexus-ai-core-v1.schema.json`
- `contracts/sidecar-manifest.json`

Source registries:

- `src/service-contract.js`
- `src/sidecar-contract.js`

Verification:

```bash
npm run contracts
npm run bundle:sidecar
npm run verify:sidecar
```

CI fails if service constants, package versions, capabilities, endpoint paths, client methods, schema references, sidecar transport/lifecycle boundaries, package exports, bundle files, integrity hashes, or static artifacts drift.

## Forbidden integration patterns

Do not:

- place the service token in renderer state, public configuration, URLs, logs, backups, diagnostics, readiness files, or Nexus Bot bootstrap data;
- call AI Core directly from Discord handlers without existing permission checks;
- use the sidecar or client as a separate scheduler;
- enable GitHub webhook intake in desktop sidecar mode;
- retry protected or disruptive proposals automatically;
- convert an AI proposal into an action without local validation and confirmation;
- route campaign context or `dnd.*` requests to AI Core;
- share provider configuration with the D&D AI service;
- expose a generic client request function to renderer code;
- add an HTTP shutdown endpoint;
- assume a fixed sidecar port or trust an unmatched readiness nonce.
