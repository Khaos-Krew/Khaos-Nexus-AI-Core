# Security Policy

## Security boundary

- Keep the service loopback-only by default.
- Require a high-entropy `NEXUS_AI_CORE_SERVICE_TOKEN` for desktop sidecar mode.
- Require HTTPS for any non-loopback standalone deployment.
- Never submit Discord bot tokens, provider keys, RCON passwords, hosting credentials, private keys, or connection strings in request bodies.
- Keep `OPENAI_API_KEY`, `GITHUB_API_TOKEN`, `CURSEFORGE_API_KEY`, and `GITHUB_WEBHOOK_SECRET` server-side only.
- Never expose AI Core directly as the Discord interaction authority.
- Never grant AI Core direct server, database, scheduler, game-hosting, RCON, or Discord credentials.
- Keep GitHub webhooks disabled unless an authenticated standalone webhook path is explicitly needed. Sidecar mode always disables webhook intake.

## Desktop sidecar protections

- Sidecar configuration accepts only `127.0.0.1` or `::1`.
- Port `0` is supported so the operating system selects a free local port; the desktop must use the authenticated readiness record rather than assume a port.
- Missing, weak, whitespace-containing, or low-diversity service tokens are rejected before listening.
- Startup nonces are bounded and restricted to a safe character set.
- Ready-file and monitor-state paths must be absolute; the ready file is written atomically with private permissions where supported.
- Readiness is emitted only after the listener accepts requests.
- Readiness and diagnostics exclude service tokens, provider/source credentials, prompts, responses, request bodies, Discord IDs, server IDs, player IDs, and campaign data.
- GitHub webhook intake is disabled in sidecar mode even when standalone webhook environment variables exist.
- Shutdown is available through IPC, `SIGINT`, and `SIGTERM`; there is no HTTP shutdown endpoint.
- IPC disconnect and optional parent-PID loss trigger bounded sidecar shutdown.
- The sidecar removes its readiness file during shutdown.
- Stable exit codes distinguish unsafe configuration, startup failure, parent loss, and forced shutdown without exposing raw errors.
- Khaos Nexus remains responsible for protected token storage, process restart policy, capability negotiation, local permissions, and audit events.

## Bundle and artifact protections

- `npm run bundle:sidecar` constructs the bundle from an explicit allowlist of runtime source, contracts, package metadata, and operator/security documentation.
- Environment files, monitor state, tests, logs, Git metadata, `node_modules`, and generated user data are excluded.
- `integrity.json` records SHA-256 and byte length for every included file.
- `npm run verify:sidecar` rejects missing, changed, or unexpected files, forbidden paths, version drift, contract drift, runtime dependencies, and automatic-publication settings.
- The Windows workflow uploads an unpublished short-retention artifact only after full Linux and Windows validation.
- Bundle creation does not create a release, tag, updater record, public deployment, or embedded credential.

## Generation provider protections

- Deterministic local behavior is the default; external model generation is opt-in.
- OpenAI configuration fails closed unless both the server-side key and explicit model are present.
- The API origin is fixed to `https://api.openai.com`; callers cannot provide a base URL.
- Every generation request uses `store:false`, `background:false`, strict JSON Schema, no tools, no conversation state, no previous-response state, bounded output tokens, and a Khaos client request ID.
- Provider instructions explicitly preserve the Khaos Nexus execution boundary and D&D isolation.
- Prompt and context values are untrusted reference data and cannot become system instructions.
- Provider responses are bounded, parsed, schema-validated, and rejected if refused, incomplete, malformed, oversized, or tool-bearing.
- Every deterministic and external output then passes a local capability policy before presentation.
- The policy rejects false execution/completion claims, D&D/DM/Co-DM leakage, credential-like output, hidden-instruction disclosure, untrusted links, invalid presentation/severity/review behavior, and oversized content.
- Unsafe Discord mentions are neutralized before presentation.
- Policy failures are non-retryable, do not affect connectivity circuit state, and never activate fallback.
- Authentication errors and raw provider error bodies are not forwarded.
- Safe response metadata is limited to provider name, model, request ID, latency, token counts, storage mode, tool count, and fallback reason.
- Daily in-memory budgets can cap requests and estimated/actual token usage. Durable billing and organization spending controls remain outside AI Core.
- Deterministic fallback is disabled by default and may activate only for retryable network, timeout, rate-limit, circuit-open, or transient server failures.
- Authentication, refusal, policy, schema, unexpected-tool, incomplete-output, and budget failures cannot silently fall back.
- The general AI provider key and settings are never shared with the D&D AI service.

