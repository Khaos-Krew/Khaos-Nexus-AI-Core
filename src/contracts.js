import {
  API_VERSION,
  CAPABILITY_SET,
  DISCORD_ALLOWED_MENTIONS,
  MAX_CONTEXT_CHARACTERS,
  MAX_PROMPT_CHARACTERS,
  SERVICE_NAME,
  TARGET_SERVICE,
} from "./constants.js";
import { AppError, validationError } from "./errors.js";
import {
  approximateCharacters,
  assertNoForbiddenFields,
  isUuid,
  sanitizeDiscordText,
  stableHash,
} from "./security.js";

const VISIBILITIES = new Set(["ephemeral", "public", "private"]);

export function validateEnvelope(body, expectedCapability) {
  assertNoForbiddenFields(body);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validationError("Request body must be an object", "body");
  }
  if (body.apiVersion !== API_VERSION) {
    throw validationError(`apiVersion must be ${API_VERSION}`, "apiVersion", "UNSUPPORTED_API_VERSION");
  }
  if (!isUuid(body.requestId)) {
    throw validationError("requestId must be a UUID", "requestId");
  }
  if (body.targetService !== TARGET_SERVICE) {
    throw new AppError("This service only accepts targetService=nexus-ai-core and never forwards requests", {
      status: 409,
      code: "WRONG_TARGET_SERVICE",
      field: "targetService",
    });
  }
  if (body.routingDepth !== 0) {
    throw new AppError("routingDepth must be 0; AI-to-AI forwarding is prohibited", {
      status: 409,
      code: "ROUTING_LOOP_PREVENTED",
      field: "routingDepth",
    });
  }
  if (typeof body.capability !== "string" || body.capability.startsWith("dnd.")) {
    throw new AppError("D&D capabilities are isolated in Khaos-Nexus-AI", {
      status: 409,
      code: "DND_CAPABILITY_ISOLATED",
      field: "capability",
    });
  }
  if (!CAPABILITY_SET.has(body.capability)) {
    throw validationError("Unsupported Nexus AI Core capability", "capability", "CAPABILITY_NOT_SUPPORTED");
  }
  if (expectedCapability && body.capability !== expectedCapability) {
    throw validationError(`capability must be ${expectedCapability}`, "capability");
  }
  if (body.prompt !== undefined) {
    if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      throw validationError("prompt must be a non-empty string", "prompt");
    }
    if (body.prompt.length > MAX_PROMPT_CHARACTERS) {
      throw new AppError("prompt is too large", { status: 413, code: "PROMPT_TOO_LARGE", field: "prompt" });
    }
  }
  if (body.context !== undefined && approximateCharacters(body.context) > MAX_CONTEXT_CHARACTERS) {
    throw new AppError("context is too large", { status: 413, code: "CONTEXT_TOO_LARGE", field: "context" });
  }
  return body;
}

export function visibilityFrom(value, fallback = "ephemeral") {
  return VISIBILITIES.has(value) ? value : fallback;
}

export function createNeutralResponse({
  requestId,
  capability,
  subsystem,
  content,
  visibility = "ephemeral",
  presentation = { type: "message", severity: "information" },
  actions = [],
  meta = {},
}) {
  return {
    apiVersion: API_VERSION,
    requestId,
    service: SERVICE_NAME,
    capability,
    attribution: {
      product: "Nexus AI",
      subsystem,
    },
    response: {
      visibility: visibilityFrom(visibility),
      content: sanitizeDiscordText(content),
      allowedMentions: DISCORD_ALLOWED_MENTIONS,
      presentation,
    },
    actions,
    meta,
  };
}

export function createActionProposal({ requestId, tool, riskLevel, arguments: args, expiresInSeconds = 600 }) {
  const proposal = {
    actionId: requestId,
    tool,
    riskLevel,
    requiresConfirmation: riskLevel >= 2,
    arguments: args,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  };
  return { ...proposal, immutableHash: stableHash(proposal) };
}
