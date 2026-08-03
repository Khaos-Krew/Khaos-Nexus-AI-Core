import { AppError, validationError } from "./errors.js";
import { fetchProviderJson } from "./http-client.js";
import { sanitizeExternalText } from "./security.js";

const PROVIDERS = new Set(["github-release", "modrinth-project", "curseforge-mod", "steam-news"]);
const CHANNELS = new Set(["stable", "beta", "alpha"]);
const SAFE_IDENTIFIER = /^[a-z0-9._-]{1,100}$/i;

function requiredString(value, field, pattern = SAFE_IDENTIFIER) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || !pattern.test(normalized)) throw validationError(`${field} is invalid`, field);
  return normalized;
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) throw validationError(`${field} must be a positive integer`, field);
  return value;
}

function allowedChannels(value) {
  const channels = Array.isArray(value) && value.length > 0 ? value.map((item) => String(item).toLowerCase()) : ["stable"];
  if (channels.some((channel) => !CHANNELS.has(channel))) throw validationError("allowedChannels contains an unsupported channel", "allowedChannels");
  return [...new Set(channels)];
}

export function validateMonitorSource(input, index = 0) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw validationError("Source must be an object", `sources[${index}]`);
  const id = requiredString(input.id, `sources[${index}].id`);
  const provider = String(input.provider ?? "").trim();
  if (!PROVIDERS.has(provider)) throw validationError("Unsupported monitor provider", `sources[${index}].provider`);
  const base = {
    id,
    provider,
    enabled: input.enabled !== false,
    allowedChannels: allowedChannels(input.allowedChannels),
    emitInitialEvents: input.emitInitialEvents === true,
  };

  if (provider === "github-release") {
    return { ...base, owner: requiredString(input.owner, `sources[${index}].owner`), repo: requiredString(input.repo, `sources[${index}].repo`) };
  }
  if (provider === "modrinth-project") {
    return {
      ...base,
      project: requiredString(input.project, `sources[${index}].project`),
      gameVersions: Array.isArray(input.gameVersions) ? input.gameVersions.map(String).slice(0, 20) : [],
      loaders: Array.isArray(input.loaders) ? input.loaders.map(String).slice(0, 20) : [],
    };
  }
  if (provider === "curseforge-mod") {
    return { ...base, modId: positiveInteger(input.modId, `sources[${index}].modId`), gameVersion: input.gameVersion ? String(input.gameVersion).slice(0, 50) : null };
  }
  return {
    ...base,
    appId: positiveInteger(input.appId, `sources[${index}].appId`),
    count: Number.isInteger(input.count) ? Math.min(Math.max(input.count, 1), 20) : 10,
    feeds: Array.isArray(input.feeds) ? input.feeds.map((item) => requiredString(item, `sources[${index}].feeds`)).slice(0, 10) : [],
    keywords: Array.isArray(input.keywords) ? input.keywords.map((item) => String(item).trim().toLowerCase()).filter(Boolean).slice(0, 20) : [],
  };
}

function releaseChannel(value) {
  if (value === "alpha") return "alpha";
  if (value === "beta") return "beta";
  return "stable";
}

function sortNewest(events) {
  return events.sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")));
}

function safeExternalUrl(value, allowedHosts) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedHosts.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

function createGithubAdapter({ fetchImpl, githubToken }) {
  return async (source, conditional) => {
    const url = new URL(`https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/releases`);
    url.searchParams.set("per_page", "20");
    const headers = { "X-GitHub-Api-Version": "2026-03-10", Accept: "application/vnd.github+json" };
    if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
    const response = await fetchProviderJson(url, { fetchImpl, headers, ...conditional });
    if (response.notModified) return response;
    if (!Array.isArray(response.data)) throw new AppError("GitHub release response is invalid", { status: 502, code: "PROVIDER_SCHEMA_ERROR" });
    const events = response.data
      .filter((release) => !release?.draft)
      .map((release) => ({
        providerEventId: `github-release:${release.id}`,
        eventType: "release",
        version: String(release.tag_name ?? release.name ?? release.id),
        releaseChannel: release.prerelease ? "beta" : "stable",
        title: sanitizeExternalText(release.name ?? release.tag_name, 200),
        changelog: sanitizeExternalText(release.body, 6000),
        publishedAt: release.published_at ?? release.created_at ?? null,
        externalUrl: safeExternalUrl(release.html_url, new Set(["github.com"])),
        authoritative: true,
        metadata: { immutable: Boolean(release.immutable), assetCount: Array.isArray(release.assets) ? release.assets.length : 0 },
      }))
      .filter((event) => source.allowedChannels.includes(event.releaseChannel));
    return { ...response, events: sortNewest(events) };
  };
}

