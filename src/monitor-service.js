import { AppError, validationError } from "./errors.js";
import { validateMonitorSource } from "./source-adapters.js";
import { sanitizeExternalText, verifyHmacSha256 } from "./security.js";

function sourceResultBase(source) {
  return { sourceId: source.id, provider: source.provider };
}

function webhookEvent(payload) {
  const release = payload.release;
  return {
    providerEventId: `github-release:${release.id}`,
    eventType: "release",
    version: String(release.tag_name ?? release.name ?? release.id),
    releaseChannel: release.prerelease ? "beta" : "stable",
    title: sanitizeExternalText(release.name ?? release.tag_name, 200),
    changelog: sanitizeExternalText(release.body, 6000),
    publishedAt: release.published_at ?? release.created_at ?? null,
    externalUrl: release.html_url ?? null,
    authoritative: true,
    metadata: { immutable: Boolean(release.immutable), webhook: true },
  };
}

export class MonitorService {
  constructor({ registry, stateStore, githubWebhookSecret = "", githubWebhooksEnabled = false } = {}) {
    if (!registry || !stateStore) throw new Error("registry and stateStore are required");
    this.registry = registry;
    this.stateStore = stateStore;
    this.githubWebhookSecret = githubWebhookSecret;
    this.githubWebhooksEnabled = githubWebhooksEnabled;
  }

  async poll(input) {
    if (!input || !Array.isArray(input.sources) || input.sources.length === 0) {
      throw validationError("sources must be a non-empty array", "sources");
    }
    if (input.sources.length > 100) throw validationError("sources cannot exceed 100 items", "sources");
    const sources = input.sources.map(validateMonitorSource).filter((source) => source.enabled);
    const results = [];

    for (const source of sources) {
      this.stateStore.registerSource(source);
      if (this.stateStore.isBackedOff(source.id) && input.ignoreBackoff !== true) {
        const state = this.stateStore.getSource(source.id);
        results.push({ ...sourceResultBase(source), status: "backoff", backoffUntil: state.backoffUntil, error: state.lastError });
        continue;
      }
      const previous = this.stateStore.getSource(source.id);
      try {
        const fetched = await this.registry.fetch(source, { etag: previous?.etag, lastModified: previous?.lastModified });
        if (fetched.notModified) {
          this.stateStore.recordNotModified(source);
          results.push({ ...sourceResultBase(source), status: "unchanged", newEvents: [], suppressedDuplicates: 0 });
          continue;
        }
        const recorded = this.stateStore.recordSuccess(source, fetched);
        results.push({
          ...sourceResultBase(source),
          status: "modified",
          newEvents: recorded.newEvents,
          suppressedDuplicates: recorded.suppressedDuplicates,
          suppressedHistorical: recorded.suppressedHistorical,
          baselineEstablished: recorded.baselineEstablished,
          latestEvent: recorded.latestEvent,
          fetchedEventCount: fetched.events?.length ?? 0,
        });
      } catch (error) {
        const state = this.stateStore.recordFailure(source, error);
        results.push({
          ...sourceResultBase(source),
          status: "failed",
          error: state.lastError,
          backoffUntil: state.backoffUntil,
        });
      }
    }

    return {
      checkedAt: new Date().toISOString(),
      sourceCount: sources.length,
      newEventCount: results.reduce((sum, result) => sum + (result.newEvents?.length ?? 0), 0),
      failedSourceCount: results.filter((result) => result.status === "failed").length,
      results,
    };
  }

  state() {
    return this.stateStore.snapshot();
  }

  handleGithubWebhook({ sourceId, deliveryId, eventName, signature, rawBody }) {
    if (!this.githubWebhooksEnabled) throw new AppError("GitHub webhooks are disabled", { status: 404, code: "NOT_FOUND" });
    if (!this.githubWebhookSecret) throw new AppError("GitHub webhook secret is not configured", { status: 503, code: "GITHUB_WEBHOOK_NOT_CONFIGURED" });
    if (!deliveryId || deliveryId.length > 200) throw validationError("X-GitHub-Delivery is required", "X-GitHub-Delivery");
    if (!verifyHmacSha256(rawBody, this.githubWebhookSecret, signature)) {
      throw new AppError("GitHub webhook signature is invalid", { status: 403, code: "INVALID_WEBHOOK_SIGNATURE" });
    }
    const state = this.stateStore.getSource(sourceId);
    if (!state || state.source.provider !== "github-release") {
      throw new AppError("Webhook source is not registered", { status: 404, code: "WEBHOOK_SOURCE_NOT_FOUND" });
    }
    if (this.stateStore.hasWebhookDelivery?.(deliveryId)) {
      return { status: "duplicate", deliveryId, newEvents: [] };
    }
    if (eventName !== "release") return { status: "ignored", reason: "unsupported-event", newEvents: [] };
    let payload;
    try { payload = JSON.parse(rawBody.toString("utf8")); }
    catch { throw new AppError("Invalid webhook JSON", { status: 400, code: "INVALID_JSON" }); }
    const action = payload.action;
    if (!payload.release || payload.release.draft || !["published", "released"].includes(action)) {
      return { status: "ignored", reason: "release-not-published", newEvents: [] };
    }
    const repository = payload.repository?.full_name?.toLowerCase();
    const expectedRepository = `${state.source.owner}/${state.source.repo}`.toLowerCase();
    if (repository !== expectedRepository) {
      throw new AppError("Webhook repository does not match the registered source", { status: 409, code: "WEBHOOK_REPOSITORY_MISMATCH" });
    }
    const event = webhookEvent(payload);
    if (!state.source.allowedChannels.includes(event.releaseChannel)) {
      return { status: "ignored", reason: "release-channel-policy", newEvents: [] };
    }
    this.stateStore.recordWebhookDelivery(deliveryId);
    const recorded = this.stateStore.recordSuccess({ ...state.source, emitInitialEvents: true }, { events: [event] });
    return {
      status: recorded.newEvents.length ? "accepted" : "duplicate-event",
      deliveryId,
      sourceId,
      newEvents: recorded.newEvents,
      suppressedDuplicates: recorded.suppressedDuplicates,
    };
  }
}
