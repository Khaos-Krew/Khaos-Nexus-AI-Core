import { DISCORD_ALLOWED_MENTIONS } from "./constants.js";
import { validationError } from "./errors.js";
import { sanitizeDiscordText, sanitizeExternalText, stableHash } from "./security.js";
import { compareUpdateResources } from "./updates.js";

const SEVERITIES = ["informational", "attention", "urgent", "critical"];
const CONFIDENCE = new Set(["confirmed", "likely", "possible", "unknown"]);
const IMPACT_CATEGORIES = new Set([
  "security", "crash", "performance", "gameplay", "content", "save_migration",
  "config_migration", "dependency", "compatibility", "breaking", "informational",
]);
const BLOCKED_STATES = new Set([
  "PINNED", "IGNORED_CHANNEL", "AWAITING_PLATFORM_RELEASE",
  "DEPENDENCY_BLOCKED", "RUNNING_VERSION_DRIFT",
]);

function cleanString(value, field, max = 200, required = true) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (required && !normalized) throw validationError(`${field} is required`, field);
  return sanitizeExternalText(normalized, max);
}

function uniqueStrings(value, maxItems = 100) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, maxItems)
    : [];
}

function severityRank(value) {
  const index = SEVERITIES.indexOf(value);
  return index < 0 ? 0 : index;
}

function maxSeverity(values) {
  return values.reduce((current, value) => severityRank(value) > severityRank(current) ? value : current, "informational");
}

function normalizeEvent(event, index) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw validationError("Each event must be an object", `events[${index}]`);
  const providerEventId = cleanString(event.providerEventId, `events[${index}].providerEventId`);
  const sourceId = cleanString(event.sourceId, `events[${index}].sourceId`);
  const provider = cleanString(event.provider, `events[${index}].provider`, 100);
  const eventType = cleanString(event.eventType ?? "release", `events[${index}].eventType`, 100);
  const releaseChannel = cleanString(event.releaseChannel ?? "stable", `events[${index}].releaseChannel`, 30);
  return {
    sourceId,
    providerEventId,
    provider,
    eventType,
    version: event.version === null || event.version === undefined ? null : cleanString(String(event.version), `events[${index}].version`, 100),
    releaseChannel,
    title: cleanString(event.title ?? providerEventId, `events[${index}].title`, 200),
    changelog: sanitizeExternalText(event.changelog ?? "", 6000),
    publishedAt: event.publishedAt ?? null,
    authoritative: event.authoritative === true,
    metadata: event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata : {},
  };
}

function normalizeBinding(binding, index) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw validationError("Each binding must be an object", `bindings[${index}]`);
  return {
    sourceId: cleanString(binding.sourceId, `bindings[${index}].sourceId`),
    providerEventIds: uniqueStrings(binding.providerEventIds, 200),
    resourceRefs: uniqueStrings(binding.resourceRefs, 500),
  };
}

function normalizeResource(resource, index) {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) throw validationError("Each resource must be an object", `resources[${index}]`);
  const id = cleanString(resource.id, `resources[${index}].id`);
  const installedVersion = cleanString(String(resource.installedVersion ?? ""), `resources[${index}].installedVersion`, 100);
  return {
    ...resource,
    id,
    name: cleanString(resource.name ?? id, `resources[${index}].name`, 200),
    publicName: cleanString(resource.publicName ?? resource.name ?? "Affected resource", `resources[${index}].publicName`, 200),
    type: cleanString(resource.type, `resources[${index}].type`, 50),
    installedVersion,
    runningVersion: cleanString(String(resource.runningVersion ?? installedVersion), `resources[${index}].runningVersion`, 100),
    availableVersion: cleanString(String(resource.availableVersion ?? installedVersion), `resources[${index}].availableVersion`, 100),
    allowedChannels: uniqueStrings(resource.allowedChannels?.length ? resource.allowedChannels : ["stable"], 10),
    requiredPlatforms: uniqueStrings(resource.requiredPlatforms, 50),
    availablePlatforms: uniqueStrings(resource.availablePlatforms, 50),
    dependencies: Array.isArray(resource.dependencies) ? resource.dependencies.slice(0, 100) : [],
    pinnedVersion: resource.pinnedVersion ? cleanString(String(resource.pinnedVersion), `resources[${index}].pinnedVersion`, 100) : null,
    scopeId: resource.scopeId ? cleanString(String(resource.scopeId), `resources[${index}].scopeId`, 200) : null,
    clusterGroup: resource.clusterGroup ? cleanString(String(resource.clusterGroup), `resources[${index}].clusterGroup`, 200) : null,
    gameKey: resource.gameKey ? cleanString(String(resource.gameKey), `resources[${index}].gameKey`, 100) : null,
  };
}

