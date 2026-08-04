import { createServer } from "node:http";
import {
  API_VERSION,
  CAPABILITIES,
  MAX_BODY_BYTES,
  SERVICE_NAME,
  SERVICE_VERSION,
  TARGET_SERVICE,
} from "./constants.js";
import { AppError } from "./errors.js";
import { createNeutralResponse, validateEnvelope, visibilityFrom } from "./contracts.js";
import { createMaintenancePlan } from "./maintenance.js";
import { ProviderRouter } from "./provider-factory.js";
import { DeterministicProvider } from "./provider.js";
import { authenticateRequest, stableHash } from "./security.js";
import { serviceContractSummary } from "./service-contract.js";
import { createUpdateDigest, evaluateUpdateImpact } from "./update-intelligence.js";
import { compareUpdateResources } from "./updates.js";

function sendJson(response, status, body, origin) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  });
  response.end(JSON.stringify(body));
}

async function readBodyBuffer(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new AppError("Request body is too large", { status: 413, code: "BODY_TOO_LARGE" });
    }
    chunks.push(chunk);
  }
  return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
}

function parseJsonBuffer(buffer) {
  if (buffer.length === 0) return {};
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new AppError("Invalid JSON", { status: 400, code: "INVALID_JSON" });
  }
}

async function readJson(request) {
  return parseJsonBuffer(await readBodyBuffer(request));
}

function createRateLimiter({ windowMs = 60_000, limit = 60 } = {}) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= limit;
  };
}

function createIdempotencyStore({ ttlMs = 10 * 60_000, maxEntries = 2_000 } = {}) {
  const entries = new Map();
  return {
    get(requestId, bodyHash) {
      const entry = entries.get(requestId);
      if (!entry) return null;
      if (Date.now() - entry.createdAt > ttlMs) {
        entries.delete(requestId);
        return null;
      }
      if (entry.bodyHash !== bodyHash) {
        throw new AppError("requestId was already used with different content", {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
          field: "requestId",
        });
      }
      return entry.result;
    },
    set(requestId, bodyHash, result) {
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entries.set(requestId, { bodyHash, result, createdAt: Date.now() });
    },
  };
}

function requestHeaderMatches(request, requestId) {
  const header = request.headers["x-khaos-request-id"];
  if (header === undefined) return;
  if (header !== requestId) {
    throw new AppError("X-Khaos-Request-Id must match body.requestId", {
      status: 400,
      code: "REQUEST_ID_MISMATCH",
      field: "requestId",
    });
  }
}

function getProviderStatus(provider, { detailed = false } = {}) {
  const status = typeof provider.status === "function"
    ? provider.status({ detailed })
    : { name: provider.name, model: provider.model, ready: provider.ready !== false };
  if (detailed) return status;
  return {
    name: status.name ?? provider.name,
    model: status.model ?? provider.model,
    ready: status.ready !== false,
    store: status.store === true,
    toolsAllowed: status.toolsAllowed === true,
    fallback: status.fallback ? {
      enabled: status.fallback.enabled === true,
      name: status.fallback.name ?? null,
      model: status.fallback.model ?? null,
    } : { enabled: false, name: null, model: null },
    circuit: status.circuit ? {
      state: status.circuit.state,
      openUntil: status.circuit.openUntil ?? null,
    } : { state: "unavailable", openUntil: null },
  };
}

