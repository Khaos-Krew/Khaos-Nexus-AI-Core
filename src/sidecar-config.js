import { isAbsolute, resolve } from "node:path";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);
const NONCE_PATTERN = /^[A-Za-z0-9._:-]{0,128}$/;

export const SIDECAR_EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  CONFIGURATION: 64,
  STARTUP: 70,
  PARENT_LOST: 71,
  FORCED_SHUTDOWN: 72,
});

export class SidecarConfigurationError extends Error {
  constructor(message, code = "SIDECAR_CONFIGURATION_INVALID") {
    super(message);
    this.name = "SidecarConfigurationError";
    this.code = code;
    this.exitCode = SIDECAR_EXIT_CODES.CONFIGURATION;
  }
}

function parseInteger(value, fallback, { min, max, name }) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || String(parsed) !== String(value).trim() || parsed < min || parsed > max) {
    throw new SidecarConfigurationError(`${name} is invalid`, `SIDECAR_${name}_INVALID`);
  }
  return parsed;
}

function validateToken(value) {
  const token = typeof value === "string" ? value : "";
  if (token.length < 32 || token.length > 4096 || /\s/.test(token) || new Set(token).size < 8) {
    throw new SidecarConfigurationError(
      "NEXUS_AI_CORE_SERVICE_TOKEN must be a high-entropy value of at least 32 characters",
      "SIDECAR_SERVICE_TOKEN_REQUIRED",
    );
  }
  return token;
}

function optionalAbsolutePath(value, name) {
  if (value === undefined || value === null || value === "") return "";
  const text = String(value);
  if (text.length > 1024 || text.includes("\0") || !isAbsolute(text)) {
    throw new SidecarConfigurationError(`${name} must be an absolute path`, `SIDECAR_${name}_INVALID`);
  }
  return resolve(text);
}

export function parseSidecarConfiguration(env = process.env) {
  const host = String(env.HOST ?? "127.0.0.1").trim();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new SidecarConfigurationError("Sidecar HOST must be 127.0.0.1 or ::1", "SIDECAR_HOST_REJECTED");
  }

  const nonce = String(env.NEXUS_AI_CORE_STARTUP_NONCE ?? "");
  if (!NONCE_PATTERN.test(nonce)) {
    throw new SidecarConfigurationError("NEXUS_AI_CORE_STARTUP_NONCE is invalid", "SIDECAR_NONCE_INVALID");
  }

  const parentPid = parseInteger(env.NEXUS_AI_CORE_PARENT_PID, 0, {
    min: 0,
    max: 2_147_483_647,
    name: "PARENT_PID",
  });
  if (parentPid === process.pid) {
    throw new SidecarConfigurationError("Sidecar cannot supervise its own process ID", "SIDECAR_PARENT_PID_INVALID");
  }

  return Object.freeze({
    host,
    port: parseInteger(env.PORT, 0, { min: 0, max: 65_535, name: "PORT" }),
    serviceToken: validateToken(env.NEXUS_AI_CORE_SERVICE_TOKEN),
    startupNonce: nonce,
    readyFile: optionalAbsolutePath(env.NEXUS_AI_CORE_READY_FILE, "READY_FILE"),
    monitorStateFile: optionalAbsolutePath(env.MONITOR_STATE_FILE, "MONITOR_STATE_FILE"),
    parentPid,
    parentCheckIntervalMs: parseInteger(env.NEXUS_AI_CORE_PARENT_CHECK_INTERVAL_MS, 1_000, {
      min: 100,
      max: 60_000,
      name: "PARENT_CHECK_INTERVAL_MS",
    }),
    shutdownGraceMs: parseInteger(env.NEXUS_AI_CORE_SHUTDOWN_GRACE_MS, 5_000, {
      min: 250,
      max: 30_000,
      name: "SHUTDOWN_GRACE_MS",
    }),
    corsOrigin: String(env.CORS_ORIGIN ?? "http://127.0.0.1").slice(0, 500),
    rateLimitPerMinute: parseInteger(env.RATE_LIMIT_PER_MINUTE, 60, {
      min: 1,
      max: 10_000,
      name: "RATE_LIMIT_PER_MINUTE",
    }),
  });
}

export function isParentAlive(parentPid) {
  if (!Number.isInteger(parentPid) || parentPid <= 0) return true;
  try {
    process.kill(parentPid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
