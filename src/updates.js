import { validationError } from "./errors.js";

const RESOURCE_TYPES = new Set(["game", "mod", "mod-loader", "server-tool"]);
const RELEASE_CHANNELS = new Set(["stable", "beta", "alpha", "custom"]);
const DEPENDENCY_BLOCKERS = new Set(["missing", "incompatible", "update_required"]);

function versionParts(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^v/, "")
    .split(/[.+\-_/]/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    if (av === bv) continue;
    if (typeof av === "number" && typeof bv === "number") return av > bv ? 1 : -1;
    if (typeof av === "number") return 1;
    if (typeof bv === "number") return -1;
    const compared = String(av).localeCompare(String(bv), "en", { numeric: true, sensitivity: "base" });
    if (compared !== 0) return compared > 0 ? 1 : -1;
  }
  return 0;
}

function normalizeResource(resource, index) {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw validationError("Each resource must be an object", `resources[${index}]`);
  }
  const id = String(resource.id ?? "").trim();
  const name = String(resource.name ?? "").trim();
  const publicName = String(resource.publicName ?? name).trim();
  const gameKey = String(resource.gameKey ?? "").trim() || null;
  const type = String(resource.type ?? "").trim();
  const installedVersion = String(resource.installedVersion ?? "").trim();
  const availableVersion = String(resource.availableVersion ?? "").trim();
  const releaseChannel = String(resource.releaseChannel ?? "stable").trim().toLowerCase();
  if (!id) throw validationError("resource id is required", `resources[${index}].id`);
  if (!name) throw validationError("resource name is required", `resources[${index}].name`);
  if (!publicName) throw validationError("publicName is required when supplied", `resources[${index}].publicName`);
  if (!RESOURCE_TYPES.has(type)) throw validationError("Unsupported resource type", `resources[${index}].type`);
  if (!installedVersion) throw validationError("installedVersion is required", `resources[${index}].installedVersion`);
  if (!availableVersion) throw validationError("availableVersion is required", `resources[${index}].availableVersion`);
  if (!RELEASE_CHANNELS.has(releaseChannel)) throw validationError("Unsupported releaseChannel", `resources[${index}].releaseChannel`);

  return {
    id,
    name,
    publicName,
    gameKey,
    type,
    scopeId: String(resource.scopeId ?? "").trim() || null,
    clusterGroup: String(resource.clusterGroup ?? "").trim() || null,
    installedVersion,
    runningVersion: String(resource.runningVersion ?? installedVersion).trim(),
    availableVersion,
    releaseChannel,
    allowedChannels: Array.isArray(resource.allowedChannels) && resource.allowedChannels.length > 0
      ? resource.allowedChannels.map((item) => String(item).toLowerCase())
      : ["stable"],
    requiredPlatforms: Array.isArray(resource.requiredPlatforms) ? resource.requiredPlatforms.map(String) : [],
    availablePlatforms: Array.isArray(resource.availablePlatforms) ? resource.availablePlatforms.map(String) : [],
    dependencies: Array.isArray(resource.dependencies) ? resource.dependencies : [],
    pinnedVersion: resource.pinnedVersion ? String(resource.pinnedVersion) : null,
  };
}

function evaluateResource(resource) {
  const blockers = [];
  const warnings = [];
  let state = "CURRENT";

  if (resource.pinnedVersion && compareVersions(resource.installedVersion, resource.pinnedVersion) === 0
      && compareVersions(resource.availableVersion, resource.pinnedVersion) !== 0) {
    state = "PINNED";
    warnings.push(`Pinned to ${resource.pinnedVersion}`);
  } else if (!resource.allowedChannels.includes(resource.releaseChannel)) {
    state = "IGNORED_CHANNEL";
    warnings.push(`${resource.releaseChannel} releases are not allowed by policy`);
  }

  const missingPlatforms = resource.requiredPlatforms.filter((platform) => !resource.availablePlatforms.includes(platform));
  if (missingPlatforms.length > 0) {
    state = "AWAITING_PLATFORM_RELEASE";
    blockers.push(`Missing platform releases: ${missingPlatforms.join(", ")}`);
  }

  const blockedDependencies = resource.dependencies.filter((dependency) => DEPENDENCY_BLOCKERS.has(dependency?.state));
  if (blockedDependencies.length > 0) {
    state = "DEPENDENCY_BLOCKED";
    blockers.push(...blockedDependencies.map((dependency) => `${dependency.name ?? "Dependency"}: ${dependency.state}`));
  }

  if (compareVersions(resource.runningVersion, resource.installedVersion) !== 0) {
    state = "RUNNING_VERSION_DRIFT";
    blockers.push(`Running ${resource.runningVersion}, installed ${resource.installedVersion}`);
  } else if (state === "CURRENT") {
    const comparison = compareVersions(resource.availableVersion, resource.installedVersion);
    if (comparison > 0) state = "UPDATE_AVAILABLE";
    if (comparison < 0) state = "AHEAD_OF_SOURCE";
  }

  return {
    ...resource,
    state,
    updateAvailable: compareVersions(resource.availableVersion, resource.installedVersion) > 0,
    blockers,
    warnings,
    ready: blockers.length === 0 && ["CURRENT", "UPDATE_AVAILABLE"].includes(state),
  };
}

function clusterFindings(resources) {
  const groups = new Map();
  for (const resource of resources) {
    if (!resource.clusterGroup) continue;
    const key = `${resource.clusterGroup}:${resource.type}:${resource.name.toLowerCase()}`;
    const entries = groups.get(key) ?? [];
    entries.push(resource);
    groups.set(key, entries);
  }
  return [...groups.entries()].flatMap(([key, entries]) => {
    const versions = [...new Set(entries.map((entry) => entry.installedVersion))];
    if (versions.length <= 1) return [];
    return [{
      type: "CLUSTER_VERSION_DRIFT",
      key,
      clusterGroup: entries[0].clusterGroup,
      resourceName: entries[0].name,
      versions,
      scopes: entries.map((entry) => ({ scopeId: entry.scopeId, installedVersion: entry.installedVersion })),
    }];
  });
}

export function compareUpdateResources(input) {
  if (!input || !Array.isArray(input.resources) || input.resources.length === 0) {
    throw validationError("resources must be a non-empty array", "resources");
  }
  if (input.resources.length > 500) throw validationError("resources cannot exceed 500 items", "resources");

  const resources = input.resources.map(normalizeResource).map(evaluateResource);
  const clusters = clusterFindings(resources);
  const counts = resources.reduce((summary, resource) => {
    summary[resource.state] = (summary[resource.state] ?? 0) + 1;
    return summary;
  }, {});
  const blockers = resources.flatMap((resource) => resource.blockers.map((message) => ({ resourceId: resource.id, message })));

  return {
    requestId: typeof input.requestId === "string" ? input.requestId : null,
    checkedAt: new Date().toISOString(),
    resources,
    clusterFindings: clusters,
    summary: {
      total: resources.length,
      updateAvailable: resources.filter((resource) => resource.updateAvailable).length,
      ready: resources.filter((resource) => resource.ready).length,
      blocked: blockers.length,
      states: counts,
    },
    blockers,
  };
}