function explicitCategories(event) {
  const categories = uniqueStrings(event.metadata?.impactCategories, 20).filter((category) => IMPACT_CATEGORIES.has(category));
  return new Set(categories);
}

function inferCategories(event) {
  const categories = explicitCategories(event);
  const text = `${event.title} ${event.changelog}`.toLowerCase();
  const checks = [
    ["security", /\b(security|cve|vulnerabilit|exploit)\b/],
    ["crash", /\b(crash|freeze|fatal|hang)\b/],
    ["performance", /\b(performance|optimization|optimisation|lag|latency)\b/],
    ["save_migration", /\b(save migration|save format|world conversion)\b/],
    ["config_migration", /\b(config migration|configuration migration|rename.*setting)\b/],
    ["dependency", /\b(dependency|requires|library update)\b/],
    ["compatibility", /\b(compatib|client.?server|crossplay|platform)\b/],
    ["breaking", /\b(breaking change|not backward compatible|incompatible)\b/],
    ["gameplay", /\b(gameplay|balance|mechanic)\b/],
    ["content", /\b(content|map|item|creature|feature)\b/],
  ];
  for (const [category, pattern] of checks) if (pattern.test(text)) categories.add(category);
  if (categories.size === 0) categories.add(event.eventType === "news" ? "informational" : "content");
  return [...categories];
}

function confidenceFor(event, boundCount) {
  if (boundCount === 0) return "unknown";
  if (event.authoritative && event.version) return "confirmed";
  if (event.authoritative) return "likely";
  return "possible";
}

function severityFor(event, comparison, categories) {
  const states = comparison.resources.map((resource) => resource.state);
  const hasUpdate = comparison.resources.some((resource) => resource.updateAvailable);
  const explicitlyCritical = event.authoritative && event.metadata?.severity === "critical";
  const securityAdvisory = event.authoritative && event.metadata?.securityAdvisory === true && categories.includes("security");
  if (explicitlyCritical || securityAdvisory) return "critical";
  if (states.some((state) => BLOCKED_STATES.has(state)) || categories.some((category) => ["security", "save_migration", "config_migration", "breaking"].includes(category))) return "urgent";
  if (hasUpdate || (event.authoritative && event.eventType === "release")) return "attention";
  return "informational";
}

function action(alertKey, tool, riskLevel, enabled = true, reason = null) {
  return {
    actionKey: stableHash({ alertKey, tool }),
    tool,
    riskLevel,
    requiresConfirmation: riskLevel >= 2,
    enabled,
    reason,
  };
}

function publicProjection(event, severity, categories, resourceImpacts, readyForMaintenance) {
  return {
    title: event.title,
    version: event.version,
    severity,
    categories,
    affectedResourceCount: resourceImpacts.length,
    affectedResources: resourceImpacts.map((impact) => impact.publicName).slice(0, 10),
    maintenanceReady: readyForMaintenance,
    authoritative: event.authoritative,
  };
}

function summarizeAlert(event, impacts, ready) {
  const count = impacts.length;
  if (count === 0) return `${event.title} was detected but has no explicit local resource binding.`;
  const stateSummary = [...new Set(impacts.map((impact) => impact.state))].join(", ");
  return `${event.title}${event.version ? ` (${event.version})` : ""} affects ${count} bound resource${count === 1 ? "" : "s"}. State: ${stateSummary}. Maintenance ${ready ? "is ready for local review" : "is not ready"}.`;
}

function findBinding(event, bindings) {
  return bindings.filter((binding) => binding.sourceId === event.sourceId && (binding.providerEventIds.length === 0 || binding.providerEventIds.includes(event.providerEventId)));
}

