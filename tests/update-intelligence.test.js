import assert from "node:assert/strict";
import test from "node:test";
import { createUpdateDigest, evaluateUpdateImpact, quietHourAdvice } from "../src/update-intelligence.js";

function baseResource(overrides = {}) {
  return {
    id: "server:rag:game",
    name: "Ragnarok Server",
    publicName: "Ragnarok",
    type: "game",
    gameKey: "ark",
    scopeId: "ragnarok",
    clusterGroup: "parental-pangea",
    installedVersion: "100",
    runningVersion: "100",
    availableVersion: "100",
    allowedChannels: ["stable"],
    requiredPlatforms: ["steam", "xbox"],
    availablePlatforms: ["steam", "xbox"],
    dependencies: [],
    ...overrides,
  };
}

function baseEvent(overrides = {}) {
  return {
    sourceId: "ark-release",
    providerEventId: "event:101",
    provider: "github-release",
    eventType: "release",
    version: "101",
    releaseChannel: "stable",
    title: "ARK server update",
    changelog: "Crash and performance fixes",
    authoritative: true,
    metadata: {},
    ...overrides,
  };
}

const binding = { sourceId: "ark-release", resourceRefs: ["server:rag:game"] };

test("explicit bindings produce confirmed impacts and stable keys", () => {
  const input = { events: [baseEvent()], resources: [baseResource()], bindings: [binding], subscriptions: [] };
  const first = evaluateUpdateImpact(input);
  const second = evaluateUpdateImpact(input);
  assert.equal(first.alerts[0].confidence, "confirmed");
  assert.equal(first.alerts[0].readyForMaintenance, true);
  assert.equal(first.alerts[0].alertKey, second.alerts[0].alertKey);
  assert.ok(first.alerts[0].categories.includes("crash"));
  assert.ok(first.alerts[0].categories.includes("performance"));
});

test("unmatched events remain visible but cannot prepare maintenance", () => {
  const result = evaluateUpdateImpact({ events: [baseEvent()], resources: [baseResource()], bindings: [], subscriptions: [] });
  const alert = result.alerts[0];
  assert.equal(result.unmatchedEventCount, 1);
  assert.equal(alert.confidence, "unknown");
  assert.equal(alert.readyForMaintenance, false);
  assert.equal(alert.actions.find((item) => item.tool === "updates.prepareMaintenance").enabled, false);
});

test("Steam news cannot confirm a build or maintenance readiness", () => {
  const result = evaluateUpdateImpact({
    events: [baseEvent({ provider: "steam-news", eventType: "news", version: null, authoritative: false })],
    resources: [baseResource()],
    bindings: [binding],
    subscriptions: [],
  });
  assert.equal(result.alerts[0].confidence, "possible");
  assert.equal(result.alerts[0].readyForMaintenance, false);
  assert.match(result.alerts[0].readinessReasons[0], /informational/);
});

test("pin, channel, dependency, platform, running, and cluster drift block readiness", () => {
  const resources = [
    baseResource({ id: "a", name: "ARK Dedicated Server", publicName: "A", pinnedVersion: "100" }),
    baseResource({
      id: "b",
      name: "ARK Dedicated Server",
      publicName: "B",
      scopeId: "b",
      installedVersion: "99",
      runningVersion: "98",
      allowedChannels: ["stable"],
      requiredPlatforms: ["steam", "xbox", "playstation"],
      availablePlatforms: ["steam"],
      dependencies: [{ name: "Library", state: "update_required" }],
    }),
  ];
  const result = evaluateUpdateImpact({
    events: [baseEvent({ releaseChannel: "beta" })],
    resources,
    bindings: [{ sourceId: "ark-release", resourceRefs: ["a", "b"] }],
    subscriptions: [],
  });
  const states = result.alerts[0].resourceImpacts.map((impact) => impact.state);
  assert.ok(states.some((state) => ["PINNED", "IGNORED_CHANNEL", "AWAITING_PLATFORM_RELEASE", "DEPENDENCY_BLOCKED", "RUNNING_VERSION_DRIFT"].includes(state)));
  assert.equal(result.alerts[0].readyForMaintenance, false);
  assert.equal(result.alerts[0].severity, "urgent");
  assert.ok(result.alerts[0].clusterFindings.length > 0);
});

test("only authorized matching subscriptions produce delivery proposals", () => {
  const subscriptions = [
    { id: "staff", authorized: true, minimumSeverity: "attention", gameKeys: ["ark"], destination: { id: "staff-channel", type: "channel", visibility: "private" } },
    { id: "wrong-game", authorized: true, gameKeys: ["minecraft"], destination: { id: "other", type: "channel" } },
    { id: "unauthorized", authorized: false, destination: { id: "bad", type: "channel" } },
  ];
  const result = evaluateUpdateImpact({ events: [baseEvent()], resources: [baseResource()], bindings: [binding], subscriptions });
  assert.equal(result.deliveries.length, 1);
  assert.equal(result.deliveries[0].subscriptionId, "staff");
  assert.equal(result.deliveries[0].projection.resourceImpacts[0].resourceRef, "server:rag:game");
});

test("public projections omit internal resource references and blockers", () => {
  const result = evaluateUpdateImpact({
    events: [baseEvent()],
    resources: [baseResource()],
    bindings: [binding],
    subscriptions: [{ id: "public", authorized: true, destination: { id: "public-channel", type: "channel", visibility: "public" } }],
  });
  const projection = result.deliveries[0].projection;
  assert.equal("resourceImpacts" in projection, false);
  assert.equal("readinessReasons" in projection, false);
  assert.deepEqual(projection.affectedResources, ["Ragnarok"]);
});

test("quiet hours defer non-urgent deliveries and allow configured urgent bypass", () => {
  const quiet = { start: "22:00", end: "07:00", utcOffsetMinutes: 0, bypassSeverity: "urgent" };
  assert.equal(quietHourAdvice(quiet, "attention", "2026-08-03T23:00:00Z").deferred, true);
  assert.equal(quietHourAdvice(quiet, "urgent", "2026-08-03T23:00:00Z").deferred, false);
  assert.equal(quietHourAdvice(quiet, "attention", "2026-08-03T12:00:00Z").deferred, false);
});

test("digest groups severity and preserves empty allowed mentions", () => {
  const evaluation = evaluateUpdateImpact({ events: [baseEvent()], resources: [baseResource()], bindings: [binding], subscriptions: [] });
  const privateDigest = createUpdateDigest({ evaluation, audience: "private" });
  const publicDigest = createUpdateDigest({ evaluation, audience: "public" });
  assert.equal(privateDigest.presentation.type, "update_digest");
  assert.deepEqual(privateDigest.allowedMentions.parse, []);
  assert.equal(publicDigest.presentation.groups[0].alerts[0].resourceImpacts, undefined);
  assert.match(publicDigest.content, /Nexus Update Digest/);
});
