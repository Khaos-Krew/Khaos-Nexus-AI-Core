import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { OllamaLocalProvider } from "../src/ollama-provider.js";
import { createProviderFromEnvironment } from "../src/provider-factory.js";

function structuredOutput(overrides = {}) {
  return {
    subsystem: "General Assistance",
    content: "Safe local response.",
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
    model: "qwen3:8b",
    done: true,
    message: { role: "assistant", content: JSON.stringify(output) },
    prompt_eval_count: 10,
    eval_count: 5,
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function assistInput() {
  return {
    requestId: randomUUID(),
    capability: "nexus.help",
    prompt: "Explain the update monitor.",
    context: { module: "updates" },
  };
}

test("Ollama selection requires a model and accepts only local loopback endpoints", () => {
  assert.throws(
    () => createProviderFromEnvironment({ env: { AI_PROVIDER: "ollama-local" } }),
    (error) => error.code === "OLLAMA_MODEL_REQUIRED",
  );
  assert.throws(
    () => createProviderFromEnvironment({
      env: { AI_PROVIDER: "ollama-local", OLLAMA_MODEL: "qwen3:8b", OLLAMA_ENDPOINT: "http://192.168.1.25:11434" },
    }),
    (error) => error.code === "OLLAMA_ENDPOINT_NOT_LOOPBACK",
  );
});

test("Ollama request is local, tool-free, schema constrained, and stateless", async () => {
  let captured;
  const input = assistInput();
  const provider = createProviderFromEnvironment({
    env: {
      AI_PROVIDER: "ollama-local",
      OLLAMA_MODEL: "qwen3:8b",
      OLLAMA_TIMEOUT_MS: "120000",
    },
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options, body: JSON.parse(options.body) };
      return completedResponse();
    },
  });

  const result = await provider.assist(input);
  assert.equal(captured.url, "http://127.0.0.1:11434/api/chat");
  assert.equal(captured.body.model, "qwen3:8b");
  assert.equal(captured.body.stream, false);
  assert.equal(captured.body.tools, undefined);
  assert.equal(captured.body.format.type, "object");
  assert.equal(captured.body.format.additionalProperties, false);
  assert.equal(captured.body.messages[0].role, "system");
  assert.match(captured.body.messages[0].content, /only permission, Discord, scheduler, and execution authorities/i);
  assert.equal(result.presentation.providerMetadata.provider, "ollama-local");
  assert.equal(result.presentation.providerMetadata.model, "qwen3:8b");
  assert.equal(result.presentation.providerMetadata.usage.totalTokens, 15);
  assert.equal(result.presentation.providerMetadata.store, false);
  assert.equal(result.presentation.providerMetadata.toolsUsed, 0);
});

test("Ollama tool calls and malformed structured output fail closed", async () => {
  const toolOutput = new OllamaLocalProvider({
    model: "qwen3:8b",
    fetchImpl: async () => completedResponse(undefined, {
      message: {
        role: "assistant",
        content: JSON.stringify(structuredOutput()),
        tool_calls: [{ function: { name: "restart_server", arguments: {} } }],
      },
    }),
  });
  await assert.rejects(() => toolOutput.assist(assistInput()), (error) => error.code === "OLLAMA_UNEXPECTED_TOOL_OUTPUT");

  const malformed = new OllamaLocalProvider({
    model: "qwen3:8b",
    fetchImpl: async () => completedResponse(undefined, { message: { role: "assistant", content: "{bad json" } }),
  });
  await assert.rejects(() => malformed.assist(assistInput()), (error) => error.code === "OLLAMA_STRUCTURED_OUTPUT_INVALID");
});

test("missing models fail closed while retryable local outages can use deterministic fallback", async () => {
  const missing = createProviderFromEnvironment({
    env: { AI_PROVIDER: "ollama-local", AI_PROVIDER_FALLBACK: "deterministic", OLLAMA_MODEL: "missing:latest" },
    fetchImpl: async () => new Response(JSON.stringify({ error: "model not found" }), { status: 404 }),
  });
  await assert.rejects(() => missing.assist(assistInput()), (error) => error.code === "OLLAMA_MODEL_NOT_AVAILABLE" && error.retryable === false);

  const unavailable = createProviderFromEnvironment({
    env: { AI_PROVIDER: "ollama-local", AI_PROVIDER_FALLBACK: "deterministic", OLLAMA_MODEL: "qwen3:8b" },
    fetchImpl: async () => { throw new TypeError("connection refused"); },
  });
  const result = await unavailable.assist(assistInput());
  assert.equal(result.presentation.providerMetadata.provider, "deterministic-local");
  assert.equal(result.presentation.providerMetadata.fallback.used, true);
  assert.equal(result.presentation.providerMetadata.fallback.fromProvider, "ollama-local");
  assert.equal(result.presentation.providerMetadata.fallback.reasonCode, "OLLAMA_NETWORK_ERROR");
});
