import { sanitizeDiscordText } from "./security.js";

export class DeterministicProvider {
  constructor() {
    this.name = "deterministic-local";
    this.model = "nexus-core-rules-v1";
  }

  async assist({ capability, prompt, context = {} }) {
    const safePrompt = sanitizeDiscordText(prompt).trim();
    switch (capability) {
      case "nexus.help":
        return {
          subsystem: "General Assistance",
          content: "Nexus AI Core can explain Khaos Nexus, summarize operational context, inspect normalized update data, prepare safe drafts, and propose maintenance actions. Khaos Nexus remains the execution authority.",
          presentation: { type: "help", severity: "information" },
        };
      case "nexus.discord.draft":
        return {
          subsystem: "Discord Drafts",
          content: `Draft for review:\n\n${safePrompt}`,
          presentation: { type: "draft", severity: "information", reviewRequired: true },
        };
      case "nexus.server.diagnose":
        return {
          subsystem: "Server Diagnostics",
          content: `Diagnostic request recorded: ${safePrompt}\n\nEvidence supplied: ${Object.keys(context).length} context section(s). No server action was executed.`,
          presentation: { type: "diagnostic_summary", severity: "attention" },
        };
      case "nexus.incident.summarize":
        return {
          subsystem: "Incident Assistant",
          content: `Incident summary draft: ${safePrompt}\n\nThis summary is advisory and does not change incident or server state.`,
          presentation: { type: "incident_summary", severity: "attention" },
        };
      default:
        return {
          subsystem: "General Assistance",
          content: `Nexus AI Core received the request: ${safePrompt}\n\nNo action was executed.`,
          presentation: { type: "message", severity: "information" },
        };
    }
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
      presentation: { type: "update_summary", severity },
      recommendation,
    };
  }
}
