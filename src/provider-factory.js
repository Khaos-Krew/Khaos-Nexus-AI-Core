import { AppError } from "./errors.js";
import { OpenAIResponsesProvider } from "./openai-provider.js";
import { validateProviderOutputPolicy } from "./output-policy.js";
import { ProviderCircuitBreaker } from "./provider-circuit.js";
import { ProviderTelemetry } from "./provider-observability.js";
import { DeterministicProvider } from "./provider.js";

function envInteger(env, key, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new AppError(`${key} is invalid`, { status: 503, code: "AI_PROVIDER_CONFIGURATION_INVALID" });
  }
  return parsed;
}

function safeProviderMetadata(output, provider, fallback = null) {
  const meta = output?.meta ?? {};
  return {
    provider: String(meta.provider ?? provider.name),
    model: String(meta.model ?? provider.model),
    providerRequestId: meta.providerRequestId ?? null,
    latencyMs: Number.isInteger(meta.latencyMs) ? meta.latencyMs : 0,
    usage: {
      inputTokens: Number.isInteger(meta.usage?.inputTokens) ? meta.usage.inputTokens : 0,
      outputTokens: Number.isInteger(meta.usage?.outputTokens) ? meta.usage.outputTokens : 0,
      totalTokens: Number.isInteger(meta.usage?.totalTokens) ? meta.usage.totalTokens : 0,
    },
    store: meta.store === true,
    toolsUsed: Number.isInteger(meta.toolsUsed) ? meta.toolsUsed : 0,
    fallback,
  };
}

function decorateProviderOutput(output, provider, fallback = null) {
  const providerMetadata = safeProviderMetadata(output, provider, fallback);
  return {
    ...output,
    presentation: {
      ...(output.presentation ?? {}),
      providerMetadata,
    },
    meta: providerMetadata,
  };
}

function capabilityFor(method, args) {
  return method === "assist" ? args[0]?.capability : "nexus.update.analyze";
}

export class ProviderRouter {
  constructor({
    primary,
    fallback = null,
    fallbackOnRetryable = false,
    circuit = null,
    telemetry = null,
    circuitOptions = {},
  } = {}) {
    if (!primary) throw new Error("primary provider is required");
    this.primary = primary;
    this.fallback = fallback;
    this.fallbackOnRetryable = fallbackOnRetryable;
    this.name = primary.name;
    this.model = primary.model;
    this.ready = primary.ready !== false;
    this.telemetry = telemetry ?? new ProviderTelemetry({ provider: primary.name, model: primary.model });
    this.circuit = circuit ?? new ProviderCircuitBreaker({
      ...circuitOptions,
      onTransition: (event) => this.telemetry.recordCircuitTransition(event),
    });
    if (circuit) {
      const previousTransition = circuit.onTransition;
      circuit.onTransition = (event) => {
        previousTransition?.(event);
        this.telemetry.recordCircuitTransition(event);
      };
    }
  }

  status({ detailed = true } = {}) {
    const primaryStatus = typeof this.primary.status === "function"
      ? this.primary.status()
      : { name: this.primary.name, model: this.primary.model, ready: this.ready };
    const circuit = this.circuit.snapshot();
    const fallback = this.fallback ? {
      enabled: this.fallbackOnRetryable,
      name: this.fallback.name,
      model: this.fallback.model,
    } : { enabled: false, name: null, model: null };
    const status = {
      ...primaryStatus,
      ready: primaryStatus.ready !== false && (circuit.state !== "open" || fallback.enabled),
      fallback,
      circuit,
    };
    if (detailed) {
      status.telemetry = this.telemetry.snapshot({ circuit, budget: primaryStatus.budget ?? null });
    }
    return status;
  }

  resetObservability() {
    this.telemetry.reset();
    this.circuit.reset();
  }

  async assist(input) {
    return this.#invoke("assist", [input]);
  }

  async analyzeUpdates(comparison, request = {}) {
    const correlatedRequest = { ...request, requestId: request.requestId ?? comparison?.requestId ?? null };
    return this.#invoke("analyzeUpdates", [comparison, correlatedRequest]);
  }

  async #invoke(method, args) {
    const capability = capabilityFor(method, args);
    this.telemetry.recordRequest();
    const gate = this.circuit.beforeRequest();
    if (!gate.allowed) {
      const error = this.circuit.openError();
      this.telemetry.recordFailure(error, { shortCircuit: true });
      return this.#fallbackOrThrow(method, args, capability, error, { shortCircuit: true });
    }