## Circuit-breaker protections

- Only retryable primary-provider failures count toward the threshold.
- Failure windows, thresholds, and cooldowns are bounded by server-side configuration.
- Open circuits skip external provider calls and fail fast or use explicitly enabled deterministic fallback.
- One half-open probe is allowed after cooldown.
- Successful probes close the circuit; retryable failed probes reopen it.
- Non-retryable policy, authentication, refusal, schema, or budget outcomes do not open the circuit.
- Circuit state is in memory and contains no request or response content.

## Provider observability protections

`GET /api/v1/provider/status` uses the existing service-token authentication model. Telemetry stores only:

- provider and model labels;
- request, success, failure, fallback, and short-circuit counts;
- latency and token aggregates;
- bounded error-code and circuit-transition counters;
- circuit and budget snapshots.

Telemetry never stores prompts, context, responses, request bodies, provider keys, raw provider errors, Discord IDs, user IDs, guild IDs, channel IDs, server IDs, player IDs, or campaign content. Public health receives only a reduced readiness projection without detailed telemetry.

## Evaluation and contract protections

- Normal CI runs `npm run eval` with the deterministic local provider only.
- The offline fixture corpus contains no real credentials, production prompts, private server data, Discord identities, or campaign content.
- Required fixtures cover execution claims, D&D leakage, internal-instruction disclosure, credential-like input, unsafe mentions, schema and presentation requirements, and repeatability.
- `npm run contracts` verifies service and sidecar manifests, package exports, client methods, transport rules, package versions, authority boundaries, and D&D isolation.
- CI fails below the evaluation threshold or when any contract/bundle file drifts.
- No external provider key is required or read by normal evaluation, contract, bundle, or integrity checks.

## Provider-source protections

- Callers select a registered provider type and identifiers; they cannot supply arbitrary URLs.
- Provider requests are limited to allowlisted HTTPS origins.
- Redirects are rejected.
- Requests use bounded timeouts, retries, response sizes, and redacted failure messages.
- ETag and Last-Modified metadata may be retained, but provider credentials and raw response bodies are not persisted.
- Steam news is informational and cannot authorize or confirm an update operation.
- The shared Khaos Nexus scheduler owns polling cadence; the sidecar creates no timer.

## Impact and notification protections

- Operational impact requires explicit typed source-to-resource bindings; fuzzy matching is prohibited.
- AI Core does not discover Discord destinations or evaluate whether a user has permission.
- Only caller-provided subscriptions marked `authorized: true` are eligible for delivery proposals.
- Subscription matching cannot grant access or broaden visibility.
- Public projections exclude local resource references, internal blockers, private scope identifiers, credentials, addresses, and player identifiers.
- Discord alert and digest models use empty allowed mentions and bounded sanitized text.
- Stable alert and delivery keys support local deduplication without storing prompts or message content.
- Quiet-hour output is scheduling advice only; Khaos Nexus remains responsible for timing and urgent overrides.
- Every maintenance, ignore, pin, acknowledgement, or subscription action remains a proposal for local permission validation and confirmation.

## Webhook protections

Standalone GitHub webhook processing requires:

- `GITHUB_WEBHOOKS_ENABLED=true`;
- a high-entropy server-side `GITHUB_WEBHOOK_SECRET`;
- the `X-Hub-Signature-256` HMAC-SHA256 signature;
- a registered GitHub source matching the payload repository;
- a unique `X-GitHub-Delivery` value;
- a supported published release event.

The raw webhook body is validated before parsing and is not stored. Desktop sidecar mode always disables this path.

## Built-in protections

The service uses bounded JSON bodies, constant-time token and signature comparison, forbidden credential-field rejection, token-like text redaction, external-text sanitization, Discord mention neutralization, explicit target-service routing, D&D namespace isolation, routing-loop prevention, rate limiting, idempotency, output policy validation, provider budgets, circuit breaking, redacted telemetry, provider fallback policy, source backoff, event deduplication, explicit impact bindings, public/private projections, supervised sidecar lifecycle, manifest synchronization, SHA-256 bundle integrity, no-store responses, and restrictive response headers.

## Reporting

Report vulnerabilities privately to the Khaos Krew repository owner. Do not include live credentials, provider keys, webhook secrets, private payloads, readiness files, Discord identifiers, or sensitive server details in a public issue.
