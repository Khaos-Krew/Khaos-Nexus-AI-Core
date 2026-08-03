import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertAllowedProviderUrl } from "../src/http-client.js";
import { MonitorService } from "../src/monitor-service.js";
import { MonitorStateStore } from "../src/monitor-store.js";
import { createSourceAdapterRegistry, validateMonitorSource } from "../src/source-adapters.js";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

test("provider URL allowlist blocks arbitrary hosts", () => {
  assert.throws(() => assertAllowedProviderUrl("https://127.0.0.1/secrets"), (error) => error.code === "PROVIDER_URL_REJECTED");
  assert.equal(assertAllowedProviderUrl("https://api.github.com/repos/a/b/releases").origin, "https://api.github.com");
});

test("GitHub adapter uses conditional headers and normalizes stable releases", async () => {
  let captured;
  const registry = createSourceAdapterRegistry({ fetchImpl: async (url, options) => {
    captured = { url: String(url), headers: Object.fromEntries(options.headers.entries()) };
    return jsonResponse([{ id: 10, tag_name: "v1.2.0", name: "Release", body: "<b>Fixes</b>", draft: false, prerelease: false, published_at: "2026-08-03T00:00:00Z", html_url: "https://github.com/a/b/releases/tag/v1.2.0", assets: [] }], { headers: { etag: '"abc"' } });
  }});
  const source = validateMonitorSource({ id: "gh", provider: "github-release", owner: "a", repo: "b" });
  const result = await registry.fetch(source, { etag: '"old"' });
  assert.match(captured.url, /api\.github\.com\/repos\/a\/b\/releases/);
  assert.equal(captured.headers["if-none-match"], '"old"');
  assert.equal(result.events[0].providerEventId, "github-release:10");
  assert.equal(result.events[0].releaseChannel, "stable");
  assert.equal(result.events[0].changelog, "Fixes");
});

test("Modrinth, CurseForge, and Steam adapters normalize provider-specific data", async () => {
  const calls = [];
  const registry = createSourceAdapterRegistry({ curseForgeApiKey: "cf-key", fetchImpl: async (url, options) => {
    calls.push({ url: String(url), headers: Object.fromEntries(options.headers.entries()) });
    if (String(url).includes("modrinth")) return jsonResponse([{ id: "ver1", version_number: "2.0.0", name: "Two", version_type: "release", date_published: "2026-08-03T00:00:00Z", game_versions: ["1.21.1"], loaders: ["neoforge"], dependencies: [], files: [] }]);
    if (String(url).includes("curseforge")) return jsonResponse({ data: [{ id: 77, displayName: "4.2.1", releaseType: 1, fileDate: "2026-08-03T00:00:00Z", gameVersions: ["1.0"], dependencies: [], hashes: [] }] });
    return jsonResponse({ appnews: { newsitems: [{ gid: "n1", title: "Server Update", contents: "Patch notes", date: 1785715200, url: "https://store.steampowered.com/news/app/1" }] } });
  }});
  const modrinth = await registry.fetch(validateMonitorSource({ id: "mr", provider: "modrinth-project", project: "abc", gameVersions: ["1.21.1"], loaders: ["neoforge"] }));
  const curseforge = await registry.fetch(validateMonitorSource({ id: "cf", provider: "curseforge-mod", modId: 123 }));
  const steam = await registry.fetch(validateMonitorSource({ id: "steam", provider: "steam-news", appId: 346110, keywords: ["update"] }));
  assert.equal(modrinth.events[0].providerEventId, "modrinth-version:ver1");
  assert.equal(curseforge.events[0].providerEventId, "curseforge-file:77");
  assert.equal(calls.find((call) => call.url.includes("curseforge")).headers["x-api-key"], "cf-key");
  assert.equal(steam.events[0].authoritative, false);
  assert.equal(steam.events[0].metadata.serverBuildConfirmed, false);
});