    try {
      const output = await this.primary[method](...args);
      const validated = validateProviderOutputPolicy({ capability, output });
      this.circuit.recordSuccess();
      this.telemetry.recordSuccess(validated.meta);
      return decorateProviderOutput(validated, this.primary);
    } catch (error) {
      this.circuit.recordFailure(error);
      this.telemetry.recordFailure(error);
      return this.#fallbackOrThrow(method, args, capability, error);
    }
  }

  async #fallbackOrThrow(method, args, capability, error, { shortCircuit = false } = {}) {
    if (!this.fallbackOnRetryable || !this.fallback || error?.retryable !== true) throw error;
    try {
      const output = await this.fallback[method](...args);
      const validated = validateProviderOutputPolicy({ capability, output });
      this.telemetry.recordSuccess(validated.meta, { fallback: true });
      return decorateProviderOutput(validated, this.fallback, {
        used: true,
        fromProvider: this.primary.name,
        fromModel: this.primary.model,
        reasonCode: error.code ?? "PROVIDER_RETRYABLE_ERROR",
        shortCircuit,
      });
    } catch (fallbackError) {
      this.telemetry.recordFailure(fallbackError);
      throw fallbackError;
    }
  }
}

export function createProviderFromEnvironment({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const selected = String(env.AI_PROVIDER ?? "deterministic-local").trim().toLowerCase();
  let primary;
  let fallback = null;
  let fallbackOnRetryable = false;

  if (selected === "deterministic-local" || selected === "deterministic") {
    primary = new DeterministicProvider();
  } else if (selected === "openai-responses" || selected === "openai") {
    primary = new OpenAIResponsesProvider({
      apiKey: env.OPENAI_API_KEY ?? "",
      model: env.OPENAI_MODEL ?? "",
      fetchImpl,
      timeoutMs: envInteger(env, "OPENAI_TIMEOUT_MS", 30_000, { min: 1_000, max: 120_000 }),
      maxOutputTokens: envInteger(env, "OPENAI_MAX_OUTPUT_TOKENS", 1_000, { min: 64, max: 16_000 }),
      maxResponseBytes: envInteger(env, "OPENAI_MAX_RESPONSE_BYTES", 1_000_000, { min: 10_000, max: 5_000_000 }),
      retries: envInteger(env, "OPENAI_RETRIES", 2, { min: 0, max: 5 }),
      reasoningEffort: String(env.OPENAI_REASONING_EFFORT ?? "").trim().toLowerCase(),
      dailyRequestBudget: envInteger(env, "OPENAI_DAILY_REQUEST_BUDGET", 0, { min: 0, max: 1_000_000 }),
      dailyTokenBudget: envInteger(env, "OPENAI_DAILY_TOKEN_BUDGET", 0, { min: 0, max: 1_000_000_000 }),
    });
    const fallbackPolicy = String(env.AI_PROVIDER_FALLBACK ?? "disabled").trim().toLowerCase();
    if (!["disabled", "deterministic"].includes(fallbackPolicy)) {
      throw new AppError("AI_PROVIDER_FALLBACK is invalid", { status: 503, code: "AI_PROVIDER_FALLBACK_INVALID" });
    }
    fallbackOnRetryable = fallbackPolicy === "deterministic";
    fallback = fallbackOnRetryable ? new DeterministicProvider() : null;
  } else {
    throw new AppError("AI_PROVIDER is unsupported", { status: 503, code: "AI_PROVIDER_NOT_SUPPORTED" });
  }

  return new ProviderRouter({
    primary,
    fallback,
    fallbackOnRetryable,
    circuitOptions: {
      failureThreshold: envInteger(env, "AI_PROVIDER_CIRCUIT_FAILURE_THRESHOLD", 5, { min: 1, max: 100 }),
      failureWindowMs: envInteger(env, "AI_PROVIDER_CIRCUIT_FAILURE_WINDOW_MS", 60_000, { min: 1_000, max: 3_600_000 }),
      cooldownMs: envInteger(env, "AI_PROVIDER_CIRCUIT_COOLDOWN_MS", 30_000, { min: 1_000, max: 3_600_000 }),
    },
  });
}
