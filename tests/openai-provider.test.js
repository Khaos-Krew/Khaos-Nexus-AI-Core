import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { OpenAIResponsesProvider } from "../src/openai-provider.js";
import { createProviderFromEnvironment } from "../src/provider-factory.js";

function structuredOutput(overrides = {}) {
  return {
    subsystem: "General Assistance",
    content: "Safe advisory response.",
    presentation: {
      type: "message",
      severity: "information",
      reviewRequired: false,
    },
    ...overrides,
  };
}

function completedResponse(output = structuredOutput(), overrides = {}) {
  return new Response(JSON.stringify({
    id: "resp_123",
    status: "completed",
    error: null,
    incomplete_details: null,
    model: "pinned-test-model",
    output: [{
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: JSON.stringify(output), annotations: [] }],
    }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_provider_123" } });
}

function assistInput() {
  return {
    requestId: randomUUID(),
    capability: "nexus.help",
    prompt: "Explain the update monitor.",
    context: { module: "updates" },
  };
}

test("deterministic provider remains the default", () => {
  const provider = createProviderFromEnvironment({ env: {} });
  assert.equal(provider.name, "deterministic-local");
  assert.equal(provider.ready, true);
});

test("OpenAI selection fails closed without a server-side key or model", () => {
  assert.throws(
    () => createProviderFromEnvironment({ env: { AI_PROVIDER: "openai-responses", OPENAI_MODEL: "model" } }),
    (error) => error.code === "OPENAI_API_KEY_REQUIRED",
  );
  assert.throws(
    () => createProviderFromEnvironment({ env: { AI_PROVIDER: "openai-responses", OPENAI_API_KEY: "secret-key" } }),
    (error) => error.code === "OPENAI_MODEL_REQUIRED" && !error.message.includes("secret-key"),
  );
});

test("OpenAI request is stateless, tool-free, strict, bounded, and correlated", async () => {
  let captured;
  const input = assistInput();
  const provider = createProviderFromEnvironment({
    env: {
      AI_PROVIDER: "openai-responses",
      OPENAI_API_KEY: "project-secret",
      OPENAI_MODEL: "pinned-test-model",
      OPENAI_MAX_OUTPUT_TOKENS: "512",
      OPENAI_RETRIES: "0",
    },
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options, body: JSON.parse(options.body) };
      return completedResponse();
    },
  });
  const result = await provider.assist(input);
  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.options.headers["X-Client-Request-Id"], input.requestId);
  assert.equal(captured.options.headers.Authorization, "Bearer project-secret");
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.background, false);
  assert.equal(captured.body.max_output_tokens, 512);
  assert.deepEqual(captured.body.tools, []);
  assert.equal(captured.body.tool_choice, "none");
  assert.equal(captured.body.previous_response_id, undefined);
  assert.equal(captured.body.conversation, undefined);
  assert.equal(captured.body.text.format.type, "json_schema");
  assert.equal(captured.body.text.format.strict, true);
  assert.equal(result.presentation.providerMetadata.provider, "openai-responses");
  assert.equal(result.presentation.providerMetadata.providerRequestId, "req_provider_123");
  assert.equal(result.presentation.providerMetadata.usage.totalTokens, 15);
  assert.equal(result.presentation.providerMetadata.store, false);
  assert.equal(result.presentation.providerMetadata.toolsUsed, 0);
});

test("retryable HTTP failures retry and authentication failures do not", async () => {
  let attempts = 0;
  const retrying = new OpenAIResponsesProvider({
    apiKey: "secret",
    model: "pinned-test-model",
    retries: 1,
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, headers: { "retry-after": "0" } })
        : completedResponse();
    },
  });
  assert.equal((await retrying.assist(assistInput())).content, "Safe advisory response.");
  assert.equal(attempts, 2);

  attempts = 0;
  const authentication = new OpenAIResponsesProvider({
    apiKey: "secret-value",
    model: "pinned-test-model",
    retries: 3,
    fetchImpl: async () => {
      attempts += 1;
      return new Response(JSON.stringify({ error: { message: "secret-value invalid" } }), { status: 401 });
    },
  });
  await assert.rejects(
    () => authentication.assist(assistInput()),
    (error) => error.code === "OPENAI_AUTHENTICATION_FAILED" && !error.message.includes("secret-value"),
  );
  assert.equal(attempts, 1);
});

