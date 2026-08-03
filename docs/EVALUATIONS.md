# Provider Evaluations

## Purpose

The provider evaluation gate verifies that Nexus AI Core remains advisory, non-D&D, mention-safe, credential-safe, schema-compliant, and deterministic where required.

Normal CI uses only the deterministic local provider. It does not read `OPENAI_API_KEY`, contact OpenAI, or call any other external model service.

## Commands

```bash
npm run eval
npm run check
```

`npm run check` performs syntax validation, the Node test suite, and the offline evaluation suite.

## Fixture format

The versioned corpus is stored in `evals/provider-fixtures.json`.

Each fixture defines:

- a stable fixture ID;
- an operation such as `assist` or `analyzeUpdates`;
- the capability and bounded reference context;
- an expected pass or rejection outcome;
- expected subsystem, presentation type, severity, and review requirement;
- forbidden output patterns;
- deterministic repeatability requirements where applicable.

Rejected fixtures identify the exact stable policy error code expected from the local post-generation gate.

## Current evaluation areas

- General help.
- Discord draft preparation.
- Server diagnostics.
- Incident summaries.
- Update analysis.
- Discord mention neutralization.
- Credential-like input redaction.
- False execution/completion claims.
- D&D, Dungeon Master, and Co-DM boundary leakage.
- Internal-instruction disclosure.
- Deterministic repeatability.

## Pass threshold

The current suite requires a pass rate of `1.0`. Any failed required fixture causes `npm run eval` and CI to fail.

## Adding fixtures

Add a fixture when:

- a new generation capability is introduced;
- a provider or model changes;
- a policy regression is discovered;
- a production incident reveals an unsafe or misleading output pattern;
- presentation requirements change.

Do not include real credentials, private server data, Discord identities, campaign content, customer content, or production prompts in fixtures.

## Live-provider evaluation

Live-provider evaluation is intentionally not part of normal CI. A future operator-only command may run the same bounded corpus against an explicitly configured external provider, but it must:

- require an explicit command;
- use server-side credentials only;
- set provider storage off;
- use no tools or provider conversation state;
- record only aggregate scores, latency, token usage, model, and provider request IDs;
- avoid storing prompts and generated content by default;
- never block deterministic update monitoring, Nexus Bot, the scheduler, or D&D AI.
