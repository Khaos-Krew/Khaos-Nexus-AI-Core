import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/errors.js";
import { validateProviderOutputPolicy } from "../src/output-policy.js";
import { ProviderCircuitBreaker } from "../src/provider-circuit.js";
import { ProviderRouter } from "../src/provider-factory.js";
import { ProviderTelemetry } from "../src/provider-observability.js";
import { DeterministicProvider } from "../src/provider.js";

function validOutput(overrides = {}) {
  return {
    subsystem: "General Assistance",
    content: "This is advisory and no action was performed.",
    presentation: { type: "help", severity: "information", reviewRequired: false },
    meta: {
      provider: "fixture",
      model: "fixture-model",
      latencyMs: 12,
      usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
      store: false,
      toolsUsed: 0,
    },
    ...overrides,
  };
}

test("post-generation policy enforces execution, D&D, secret, link, and presentation boundaries", () => {
  assert.equal(validateProviderOutputPolicy({ capability: "nexus.help", output: validOutput() }).policy.validated, true);
  assert.throws(
    () => validateProviderOutputPolicy({ capability: "nexus.help", output: validOutput({ content: "I restarted the server successfully." }) }),
    (error) => error.code === "AI_OUTPUT_EXECUTION_CLAIM" && error.retryable === false,
  );
  assert.throws(
    () => validateProviderOutputPolicy({ capability: "nexus.help", output: validOutput({ content: "I will act as your Dungeon Master." }) }),
    (error) => error.code === "AI_OUTPUT_DND_BOUNDARY",
  );
  assert.throws(
    () => validateProviderOutputPolicy({ capability: "nexus.help", output: validOutput({ content: "Bearer abcdefghijklmnop" }) }),
    (error) => error.code === "AI_OUTPUT_SECRET_DETECTED",
  );
  assert.throws(
    () => validateProviderOutputPolicy({ capability: "nexus.help", output: validOutput({ content: "Open https://evil.example now." }) }),
    (error) => error.code === "AI_OUTPUT_UNTRUSTED_LINK",
  );
  assert.throws(
    () => validateProviderOutputPolicy({ capability: "nexus.discord.draft", output: validOutput() }),
    (error) => error.code === "AI_OUTPUT_PRESENTATION_MISMATCH",
  );
});

test("unsafe Discord mentions are neutralized after raw policy checks", () => {
  const output = validateProviderOutputPolicy({
    capability: "nexus.discord.draft",
    output: validOutput({
      content: "@everyone maintenance soon <@1234>",
      presentation: { type: "draft", severity: "information", reviewRequired: true },
    }),
  });
  assert.equal(output.content.includes("@everyone"), false);
  assert.equal(output.content.includes("<@1234>"), false);
});

test("circuit breaker opens, short-circuits, half-opens, and closes", async () => {
  let now = 1_700_000_000_000;
  let attempts = 0;
  let shouldFail = true;
  const primary = {
    name: "fixture-primary",
    model: "fixture-model",
    ready: true,
    status: () => ({ name: "fixture-primary", model: "fixture-model", ready: true, store: false, toolsAllowed: false }),
    async assist() {
      attempts += 1;
      if (shouldFail) throw new AppError("temporary", { status: 503, code: "TEMPORARY", retryable: true });
      return validOutput();
    },
  };
  const circuit = new ProviderCircuitBreaker({ failureThreshold: 2, failureWindowMs: 10_000, cooldownMs: 1_000, now: () => now });
  const router = new ProviderRouter({ primary, circuit });
  await assert.rejects(() => router.assist({ capability: "nexus.help" }), (error) => error.code === "TEMPORARY");
  await assert.rejects(() => router.assist({ capability: "nexus.help" }), (error) => error.code === "TEMPORARY");
  assert.equal(router.status().circuit.state, "open");
  await assert.rejects(() => router.assist({ capability: "nexus.help" }), (error) => error.code === "AI_PROVIDER_CIRCUIT_OPEN");
  assert.equal(attempts, 2);
  now += 1_001;
  shouldFail = false;
  assert.equal((await router.assist({ capability: "nexus.help" })).content.includes("advisory"), true);
  assert.equal(attempts, 3);
  assert.equal(router.status().circuit.state, "closed");
});

test("non-retryable policy failures do not open the circuit or invoke fallback", async () => {
  let fallbackCalls = 0;
  const primary = {
    name: "unsafe-primary",
    model: "unsafe-model",
    ready: true,
    async assist() { return validOutput({ content: "I sent the announcement." }); },
    status: () => ({ name: "unsafe-primary", model: "unsafe-model", ready: true }),
  };
  const fallback = {
    ...new DeterministicProvider(),
    async assist(input) { fallbackCalls += 1; return new DeterministicProvider().assist(input); },
  };
  const router = new ProviderRouter({
    primary,
    fallback,
    fallbackOnRetryable: true,
    circuitOptions: { failureThreshold: 1 },
  });
  await assert.rejects(() => router.assist({ capability: "nexus.help", prompt: "help" }), (error) => error.code === "AI_OUTPUT_EXECUTION_CLAIM");
  assert.equal(fallbackCalls, 0);
  assert.equal(router.status().circuit.state, "closed");
});

test("an open circuit uses only explicitly enabled visible fallback", async () => {
  let attempts = 0;
  const primary = {
    name: "offline-primary",
    model: "offline-model",
    ready: true,
    async assist() { attempts += 1; throw new AppError("offline", { status: 503, code: "OFFLINE", retryable: true }); },
    status: () => ({ name: "offline-primary", model: "offline-model", ready: true }),
  };
  const router = new ProviderRouter({
    primary,
    fallback: new DeterministicProvider(),
    fallbackOnRetryable: true,
    circuitOptions: { failureThreshold: 1, cooldownMs: 60_000 },
  });
  const first = await router.assist({ capability: "nexus.help", prompt: "help" });
  const second = await router.assist({ capability: "nexus.help", prompt: "help" });
  assert.equal(first.presentation.providerMetadata.fallback.used, true);
  assert.equal(second.presentation.providerMetadata.fallback.shortCircuit, true);
  assert.equal(attempts, 1);
});

test("telemetry stores bounded aggregates but no content or identities", () => {
  const telemetry = new ProviderTelemetry({ provider: "provider", model: "model" });
  telemetry.recordRequest();
  telemetry.recordSuccess({ latencyMs: 20, usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 } });
  telemetry.recordFailure({ code: "SECRET_PROMPT_TEXT" });
  telemetry.recordCircuitTransition({ previous: "closed", next: "open" });
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.requests, 1);
  assert.equal(snapshot.successes, 1);
  assert.equal(snapshot.failures, 1);
  assert.equal(snapshot.usage.totalTokens, 7);
  assert.equal(snapshot.contentStored, false);
  assert.equal(snapshot.identitiesStored, false);
  assert.equal(JSON.stringify(snapshot).includes("actual prompt"), false);
});
