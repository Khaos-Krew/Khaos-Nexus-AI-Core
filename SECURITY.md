# Security Policy

## Security boundary

- Keep the service loopback-only by default.
- Configure a strong `NEXUS_AI_CORE_SERVICE_TOKEN` before non-local use.
- Require HTTPS for any non-loopback deployment.
- Never submit Discord bot tokens, provider keys, RCON passwords, hosting credentials, private keys, or connection strings in request bodies.
- Keep `GITHUB_API_TOKEN`, `CURSEFORGE_API_KEY`, and `GITHUB_WEBHOOK_SECRET` server-side only.
- Never expose AI Core directly as the Discord interaction authority.
- Never grant AI Core direct server, database, scheduler, game-hosting, RCON, or Discord credentials.
- Keep GitHub webhooks disabled unless an authenticated webhook path is explicitly needed.

## Provider protections

- Callers select a registered provider type and identifiers; they cannot supply arbitrary URLs.
- Provider requests are limited to allowlisted HTTPS origins.
- Redirects are rejected.
- Requests use bounded timeouts, retries, response sizes, and redacted failure messages.
- ETag and Last-Modified metadata may be retained, but provider credentials and raw response bodies are not persisted.
- Steam news is informational and cannot authorize or confirm an update operation.

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

The service uses bounded JSON bodies, constant-time token and signature comparison, forbidden credential-field rejection, token-like text redaction, external-text sanitization, Discord mention neutralization, explicit target-service routing, D&D namespace isolation, routing-loop prevention, rate limiting, idempotency, source backoff, event deduplication, no-store responses, and restrictive response headers.

## Reporting

Report vulnerabilities privately to the Khaos Krew repository owner. Do not include live credentials, webhook secrets, private payloads, or sensitive server details in a public issue.
