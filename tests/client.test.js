import assert from "node:assert/strict";
import test from "node:test";
import {
  NexusAiCoreClient,
  NexusAiCoreClientError,
  validateAiCoreEndpoint,
} from "../src/client.js";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function envelopeResponse(requestBody, extra = {}) {
  return jsonResponse({ apiVersion: "1", requestId: requestBody.requestId, service: "khaos-nexus-ai-core", ...extra });
}

test("endpoint validation allows loopback HTTP and requires HTTPS elsewhere", () => {
  assert.equal(validateAiCoreEndpoint("http://127.0.0.1:8790").origin, "http://127.0.0.1:8790");
  assert.equal(validateAiCoreEndpoint("http://localhost:8790").origin, "http://localhost:8790");
  assert.equal(validateAiCoreEndpoint("http://[::1]:8790").protocol, "http:");
  assert.equal(validateAiCoreEndpoint("https://ai.example.com").origin, "https://ai.example.com");
  assert.throws(() => validateAiCoreEndpoint("http://ai.example.com"), (error) => error.code === "CLIENT_HTTPS_REQUIRED");
  assert.throws(() => validateAiCoreEndpoint("ftp://localhost"), (error) => error.code === "CLIENT_ENDPOINT_REJECTED");
  assert.throws(() => validateAiCoreEndpoint("https://user:pass@ai.example.com"), (error) => error.code === "CLIENT_ENDPOINT_REJECTED");
  assert.throws(() => validateAiCoreEndpoint("https://ai.example.com/base"), (error) => error.code === "CLIENT_ENDPOINT_REJECTED");
  assert.throws(() => validateAiCoreEndpoint("https://ai.example.com?token=x"), (error) => error.code === "CLIENT_ENDPOINT_REJECTED");
  assert.throws(() => validateAiCoreEndpoint("https://ai.example.com#secret"), (error) => error.code === "CLIENT_ENDPOINT_REJECTED");
});

test("client keeps service tokens out of URLs, errors, status, and serialization", async () => {
  const calls = [];
  const token = "protected-service-token";
  const client = new NexusAiCoreClient({
    endpoint: "https://ai.example.com",
    serviceToken: token,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), headers: Object.fromEntries(options.headers.entries()) });
      return jsonResponse({ apiVersion: "1", service: "khaos-nexus-ai-core", targetService: "nexus-ai-core", capabilities: [] });
    },
  });
  await client.capabilities();
  assert.equal(calls[0].url.includes(token), false);
  assert.equal(calls[0].headers.authorization, `Bearer ${token}`);
  assert.equal(JSON.stringify(client).includes(token), false);
  assert.equal(JSON.stringify(client.status()).includes(token), false);
  assert.equal(client.status().authenticated, true);
});

test("POST methods use fixed v1 envelopes and matching request IDs", async () => {
  const calls = [];
  const client = new NexusAiCoreClient({
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url: String(url), options, body });
      return envelopeResponse(body, { execution: { performed: false } });
    },
  });
  await client.compareUpdates({ resources: [{ id: "x" }], apiVersion: "bad", targetService: "bad", routingDepth: 99, capability: "dnd.bad" });
  const call = calls[0];
  assert.equal(new URL(call.url).pathname, "/api/v1/updates/compare");
  assert.equal(call.body.apiVersion, "1");
  assert.equal(call.body.targetService, "nexus-ai-core");
  assert.equal(call.body.routingDepth, 0);
  assert.equal(call.body.capability, "nexus.update.compare");
  assert.match(call.body.requestId, /^[0-9a-f-]{36}$/i);
  assert.equal(call.options.headers.get("X-Khaos-Request-Id"), call.body.requestId);
  assert.equal(call.options.redirect, "error");
  assert.equal(call.options.credentials, "omit");
  assert.equal(call.options.referrerPolicy, "no-referrer");
});

test("client exposes only registered fixed methods and rejects D&D assist capabilities", async () => {
  const client = new NexusAiCoreClient({ fetchImpl: async () => jsonResponse({}) });
  assert.equal(typeof client.request, "undefined");
  assert.equal(typeof client.fetch, "undefined");
  await assert.rejects(
    () => client.assist({ capability: "dnd.co-dm.draft", prompt: "run campaign" }),
    (error) => error.code === "CLIENT_CAPABILITY_REJECTED",
  );
  await assert.rejects(
    () => client.assist({ capability: "nexus.update.poll", prompt: "wrong endpoint" }),
    (error) => error.code === "CLIENT_CAPABILITY_REJECTED",
  );
});

