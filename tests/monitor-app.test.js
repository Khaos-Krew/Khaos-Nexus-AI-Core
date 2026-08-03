import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app.js";
import { MonitorService } from "../src/monitor-service.js";
import { MonitorStateStore } from "../src/monitor-store.js";
import { validateMonitorSource } from "../src/source-adapters.js";

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

test("monitor poll and state routes remain advisory and scheduler-owned", async () => {
  const monitorService = {
    async poll(body) {
      return { sourceCount: body.sources.length, newEventCount: 1, failedSourceCount: 0, results: [] };
    },
    state() {
      return { version: 1, sourceCount: 2, sources: [], webhookDeliveryCount: 0 };
    },
  };
  await withServer({ monitorService }, async (baseUrl) => {
    const pollRequest = envelope("nexus.update.poll", {
      sources: [{ id: "release", provider: "github-release", owner: "Khaos-Krew", repo: "Tool" }],
    });
    const poll = await fetch(`${baseUrl}/api/v1/monitor/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pollRequest),
    }).then((response) => response.json());
    assert.equal(poll.monitor.newEventCount, 1);
    assert.equal(poll.execution.performed, false);
    assert.equal(poll.execution.schedulerAuthority, "khaos-nexus-shared-scheduler");

    const state = await fetch(`${baseUrl}/api/v1/monitor/state`).then((response) => response.json());
    assert.equal(state.capability, "nexus.update.state");
    assert.equal(state.state.sourceCount, 2);
  });
});

test("GitHub webhook route uses signature authentication instead of service bearer authentication", async () => {
  const secret = "webhook-secret";
  const store = new MonitorStateStore();
  store.registerSource(validateMonitorSource({ id: "release", provider: "github-release", owner: "Khaos-Krew", repo: "Tool" }));
  const monitorService = new MonitorService({
    registry: { fetch() {} },
    stateStore: store,
    githubWebhookSecret: secret,
    githubWebhooksEnabled: true,
  });
  const body = JSON.stringify({
    action: "published",
    repository: { full_name: "Khaos-Krew/Tool" },
    release: { id: 1, tag_name: "v1", name: "One", body: "Notes", draft: false, prerelease: false, published_at: "2026-08-03T00:00:00Z" },
  });
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  await withServer({ monitorService, serviceToken: "desktop-token", authRequired: true }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/webhooks/github?sourceId=release`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": signature,
        "X-GitHub-Delivery": "delivery-1",
        "X-GitHub-Event": "release",
      },
      body,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.status, "accepted");
  });
});

test("monitor endpoints fail safely when the monitor is unavailable", async () => {
  await withServer({}, async (baseUrl) => {
    const state = await fetch(`${baseUrl}/api/v1/monitor/state`);
    assert.equal(state.status, 503);
    const pollRequest = envelope("nexus.update.poll", { sources: [{ id: "x", provider: "steam-news", appId: 1 }] });
    const poll = await fetch(`${baseUrl}/api/v1/monitor/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pollRequest),
    });
    assert.equal(poll.status, 503);
  });
});
