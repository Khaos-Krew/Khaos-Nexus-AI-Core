import { randomUUID } from "node:crypto";
import { API_VERSION, TARGET_SERVICE } from "./constants.js";
import { CLIENT_METHOD_REGISTRY, ENDPOINT_REGISTRY } from "./service-contract.js";

const ENDPOINTS = new Map(ENDPOINT_REGISTRY.map((endpoint) => [endpoint.key, endpoint]));
const ASSIST_CAPABILITIES = new Set([
  "nexus.help",
  "nexus.discord.assist",
  "nexus.discord.draft",
  "nexus.server.diagnose",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);

export class NexusAiCoreClientError extends Error {
  constructor(message, { status = 0, code = "CLIENT_ERROR", field = null, retryable = false, providerRequestId = null } = {}) {
    super(message);
    this.name = "NexusAiCoreClientError";
    this.status = status;
    this.code = code;
    this.field = field;
    this.retryable = retryable;
    this.providerRequestId = providerRequestId;
  }
}

function clientError(code, message, extra = {}) {
  return new NexusAiCoreClientError(message, { code, ...extra });
}

function normalizeHostname(hostname) {
  return String(hostname).replace(/^\[|\]$/g, "").toLowerCase();
}

export function validateAiCoreEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw clientError("CLIENT_ENDPOINT_INVALID", "AI Core endpoint is invalid");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw clientError("CLIENT_ENDPOINT_REJECTED", "AI Core endpoint cannot contain credentials, query parameters, or fragments");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw clientError("CLIENT_ENDPOINT_REJECTED", "AI Core endpoint cannot contain a path prefix");
  }
  const hostname = normalizeHostname(url.hostname);
  const loopback = LOOPBACK_HOSTS.has(hostname);
  if (url.protocol === "http:" && !loopback) {
    throw clientError("CLIENT_HTTPS_REQUIRED", "Non-loopback AI Core endpoints require HTTPS");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw clientError("CLIENT_ENDPOINT_REJECTED", "AI Core endpoint protocol is unsupported");
  }
  url.pathname = "/";
  return url;
}

function integer(value, fallback, min, max) {
  return Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;
}

