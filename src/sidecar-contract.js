import { API_VERSION, SERVICE_NAME, SERVICE_VERSION, TARGET_SERVICE } from "./constants.js";
import { CONTRACT_VERSION } from "./service-contract.js";

export const SIDECAR_CONTRACT_VERSION = "1.0.0";
export const SIDECAR_READY_EVENT = "nexus-ai-core.ready";
export const SIDECAR_SHUTDOWN_MESSAGE = "nexus-ai-core.shutdown";

export const SIDECAR_CONTRACT = Object.freeze({
  sidecarContractVersion: SIDECAR_CONTRACT_VERSION,
  service: SERVICE_NAME,
  serviceVersion: SERVICE_VERSION,
  serviceContractVersion: CONTRACT_VERSION,
  apiVersion: API_VERSION,
  targetService: TARGET_SERVICE,
  entrypoint: "src/sidecar.js",
  readinessEvent: SIDECAR_READY_EVENT,
  shutdownMessage: SIDECAR_SHUTDOWN_MESSAGE,
  transport: {
    protocol: "http",
    allowedHosts: ["127.0.0.1", "::1"],
    dynamicPortAllowed: true,
    authenticationRequired: true,
    serviceTokenTransport: "authorization-bearer-header",
  },
  supervision: {
    ipcReadinessSupported: true,
    ipcShutdownSupported: true,
    parentPidSupported: true,
    httpShutdownSupported: false,
    gracefulSignals: ["SIGINT", "SIGTERM"],
  },
  boundaries: {
    directExecution: false,
    directDiscordConnection: false,
    directServiceForwarding: false,
    schedulerOwnedExternally: true,
    githubWebhooksEnabled: false,
    dndService: "Khaos-Krew/Khaos-Nexus-AI",
    dndNamespace: "dnd.*",
    directDndCallsAllowed: false,
  },
  bundle: {
    outputPattern: "dist/sidecar/khaos-nexus-ai-core-<serviceVersion>",
    integrityAlgorithm: "sha256",
    runtimeDependencies: 0,
    publicationAutomatic: false,
  },
  exitCodes: {
    success: 0,
    configuration: 64,
    startup: 70,
    parentLost: 71,
    forcedShutdown: 72,
  },
});

export function sidecarContractSummary() {
  return structuredClone(SIDECAR_CONTRACT);
}

export function createSidecarReadiness({ host, port, startupNonce, providerStatus, monitorAvailable }) {
  return {
    event: SIDECAR_READY_EVENT,
    mode: "desktop-sidecar",
    service: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
    serviceContractVersion: CONTRACT_VERSION,
    sidecarContractVersion: SIDECAR_CONTRACT_VERSION,
    apiVersion: API_VERSION,
    targetService: TARGET_SERVICE,
    pid: process.pid,
    host,
    port,
    endpoint: `http://${host === "::1" ? `[${host}]` : host}:${port}`,
    startupNonce,
    startedAt: new Date().toISOString(),
    providerStatus: {
      name: String(providerStatus?.name ?? "unknown").slice(0, 100),
      model: String(providerStatus?.model ?? "unknown").slice(0, 100),
      ready: providerStatus?.ready === true,
    },
    monitor: {
      available: monitorAvailable === true,
      schedulerOwnedExternally: true,
      githubWebhooksEnabled: false,
    },
    boundaries: structuredClone(SIDECAR_CONTRACT.boundaries),
  };
}
