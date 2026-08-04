# Khaos Nexus AI Core Desktop Sidecar

## Purpose

The desktop sidecar is the local supervised runtime intended for the Khaos Nexus Electron main process. It is separate from the standalone service entrypoint and does not replace Nexus Bot, the shared scheduler, game adapters, protected storage, or the isolated D&D AI service.

## Launch contract

Launch `src/sidecar.js` with Node.js 22 or later. The desktop should generate a new high-entropy service token for each managed installation or launch policy and keep it in protected main-process storage.

Required environment:

```text
HOST=127.0.0.1
PORT=0
AUTH_REQUIRED=true
NEXUS_AI_CORE_SERVICE_TOKEN=<at-least-32-character-high-entropy-token>
```

Recommended correlation and supervision fields:

```text
NEXUS_AI_CORE_STARTUP_NONCE=<desktop-generated-nonce>
NEXUS_AI_CORE_PARENT_PID=<desktop-process-id>
NEXUS_AI_CORE_READY_FILE=<absolute-private-runtime-path>
NEXUS_AI_CORE_PARENT_CHECK_INTERVAL_MS=1000
NEXUS_AI_CORE_SHUTDOWN_GRACE_MS=5000
```

The sidecar rejects non-loopback hosts, weak or missing tokens, malformed nonces, relative ready-file paths, invalid ports, and invalid parent process IDs.

## Readiness

After the listener accepts requests, the sidecar emits exactly one JSON readiness line to stdout. When launched with a Node IPC channel, it sends the same object to the parent process. When `NEXUS_AI_CORE_READY_FILE` is configured, the object is also written atomically to that path with private file permissions where supported.

The readiness object contains only:

- service and contract versions;
- API and target identity;
- process ID;
- loopback host, selected port, and endpoint;
- startup nonce;
- startup timestamp;
- provider name, model, and readiness;
- update-monitor availability;
- explicit authority and D&D-isolation boundaries.

It never contains service tokens, provider credentials, source credentials, prompts, responses, Discord identifiers, server identifiers, player identifiers, or campaign data.

The desktop must validate:

1. `event` is `nexus-ai-core.ready`.
2. `startupNonce` matches the launch nonce.
3. `host` is loopback and `endpoint` matches the announced host and port.
4. `targetService` is `nexus-ai-core`.
5. `apiVersion` and contract versions are compatible.
6. Direct execution, Discord connection, service forwarding, and D&D calls remain disabled.
7. GitHub webhook intake is disabled in sidecar mode.

After readiness, instantiate `NexusAiCoreClient` with the announced endpoint and protected service token, then call `negotiate()` with the capabilities required by the desktop feature being enabled.

## Shutdown

Preferred shutdown uses the Node IPC message:

```json
{ "type": "nexus-ai-core.shutdown" }
```

`SIGINT` and `SIGTERM` are also supported. The sidecar stops accepting requests, removes its readiness file, closes idle connections, and exits within the configured grace period. There is no HTTP shutdown endpoint.

When the IPC parent disconnects or the optional parent process ID disappears, the sidecar shuts down with the parent-loss exit code.

Exit codes:

- `0`: clean shutdown.
- `64`: invalid or unsafe configuration.
- `70`: startup failure.
- `71`: supervising parent was lost.
- `72`: shutdown exceeded the grace period or failed.

Diagnostics are stable JSON records written to stderr. They contain event and error codes only, not raw errors or credentials.

## Provider configuration

The deterministic local provider remains the default. Optional OpenAI configuration belongs only in the AI Core sidecar environment or protected service configuration. It must never be copied into renderer state, Discord bootstrap data, public diagnostics, backup exports, or D&D AI settings.

## Update monitoring

The sidecar exposes update-monitor APIs but creates no recurring timer. Khaos Nexus must initiate polling through its existing shared scheduler or an explicit owner action. GitHub webhooks are disabled in sidecar mode.

## Bundle

Run:

```bash
npm run bundle:sidecar
npm run verify:sidecar
```

The output is:

```text
dist/sidecar/khaos-nexus-ai-core-<service-version>/
```

The bundle contains runtime JavaScript, the hardened client, machine-readable contracts, package metadata, and integration/security documentation. `integrity.json` records the SHA-256 digest and byte length of every included file. Verification rejects missing, changed, or unexpected files and forbidden paths such as `.env`, tests, logs, monitor state, Git metadata, and `node_modules`.

The artifact is unpublished integration material. Building it does not create a GitHub release, tag, updater record, or public deployment.