async function readBoundedResponse(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) {
      throw clientError("CLIENT_RESPONSE_TOO_LARGE", "AI Core response exceeded the configured size limit", { status: response.status });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJson(buffer, status, providerRequestId) {
  try {
    return buffer.length ? JSON.parse(buffer.toString("utf8")) : {};
  } catch {
    throw clientError("CLIENT_INVALID_JSON", "AI Core returned invalid JSON", { status, providerRequestId });
  }
}

function endpointFor(key) {
  const endpoint = ENDPOINTS.get(key);
  if (!endpoint) throw clientError("CLIENT_ENDPOINT_NOT_REGISTERED", "AI Core client endpoint is not registered");
  return endpoint;
}

function assertCapability(capability) {
  if (typeof capability !== "string" || !capability.startsWith("nexus.") || capability.startsWith("dnd.")) {
    throw clientError("CLIENT_CAPABILITY_REJECTED", "AI Core client capability is invalid");
  }
}

export class NexusAiCoreClient {
  #baseUrl;
  #serviceToken;
  #fetchImpl;
  #timeoutMs;
  #maxResponseBytes;

  constructor({ endpoint = "http://127.0.0.1:8790", serviceToken = "", fetchImpl = globalThis.fetch, timeoutMs = 15_000, maxResponseBytes = 2_000_000 } = {}) {
    if (typeof fetchImpl !== "function") throw clientError("CLIENT_FETCH_UNAVAILABLE", "AI Core client requires fetch support");
    this.#baseUrl = validateAiCoreEndpoint(endpoint);
    this.#serviceToken = typeof serviceToken === "string" ? serviceToken : "";
    this.#fetchImpl = fetchImpl;
    this.#timeoutMs = integer(timeoutMs, 15_000, 1_000, 120_000);
    this.#maxResponseBytes = integer(maxResponseBytes, 2_000_000, 10_000, 10_000_000);
  }

  status() {
    return {
      endpoint: this.#baseUrl.origin,
      authenticated: this.#serviceToken.length > 0,
      apiVersion: API_VERSION,
      targetService: TARGET_SERVICE,
    };
  }

  async health() { return this.#request("health"); }
  async capabilities() { return this.#request("capabilities"); }
  async contracts() { return this.#request("contracts"); }
  async providerStatus() { return this.#request("providerStatus"); }
  async monitorState() { return this.#request("monitorState"); }

  async assist({ capability, prompt, context = {}, visibility = "ephemeral" } = {}) {
    if (!ASSIST_CAPABILITIES.has(capability)) throw clientError("CLIENT_CAPABILITY_REJECTED", "Capability is not supported by the assist endpoint");
    return this.#request("assist", { capability, prompt, context, visibility });
  }

  async compareUpdates(input = {}) { return this.#request("compareUpdates", input); }
  async analyzeUpdates(input = {}) { return this.#request("analyzeUpdates", input); }
  async evaluateUpdates(input = {}) { return this.#request("evaluateUpdates", input); }
  async digestUpdates(input = {}) { return this.#request("digestUpdates", input); }
  async pollMonitor(input = {}) { return this.#request("pollMonitor", input); }
  async proposeMaintenance(input = {}) { return this.#request("proposeMaintenance", input); }

  async summarizeIncident({ prompt, context = {}, visibility = "ephemeral" } = {}) {
    return this.#request("summarizeIncident", { prompt, context, visibility });
  }

  async negotiate({ requiredCapabilities = [], requireProvider = false } = {}) {
    const [health, capabilities] = await Promise.all([this.health(), this.capabilities()]);
    if (health.apiVersion !== API_VERSION || capabilities.apiVersion !== API_VERSION) {
      throw clientError("CLIENT_API_VERSION_MISMATCH", "AI Core API version is incompatible");
    }
    if (health.targetService !== TARGET_SERVICE || capabilities.targetService !== TARGET_SERVICE) {
      throw clientError("CLIENT_TARGET_SERVICE_MISMATCH", "AI Core target service is incompatible");
    }
    if (capabilities.directExecution !== false || capabilities.directServiceForwarding !== false || capabilities.directDiscordConnection !== false) {
      throw clientError("CLIENT_AUTHORITY_CONTRACT_REJECTED", "AI Core authority contract is unsafe");
    }
    const advertised = Array.isArray(capabilities.capabilities) ? capabilities.capabilities : [];
    if (advertised.some((capability) => typeof capability !== "string" || capability.startsWith("dnd."))) {
      throw clientError("CLIENT_DND_ISOLATION_REJECTED", "AI Core advertised an invalid capability namespace");
    }
    const required = [...new Set(requiredCapabilities.map(String))];
    required.forEach(assertCapability);
    const missing = required.filter((capability) => !advertised.includes(capability));
    if (missing.length) {
      throw clientError("CLIENT_REQUIRED_CAPABILITY_MISSING", `AI Core is missing required capabilities: ${missing.join(", ")}`);
    }
    if (requireProvider && health.providerStatus?.ready !== true) {
      throw clientError("CLIENT_PROVIDER_UNAVAILABLE", "AI Core generation provider is not ready", { retryable: true });
    }
    return {
      service: health.service,
      serviceVersion: health.version,
      apiVersion: health.apiVersion,
      targetService: health.targetService,
      providerStatus: health.providerStatus,
      capabilities: advertised,
      requiredCapabilities: required,
    };
  }

  async #request(key, payload = null) {
    const endpoint = endpointFor(key);
    const requestId = endpoint.method === "POST" ? randomUUID() : null;
    let body;
    if (endpoint.method === "POST") {
      const capability = endpoint.capability === "dynamic-assist" ? payload?.capability : endpoint.capability;
      assertCapability(capability);
      body = JSON.stringify({
        ...(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}),
        apiVersion: API_VERSION,
        requestId,
        targetService: TARGET_SERVICE,
        routingDepth: 0,
        capability,
      });
    }

    const url = new URL(endpoint.path, this.#baseUrl);
    const headers = new Headers({ Accept: "application/json" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (this.#serviceToken) headers.set("Authorization", `Bearer ${this.#serviceToken}`);
    if (requestId) headers.set("X-Khaos-Request-Id", requestId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    try {
      response = await this.#fetchImpl(url, {
        method: endpoint.method,
        headers,
        body,
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (error?.name === "AbortError") throw clientError("CLIENT_TIMEOUT", "AI Core request timed out", { retryable: true });
      throw clientError("CLIENT_NETWORK_ERROR", "AI Core request failed", { retryable: true });
    }
    clearTimeout(timer);

    const providerRequestId = response.headers.get("x-request-id");
    if (response.status >= 300 && response.status < 400) {
      throw clientError("CLIENT_REDIRECT_REJECTED", "AI Core response redirect was rejected", { status: response.status, providerRequestId });
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw clientError("CLIENT_CONTENT_TYPE_REJECTED", "AI Core returned a non-JSON response", { status: response.status, providerRequestId });
    }
    const data = parseJson(await readBoundedResponse(response, this.#maxResponseBytes), response.status, providerRequestId);
    if (!response.ok) {
      throw new NexusAiCoreClientError(
        typeof data.error?.message === "string" ? data.error.message : "AI Core request failed",
        {
          status: response.status,
          code: typeof data.error?.code === "string" ? data.error.code : "CLIENT_REMOTE_ERROR",
          field: typeof data.error?.field === "string" ? data.error.field : null,
          retryable: data.error?.retryable === true,
          providerRequestId,
        },
      );
    }
    if (requestId && data.requestId !== requestId) {
      throw clientError("CLIENT_RESPONSE_ID_MISMATCH", "AI Core response request ID did not match", { status: response.status, providerRequestId });
    }
    return data;
  }
}

export const nexusAiCoreClientMethods = Object.freeze({ ...CLIENT_METHOD_REGISTRY });
