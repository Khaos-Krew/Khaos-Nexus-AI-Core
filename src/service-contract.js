import { API_VERSION, CAPABILITIES, SERVICE_NAME, SERVICE_VERSION, TARGET_SERVICE } from "./constants.js";

export const CONTRACT_VERSION = "1.0.0";
export const CONTRACT_SCHEMA_ID = "https://khaos-krew.github.io/khaos-nexus-ai-core/contracts/v1/schema.json";

export const ENDPOINT_REGISTRY = Object.freeze([
  { key: "health", method: "GET", path: "/health", auth: "none", capability: null, clientMethod: "health" },
  { key: "capabilities", method: "GET", path: "/api/v1/capabilities", auth: "service-token", capability: null, clientMethod: "capabilities" },
  { key: "contracts", method: "GET", path: "/api/v1/contracts", auth: "service-token", capability: null, clientMethod: "contracts" },
  { key: "providerStatus", method: "GET", path: "/api/v1/provider/status", auth: "service-token", capability: null, clientMethod: "providerStatus" },
  { key: "monitorState", method: "GET", path: "/api/v1/monitor/state", auth: "service-token", capability: "nexus.update.state", clientMethod: "monitorState" },
  { key: "assist", method: "POST", path: "/api/v1/discord/assist", auth: "service-token", capability: "dynamic-assist", clientMethod: "assist" },
  { key: "compareUpdates", method: "POST", path: "/api/v1/updates/compare", auth: "service-token", capability: "nexus.update.compare", clientMethod: "compareUpdates" },
  { key: "analyzeUpdates", method: "POST", path: "/api/v1/updates/analyze", auth: "service-token", capability: "nexus.update.analyze", clientMethod: "analyzeUpdates" },
  { key: "evaluateUpdates", method: "POST", path: "/api/v1/updates/evaluate", auth: "service-token", capability: "nexus.update.evaluate", clientMethod: "evaluateUpdates" },
  { key: "digestUpdates", method: "POST", path: "/api/v1/updates/digest", auth: "service-token", capability: "nexus.update.digest", clientMethod: "digestUpdates" },
  { key: "pollMonitor", method: "POST", path: "/api/v1/monitor/poll", auth: "service-token", capability: "nexus.update.poll", clientMethod: "pollMonitor" },
  { key: "proposeMaintenance", method: "POST", path: "/api/v1/maintenance/plans", auth: "service-token", capability: "nexus.maintenance.propose", clientMethod: "proposeMaintenance" },
  { key: "summarizeIncident", method: "POST", path: "/api/v1/incidents/summarize", auth: "service-token", capability: "nexus.incident.summarize", clientMethod: "summarizeIncident" },
]);

export const CLIENT_METHOD_REGISTRY = Object.freeze(Object.fromEntries(
  ENDPOINT_REGISTRY.map((endpoint) => [endpoint.clientMethod, endpoint.key]),
));

export const SCHEMA_REFERENCES = Object.freeze({
  requestEnvelope: `${CONTRACT_SCHEMA_ID}#/$defs/requestEnvelope`,
  neutralResponse: `${CONTRACT_SCHEMA_ID}#/$defs/neutralResponse`,
  providerStatus: `${CONTRACT_SCHEMA_ID}#/$defs/providerStatus`,
  monitorPollResult: `${CONTRACT_SCHEMA_ID}#/$defs/monitorPollResult`,
  updateEvaluation: `${CONTRACT_SCHEMA_ID}#/$defs/updateEvaluation`,
  updateDigest: `${CONTRACT_SCHEMA_ID}#/$defs/updateDigest`,
  maintenanceProposal: `${CONTRACT_SCHEMA_ID}#/$defs/maintenanceProposal`,
  errorResponse: `${CONTRACT_SCHEMA_ID}#/$defs/errorResponse`,
});

export const SERVICE_CONTRACT = Object.freeze({
  contractVersion: CONTRACT_VERSION,
  service: SERVICE_NAME,
  serviceVersion: SERVICE_VERSION,
  apiVersion: API_VERSION,
  targetService: TARGET_SERVICE,
  authentication: "bearer-service-token",
  executionAuthority: "khaos-nexus",
  directExecution: false,
  directDiscordConnection: false,
  directServiceForwarding: false,
  schedulerOwnedExternally: true,
  dndIsolation: {
    service: "Khaos-Krew/Khaos-Nexus-AI",
    rejectedNamespace: "dnd.*",
    directCallsAllowed: false,
  },
  compatibility: {
    stableApiMajor: "1",
    additiveMinorChangesAllowed: true,
    breakingChangesRequireNewApiMajor: true,
    unknownCapabilitiesMustBeIgnoredUnlessRequired: true,
  },
  capabilities: [...CAPABILITIES],
  endpoints: ENDPOINT_REGISTRY.map(({ key, method, path, auth, capability, clientMethod }) => ({
    key, method, path, auth, capability, clientMethod,
  })),
  schemas: SCHEMA_REFERENCES,
});

export function serviceContractSummary() {
  return structuredClone(SERVICE_CONTRACT);
}
