import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { NexusAiCoreClient, nexusAiCoreClientMethods } from "../src/client.js";
import { API_VERSION, CAPABILITIES, SERVICE_VERSION, TARGET_SERVICE } from "../src/constants.js";
import { ENDPOINT_REGISTRY, SERVICE_CONTRACT, serviceContractSummary } from "../src/service-contract.js";

async function withServer(options, run) {
  const server = createApp(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("service contract matches source constants and preserves authority boundaries", () => {
  assert.equal(SERVICE_CONTRACT.apiVersion, API_VERSION);
  assert.equal(SERVICE_CONTRACT.serviceVersion, SERVICE_VERSION);
  assert.equal(SERVICE_CONTRACT.targetService, TARGET_SERVICE);
  assert.deepEqual(SERVICE_CONTRACT.capabilities, CAPABILITIES);
  assert.equal(SERVICE_CONTRACT.directExecution, false);
  assert.equal(SERVICE_CONTRACT.directDiscordConnection, false);
  assert.equal(SERVICE_CONTRACT.directServiceForwarding, false);
  assert.equal(SERVICE_CONTRACT.schedulerOwnedExternally, true);
  assert.equal(SERVICE_CONTRACT.dndIsolation.directCallsAllowed, false);
  assert.ok(SERVICE_CONTRACT.capabilities.every((capability) => capability.startsWith("nexus.") && !capability.startsWith("dnd.")));
});

test("contract summaries are defensive copies", () => {
  const first = serviceContractSummary();
  first.capabilities.push("dnd.bad");
  first.endpoints[0].path = "/changed";
  const second = serviceContractSummary();
  assert.equal(second.capabilities.includes("dnd.bad"), false);
  assert.equal(second.endpoints[0].path, "/health");
});

test("every registered endpoint has exactly one fixed client method", () => {
  const methods = new Set();
  for (const endpoint of ENDPOINT_REGISTRY) {
    assert.equal(nexusAiCoreClientMethods[endpoint.clientMethod], endpoint.key);
    assert.equal(typeof NexusAiCoreClient.prototype[endpoint.clientMethod], "function");
    assert.equal(methods.has(endpoint.clientMethod), false);
    methods.add(endpoint.clientMethod);
  }
  assert.equal(methods.size, ENDPOINT_REGISTRY.length);
});

test("authenticated contracts endpoint exposes bounded metadata and no secrets or content", async () => {
  await withServer({ serviceToken: "protected-service-token", authRequired: true }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/v1/contracts`)).status, 401);
    const response = await fetch(`${baseUrl}/api/v1/contracts`, {
      headers: { Authorization: "Bearer protected-service-token" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.apiVersion, "1");
    assert.equal(body.contract.contractVersion, "1.0.0");
    assert.equal(body.contract.serviceVersion, SERVICE_VERSION);
    assert.equal(body.schemasServedInline, false);
    assert.equal(body.contentStored, false);
    assert.equal(body.identitiesStored, false);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("protected-service-token"), false);
    assert.equal(serialized.includes("OPENAI_API_KEY"), false);
    assert.equal(serialized.includes("dnd.co-dm"), false);
  });
});

test("client contracts method consumes the authenticated service contract", async () => {
  await withServer({ serviceToken: "client-token", authRequired: true }, async (baseUrl) => {
    const client = new NexusAiCoreClient({ endpoint: baseUrl, serviceToken: "client-token" });
    const body = await client.contracts();
    assert.equal(body.contract.apiVersion, "1");
    assert.equal(body.contract.targetService, "nexus-ai-core");
    assert.equal(body.contract.directExecution, false);
  });
});
