import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stableHash } from "./security.js";

function safeSourceConfig(source) {
  const allowed = ["id", "provider", "owner", "repo", "project", "modId", "gameVersion", "appId", "allowedChannels", "gameVersions", "loaders", "feeds", "keywords", "count", "enabled", "emitInitialEvents"];
  return Object.fromEntries(allowed.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function initialState() {
  return { version: 1, sources: {}, webhookDeliveries: {} };
}

export class MonitorStateStore {
  constructor({ filePath = "", maxSeenEvents = 500, maxWebhookDeliveries = 2000 } = {}) {
    this.filePath = filePath;
    this.maxSeenEvents = maxSeenEvents;
    this.maxWebhookDeliveries = maxWebhookDeliveries;
    this.state = initialState();
    if (filePath) this.#load();
  }

  #load() {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
      if (parsed?.version === 1 && parsed.sources && parsed.webhookDeliveries) this.state = parsed;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  #persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temporary, this.filePath);
  }

  getSource(sourceId) {
    return this.state.sources[sourceId] ?? null;
  }

  registerSource(source) {
    const safeSource = safeSourceConfig(source);
    const sourceHash = stableHash(safeSource);
    const existing = this.state.sources[source.id] ?? {};
    const unchanged = existing.sourceHash === sourceHash;
    this.state.sources[source.id] = {
      source: safeSource,
      sourceHash,
      seenEventIds: unchanged && Array.isArray(existing.seenEventIds) ? existing.seenEventIds : [],
      etag: unchanged ? existing.etag ?? null : null,
      lastModified: unchanged ? existing.lastModified ?? null : null,
      lastCheckedAt: unchanged ? existing.lastCheckedAt ?? null : null,
      lastSuccessAt: unchanged ? existing.lastSuccessAt ?? null : null,
      consecutiveFailures: unchanged ? existing.consecutiveFailures ?? 0 : 0,
      backoffUntil: unchanged ? existing.backoffUntil ?? null : null,
      lastError: unchanged ? existing.lastError ?? null : null,
      lastEventAt: unchanged ? existing.lastEventAt ?? null : null,
    };
    this.#persist();
    return this.state.sources[source.id];
  }

  recordSuccess(source, result) {
    const entry = this.registerSource(source);
    const initialBaseline = entry.lastSuccessAt === null && entry.seenEventIds.length === 0;
    const seen = new Set(entry.seenEventIds);
    const newEvents = [];
    let suppressedDuplicates = 0;
    let suppressedHistorical = 0;
    for (const event of result.events ?? []) {
      if (seen.has(event.providerEventId)) suppressedDuplicates += 1;
      else {
        seen.add(event.providerEventId);
        if (initialBaseline && !source.emitInitialEvents) suppressedHistorical += 1;
        else newEvents.push(event);
      }
    }
    Object.assign(entry, {
      seenEventIds: [...seen].slice(-this.maxSeenEvents),
      etag: result.etag ?? entry.etag,
      lastModified: result.lastModified ?? entry.lastModified,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      consecutiveFailures: 0,
      backoffUntil: null,
      lastError: null,
      lastEventAt: result.events?.[0]?.publishedAt ?? entry.lastEventAt,
    });
    this.#persist();
    return {
      newEvents,
      suppressedDuplicates,
      suppressedHistorical,
      baselineEstablished: initialBaseline,
      latestEvent: result.events?.[0] ?? null,
    };
  }

  recordNotModified(source) {
    const entry = this.registerSource(source);
    entry.lastCheckedAt = new Date().toISOString();
    entry.lastSuccessAt = entry.lastCheckedAt;
    entry.consecutiveFailures = 0;
    entry.backoffUntil = null;
    entry.lastError = null;
    this.#persist();
  }

  recordFailure(source, error) {
    const entry = this.registerSource(source);
    entry.lastCheckedAt = new Date().toISOString();
    entry.consecutiveFailures += 1;
    const delayMs = Math.min(60_000 * 2 ** Math.max(entry.consecutiveFailures - 1, 0), 60 * 60_000);
    entry.backoffUntil = new Date(Date.now() + delayMs).toISOString();
    entry.lastError = {
      code: error.code ?? "MONITOR_SOURCE_FAILED",
      message: String(error.message ?? "Monitor source failed").slice(0, 300),
      retryable: Boolean(error.retryable),
      at: entry.lastCheckedAt,
    };
    this.#persist();
    return entry;
  }

  isBackedOff(sourceId) {
    const until = this.getSource(sourceId)?.backoffUntil;
    return until ? Date.parse(until) > Date.now() : false;
  }

  hasWebhookDelivery(deliveryId) {
    return Boolean(this.state.webhookDeliveries[deliveryId]);
  }

  recordWebhookDelivery(deliveryId) {
    if (this.hasWebhookDelivery(deliveryId)) return false;
    this.state.webhookDeliveries[deliveryId] = new Date().toISOString();
    const identifiers = Object.keys(this.state.webhookDeliveries);
    if (identifiers.length > this.maxWebhookDeliveries) {
      identifiers.sort((left, right) => this.state.webhookDeliveries[left].localeCompare(this.state.webhookDeliveries[right]));
      for (const id of identifiers.slice(0, identifiers.length - this.maxWebhookDeliveries)) delete this.state.webhookDeliveries[id];
    }
    this.#persist();
    return true;
  }

  snapshot() {
    return {
      version: this.state.version,
      sourceCount: Object.keys(this.state.sources).length,
      sources: Object.entries(this.state.sources).map(([id, entry]) => ({
        id,
        provider: entry.source.provider,
        lastCheckedAt: entry.lastCheckedAt,
        lastSuccessAt: entry.lastSuccessAt,
        consecutiveFailures: entry.consecutiveFailures,
        backoffUntil: entry.backoffUntil,
        lastError: entry.lastError,
        lastEventAt: entry.lastEventAt,
        seenEventCount: entry.seenEventIds.length,
      })),
      webhookDeliveryCount: Object.keys(this.state.webhookDeliveries).length,
    };
  }
}
