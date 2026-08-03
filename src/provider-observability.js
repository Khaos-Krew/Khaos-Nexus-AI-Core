function safeCode(value) {
  const normalized = String(value ?? "UNKNOWN_ERROR").replace(/[^A-Z0-9_]/gi, "_").toUpperCase().slice(0, 80);
  return normalized || "UNKNOWN_ERROR";
}

export class ProviderTelemetry {
  constructor({ provider = "unknown", model = "unknown", maxErrorCodes = 50 } = {}) {
    this.provider = String(provider).slice(0, 100);
    this.model = String(model).slice(0, 100);
    this.maxErrorCodes = Math.min(Math.max(Number.isInteger(maxErrorCodes) ? maxErrorCodes : 50, 1), 200);
    this.reset();
  }

  reset() {
    this.startedAt = new Date().toISOString();
    this.requests = 0;
    this.successes = 0;
    this.failures = 0;
    this.fallbacks = 0;
    this.shortCircuits = 0;
    this.totalLatencyMs = 0;
    this.maxLatencyMs = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalTokens = 0;
    this.errorCodes = new Map();
    this.circuitTransitions = new Map();
  }

  recordRequest() {
    this.requests += 1;
  }

  recordSuccess(meta = {}, { fallback = false } = {}) {
    this.successes += 1;
    if (fallback) this.fallbacks += 1;
    const latency = Number.isInteger(meta.latencyMs) && meta.latencyMs >= 0 ? meta.latencyMs : 0;
    this.totalLatencyMs += latency;
    this.maxLatencyMs = Math.max(this.maxLatencyMs, latency);
    this.totalInputTokens += Number.isInteger(meta.usage?.inputTokens) ? Math.max(meta.usage.inputTokens, 0) : 0;
    this.totalOutputTokens += Number.isInteger(meta.usage?.outputTokens) ? Math.max(meta.usage.outputTokens, 0) : 0;
    this.totalTokens += Number.isInteger(meta.usage?.totalTokens) ? Math.max(meta.usage.totalTokens, 0) : 0;
  }

  recordFailure(error, { shortCircuit = false } = {}) {
    this.failures += 1;
    if (shortCircuit) this.shortCircuits += 1;
    const code = safeCode(error?.code);
    if (!this.errorCodes.has(code) && this.errorCodes.size >= this.maxErrorCodes) {
      this.errorCodes.set("OTHER", (this.errorCodes.get("OTHER") ?? 0) + 1);
      return;
    }
    this.errorCodes.set(code, (this.errorCodes.get(code) ?? 0) + 1);
  }

  recordCircuitTransition({ previous, next }) {
    const key = `${previous}_TO_${next}`.toUpperCase();
    this.circuitTransitions.set(key, (this.circuitTransitions.get(key) ?? 0) + 1);
  }

  snapshot({ circuit = null, budget = null } = {}) {
    const averageLatencyMs = this.successes > 0 ? Math.round(this.totalLatencyMs / this.successes) : 0;
    return {
      provider: this.provider,
      model: this.model,
      startedAt: this.startedAt,
      requests: this.requests,
      successes: this.successes,
      failures: this.failures,
      fallbacks: this.fallbacks,
      shortCircuits: this.shortCircuits,
      latency: {
        averageMs: averageLatencyMs,
        maxMs: this.maxLatencyMs,
        totalMs: this.totalLatencyMs,
      },
      usage: {
        inputTokens: this.totalInputTokens,
        outputTokens: this.totalOutputTokens,
        totalTokens: this.totalTokens,
      },
      errorCodes: Object.fromEntries([...this.errorCodes.entries()].sort(([left], [right]) => left.localeCompare(right))),
      circuitTransitions: Object.fromEntries([...this.circuitTransitions.entries()].sort(([left], [right]) => left.localeCompare(right))),
      circuit,
      budget,
      contentStored: false,
      identitiesStored: false,
    };
  }
}
