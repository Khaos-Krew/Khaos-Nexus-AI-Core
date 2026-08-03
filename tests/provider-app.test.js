import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createProviderFromEnvironment } from "../src/provider-factory.js";

function providerResponse() {
  return new Response(JSON.stringify({
    id: "resp_app",
    status: "completed",
    error: null,
    incomplete_details: null,
    model: "pinned-test-model",
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify({
          subsystem: "General Assistance",
          content: "Advisory response.",
          presentation: { type: "message", severity: "information", reviewRequired: false },
        }),
      }],
    }],
    usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
  }), { status: 200, headers: { "x-request-id": "req_app" } });
}

async function withServer(provider, run) {
  const server = createApp({ provider });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("service responses expose safe provider metadata without credentials", async () => {
  const provider = createProviderFromEnvironment({
    env: { AI_PROVIDER: "openai-responses", OPENAI_API_KEY: "never-expose-this", OPENAI_MODEL: "pinned-test-model", OPENAI_RETRIES: "0" },
    fetchImpl: async () => providerResponse(),
  });
  await withServer(provider, async (baseUrl) => {
    const requestId = randomUUID();
    const response = await fetch(`${baseUrl}/api/v1/discord/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiVersion: "1",
        requestId,
        targetService: "nexus-ai-core",
        routingDepth: 0,
        capability: "nexus.help",
        prompt: "Explain Nexus AI.",
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.response.presentation.providerMetadata.provider, "openai-responses");
    assert.equal(body.response.presentation.providerMetadata.model, "pinned-test-model");
    assert.equal(body.response.presentation.providerMetadata.usage.totalTokens, 30);
    assert.equal(JSON.stringify(body).includes("never-expose-this"), false);
  });
});

test("update analysis preserves the original Khaos request ID", async () => {
  let clientRequestId;
  const provider = createProviderFromEnvironment({
    env: { AI_PROVIDER: "openai-responses", OPENAI_API_KEY: "secret", OPENAI_MODEL: "pinned-test-model", OPENAI_RETRIES: "0" },
    fetchImpl: async (_url, options) => {
      clientRequestId = options.headers["X-Client-Request-Id"];
      return providerResponse();
    },
  });
  const requestId = randomUUID();
  await provider.analyzeUpdates({
    requestId,
    summary: { total: 1, updateAvailable: 1, ready: 1, blocked: 0 },
    blockers: [],
    clusterFindings: [],
    resources: [],
  });
  assert.equal(clientRequestId, requestId);
});