test("CurseForge fails safely without a server-side API key", async () => {
  const registry = createSourceAdapterRegistry({ fetchImpl: async () => { throw new Error("must not fetch"); } });
  const source = validateMonitorSource({ id: "cf", provider: "curseforge-mod", modId: 123 });
  await assert.rejects(() => registry.fetch(source), (error) => error.code === "CURSEFORGE_NOT_CONFIGURED");
});

test("monitor polling deduplicates events, persists metadata, and isolates failures", async () => {
  let calls = 0;
  const registry = { async fetch(source) {
    calls += 1;
    if (source.id === "bad") { const error = new Error("provider down"); error.code = "PROVIDER_TIMEOUT"; error.retryable = true; throw error; }
    return { etag: '"new"', lastModified: null, events: [{ providerEventId: "event:1", publishedAt: "2026-08-03T00:00:00Z" }] };
  }};
  const filePath = join(mkdtempSync(join(tmpdir(), "nexus-monitor-")), "state.json");
  const store = new MonitorStateStore({ filePath });
  const service = new MonitorService({ registry, stateStore: store });
  const sources = [
    { id: "good", provider: "github-release", owner: "a", repo: "b", emitInitialEvents: true },
    { id: "bad", provider: "modrinth-project", project: "broken" },
  ];
  const first = await service.poll({ sources });
  assert.equal(first.newEventCount, 1);
  assert.equal(first.failedSourceCount, 1);
  const second = await service.poll({ sources, ignoreBackoff: true });
  assert.equal(second.results[0].suppressedDuplicates, 1);
  assert.equal(second.results[1].status, "failed");
  assert.ok(JSON.parse(readFileSync(filePath, "utf8")).sources.good);
  assert.equal(calls, 4);
});

test("new sources establish a quiet baseline and source changes reset state", async () => {
  let eventId = "event:old";
  const registry = { async fetch() { return { events: [{ providerEventId: eventId, publishedAt: "2026-08-03T00:00:00Z" }] }; } };
  const store = new MonitorStateStore();
  const service = new MonitorService({ registry, stateStore: store });
  const initial = await service.poll({ sources: [{ id: "source", provider: "github-release", owner: "a", repo: "one" }] });
  assert.equal(initial.newEventCount, 0);
  assert.equal(initial.results[0].baselineEstablished, true);
  assert.equal(initial.results[0].suppressedHistorical, 1);
  eventId = "event:new";
  const changed = await service.poll({ sources: [{ id: "source", provider: "github-release", owner: "a", repo: "two" }] });
  assert.equal(changed.newEventCount, 0);
  assert.equal(changed.results[0].baselineEstablished, true);
});

test("GitHub webhooks validate signatures, repository, delivery, and event deduplication", () => {
  const secret = "It's a Secret to Everybody";
  const store = new MonitorStateStore();
  store.registerSource(validateMonitorSource({ id: "release", provider: "github-release", owner: "Khaos-Krew", repo: "Tool" }));
  const service = new MonitorService({ registry: { fetch() {} }, stateStore: store, githubWebhookSecret: secret, githubWebhooksEnabled: true });
  const payload = Buffer.from(JSON.stringify({
    action: "published",
    repository: { full_name: "Khaos-Krew/Tool" },
    release: { id: 55, tag_name: "v1.0.0", name: "One", body: "Notes", draft: false, prerelease: false, published_at: "2026-08-03T00:00:00Z", html_url: "https://github.com/Khaos-Krew/Tool/releases/tag/v1.0.0" },
  }));
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const accepted = service.handleGithubWebhook({ sourceId: "release", deliveryId: "delivery-1", eventName: "release", signature, rawBody: payload });
  assert.equal(accepted.status, "accepted");
  const duplicate = service.handleGithubWebhook({ sourceId: "release", deliveryId: "delivery-1", eventName: "release", signature, rawBody: payload });
  assert.equal(duplicate.status, "duplicate");
  assert.throws(() => service.handleGithubWebhook({ sourceId: "release", deliveryId: "delivery-2", eventName: "release", signature: "sha256=bad", rawBody: payload }), (error) => error.code === "INVALID_WEBHOOK_SIGNATURE");
});