test("capability negotiation validates version, target, authority, namespaces, requirements, and provider readiness", async () => {
  const successClient = new NexusAiCoreClient({
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/health") return jsonResponse({ apiVersion: "1", targetService: "nexus-ai-core", service: "khaos-nexus-ai-core", version: "0.6.0", providerStatus: { ready: true } });
      return jsonResponse({
        apiVersion: "1",
        targetService: "nexus-ai-core",
        capabilities: ["nexus.help", "nexus.update.poll"],
        directExecution: false,
        directServiceForwarding: false,
        directDiscordConnection: false,
      });
    },
  });
  const negotiation = await successClient.negotiate({ requiredCapabilities: ["nexus.update.poll"], requireProvider: true });
  assert.deepEqual(negotiation.requiredCapabilities, ["nexus.update.poll"]);

  const scenarios = [
    [{ apiVersion: "2", targetService: "nexus-ai-core", capabilities: [], directExecution: false, directServiceForwarding: false, directDiscordConnection: false }, "CLIENT_API_VERSION_MISMATCH"],
    [{ apiVersion: "1", targetService: "dnd-ai", capabilities: [], directExecution: false, directServiceForwarding: false, directDiscordConnection: false }, "CLIENT_TARGET_SERVICE_MISMATCH"],
    [{ apiVersion: "1", targetService: "nexus-ai-core", capabilities: [], directExecution: true, directServiceForwarding: false, directDiscordConnection: false }, "CLIENT_AUTHORITY_CONTRACT_REJECTED"],
    [{ apiVersion: "1", targetService: "nexus-ai-core", capabilities: ["dnd.co-dm.draft"], directExecution: false, directServiceForwarding: false, directDiscordConnection: false }, "CLIENT_DND_ISOLATION_REJECTED"],
  ];
  for (const [capabilityBody, code] of scenarios) {
    const client = new NexusAiCoreClient({
      fetchImpl: async (url) => new URL(url).pathname === "/health"
        ? jsonResponse({ apiVersion: "1", targetService: "nexus-ai-core", providerStatus: { ready: true } })
        : jsonResponse(capabilityBody),
    });
    await assert.rejects(() => client.negotiate(), (error) => error.code === code);
  }

  const missing = new NexusAiCoreClient({
    fetchImpl: async (url) => new URL(url).pathname === "/health"
      ? jsonResponse({ apiVersion: "1", targetService: "nexus-ai-core", providerStatus: { ready: true } })
      : jsonResponse({ apiVersion: "1", targetService: "nexus-ai-core", capabilities: ["nexus.help"], directExecution: false, directServiceForwarding: false, directDiscordConnection: false }),
  });
  await assert.rejects(() => missing.negotiate({ requiredCapabilities: ["nexus.update.poll"] }), (error) => error.code === "CLIENT_REQUIRED_CAPABILITY_MISSING");

  const unavailable = new NexusAiCoreClient({
    fetchImpl: async (url) => new URL(url).pathname === "/health"
      ? jsonResponse({ apiVersion: "1", targetService: "nexus-ai-core", providerStatus: { ready: false } })
      : jsonResponse({ apiVersion: "1", targetService: "nexus-ai-core", capabilities: [], directExecution: false, directServiceForwarding: false, directDiscordConnection: false }),
  });
  await assert.rejects(() => unavailable.negotiate({ requireProvider: true }), (error) => error.code === "CLIENT_PROVIDER_UNAVAILABLE" && error.retryable === true);
});

test("client enforces response IDs, JSON content, redirects, size, and bounded errors", async () => {
  const mismatch = new NexusAiCoreClient({ fetchImpl: async () => jsonResponse({ requestId: "wrong" }) });
  await assert.rejects(() => mismatch.compareUpdates({ resources: [] }), (error) => error.code === "CLIENT_RESPONSE_ID_MISMATCH");

  const nonJson = new NexusAiCoreClient({ fetchImpl: async () => new Response("text", { status: 200, headers: { "content-type": "text/plain" } }) });
  await assert.rejects(() => nonJson.health(), (error) => error.code === "CLIENT_CONTENT_TYPE_REJECTED");

  const redirect = new NexusAiCoreClient({ fetchImpl: async () => new Response("{}", { status: 302, headers: { "content-type": "application/json", location: "https://other.example" } }) });
  await assert.rejects(() => redirect.health(), (error) => error.code === "CLIENT_REDIRECT_REJECTED");

  const oversized = new NexusAiCoreClient({ maxResponseBytes: 10_000, fetchImpl: async () => jsonResponse({ value: "x".repeat(20_000) }) });
  await assert.rejects(() => oversized.health(), (error) => error.code === "CLIENT_RESPONSE_TOO_LARGE");

  const remoteError = new NexusAiCoreClient({
    fetchImpl: async () => jsonResponse({ error: { code: "REMOTE_SAFE", message: "Safe failure", field: "prompt", retryable: true } }, { status: 429, headers: { "x-request-id": "provider-id" } }),
  });
  await assert.rejects(
    () => remoteError.health(),
    (error) => error instanceof NexusAiCoreClientError && error.code === "REMOTE_SAFE" && error.status === 429 && error.field === "prompt" && error.retryable === true && error.providerRequestId === "provider-id",
  );
});

test("network and timeout failures return stable redacted client errors", async () => {
  const network = new NexusAiCoreClient({ fetchImpl: async () => { throw new Error("secret network detail"); } });
  await assert.rejects(() => network.health(), (error) => error.code === "CLIENT_NETWORK_ERROR" && !error.message.includes("secret"));

  const timeout = new NexusAiCoreClient({ fetchImpl: async () => { const error = new Error("aborted secret"); error.name = "AbortError"; throw error; } });
  await assert.rejects(() => timeout.health(), (error) => error.code === "CLIENT_TIMEOUT" && error.retryable === true && !error.message.includes("secret"));
});