function createAlert(event, bindings, resourceMap) {
  const matchingBindings = findBinding(event, bindings);
  const resourceRefs = [...new Set(matchingBindings.flatMap((binding) => binding.resourceRefs))];
  const boundResources = resourceRefs.map((ref) => resourceMap.get(ref)).filter(Boolean);
  const categories = inferCategories(event);
  const confidence = confidenceFor(event, boundResources.length);

  let comparison = { resources: [], clusterFindings: [] };
  if (boundResources.length) {
    comparison = compareUpdateResources({
      resources: boundResources.map((resource) => ({
        ...resource,
        availableVersion: event.authoritative && event.version ? event.version : resource.availableVersion,
        releaseChannel: event.releaseChannel,
      })),
    });
  }
  const severity = severityFor(event, comparison, categories);
  const authoritativeVersion = event.authoritative && Boolean(event.version);
  const readyForMaintenance = authoritativeVersion
    && comparison.resources.some((resource) => resource.updateAvailable)
    && comparison.resources.every((resource) => resource.ready)
    && comparison.clusterFindings.length === 0;
  const reasons = [];
  if (!event.authoritative) reasons.push("Provider event is informational and cannot confirm an installable build.");
  if (!event.version) reasons.push("Event does not provide a version.");
  if (boundResources.length === 0) reasons.push("No explicit local resource binding exists.");
  reasons.push(...comparison.resources.flatMap((resource) => resource.blockers.map((blocker) => `${resource.name}: ${blocker}`)));
  if (comparison.clusterFindings.length) reasons.push("Cluster version drift must be resolved.");

  const resourceImpacts = comparison.resources.map((resource) => ({
    resourceRef: resource.id,
    name: resource.name,
    publicName: resource.publicName ?? resource.name,
    gameKey: resource.gameKey ?? null,
    scopeId: resource.scopeId,
    clusterGroup: resource.clusterGroup,
    installedVersion: resource.installedVersion,
    runningVersion: resource.runningVersion,
    availableVersion: resource.availableVersion,
    state: resource.state,
    ready: resource.ready,
    updateAvailable: resource.updateAvailable,
    blockers: resource.blockers,
    warnings: resource.warnings,
  }));
  const alertKey = stableHash({
    providerEventId: event.providerEventId,
    resourceRefs: resourceImpacts.map((impact) => impact.resourceRef).sort(),
    version: event.version,
  });
  const actions = [
    action(alertKey, "updates.view", 0),
    action(alertKey, "updates.acknowledge", 1),
    action(alertKey, "updates.prepareMaintenance", 2, readyForMaintenance, readyForMaintenance ? null : reasons[0] ?? "Maintenance is not ready."),
    action(alertKey, "updates.ignoreVersion", 2, authoritativeVersion, authoritativeVersion ? null : "No authoritative version is available."),
    action(alertKey, "updates.pinVersion", 2, authoritativeVersion, authoritativeVersion ? null : "No authoritative version is available."),
    action(alertKey, "updates.subscribe", 1),
  ];
  const summary = summarizeAlert(event, resourceImpacts, readyForMaintenance);
  return {
    alertKey,
    sourceId: event.sourceId,
    providerEventId: event.providerEventId,
    provider: event.provider,
    eventType: event.eventType,
    releaseChannel: event.releaseChannel,
    publishedAt: event.publishedAt,
    severity,
    confidence: CONFIDENCE.has(confidence) ? confidence : "unknown",
    categories,
    title: event.title,
    version: event.version,
    summary: sanitizeDiscordText(summary).slice(0, 1000),
    authoritative: event.authoritative,
    readyForMaintenance,
    readinessReasons: reasons.slice(0, 50),
    resourceImpacts,
    clusterFindings: comparison.clusterFindings,
    public: publicProjection(event, severity, categories, resourceImpacts, readyForMaintenance),
    actions,
    presentation: {
      type: "update_alert",
      severity,
      allowedMentions: DISCORD_ALLOWED_MENTIONS,
      fields: [
        { name: "Version", value: event.version ?? "Not provided" },
        { name: "Affected", value: String(resourceImpacts.length) },
        { name: "Readiness", value: readyForMaintenance ? "Ready for review" : "Not ready" },
      ],
    },
  };
}

