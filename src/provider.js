import { sanitizeDiscordText } from "./security.js";

function deterministicMeta(provider, extra = {}) {
  return {
    provider: provider.name,
    model: provider.model,
    providerRequestId: null,
    latencyMs: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    fallback: null,
    store: false,
    toolsUsed: 0,
    ...extra,
  };
}

export class DeterministicProvider {
  constructor() {
    this.name = "deterministic-local";
    this.model = "nexus-core-rules-v1";
    this.ready = true;
  }

  status() {
    return {
      name: this.name,
      model: this.model,
      ready: this.ready,
      store: false,
      toolsAllowed: false,
    };
  }

  async assist({ capability, prompt, context = {} }) {
    const safePrompt = sanitizeDiscordText(prompt).trim();
    let result;
    switch (capability) {
      case "nexus.help":
        result = {
          subsystem: "General Assistance",
          content: "Nexus AI Core can explain Khaos Nexus, summarize operational context, inspect normalized update data, prepare safe drafts, and propose maintenance actions. Khaos Nexus remains the execution authority.",
          presentation: { type: "help", severity: "information", reviewRequired: false },
        };
        break;
      case "nexus.discord.draft":
        result = {
          subsystem: "Discord Drafts",
          content: `Draft for review:\n\n${safePrompt}`,
          presentation: { type: "draft", severity: "information", reviewRequired: true },
        };
        break;
      case "nexus.server.diagnose":
        result = {
          subsystem: "Server Diagnostics",
          content: `Diagnostic request recorded: ${safePrompt}\n\nEvidence supplied: ${Object.keys(context).length} context section(s). No server action was executed.`,
          presentation: { type: "diagnostic_summary", severity: "attention", reviewRequired: false },
        };
        break;
      case "nexus.incident.summarize":
        result = {
          subsystem: "Incident Assistant",
          content: `Incident summary draft: ${safePrompt}\n\nThis summary is advisory and does not change incident or server state.`,
          presentation: { type: "incident_summary", severity: "attention", reviewRequired: true },
        };
        break;
      default:
        result = {
          subsystem: "General Assistance",
          content: `Nexus AI Core received the request: ${safePrompt}\n\nNo action was executed.`,
          presentation: { type: "message", severity: "information", reviewRequired: false },
        };
    }
    return { ...result, meta: deterministicMeta(this) };
  }

  async analyzeUpdates(comparison) {
    const { summary, blockers, clusterFindings } = comparison;
    const severity = blockers.length > 0 || clusterFindings.length > 0 ? "attention" : "information";
    const recommendation = blockers.length > 0
      ? "Do not begin automatic maintenance. Resolve the listed blockers and recheck readiness."
      : summary.updateAvailable > 0
        ? "Updates are available. Prepare a reviewed maintenance plan through the shared scheduler."
        : "Tracked resources are current.";
    return {
      subsystem: "Game & Mod Update Monitor",
      content: [
        `Tracked resources: ${summary.total}`,
        `Updates available: ${summary.updateAvailable}`,
        `Ready resources: ${summary.ready}`,
        `Blocking findings: ${summary.blocked + clusterFindings.length}`,
        "",
        recommendation,
      ].join("\n"),
      presentation: { type: "update_summary", severity, reviewRequired: false },
      recommendation,
      meta: deterministicMeta(this),
    };
  }
}