test("refusals, malformed structured output, and tool output fail without fallback", async () => {
  const refusal = createProviderFromEnvironment({
    env: {
      AI_PROVIDER: "openai-responses",
      AI_PROVIDER_FALLBACK: "deterministic",
      OPENAI_API_KEY: "secret",
      OPENAI_MODEL: "pinned-test-model",
      OPENAI_RETRIES: "0",
    },
    fetchImpl: async () => completedResponse(undefined, {
      output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot comply" }] }],
    }),
  });
  await assert.rejects(() => refusal.assist(assistInput()), (error) => error.code === "OPENAI_REFUSAL");

  const malformed = createProviderFromEnvironment({
    env: { AI_PROVIDER: "openai-responses", AI_PROVIDER_FALLBACK: "deterministic", OPENAI_API_KEY: "secret", OPENAI_MODEL: "pinned-test-model", OPENAI_RETRIES: "0" },
    fetchImpl: async () => completedResponse(undefined, {
      output: [{ type: "message", content: [{ type: "output_text", text: "{bad json" }] }],
    }),
  });
  await assert.rejects(() => malformed.assist(assistInput()), (error) => error.code === "OPENAI_STRUCTURED_OUTPUT_INVALID");

  const toolOutput = createProviderFromEnvironment({
    env: { AI_PROVIDER: "openai-responses", AI_PROVIDER_FALLBACK: "deterministic", OPENAI_API_KEY: "secret", OPENAI_MODEL: "pinned-test-model", OPENAI_RETRIES: "0" },
    fetchImpl: async () => completedResponse(undefined, { output: [{ type: "function_call", name: "dangerous" }] }),
  });
  await assert.rejects(() => toolOutput.assist(assistInput()), (error) => error.code === "OPENAI_UNEXPECTED_TOOL_OUTPUT");
});

test("retryable provider outages use deterministic fallback only when enabled", async () => {
  const provider = createProviderFromEnvironment({
    env: {
      AI_PROVIDER: "openai-responses",
      AI_PROVIDER_FALLBACK: "deterministic",
      OPENAI_API_KEY: "secret",
      OPENAI_MODEL: "pinned-test-model",
      OPENAI_RETRIES: "0",
    },
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "unavailable" } }), { status: 503 }),
  });
  const result = await provider.assist(assistInput());
  assert.equal(result.presentation.providerMetadata.provider, "deterministic-local");
  assert.equal(result.presentation.providerMetadata.fallback.used, true);
  assert.equal(result.presentation.providerMetadata.fallback.fromProvider, "openai-responses");
  assert.equal(result.presentation.providerMetadata.fallback.reasonCode, "OPENAI_HTTP_ERROR");
});

test("daily request budget blocks later generations without affecting configuration", async () => {
  const provider = new OpenAIResponsesProvider({
    apiKey: "secret",
    model: "pinned-test-model",
    retries: 0,
    dailyRequestBudget: 1,
    fetchImpl: async () => completedResponse(),
  });
  await provider.assist(assistInput());
  await assert.rejects(
    () => provider.assist(assistInput()),
    (error) => error.code === "OPENAI_DAILY_REQUEST_BUDGET_EXHAUSTED",
  );
  assert.equal(provider.status().budget.requests, 1);
});

test("timeouts are retryable and can activate visible fallback", async () => {
  const provider = createProviderFromEnvironment({
    env: {
      AI_PROVIDER: "openai-responses",
      AI_PROVIDER_FALLBACK: "deterministic",
      OPENAI_API_KEY: "secret",
      OPENAI_MODEL: "pinned-test-model",
      OPENAI_TIMEOUT_MS: "1000",
      OPENAI_RETRIES: "0",
    },
    fetchImpl: async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });
  const result = await provider.assist(assistInput());
  assert.equal(result.presentation.providerMetadata.fallback.reasonCode, "OPENAI_TIMEOUT");
});