function normalizeSubscription(subscription, index) {
  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) throw validationError("Each subscription must be an object", `subscriptions[${index}]`);
  const destination = subscription.destination && typeof subscription.destination === "object" ? subscription.destination : {};
  return {
    id: cleanString(subscription.id, `subscriptions[${index}].id`),
    authorized: subscription.authorized === true,
    minimumSeverity: SEVERITIES.includes(subscription.minimumSeverity) ? subscription.minimumSeverity : "informational",
    sourceIds: uniqueStrings(subscription.sourceIds),
    providers: uniqueStrings(subscription.providers),
    eventTypes: uniqueStrings(subscription.eventTypes),
    releaseChannels: uniqueStrings(subscription.releaseChannels),
    resourceRefs: uniqueStrings(subscription.resourceRefs, 500),
    gameKeys: uniqueStrings(subscription.gameKeys),
    scopeIds: uniqueStrings(subscription.scopeIds),
    destination: {
      id: cleanString(destination.id, `subscriptions[${index}].destination.id`),
      type: cleanString(destination.type ?? "channel", `subscriptions[${index}].destination.type`, 50),
      visibility: destination.visibility === "public" ? "public" : "private",
    },
    quietHours: subscription.quietHours && typeof subscription.quietHours === "object" ? subscription.quietHours : null,
  };
}

function includesOrAny(filter, values) {
  return filter.length === 0 || values.some((value) => filter.includes(value));
}

function matchesSubscription(alert, subscription) {
  if (!subscription.authorized || severityRank(alert.severity) < severityRank(subscription.minimumSeverity)) return false;
  if (!includesOrAny(subscription.sourceIds, [alert.sourceId])) return false;
  if (!includesOrAny(subscription.providers, [alert.provider])) return false;
  if (!includesOrAny(subscription.eventTypes, [alert.eventType])) return false;
  if (!includesOrAny(subscription.releaseChannels, [alert.releaseChannel])) return false;
  if (!includesOrAny(subscription.resourceRefs, alert.resourceImpacts.map((impact) => impact.resourceRef))) return false;
  if (!includesOrAny(subscription.gameKeys, alert.resourceImpacts.map((impact) => impact.gameKey).filter(Boolean))) return false;
  if (!includesOrAny(subscription.scopeIds, alert.resourceImpacts.map((impact) => impact.scopeId).filter(Boolean))) return false;
  return true;
}

function parseClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

export function quietHourAdvice(quietHours, severity, nowValue = new Date().toISOString()) {
  if (!quietHours) return { deferred: false, deferUntil: null };
  const start = parseClock(quietHours.start);
  const end = parseClock(quietHours.end);
  const offset = Number.isInteger(quietHours.utcOffsetMinutes) ? Math.min(Math.max(quietHours.utcOffsetMinutes, -840), 840) : 0;
  if (start === null || end === null || start === end) return { deferred: false, deferUntil: null };
  const bypassSeverity = SEVERITIES.includes(quietHours.bypassSeverity) ? quietHours.bypassSeverity : "critical";
  if (severityRank(severity) >= severityRank(bypassSeverity)) return { deferred: false, deferUntil: null };
  const nowMs = Date.parse(nowValue);
  if (!Number.isFinite(nowMs)) throw validationError("now must be an ISO timestamp", "now");
  const local = new Date(nowMs + offset * 60_000);
  const localMinutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const inQuiet = start < end ? localMinutes >= start && localMinutes < end : localMinutes >= start || localMinutes < end;
  if (!inQuiet) return { deferred: false, deferUntil: null };
  let minutesUntilEnd;
  if (start < end) minutesUntilEnd = end - localMinutes;
  else if (localMinutes < end) minutesUntilEnd = end - localMinutes;
  else minutesUntilEnd = (24 * 60 - localMinutes) + end;
  return { deferred: true, deferUntil: new Date(nowMs + minutesUntilEnd * 60_000).toISOString() };
}

