import { AppError } from "./errors.js";
import { OpenAIResponsesProvider } from "./openai-provider.js";
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

export class ProviderRouter {
  constructor({ primary, fallback = null, fallbackOnRetryable = false } = {}) {
    if (!primary) throw new Error("primary provider is required");
    this.primary = primary;
    this.fallback = fallback;
    this.fallbackOnRetryable = fallbackOnRetryable;
    this.name = primary.name;
    this.model = primary.model;
    this.ready = primary.ready !== false;
  }

  status() {
    return {
      ...(typeof this.primary.status === "function" ? this.primary.status() : { name: this.primary.name, model: this.primary.model, ready: this.ready }),
      fallback: this.fallback ? {
        enabled: this.fallbackOnRetryable,
        name: this.fallback.name,
        model: this.fallback.model,
      } : { enabled: false, name: null, model: null },
    };
  }

  async assist(input) {
    return this.#invoke("assist", [input]);
  }

  async analyzeUpdates(comparison, request = {}) {
    return this.#invoke("analyzeUpdates", [comparison, request]);
  }

  async #invoke(method, args) {
    try {
      return await this.primary[method](...args);
    } catch (error) {
      if (!this.fallbackOnRetryable || !this.fallback || error?.retryable !== true) throw error;
      const output = await this.fallback[method](...args);
      return {
        ...output,
        meta: {
          ...(output.meta ?? {}),
          fallback: {
            used: true,
            fromProvider: this.primary.name,
            fromModel: this.primary.model,
            reasonCode: error.code ?? "PROVIDER_RETRYABLE_ERROR",
          },
        },
      };
    }
  }
}

export function createProviderFromEnvironment({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const selected = String(env.AI_PROVIDER ?? "deterministic-local").trim().toLowerCase();
  if (selected === "deterministic-local" || selected === "deterministic") return new DeterministicProvider();
  if (selected !== "openai-responses" && selected !== "openai") {
    throw new AppError("AI_PROVIDER is unsupported", { status: 503, code: "AI_PROVIDER_NOT_SUPPORTED" });
  }

  const primary = new OpenAIResponsesProvider({
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
  return new ProviderRouter({
    primary,
    fallback: fallbackPolicy === "deterministic" ? new DeterministicProvider() : null,
    fallbackOnRetryable: fallbackPolicy === "deterministic",
  });
}
