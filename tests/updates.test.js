import assert from "node:assert/strict";
import test from "node:test";
import { createMaintenancePlan } from "../src/maintenance.js";
import { compareUpdateResources, compareVersions } from "../src/updates.js";

test("version comparison supports semantic versions and build identifiers", () => {
  assert.equal(compareVersions("1.2.10", "1.2.9"), 1);
  assert.equal(compareVersions("v100", "99"), 1);
  assert.equal(compareVersions("1.0.0", "1.0"), 0);
});

test("update comparison finds platform, dependency, running, and cluster drift", () => {
  const result = compareUpdateResources({ resources: [
    {
      id: "ark-rag-game",
      name: "ARK Dedicated Server",
      type: "game",
      scopeId: "ragnarok",
      clusterGroup: "parental-pangea",
      installedVersion: "100",
      runningVersion: "99",
      availableVersion: "101",
      requiredPlatforms: ["steam", "xbox", "playstation"],
      availablePlatforms: ["steam", "xbox"],
    },
    {
      id: "ark-ast-game",
      name: "ARK Dedicated Server",
      type: "game",
      scopeId: "astraeos",
      clusterGroup: "parental-pangea",
      installedVersion: "101",
      availableVersion: "101",
      requiredPlatforms: ["steam", "xbox", "playstation"],
      availablePlatforms: ["steam", "xbox", "playstation"],
    },
    {
      id: "asr-structures",
      name: "ASR Structures",
      type: "mod",
      installedVersion: "4.2.0",
      availableVersion: "4.2.1",
      dependencies: [{ name: "Shared Library", state: "update_required" }],
    },
  ] });

  assert.equal(result.summary.total, 3);
  assert.equal(result.resources[0].state, "RUNNING_VERSION_DRIFT");
  assert.equal(result.resources[2].state, "DEPENDENCY_BLOCKED");
  assert.equal(result.clusterFindings[0].type, "CLUSTER_VERSION_DRIFT");
});

test("maintenance plans remain blocked proposals and include rollback", () => {
  const plan = createMaintenancePlan({
    resourceRefs: ["server:ragnarok", "server:astraeos"],
    currentPlayers: 12,
    crossPlatformReady: false,
    recentBackupAvailable: false,
  });
  assert.equal(plan.status, "BLOCKED");
  assert.equal(plan.automaticExecutionAllowed, false);
  assert.equal(plan.riskLevel, 3);
  assert.ok(plan.steps.some((step) => step.type === "backup"));
  assert.ok(plan.rollback.steps.length > 0);
});
