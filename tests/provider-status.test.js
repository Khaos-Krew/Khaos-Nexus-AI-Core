import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createProviderFromEnvironment } from "../src/provider-factory.js";

async function withServer(options, run) {
  const server = createApp(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("public health exposes bounded readiness but no telemetry content", async () => {
  const provider = createProviderFromEnvironment({ env: { AI_PROVIDER: "deterministic-local" } });
  await withServer({ provider, serviceToken: "protected", authRequired: true }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.providerStatus.name, "deterministic-local");
    assert.equal(body.providerStatus.ready, true);
    assert.equal(body.providerStatus.circuit.state, "closed");
    assert.equal("telemetry" in body.providerStatus, false);
    assert.equal(JSON.stringify(body).includes("protected"), false);
  });
});

test("detailed provider status requires service authentication and stores no content or identities", async () => {
  const provider = createProviderFromEnvironment({ env: { AI_PROVIDER: "deterministic-local" } });
  await withServer({ provider, serviceToken: "protected", authRequired: true }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/v1/provider/status`)).status, 401);

    const requestId = randomUUID();
    const generated = await fetch(`${baseUrl}/api/v1/discord/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer protected" },
      body: JSON.stringify({
        apiVersion: "1",
        requestId,
        targetService: "nexus-ai-core",
        routingDepth: 0,
        capability: "nexus.help",
        prompt: "private prompt that must not be stored",
      }),
    });
    assert.equal(generated.status, 200);

    const statusResponse = await fetch(`${baseUrl}/api/v1/provider/status`, {
      headers: { Authorization: "Bearer protected" },
    });
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.providerStatus.telemetry.requests, 1);
    assert.equal(status.providerStatus.telemetry.successes, 1);
    assert.equal(status.providerStatus.telemetry.contentStored, false);
    assert.equal(status.providerStatus.telemetry.identitiesStored, false);
    assert.equal(status.contentStored, false);
    assert.equal(status.identitiesStored, false);
    const serialized = JSON.stringify(status);
    assert.equal(serialized.includes("private prompt"), false);
    assert.equal(serialized.includes(requestId), false);
    assert.equal(serialized.includes("protected"), false);
  });
});

test("capability discovery includes bounded provider readiness", async () => {
  const provider = createProviderFromEnvironment({ env: { AI_PROVIDER: "deterministic-local" } });
  await withServer({ provider }, async (baseUrl) => {
    const body = await fetch(`${baseUrl}/api/v1/capabilities`).then((response) => response.json());
    assert.equal(body.providerStatus.name, "deterministic-local");
    assert.equal(body.providerStatus.ready, true);
    assert.equal("telemetry" in body.providerStatus, false);
  });
});
