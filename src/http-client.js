import { AppError } from "./errors.js";

const ALLOWED_ORIGINS = new Set([
  "https://api.github.com",
  "https://api.modrinth.com",
  "https://api.curseforge.com",
  "https://api.steampowered.com",
]);

function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), 5_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.min(Math.max(timestamp - Date.now(), 0), 5_000) : 0;
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBoundedBody(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new AppError("Provider response exceeded the configured size limit", {
        status: 502,
        code: "PROVIDER_RESPONSE_TOO_LARGE",
      });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function assertAllowedProviderUrl(value) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_ORIGINS.has(url.origin)) {
    throw new AppError("Provider URL is not allowlisted", { status: 400, code: "PROVIDER_URL_REJECTED" });
  }
  if (url.username || url.password || url.hash) {
    throw new AppError("Provider URL contains forbidden credentials or fragment", { status: 400, code: "PROVIDER_URL_REJECTED" });
  }
  return url;
}

export async function fetchProviderJson(urlValue, {
  fetchImpl = globalThis.fetch,
  headers = {},
  etag,
  lastModified,
  timeoutMs = 8_000,
  maxBytes = 1_000_000,
  retries = 1,
} = {}) {
  const url = assertAllowedProviderUrl(urlValue);
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", "application/json");
  requestHeaders.set("User-Agent", "Khaos-Nexus-AI-Core/0.2.0");
  if (etag) requestHeaders.set("If-None-Match", etag);
  if (lastModified) requestHeaders.set("If-Modified-Since", lastModified);

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: requestHeaders,
        redirect: "error",
        signal: controller.signal,
      });
      clearTimeout(timer);
      const metadata = {
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
      if (response.status === 304) return { notModified: true, data: null, ...metadata };
      const body = await readBoundedBody(response, maxBytes);
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const error = new AppError(`Provider request failed with HTTP ${response.status}`, {
          status: 502,
          code: "PROVIDER_HTTP_ERROR",
          retryable,
        });
        error.providerStatus = response.status;
        error.retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        throw error;
      }
      let data;
      try {
        data = body.length === 0 ? null : JSON.parse(body.toString("utf8"));
      } catch {
        throw new AppError("Provider returned invalid JSON", { status: 502, code: "PROVIDER_INVALID_JSON" });
      }
      return { notModified: false, data, ...metadata };
    } catch (error) {
      clearTimeout(timer);
      lastError = error.name === "AbortError"
        ? new AppError("Provider request timed out", { status: 504, code: "PROVIDER_TIMEOUT", retryable: true })
        : error;
      if (attempt >= retries || !lastError.retryable) break;
      await sleep(lastError.retryAfterMs || 100 * (attempt + 1));
    }
  }
  throw lastError;
}
