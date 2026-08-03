# Security Policy

## Security boundary

- Keep the service loopback-only by default.
- Configure a strong `NEXUS_AI_CORE_SERVICE_TOKEN` before non-local use.
- Require HTTPS for any non-loopback deployment.
- Never submit Discord bot tokens, provider keys, RCON passwords, hosting credentials, private keys, or connection strings in request bodies.
- Keep `OPENAI_API_KEY`, `GITHUB_API_TOKEN`, `CURSEFORGE_API_KEY`, and `GITHUB_WEBHOOK_SECRET` server-side only.
- Never expose AI Core directly as the Discord interaction authority.
- Never grant AI Core direct server, database, scheduler, game-hosting, RCON, or Discord credentials.
- Keep GitHub webhooks disabled unless an authenticated webhook path is explicitly needed.

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

## Evaluation protections

- Normal CI runs `npm run eval` with the deterministic local provider only.
- The offline fixture corpus contains no real credentials, production prompts, private server data, Discord identities, or campaign content.
- Required fixtures cover execution claims, D&D leakage, internal-instruction disclosure, credential-like input, unsafe mentions, schema and presentation requirements, and repeatability.
- CI fails below the configured pass threshold.
- No external provider key is required or read by the normal evaluation command.

## Provider-source protections

- Callers select a registered provider type and identifiers; they cannot supply arbitrary URLs.
- Provider requests are limited to allowlisted HTTPS origins.
- Redirects are rejected.
- Requests use bounded timeouts, retries, response sizes, and redacted failure messages.
- ETag and Last-Modified metadata may be retained, but provider credentials and raw response bodies are not persisted.
- Steam news is informational and cannot authorize or confirm an update operation.

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

GitHub webhook processing requires:

- `GITHUB_WEBHOOKS_ENABLED=true`;
- a high-entropy server-side `GITHUB_WEBHOOK_SECRET`;
- the `X-Hub-Signature-256` HMAC-SHA256 signature;
- a registered GitHub source matching the payload repository;
- a unique `X-GitHub-Delivery` value;
- a supported published release event.

The raw webhook body is validated before parsing and is not stored.

## Built-in protections

The service uses bounded JSON bodies, constant-time token and signature comparison, forbidden credential-field rejection, token-like text redaction, external-text sanitization, Discord mention neutralization, explicit target-service routing, D&D namespace isolation, routing-loop prevention, rate limiting, idempotency, output policy validation, provider budgets, circuit breaking, redacted telemetry, provider fallback policy, source backoff, event deduplication, explicit impact bindings, public/private projections, no-store responses, and restrictive response headers.

## Reporting

Report vulnerabilities privately to the Khaos Krew repository owner. Do not include live credentials, provider keys, webhook secrets, private payloads, Discord identifiers, or sensitive server details in a public issue.
