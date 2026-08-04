#!/usr/bin/env node

import { SIDECAR_EXIT_CODES, SidecarConfigurationError } from "./sidecar-config.js";
import { createSidecarRuntime, sidecarDiagnostic } from "./sidecar-runtime.js";

let runtime = null;
let completed = false;

function finish(code) {
  if (completed) return;
  completed = true;
  process.exitCode = code;
  if (process.connected) {
    try { process.disconnect(); } catch {}
  }
}

async function stop(exitCode = SIDECAR_EXIT_CODES.SUCCESS) {
  if (!runtime) {
    finish(exitCode);
    return;
  }
  const result = await runtime.stop({ exitCode });
  finish(result);
}

async function main() {
  try {
    runtime = createSidecarRuntime({ onExit: finish });
    const readiness = await runtime.start();
    if (process.connected) {
      try { process.send(readiness); } catch {}
    }
  } catch (error) {
    const configurationError = error instanceof SidecarConfigurationError;
    const exitCode = configurationError ? error.exitCode : SIDECAR_EXIT_CODES.STARTUP;
    const code = configurationError ? error.code : (error?.code ?? "SIDECAR_STARTUP_FAILED");
    process.stderr.write(`${sidecarDiagnostic("nexus-ai-core.sidecar-startup-error", code, exitCode)}\n`);
    if (runtime) await stop(exitCode);
    else finish(exitCode);
  }
}

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
process.on("message", (message) => {
  if (runtime?.acceptsShutdownMessage(message)) void stop();
});
process.on("disconnect", () => {
  if (!completed) void stop(SIDECAR_EXIT_CODES.PARENT_LOST);
});

void main();
