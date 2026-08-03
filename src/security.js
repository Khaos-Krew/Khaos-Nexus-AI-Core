import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AppError, validationError } from "./errors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_KEYS = new Set([
  "authorization",
  "bottoken",
  "discordtoken",
  "servicetoken",
  "accesstoken",
  "refreshtoken",
  "password",
  "rconpassword",
  "apikey",
  "apisecret",
  "clientsecret",
  "privatekey",
  "connectionstring",
  "credential",
  "credentials",
]);
const REDACTED_VALUE_PATTERN = /(bearer\s+[a-z0-9._~+/=-]+|(?:sk|ghp|github_pat|xox[baprs])[-_a-z0-9]{12,})/gi;

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizedKey(key) {
  return String(key).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function assertNoForbiddenFields(value, path = "body") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenFields(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (FORBIDDEN_KEYS.has(normalized)) {
      throw validationError(`Protected credential field is not accepted: ${path}.${key}`, `${path}.${key}`, "PROTECTED_FIELD_REJECTED");
    }
    assertNoForbiddenFields(nested, `${path}.${key}`);
  }
}

export function redactText(value) {
  return String(value ?? "").replace(REDACTED_VALUE_PATTERN, "[REDACTED]");
}

export function sanitizeDiscordText(value) {
  return redactText(value)
    .replace(/@everyone/gi, "@\u200beveryone")
    .replace(/@here/gi, "@\u200bhere")
    .replace(/<@&?\d+>/g, "[mention]");
}

export function sanitizeExternalText(value, maxCharacters = 4_000) {
  return redactText(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxCharacters);
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest();
}

export function constantTimeEqual(left, right) {
  const leftDigest = digest(left);
  const rightDigest = digest(right);
  return timingSafeEqual(leftDigest, rightDigest);
}

export function verifyHmacSha256(payload, secret, signature) {
  if (!secret || typeof signature !== "string" || !signature.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  return constantTimeEqual(expected, signature);
}

export function extractBearerToken(request) {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function authenticateRequest(request, { serviceToken, authRequired }) {
  const supplied = extractBearerToken(request);
  const configured = typeof serviceToken === "string" && serviceToken.length > 0;

  if (!supplied) {
    if (authRequired || configured) {
      throw new AppError("Authorization: Bearer <service-token> is required", {
        status: 401,
        code: "AUTHENTICATION_REQUIRED",
      });
    }
    return { subject: "local-development", authenticated: false };
  }

  if (!configured || !constantTimeEqual(supplied, serviceToken)) {
    throw new AppError("Invalid service token", { status: 401, code: "INVALID_SERVICE_TOKEN" });
  }

  return { subject: "khaos-nexus-desktop", authenticated: true };
}

export function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(sortObject(value))).digest("hex");
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

export function approximateCharacters(value) {
  return JSON.stringify(value ?? null).length;
}
