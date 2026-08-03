import { validationError } from "./errors.js";
import { stableHash } from "./security.js";

export function createMaintenancePlan(input) {
  if (!input || !Array.isArray(input.resourceRefs) || input.resourceRefs.length === 0) {
    throw validationError("resourceRefs must be a non-empty array", "resourceRefs");
  }
  const resourceRefs = [...new Set(input.resourceRefs.map(String).map((value) => value.trim()).filter(Boolean))];
  const warningMinutes = Number.isInteger(input.warningMinutes) && input.warningMinutes >= 0
    ? Math.min(input.warningMinutes, 120)
    : 10;
  const currentPlayers = Number.isInteger(input.currentPlayers) && input.currentPlayers >= 0 ? input.currentPlayers : 0;
  const blockers = Array.isArray(input.blockers) ? input.blockers.map(String).filter(Boolean) : [];
  if (input.crossPlatformReady === false) blockers.push("Required platform releases are not ready");
  if (input.compatibilityState === "unknown") blockers.push("Compatibility state is unknown");
  if (input.recentBackupAvailable === false) blockers.push("No recent verified backup is available");

  const steps = [
    { order: 1, type: "verify", action: "Recheck game, mod, dependency, and platform readiness" },
    { order: 2, type: "notify", action: `Publish a maintenance warning ${warningMinutes} minutes before execution` },
    { order: 3, type: "guard", action: "Acquire the shared scheduler maintenance lock" },
    { order: 4, type: "save", action: "Request a game-safe save through the registered server adapter" },
    { order: 5, type: "backup", action: "Create and verify a pre-update backup" },
    { order: 6, type: "stop", action: "Stop the server through the registered adapter" },
    { order: 7, type: "update", action: "Apply only approved game and mod versions" },
    { order: 8, type: "verify", action: "Validate installed versions and file identities" },
    { order: 9, type: "start", action: "Start the server through the registered adapter" },
    { order: 10, type: "health", action: "Verify process, adapter, RCON/API, and expected version health" },
    { order: 11, type: "observe", action: "Observe the server before continuing a staged rollout" },
    { order: 12, type: "notify", action: "Publish a per-resource completion or partial-failure result" },
  ];

  const basePlan = {
    status: blockers.length > 0 ? "BLOCKED" : "PROPOSED",
    executionAuthority: "khaos-nexus-shared-scheduler",
    automaticExecutionAllowed: false,
    resourceRefs,
    ordered: input.ordered !== false,
    warningMinutes,
    currentPlayers,
    riskLevel: currentPlayers > 0 ? 3 : 2,
    requiresConfirmation: true,
    blockers: [...new Set(blockers)],
    steps,
    rollback: {
      automatic: false,
      steps: [
        "Stop the failed server safely",
        "Restore approved binaries, mod file IDs, and configuration snapshot",
        "Restore save data only after a separate high-risk confirmation",
        "Start and verify the rolled-back server",
      ],
    },
  };

  return { ...basePlan, immutableHash: stableHash(basePlan) };
}
