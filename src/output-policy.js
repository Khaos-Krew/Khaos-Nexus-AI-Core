import { AppError } from "./errors.js";
import { sanitizeDiscordText, sanitizeExternalText } from "./security.js";

const CAPABILITY_POLICY = Object.freeze({
  "nexus.help": {
    types: new Set(["help", "message"]),
    severities: new Set(["information", "attention"]),
    reviewRequired: false,
  },
  "nexus.discord.assist": {
    types: new Set(["message", "help", "draft"]),
    severities: new Set(["information", "attention", "urgent", "critical"]),
    reviewRequired: null,
  },
  "nexus.discord.draft": {
    types: new Set(["draft"]),
    severities: new Set(["information", "attention", "urgent", "critical"]),
    reviewRequired: true,
  },
  "nexus.server.diagnose": {
    types: new Set(["diagnostic_summary", "message"]),
    severities: new Set(["information", "attention", "urgent", "critical"]),
    reviewRequired: null,
  },
  "nexus.incident.summarize": {
    types: new Set(["incident_summary", "draft"]),
    severities: new Set(["information", "attention", "urgent", "critical"]),
    reviewRequired: true,
  },
  "nexus.update.analyze": {
    types: new Set(["update_summary"]),
    severities: new Set(["information", "attention", "urgent", "critical"]),
    reviewRequired: false,
  },
});

const EXECUTION_CLAIM_PATTERN = /\b(?:i|we|nexus ai|the assistant)\s+(?:have\s+|already\s+)?(?:executed|scheduled|sent|published|posted|restarted|stopped|started|updated|downloaded|installed|banned|kicked|saved|modified|approved|deleted|created|changed|applied|completed|restored|rolled\s+back)\b/i;
const PASSIVE_EXECUTION_PATTERN = /\b(?:was|were|has been|have been)\s+(?:successfully\s+)?(?:scheduled|sent|published|posted|restarted|stopped|started|updated|downloaded|installed|banned|kicked|saved|modified|approved|deleted|created|changed|applied|completed|restored|rolled\s+back)\s+(?:by\s+(?:me|nexus ai|the assistant))\b/i;
const DND_BOUNDARY_PATTERN = /\b(?:dungeon\s+master|game\s+master|co[- ]?dm|d&d\s+campaign|campaign\s+turn|roll\s+initiative|dm\s+screen|player\s+character\s+dialogue)\b/i;
const SECRET_PATTERN = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:OPENAI_API_KEY|DISCORD_TOKEN|RCON_PASSWORD|CLIENT_SECRET)\s*=\s*\S+)/i;
const INSTRUCTION_DISCLOSURE_PATTERN = /\b(?:my|the)\s+(?:system prompt|developer message|hidden instructions|internal policy|chain of thought)\s+(?:is|says|contains|was)\b/i;
const URL_PATTERN = /https?:\/\/[^\s)\]}>]+/i;

function policyError(code, message) {
  return new AppError(message, { status: 422, code, retryable: false });
}

function capabilityPolicy(capability) {
  const policy = CAPABILITY_POLICY[capability];
  if (!policy) throw policyError("AI_OUTPUT_CAPABILITY_POLICY_MISSING", "No output policy exists for this capability");
  return policy;
}

export function validateProviderOutputPolicy({ capability, output }) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw policyError("AI_OUTPUT_SCHEMA_VIOLATION", "Provider output is not an object");
  }
  const policy = capabilityPolicy(capability);
  const rawSubsystem = typeof output.subsystem === "string" ? output.subsystem.trim() : "";
  const rawContent = typeof output.content === "string" ? output.content.trim() : "";
  const presentation = output.presentation;

  if (!rawSubsystem || !rawContent || !presentation || typeof presentation !== "object" || Array.isArray(presentation)) {
    throw policyError("AI_OUTPUT_SCHEMA_VIOLATION", "Provider output is incomplete");
  }
  if (rawSubsystem.length > 80 || rawContent.length > 6_000) {
    throw policyError("AI_OUTPUT_TOO_LARGE", "Provider output exceeds the allowed length");
  }
  if (!policy.types.has(presentation.type)) {
    throw policyError("AI_OUTPUT_PRESENTATION_MISMATCH", "Provider output presentation does not match the capability");
  }
  if (!policy.severities.has(presentation.severity)) {
    throw policyError("AI_OUTPUT_SEVERITY_MISMATCH", "Provider output severity does not match the capability");
  }
  if (typeof presentation.reviewRequired !== "boolean") {
    throw policyError("AI_OUTPUT_SCHEMA_VIOLATION", "Provider output review policy is invalid");
  }
  if (policy.reviewRequired !== null && presentation.reviewRequired !== policy.reviewRequired) {
    throw policyError("AI_OUTPUT_REVIEW_POLICY_MISMATCH", "Provider output review requirement does not match the capability");
  }

  const rawCombined = `${rawSubsystem}\n${rawContent}`;
  if (EXECUTION_CLAIM_PATTERN.test(rawCombined) || PASSIVE_EXECUTION_PATTERN.test(rawCombined)) {
    throw policyError("AI_OUTPUT_EXECUTION_CLAIM", "Provider output claimed an operation was executed");
  }
  if (DND_BOUNDARY_PATTERN.test(rawCombined)) {
    throw policyError("AI_OUTPUT_DND_BOUNDARY", "Provider output crossed the D&D service boundary");
  }
  if (SECRET_PATTERN.test(rawCombined)) {
    throw policyError("AI_OUTPUT_SECRET_DETECTED", "Provider output contained credential-like data");
  }
  if (INSTRUCTION_DISCLOSURE_PATTERN.test(rawCombined)) {
    throw policyError("AI_OUTPUT_INSTRUCTION_DISCLOSURE", "Provider output disclosed internal instructions");
  }
  if (URL_PATTERN.test(rawCombined)) {
    throw policyError("AI_OUTPUT_UNTRUSTED_LINK", "Provider-generated links are not allowed in this response surface");
  }

  const subsystem = sanitizeExternalText(rawSubsystem, 80);
  const content = sanitizeDiscordText(rawContent).trim();
  if (!subsystem || !content) throw policyError("AI_OUTPUT_SCHEMA_VIOLATION", "Provider output became empty after sanitization");

  return {
    ...output,
    subsystem,
    content,
    presentation: {
      ...presentation,
      type: presentation.type,
      severity: presentation.severity,
      reviewRequired: presentation.reviewRequired,
    },
    policy: {
      validated: true,
      capability,
      rulesVersion: "1",
    },
  };
}

export const providerOutputPolicy = Object.freeze({
  rulesVersion: "1",
  capabilities: Object.keys(CAPABILITY_POLICY),
});
