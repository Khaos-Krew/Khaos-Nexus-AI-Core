import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app.js";

async function withServer(options, run) {
  const server = createApp(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function envelope(capability, additions = {}) {
  return {
    apiVersion: "1",
    requestId: randomUUID(),
    targetService: "nexus-ai-core",
    routingDepth: 0,
    capability,
    ...additions,
  };
}

test("health and capability discovery expose isolation boundaries", async () => {
  await withServer({}, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    assert.equal(health.status, "ok");
    assert.equal(health.isolation.directAiToAiCallsAllowed, false);

    const capabilities = await fetch(`${baseUrl}/api/v1/capabilities`).then((response) => response.json());
    assert.ok(capabilities.capabilities.includes("nexus.update.compare"));
    assert.deepEqual(capabilities.rejectedNamespaces, ["dnd.*"]);
  });
});

test("service authentication is enforced when configured", async () => {
  await withServer({ serviceToken: "correct", authRequired: true }, async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/v1/capabilities`);
    assert.equal(denied.status, 401);
    const allowed = await fetch(`${baseUrl}/api/v1/capabilities`, {
      headers: { Authorization: "Bearer correct" },
    });
    assert.equal(allowed.status, 200);
  });
});

test("D&D requests and AI-to-AI routing are rejected without forwarding", async () => {
  await withServer({}, async (baseUrl) => {
    const dnd = envelope("dnd.co-dm.draft", { prompt: "Prepare a session" });
    const response = await fetch(`${baseUrl}/api/v1/discord/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dnd),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "DND_CAPABILITY_ISOLATED");

    const forwarded = envelope("nexus.help", {
      targetService: "dnd-ai",
      routingDepth: 1,
      prompt: "Help",
    });
    const forwardedResponse = await fetch(`${baseUrl}/api/v1/discord/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forwarded),
    });
    assert.equal(forwardedResponse.status, 409);
  });
});

test("Discord assistance is neutral, mention-safe, and idempotent", async () => {
  await withServer({}, async (baseUrl) => {
    const request = envelope("nexus.discord.draft", {
      prompt: "@everyone Maintenance tonight",
      visibility: "public",
    });
    const first = await fetch(`${baseUrl}/api/v1/discord/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Khaos-Request-Id": request.requestId },
      body: JSON.stringify(request),
    }).then((response) => response.json());
    assert.equal(first.response.allowedMentions.parse.length, 0);
    assert.equal(first.response.content.includes("@everyone"), false);
    assert.equal(first.meta.executedActions, 0);

    const replay = await fetch(`${baseUrl}/api/v1/discord/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }).then((response) => response.json());
    assert.equal(replay.meta.idempotentReplay, true);

    const changed = { ...request, prompt: "Different content" };
    const conflict = await fetch(`${baseUrl}/api/v1/discord/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changed),
    });
    assert.equal(conflict.status, 409);
  });
});

test("update comparison and maintenance endpoints never execute actions", async () => {
  await withServer({}, async (baseUrl) => {
    const updateRequest = envelope("nexus.update.compare", {
      resources: [{
        id: "minecraft",
        name: "Minecraft Server",
        type: "game",
        installedVersion: "1.21.1",
        availableVersion: "1.21.2",
      }],
    });
    const update = await fetch(`${baseUrl}/api/v1/updates/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateRequest),
    }).then((response) => response.json());
    assert.equal(update.comparison.resources[0].state, "UPDATE_AVAILABLE");
    assert.equal(update.execution.performed, false);

    const planRequest = envelope("nexus.maintenance.propose", {
      resourceRefs: ["server:minecraft"],
      recentBackupAvailable: true,
      crossPlatformReady: true,
    });
    const plan = await fetch(`${baseUrl}/api/v1/maintenance/plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(planRequest),
    }).then((response) => response.json());
    assert.equal(plan.plan.status, "PROPOSED");
    assert.equal(plan.execution.performed, false);
  });
});

test("rate limiting returns retryable 429 responses", async () => {
  await withServer({ rateLimit: { limit: 1, windowMs: 60_000 } }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/v1/capabilities`)).status, 200);
    const second = await fetch(`${baseUrl}/api/v1/capabilities`);
    assert.equal(second.status, 429);
    assert.equal((await second.json()).error.retryable, true);
  });
});
