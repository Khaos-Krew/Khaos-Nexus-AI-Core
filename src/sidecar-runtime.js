import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createApp } from "./app.js";
import { MonitorService } from "./monitor-service.js";
import { MonitorStateStore } from "./monitor-store.js";
import { createProviderFromEnvironment } from "./provider-factory.js";
import { SIDECAR_EXIT_CODES, isParentAlive, parseSidecarConfiguration } from "./sidecar-config.js";
import { SIDECAR_SHUTDOWN_MESSAGE, createSidecarReadiness } from "./sidecar-contract.js";
import { createSourceAdapterRegistry } from "./source-adapters.js";

export function sidecarDiagnostic(event, code, exitCode) {
  return JSON.stringify({ event, code, exitCode, service: "khaos-nexus-ai-core" });
}

function providerProjection(provider) {
  const value = typeof provider.status === "function" ? provider.status({ detailed: false }) : {};
  return {
    name: value.name ?? provider.name,
    model: value.model ?? provider.model,
    ready: value.ready !== false,
  };
}

async function writeReadinessFile(filePath, readiness) {
  if (!filePath) return "";
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(readiness)}\n`, { encoding: "utf8", mode: 0o600, flag: "w" });
  await rename(temporaryPath, filePath);
  return filePath;
}

export function createSidecarRuntime({
  env = process.env,
  output = process.stdout,
  errorOutput = process.stderr,
  onExit = null,
} = {}) {
  const configuration = parseSidecarConfiguration(env);
  const provider = createProviderFromEnvironment({ env });
  const notifyExit = typeof onExit === "function" ? onExit : () => {};
  const monitorService = new MonitorService({
    registry: createSourceAdapterRegistry({
      githubToken: env.GITHUB_API_TOKEN ?? "",
      curseForgeApiKey: env.CURSEFORGE_API_KEY ?? "",
    }),
    stateStore: new MonitorStateStore({ filePath: configuration.monitorStateFile }),
    githubWebhookSecret: "",
    githubWebhooksEnabled: false,
  });
  const server = createApp({
    provider,
    monitorService,
    serviceToken: configuration.serviceToken,
    authRequired: true,
    corsOrigin: configuration.corsOrigin,
    rateLimit: { limit: configuration.rateLimitPerMinute },
  });

  let readyFile = "";
  let parentTimer = null;
  let forcedTimer = null;
  let stopping = false;

  async function stop({ exitCode = SIDECAR_EXIT_CODES.SUCCESS } = {}) {
    if (stopping) return exitCode;
    stopping = true;
    if (parentTimer) clearInterval(parentTimer);
    if (readyFile) await rm(readyFile, { force: true }).catch(() => {});
    if (!server.listening) {
      notifyExit(exitCode);
      return exitCode;
    }

    return new Promise((resolve) => {
      forcedTimer = setTimeout(() => {
        errorOutput.write(`${sidecarDiagnostic("nexus-ai-core.sidecar-forced-shutdown", "SIDECAR_FORCED_SHUTDOWN", SIDECAR_EXIT_CODES.FORCED_SHUTDOWN)}\n`);
        server.closeAllConnections?.();
        notifyExit(SIDECAR_EXIT_CODES.FORCED_SHUTDOWN);
        resolve(SIDECAR_EXIT_CODES.FORCED_SHUTDOWN);
      }, configuration.shutdownGraceMs);
      forcedTimer.unref?.();
      server.close((error) => {
        clearTimeout(forcedTimer);
        const result = error ? SIDECAR_EXIT_CODES.FORCED_SHUTDOWN : exitCode;
        notifyExit(result);
        resolve(result);
      });
      server.closeIdleConnections?.();
    });
  }

  async function start() {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(configuration.port, configuration.host, resolve);
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : configuration.port;
    const readiness = createSidecarReadiness({
      host: configuration.host,
      port,
      startupNonce: configuration.startupNonce,
      providerStatus: providerProjection(provider),
      monitorAvailable: true,
    });
    readyFile = await writeReadinessFile(configuration.readyFile, readiness);
    output.write(`${JSON.stringify(readiness)}\n`);

    if (configuration.parentPid > 0) {
      parentTimer = setInterval(() => {
        if (!isParentAlive(configuration.parentPid)) {
          errorOutput.write(`${sidecarDiagnostic("nexus-ai-core.sidecar-parent-lost", "SIDECAR_PARENT_LOST", SIDECAR_EXIT_CODES.PARENT_LOST)}\n`);
          void stop({ exitCode: SIDECAR_EXIT_CODES.PARENT_LOST });
        }
      }, configuration.parentCheckIntervalMs);
      parentTimer.unref?.();
    }
    return readiness;
  }

  function acceptsShutdownMessage(message) {
    return message?.type === SIDECAR_SHUTDOWN_MESSAGE;
  }

  return Object.freeze({ configuration, provider, monitorService, server, start, stop, acceptsShutdownMessage });
}