export function createApp({
  provider = new ProviderRouter({ primary: new DeterministicProvider() }),
  monitorService = null,
  serviceToken = "",
  authRequired = false,
  corsOrigin = "http://localhost:3000",
  rateLimit = {},
} = {}) {
  const allowRequest = createRateLimiter(rateLimit);
  const idempotency = createIdempotencyStore();

  return createServer(async (request, response) => {
    const origin = corsOrigin === "*" ? "*" : corsOrigin;
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Khaos-Request-Id,X-Hub-Signature-256,X-GitHub-Delivery,X-GitHub-Event",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      });
      response.end();
      return;
    }

    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const { pathname } = url;

      if (request.method === "GET" && pathname === "/health") {
        const publicProvider = getProviderStatus(provider);
        sendJson(response, 200, {
          status: "ok",
          service: SERVICE_NAME,
          apiVersion: API_VERSION,
          version: SERVICE_VERSION,
          targetService: TARGET_SERVICE,
          provider: publicProvider.name,
          model: publicProvider.model,
          providerStatus: publicProvider,
          updateMonitor: { available: Boolean(monitorService), schedulerOwnedExternally: true },
          isolation: {
            dndService: "Khaos-Krew/Khaos-Nexus-AI",
            directAiToAiCallsAllowed: false,
            executionAuthority: "Khaos Nexus desktop and Nexus Bot",
          },
        }, origin);
        return;
      }

      if (request.method === "POST" && pathname === "/api/v1/webhooks/github") {
        if (!monitorService) throw new AppError("Route not found", { status: 404, code: "NOT_FOUND" });
        const rawBody = await readBodyBuffer(request);
        const result = monitorService.handleGithubWebhook({
          sourceId: url.searchParams.get("sourceId") ?? "",
          deliveryId: request.headers["x-github-delivery"],
          eventName: request.headers["x-github-event"],
          signature: request.headers["x-hub-signature-256"],
          rawBody,
        });
        sendJson(response, 200, { apiVersion: API_VERSION, service: SERVICE_NAME, result }, origin);
        return;
      }

      const auth = authenticateRequest(request, { serviceToken, authRequired });
      const clientKey = auth.authenticated ? auth.subject : request.socket.remoteAddress ?? "unknown";
      if (!allowRequest(clientKey)) {
        throw new AppError("Rate limit exceeded", { status: 429, code: "RATE_LIMITED", retryable: true });
      }

      if (request.method === "GET" && pathname === "/api/v1/capabilities") {
        sendJson(response, 200, {
          apiVersion: API_VERSION,
          service: SERVICE_NAME,
          targetService: TARGET_SERVICE,
          capabilities: CAPABILITIES,
          providerStatus: getProviderStatus(provider),
          rejectedNamespaces: ["dnd.*"],
          directServiceForwarding: false,
          directDiscordConnection: false,
          directExecution: false,
        }, origin);
        return;
      }

      if (request.method === "GET" && pathname === "/api/v1/contracts") {
        sendJson(response, 200, {
          apiVersion: API_VERSION,
          service: SERVICE_NAME,
          contract: serviceContractSummary(),
          schemasServedInline: false,
          credentialsIncluded: false,
          contentStored: false,
          identitiesStored: false,
        }, origin);
        return;
      }

      if (request.method === "GET" && pathname === "/api/v1/provider/status") {
        sendJson(response, 200, {
          apiVersion: API_VERSION,
          service: SERVICE_NAME,
          providerStatus: getProviderStatus(provider, { detailed: true }),
          contentStored: false,
          identitiesStored: false,
        }, origin);
        return;
      }

      if (request.method === "GET" && pathname === "/api/v1/monitor/state") {
        if (!monitorService) throw new AppError("Update monitor is not configured", { status: 503, code: "MONITOR_NOT_CONFIGURED" });
        sendJson(response, 200, {
          apiVersion: API_VERSION,
          service: SERVICE_NAME,
          capability: "nexus.update.state",
          state: monitorService.state(),
        }, origin);
        return;
      }

      if (request.method !== "POST") {
        throw new AppError("Route not found", { status: 404, code: "NOT_FOUND" });
      }

      const body = await readJson(request);
      const endpointCapabilities = new Map([
        ["/api/v1/discord/assist", new Set(["nexus.help", "nexus.discord.assist", "nexus.discord.draft", "nexus.server.diagnose", "nexus.incident.summarize"])],
        ["/api/v1/updates/compare", new Set(["nexus.update.compare"])],
        ["/api/v1/updates/analyze", new Set(["nexus.update.analyze"])],
        ["/api/v1/updates/evaluate", new Set(["nexus.update.evaluate"])],
        ["/api/v1/updates/digest", new Set(["nexus.update.digest"])],
        ["/api/v1/monitor/poll", new Set(["nexus.update.poll"])],
        ["/api/v1/maintenance/plans", new Set(["nexus.maintenance.propose"])],
        ["/api/v1/incidents/summarize", new Set(["nexus.incident.summarize"])],
      ]);
      const allowedCapabilities = endpointCapabilities.get(pathname);
      if (!allowedCapabilities) throw new AppError("Route not found", { status: 404, code: "NOT_FOUND" });
      validateEnvelope(body);
      if (!allowedCapabilities.has(body.capability)) {
        throw new AppError("Capability is not valid for this endpoint", {
          status: 400,
          code: "ENDPOINT_CAPABILITY_MISMATCH",
          field: "capability",
        });
      }
      requestHeaderMatches(request, body.requestId);

      const bodyHash = stableHash(body);
      const existing = idempotency.get(body.requestId, bodyHash);
      if (existing) {
        sendJson(response, 200, { ...existing, meta: { ...(existing.meta ?? {}), idempotentReplay: true } }, origin);
        return;
      }

      let result;
      if (pathname === "/api/v1/discord/assist" || pathname === "/api/v1/incidents/summarize") {
        const generated = await provider.assist(body);
        result = createNeutralResponse({
          requestId: body.requestId,
          capability: body.capability,
          subsystem: generated.subsystem,
          content: generated.content,
          visibility: visibilityFrom(body.visibility),
          presentation: generated.presentation,
          meta: { ...(generated.meta ?? {}), executedActions: 0 },
        });
      } else if (pathname === "/api/v1/updates/compare") {
        const comparison = compareUpdateResources(body);
        result = {
          apiVersion: API_VERSION,
          requestId: body.requestId,
          service: SERVICE_NAME,
          capability: body.capability,
          comparison,
          execution: { performed: false, authority: "Khaos Nexus" },
        };
      } else if (pathname === "/api/v1/updates/analyze") {
        const comparison = compareUpdateResources(body);
        const generated = await provider.analyzeUpdates(comparison, { requestId: body.requestId });
        result = createNeutralResponse({
          requestId: body.requestId,
          capability: body.capability,
          subsystem: generated.subsystem,
          content: generated.content,
          visibility: visibilityFrom(body.visibility),
          presentation: generated.presentation,
          meta: { ...(generated.meta ?? {}), comparison },
        });
      } else if (pathname === "/api/v1/updates/evaluate") {
        result = {
          apiVersion: API_VERSION,
          requestId: body.requestId,
          service: SERVICE_NAME,
          capability: body.capability,
          evaluation: evaluateUpdateImpact(body),
          execution: { performed: false, authority: "Khaos Nexus" },
        };
      } else if (pathname === "/api/v1/updates/digest") {
        const evaluation = evaluateUpdateImpact(body);
        result = {
          apiVersion: API_VERSION,
          requestId: body.requestId,
          service: SERVICE_NAME,
          capability: body.capability,
          digest: createUpdateDigest({ ...body, evaluation }),
          evaluationSummary: {
            alertCount: evaluation.alertCount,
            deliveryCount: evaluation.deliveryCount,
            highestSeverity: evaluation.highestSeverity,
          },
          execution: { performed: false, authority: "Khaos Nexus" },
        };
      } else if (pathname === "/api/v1/monitor/poll") {
        if (!monitorService) throw new AppError("Update monitor is not configured", { status: 503, code: "MONITOR_NOT_CONFIGURED" });
        result = {
          apiVersion: API_VERSION,
          requestId: body.requestId,
          service: SERVICE_NAME,
          capability: body.capability,
          monitor: await monitorService.poll(body),
          execution: { performed: false, schedulerAuthority: "khaos-nexus-shared-scheduler" },
        };
      } else if (pathname === "/api/v1/maintenance/plans") {
        const plan = createMaintenancePlan(body);
        result = {
          apiVersion: API_VERSION,
          requestId: body.requestId,
          service: SERVICE_NAME,
          capability: body.capability,
          plan,
          execution: { performed: false, authority: "khaos-nexus-shared-scheduler" },
        };
      }

      idempotency.set(body.requestId, bodyHash, result);
      sendJson(response, 200, result, origin);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      sendJson(response, status, {
        apiVersion: API_VERSION,
        error: {
          code: error.code ?? "INTERNAL_ERROR",
          message: status >= 500 ? "Internal service error" : error.message,
          field: error.field,
          retryable: Boolean(error.retryable),
        },
      }, origin);
    }
  });
}
