import { AppError } from "./errors.js";

function positiveInteger(value, fallback, min, max) {
  return Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;
}

export class ProviderCircuitBreaker {
  constructor({
    failureThreshold = 5,
    failureWindowMs = 60_000,
    cooldownMs = 30_000,
    now = () => Date.now(),
    onTransition = null,
  } = {}) {
    this.failureThreshold = positiveInteger(failureThreshold, 5, 1, 100);
    this.failureWindowMs = positiveInteger(failureWindowMs, 60_000, 1_000, 3_600_000);
    this.cooldownMs = positiveInteger(cooldownMs, 30_000, 1_000, 3_600_000);
    this.now = now;
    this.onTransition = typeof onTransition === "function" ? onTransition : null;
    this.state = "closed";
    this.openedAt = null;
    this.openUntil = null;
    this.probeInFlight = false;
    this.retryableFailures = [];
    this.transitionCount = 0;
  }

  #transition(next, reason) {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    this.transitionCount += 1;
    if (next === "open") {
      this.openedAt = this.now();
      this.openUntil = this.openedAt + this.cooldownMs;
      this.probeInFlight = false;
    } else if (next === "half_open") {
      this.probeInFlight = false;
    } else if (next === "closed") {
      this.openedAt = null;
      this.openUntil = null;
      this.probeInFlight = false;
      this.retryableFailures = [];
    }
    this.onTransition?.({ previous, next, reason, at: this.now() });
  }

  #pruneFailures() {
    const cutoff = this.now() - this.failureWindowMs;
    this.retryableFailures = this.retryableFailures.filter((timestamp) => timestamp >= cutoff);
  }

  beforeRequest() {
    if (this.state === "open") {
      if (this.openUntil !== null && this.now() >= this.openUntil) {
        this.#transition("half_open", "cooldown_elapsed");
      } else {
        return { allowed: false, state: this.state, reason: "circuit_open", retryAt: this.openUntil };
      }
    }
    if (this.state === "half_open") {
      if (this.probeInFlight) {
        return { allowed: false, state: this.state, reason: "probe_in_flight", retryAt: this.openUntil };
      }
      this.probeInFlight = true;
      return { allowed: true, state: this.state, probe: true };
    }
    return { allowed: true, state: this.state, probe: false };
  }

  recordSuccess() {
    if (this.state === "half_open" || this.state === "open") this.#transition("closed", "successful_probe");
    else {
      this.#pruneFailures();
      this.retryableFailures = [];
    }
  }

  recordFailure(error) {
    if (error?.retryable !== true) {
      if (this.state === "half_open") this.#transition("closed", "non_retryable_probe_result");
      return false;
    }
    if (this.state === "half_open") {
      this.#transition("open", "failed_probe");
      return true;
    }
    this.#pruneFailures();
    this.retryableFailures.push(this.now());
    if (this.retryableFailures.length >= this.failureThreshold) {
      this.#transition("open", "failure_threshold_reached");
      return true;
    }
    return false;
  }

  openError() {
    return new AppError("Primary AI provider circuit is open", {
      status: 503,
      code: "AI_PROVIDER_CIRCUIT_OPEN",
      retryable: true,
    });
  }

  snapshot() {
    this.#pruneFailures();
    return {
      state: this.state,
      failureThreshold: this.failureThreshold,
      failureWindowMs: this.failureWindowMs,
      cooldownMs: this.cooldownMs,
      retryableFailureCount: this.retryableFailures.length,
      openedAt: this.openedAt === null ? null : new Date(this.openedAt).toISOString(),
      openUntil: this.openUntil === null ? null : new Date(this.openUntil).toISOString(),
      probeInFlight: this.probeInFlight,
      transitionCount: this.transitionCount,
    };
  }

  reset() {
    this.state = "closed";
    this.openedAt = null;
    this.openUntil = null;
    this.probeInFlight = false;
    this.retryableFailures = [];
    this.transitionCount = 0;
  }
}