function createDeliveries(alerts, subscriptions, now) {
  const deliveries = [];
  for (const alert of alerts) {
    for (const subscription of subscriptions) {
      if (!matchesSubscription(alert, subscription)) continue;
      const quiet = quietHourAdvice(subscription.quietHours, alert.severity, now);
      const projection = subscription.destination.visibility === "public" ? alert.public : {
        ...alert.public,
        summary: alert.summary,
        resourceImpacts: alert.resourceImpacts,
        readinessReasons: alert.readinessReasons,
      };
      deliveries.push({
        deliveryKey: stableHash({ alertKey: alert.alertKey, destinationId: subscription.destination.id }),
        alertKey: alert.alertKey,
        subscriptionId: subscription.id,
        destination: subscription.destination,
        projection,
        deferred: quiet.deferred,
        deferUntil: quiet.deferUntil,
      });
    }
  }
  return deliveries;
}

export function evaluateUpdateImpact(input) {
  if (!input || !Array.isArray(input.events) || input.events.length === 0) throw validationError("events must be a non-empty array", "events");
  if (!Array.isArray(input.resources)) throw validationError("resources must be an array", "resources");
  if (!Array.isArray(input.bindings)) throw validationError("bindings must be an array", "bindings");
  if (input.events.length > 200 || input.resources.length > 500 || input.bindings.length > 500) throw validationError("Input collection exceeds the supported limit", "body");
  const events = input.events.map(normalizeEvent);
  const resources = input.resources.map(normalizeResource);
  const bindings = input.bindings.map(normalizeBinding);
  const subscriptions = Array.isArray(input.subscriptions) ? input.subscriptions.map(normalizeSubscription) : [];
  const resourceMap = new Map(resources.map((resource) => [resource.id, resource]));
  const alerts = events.map((event) => createAlert(event, bindings, resourceMap));
  const now = input.now ?? new Date().toISOString();
  const deliveries = createDeliveries(alerts, subscriptions, now);
  return {
    evaluatedAt: now,
    alertCount: alerts.length,
    matchedAlertCount: alerts.filter((alert) => alert.resourceImpacts.length > 0).length,
    unmatchedEventCount: alerts.filter((alert) => alert.resourceImpacts.length === 0).length,
    deliveryCount: deliveries.length,
    highestSeverity: maxSeverity(alerts.map((alert) => alert.severity)),
    alerts,
    deliveries,
  };
}

function digestLine(alert, audience) {
  const projection = audience === "public" ? alert.public : alert;
  const version = projection.version ? ` ${projection.version}` : "";
  return `• [${projection.severity.toUpperCase()}] ${projection.title}${version} — ${projection.affectedResourceCount ?? projection.resourceImpacts?.length ?? 0} affected`;
}

export function createUpdateDigest(input) {
  const evaluation = input.evaluation?.alerts ? input.evaluation : evaluateUpdateImpact(input);
  const audience = input.audience === "public" ? "public" : "private";
  const maxItems = Number.isInteger(input.maxItems) ? Math.min(Math.max(input.maxItems, 1), 50) : 20;
  const alerts = [...evaluation.alerts].sort((left, right) => severityRank(right.severity) - severityRank(left.severity)).slice(0, maxItems);
  const grouped = SEVERITIES.slice().reverse().map((severity) => ({
    severity,
    alerts: alerts.filter((alert) => alert.severity === severity).map((alert) => audience === "public" ? alert.public : alert),
  })).filter((group) => group.alerts.length > 0);
  const content = sanitizeDiscordText([
    "Nexus Update Digest",
    `Alerts: ${evaluation.alertCount} · Deliveries: ${evaluation.deliveryCount} · Highest severity: ${evaluation.highestSeverity}`,
    "",
    ...alerts.map((alert) => digestLine(alert, audience)),
  ].join("\n")).slice(0, 6000);
  const digestKey = stableHash({ digest: alerts.map((alert) => alert.alertKey) });
  const maintenanceReady = alerts.some((alert) => alert.readyForMaintenance);
  return {
    audience,
    content,
    allowedMentions: DISCORD_ALLOWED_MENTIONS,
    presentation: { type: "update_digest", severity: evaluation.highestSeverity, groups: grouped },
    actions: [
      action(digestKey, "updates.viewAll", 0),
      action(digestKey, "updates.prepareMaintenance", 2, maintenanceReady, maintenanceReady ? null : "No digest item is ready for maintenance."),
    ],
    meta: {
      truncated: evaluation.alertCount > maxItems,
      includedAlerts: alerts.length,
      totalAlerts: evaluation.alertCount,
    },
  };
}
