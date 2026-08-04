import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";
import { NexusAiCoreClient } from "../src/client.js";
import { SIDECAR_EXIT_CODES, parseSidecarConfiguration } from "../src/sidecar-config.js";
import { SIDECAR_READY_EVENT, SIDECAR_SHUTDOWN_MESSAGE } from "../src/sidecar-contract.js";

const sidecarPath = fileURLToPath(new URL("../src/sidecar.js", import.meta.url));

function token() {
  return randomBytes(32).toString("hex");
}

function childEnvironment(additions = {}) {
  return {
    ...process.env,
    AI_PROVIDER: "deterministic-local",
    AI_PROVIDER_FALLBACK: "disabled",
    HOST: "127.0.0.1",
    PORT: "0",
    AUTH_REQUIRED: "true",
    NEXUS_AI_CORE_SERVICE_TOKEN: token(),
    GITHUB_WEBHOOKS_ENABLED: "false",
    MONITOR_STATE_FILE: "",
    ...additions,
  };
}

function spawnSidecar(env = childEnvironment()) {
  const child = spawn(process.execPath, [sidecarPath], {
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return { child, env, output: () => ({ stdout, stderr }) };
}

function waitForReadiness(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Sidecar readiness timed out")), timeoutMs);
    const onMessage = (message) => {
      if (message?.event !== SIDECAR_READY_EVENT) return;
      cleanup();
      resolve(message);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Sidecar exited before readiness with code ${code}`));
    };
    function cleanup() {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    }
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

function waitForExit(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve({ code: child.exitCode, signal: child.signalCode });
    const timer = setTimeout(() => reject(new Error("Sidecar exit timed out")), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function stopSidecar(child) {
  if (child.exitCode !== null) return { code: child.exitCode, signal: child.signalCode };
  if (child.connected) child.send({ type: SIDECAR_SHUTDOWN_MESSAGE });
  else child.kill("SIGTERM");
  return waitForExit(child);
}

async function temporaryDirectory() {
  return mkdtemp(join(tmpdir(), "khaos-nexus-ai-core-sidecar-"));
}

test("sidecar configuration requires loopback, strong authentication, and bounded startup fields", () => {
  assert.throws(
    () => parseSidecarConfiguration({ HOST: "0.0.0.0", PORT: "0", NEXUS_AI_CORE_SERVICE_TOKEN: token() }),
    (error) => error.code === "SIDECAR_HOST_REJECTED",
  );
  assert.throws(
    () => parseSidecarConfiguration({ HOST: "127.0.0.1", PORT: "0", NEXUS_AI_CORE_SERVICE_TOKEN: "weak" }),
    (error) => error.code === "SIDECAR_SERVICE_TOKEN_REQUIRED",
  );
  assert.throws(
    () => parseSidecarConfiguration({ HOST: "127.0.0.1", PORT: "0", NEXUS_AI_CORE_SERVICE_TOKEN: token(), NEXUS_AI_CORE_STARTUP_NONCE: "bad nonce" }),
    (error) => error.code === "SIDECAR_NONCE_INVALID",
  );
  assert.throws(
    () => parseSidecarConfiguration({ HOST: "127.0.0.1", PORT: "0", NEXUS_AI_CORE_SERVICE_TOKEN: token(), NEXUS_AI_CORE_READY_FILE: "relative.json" }),
    (error) => error.code === "SIDECAR_READY_FILE_INVALID",
  );
  const parsed = parseSidecarConfiguration({ HOST: "::1", PORT: "0", NEXUS_AI_CORE_SERVICE_TOKEN: token() });
  assert.equal(parsed.host, "::1");
  assert.equal(parsed.port, 0);
});

test("spawned sidecar completes authenticated app-client handshake and graceful shutdown", async () => {
  const directory = await temporaryDirectory();
  const readyFile = join(directory, "ready.json");
  const serviceToken = token();
  const nonce = `smoke-${randomBytes(8).toString("hex")}`;
  const processState = spawnSidecar(childEnvironment({
    NEXUS_AI_CORE_SERVICE_TOKEN: serviceToken,
    NEXUS_AI_CORE_STARTUP_NONCE: nonce,
    NEXUS_AI_CORE_READY_FILE: readyFile,
  }));
  try {
    const readiness = await waitForReadiness(processState.child);
    assert.equal(readiness.event, SIDECAR_READY_EVENT);
    assert.equal(readiness.mode, "desktop-sidecar");
    assert.equal(readiness.startupNonce, nonce);
    assert.equal(readiness.host, "127.0.0.1");
    assert.ok(Number.isInteger(readiness.port) && readiness.port > 0);
    assert.equal(readiness.boundaries.directExecution, false);
    assert.equal(readiness.boundaries.directDiscordConnection, false);
    assert.equal(readiness.boundaries.directDndCallsAllowed, false);
    assert.equal(readiness.monitor.githubWebhooksEnabled, false);

    const client = new NexusAiCoreClient({ endpoint: readiness.endpoint, serviceToken, timeoutMs: 5_000 });
    const health = await client.health();
    assert.equal(health.status, "ok");
    const contracts = await client.contracts();
    assert.equal(contracts.contract.serviceVersion, readiness.serviceVersion);
    const negotiated = await client.negotiate({ requiredCapabilities: ["nexus.help", "nexus.update.poll"] });
    assert.ok(negotiated.capabilities.includes("nexus.help"));
    const answer = await client.assist({ capability: "nexus.help", prompt: "Explain Nexus AI Core." });
    assert.equal(answer.response.allowedMentions.parse.length, 0);
    await assert.rejects(
      () => client.assist({ capability: "dnd.co-dm.draft", prompt: "Run the campaign." }),
      (error) => error.code === "CLIENT_CAPABILITY_REJECTED",
    );

    const readyDocument = JSON.parse(await readFile(readyFile, "utf8"));
    assert.equal(readyDocument.endpoint, readiness.endpoint);
    const serialized = JSON.stringify({ readiness, readyDocument, ...processState.output() });
    assert.equal(serialized.includes(serviceToken), false);
    assert.equal(serialized.includes("OPENAI_API_KEY"), false);

    const stopped = await stopSidecar(processState.child);
    assert.equal(stopped.code, SIDECAR_EXIT_CODES.SUCCESS);
    await assert.rejects(() => stat(readyFile), (error) => error.code === "ENOENT");
  } finally {
    if (processState.child.exitCode === null) processState.child.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
  }
});

test("sidecar exits when its IPC parent disconnects", async () => {
  const processState = spawnSidecar();
  await waitForReadiness(processState.child);
  processState.child.disconnect();
  const result = await waitForExit(processState.child);
  assert.equal(result.code, SIDECAR_EXIT_CODES.PARENT_LOST);
});

test("sidecar parent PID supervision detects an orphan", async () => {
  const processState = spawnSidecar(childEnvironment({
    NEXUS_AI_CORE_PARENT_PID: "2147483646",
    NEXUS_AI_CORE_PARENT_CHECK_INTERVAL_MS: "100",
  }));
  await waitForReadiness(processState.child);
  const result = await waitForExit(processState.child);
  assert.equal(result.code, SIDECAR_EXIT_CODES.PARENT_LOST);
  assert.match(processState.output().stderr, /SIDECAR_PARENT_LOST/);
});

test("sidecar startup collision returns a stable non-secret exit", async () => {
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const port = occupied.address().port;
  const serviceToken = token();
  const processState = spawnSidecar(childEnvironment({ PORT: String(port), NEXUS_AI_CORE_SERVICE_TOKEN: serviceToken }));
  try {
    const result = await waitForExit(processState.child);
    assert.equal(result.code, SIDECAR_EXIT_CODES.STARTUP);
    const output = JSON.stringify(processState.output());
    assert.match(output, /EADDRINUSE|SIDECAR_STARTUP_FAILED/);
    assert.equal(output.includes(serviceToken), false);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});

test("invalid sidecar configuration exits without becoming ready", async () => {
  const processState = spawnSidecar(childEnvironment({ NEXUS_AI_CORE_SERVICE_TOKEN: "weak" }));
  const result = await waitForExit(processState.child);
  assert.equal(result.code, SIDECAR_EXIT_CODES.CONFIGURATION);
  assert.match(processState.output().stderr, /SIDECAR_SERVICE_TOKEN_REQUIRED/);
});
