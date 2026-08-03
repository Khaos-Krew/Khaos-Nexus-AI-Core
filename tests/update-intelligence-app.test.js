import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app.js";

async function withServer(run) {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function requestBody(capability) {
  return {
    apiVersion: "1",
    requestId: randomUUID(),
    targetService: "nexus-ai-core",
    routingDepth: 0,
    capability,
    events: [{
      sourceId: "ark-release",
      providerEventId: "release:101",
      provider: "github-release",
      eventType: "release",
      version: "101",
      releaseChannel: "stable",
      title: "ARK update",
      changelog: "Performance and crash fixes",
      authoritative: true,
      metadata: {},
    }],
    resources: [{
      id: "server:rag:game",
      name: "Ragnarok Server",
      publicName: "Ragnarok",
      type: "game",
      gameKey: "ark",
      installedVersion: "100",
      runningVersion: "100",
      availableVersion: "100",
      allowedChannels: ["stable"],
    }],
    bindings: [{ sourceId: "ark-release", resourceRefs: ["server:rag:game"] }],
    subscriptions: [{
      id: "staff",
      authorized: true,
      destination: { id: "staff-updates", type: "channel", visibility: "private" },
    }],
  };
}

test("update evaluation endpoint returns advisory alerts and deliveries", async () => {
  await withServer(async (baseUrl) => {
    const body = requestBody("nexus.update.evaluate");
    const response = await fetch(`${baseUrl}/api/v1/updates/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Khaos-Request-Id": body.requestId },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.evaluation.alertCount, 1);
    assert.equal(result.evaluation.deliveryCount, 1);
    assert.equal(result.evaluation.alerts[0].readyForMaintenance, true);
    assert.equal(result.execution.performed, false);
  });
});

test("update digest endpoint returns mention-safe neutral presentation", async () => {
  await withServer(async (baseUrl) => {
    const body = { ...requestBody("nexus.update.digest"), audience: "public" };
    const response = await fetch(`${baseUrl}/api/v1/updates/digest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.digest.presentation.type, "update_digest");
    assert.deepEqual(result.digest.allowedMentions.parse, []);
    assert.equal(result.digest.presentation.groups[0].alerts[0].resourceImpacts, undefined);
    assert.equal(result.execution.performed, false);
  });
});