function createModrinthAdapter({ fetchImpl }) {
  return async (source, conditional) => {
    const url = new URL(`https://api.modrinth.com/v2/project/${encodeURIComponent(source.project)}/version`);
    url.searchParams.set("include_changelog", "false");
    if (source.gameVersions.length) url.searchParams.set("game_versions", JSON.stringify(source.gameVersions));
    if (source.loaders.length) url.searchParams.set("loaders", JSON.stringify(source.loaders));
    const response = await fetchProviderJson(url, { fetchImpl, ...conditional });
    if (response.notModified) return response;
    if (!Array.isArray(response.data)) throw new AppError("Modrinth version response is invalid", { status: 502, code: "PROVIDER_SCHEMA_ERROR" });
    const events = response.data.map((version) => ({
      providerEventId: `modrinth-version:${version.id}`,
      eventType: "release",
      version: String(version.version_number ?? version.name ?? version.id),
      releaseChannel: releaseChannel(version.version_type),
      title: sanitizeExternalText(version.name ?? version.version_number, 200),
      changelog: "",
      publishedAt: version.date_published ?? null,
      externalUrl: null,
      authoritative: true,
      metadata: {
        gameVersions: Array.isArray(version.game_versions) ? version.game_versions.slice(0, 50) : [],
        loaders: Array.isArray(version.loaders) ? version.loaders.slice(0, 50) : [],
        dependencies: Array.isArray(version.dependencies) ? version.dependencies.slice(0, 100) : [],
        fileIds: Array.isArray(version.files) ? version.files.map((file) => file?.hashes?.sha512 ?? file?.hashes?.sha1 ?? file?.filename).filter(Boolean).slice(0, 50) : [],
      },
    })).filter((event) => source.allowedChannels.includes(event.releaseChannel));
    return { ...response, events: sortNewest(events) };
  };
}

function curseForgeChannel(releaseType) {
  if (releaseType === 3) return "alpha";
  if (releaseType === 2) return "beta";
  return "stable";
}

function createCurseForgeAdapter({ fetchImpl, curseForgeApiKey }) {
  return async (source, conditional) => {
    if (!curseForgeApiKey) throw new AppError("CurseForge API key is not configured", { status: 503, code: "CURSEFORGE_NOT_CONFIGURED" });
    const url = new URL(`https://api.curseforge.com/v1/mods/${source.modId}/files`);
    url.searchParams.set("pageSize", "50");
    if (source.gameVersion) url.searchParams.set("gameVersion", source.gameVersion);
    const response = await fetchProviderJson(url, { fetchImpl, headers: { "x-api-key": curseForgeApiKey }, ...conditional });
    if (response.notModified) return response;
    const files = response.data?.data;
    if (!Array.isArray(files)) throw new AppError("CurseForge file response is invalid", { status: 502, code: "PROVIDER_SCHEMA_ERROR" });
    const events = files.map((file) => ({
      providerEventId: `curseforge-file:${file.id}`,
      eventType: "release",
      version: String(file.displayName ?? file.fileName ?? file.id),
      releaseChannel: curseForgeChannel(file.releaseType),
      title: sanitizeExternalText(file.displayName ?? file.fileName, 200),
      changelog: "",
      publishedAt: file.fileDate ?? null,
      externalUrl: null,
      authoritative: true,
      metadata: {
        fileId: file.id,
        gameVersions: Array.isArray(file.gameVersions) ? file.gameVersions.slice(0, 50) : [],
        dependencies: Array.isArray(file.dependencies) ? file.dependencies.slice(0, 100) : [],
        hashes: Array.isArray(file.hashes) ? file.hashes.slice(0, 10) : [],
        earlyAccess: Boolean(file.isEarlyAccessContent),
      },
    })).filter((event) => source.allowedChannels.includes(event.releaseChannel));
    return { ...response, events: sortNewest(events) };
  };
}

function createSteamNewsAdapter({ fetchImpl }) {
  return async (source, conditional) => {
    const url = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
    url.searchParams.set("appid", String(source.appId));
    url.searchParams.set("count", String(source.count));
    url.searchParams.set("maxlength", "6000");
    url.searchParams.set("format", "json");
    if (source.feeds.length) url.searchParams.set("feeds", source.feeds.join(","));
    const response = await fetchProviderJson(url, { fetchImpl, ...conditional });
    if (response.notModified) return response;
    const items = response.data?.appnews?.newsitems;
    if (!Array.isArray(items)) throw new AppError("Steam news response is invalid", { status: 502, code: "PROVIDER_SCHEMA_ERROR" });
    const events = items.filter((item) => {
      if (source.keywords.length === 0) return true;
      const haystack = `${item.title ?? ""} ${item.contents ?? ""}`.toLowerCase();
      return source.keywords.some((keyword) => haystack.includes(keyword));
    }).map((item) => ({
      providerEventId: `steam-news:${item.gid}`,
      eventType: "news",
      version: null,
      releaseChannel: "stable",
      title: sanitizeExternalText(item.title, 200),
      changelog: sanitizeExternalText(item.contents, 6000),
      publishedAt: Number.isFinite(item.date) ? new Date(item.date * 1000).toISOString() : null,
      externalUrl: safeExternalUrl(item.url, new Set(["store.steampowered.com", "steamcommunity.com"])),
      authoritative: false,
      metadata: { feed: item.feedname ?? null, informationalOnly: true, serverBuildConfirmed: false },
    }));
    return { ...response, events: sortNewest(events) };
  };
}

export function createSourceAdapterRegistry({ fetchImpl = globalThis.fetch, githubToken = "", curseForgeApiKey = "" } = {}) {
  const adapters = new Map([
    ["github-release", createGithubAdapter({ fetchImpl, githubToken })],
    ["modrinth-project", createModrinthAdapter({ fetchImpl })],
    ["curseforge-mod", createCurseForgeAdapter({ fetchImpl, curseForgeApiKey })],
    ["steam-news", createSteamNewsAdapter({ fetchImpl })],
  ]);
  return {
    async fetch(source, conditional = {}) {
      const adapter = adapters.get(source.provider);
      if (!adapter) throw new AppError("Monitor provider is not registered", { status: 400, code: "PROVIDER_NOT_REGISTERED" });
      return adapter(source, conditional);
    },
  };
}
