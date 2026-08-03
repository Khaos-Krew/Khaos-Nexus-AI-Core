# Security Policy

## Security boundary

- Keep the service loopback-only by default.
- Configure a strong `NEXUS_AI_CORE_SERVICE_TOKEN` before non-local use.
- Require HTTPS for any non-loopback deployment.
- Never submit Discord bot tokens, provider keys, RCON passwords, hosting credentials, private keys, or connection strings in request bodies.
- Never expose AI Core directly as the Discord interaction authority.
- Never grant AI Core direct server, database, scheduler, or Discord credentials.

## Built-in protections

The service uses bounded JSON bodies, constant-time token comparison, forbidden credential-field rejection, token-like text redaction, Discord mention neutralization, explicit target-service routing, D&D namespace isolation, routing-loop prevention, rate limiting, idempotency, no-store responses, and restrictive response headers.

## Reporting

Report vulnerabilities privately to the Khaos Krew repository owner. Do not include live credentials or sensitive server details in a public issue.
