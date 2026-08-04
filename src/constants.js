export const SERVICE_NAME = "khaos-nexus-ai-core";
export const API_VERSION = "1";
export const SERVICE_VERSION = "0.7.0";
export const TARGET_SERVICE = "nexus-ai-core";
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_PROMPT_CHARACTERS = 12_000;
export const MAX_CONTEXT_CHARACTERS = 80_000;

export const CAPABILITIES = Object.freeze([
  "nexus.help",
  "nexus.discord.assist",
  "nexus.discord.draft",
  "nexus.server.diagnose",
  "nexus.update.compare",
  "nexus.update.analyze",
  "nexus.update.poll",
  "nexus.update.state",
  "nexus.update.evaluate",
  "nexus.update.digest",
  "nexus.maintenance.propose",
  "nexus.incident.summarize",
]);

export const CAPABILITY_SET = new Set(CAPABILITIES);

export const DISCORD_ALLOWED_MENTIONS = Object.freeze({
  parse: [],
  users: [],
  roles: [],
  repliedUser: false,
});
