import type { ToolTarget } from "./tool-targets.js";

// Display metadata for the user-facing supported-tools tables: human label and
// grouping (AI tool vs open standard), in presentation order. This is tool-level
// metadata (not feature-specific), so it lives here once rather than being split
// across the per-feature factories. Support cells are derived from getToolTargets;
// only these labels are hand-maintained. Legacy alias targets are intentionally
// omitted (hidden from the tables).
export type ToolDisplayGroup = "ai" | "standard";

export type ToolDisplayEntry = {
  readonly key: ToolTarget;
  readonly label: string;
  readonly group: ToolDisplayGroup;
};

export const TOOL_DISPLAY: ReadonlyArray<ToolDisplayEntry> = [
  { key: "agentsmd", label: "AGENTS.md", group: "standard" },
  { key: "agentsskills", label: "AgentsSkills", group: "standard" },
  { key: "amp", label: "Amp", group: "ai" },
  { key: "claudecode", label: "Claude Code", group: "ai" },
  { key: "codexcli", label: "Codex CLI", group: "ai" },
  { key: "geminicli", label: "Gemini CLI ⚠️", group: "ai" },
  { key: "copilot", label: "GitHub Copilot", group: "ai" },
  { key: "copilotcli", label: "GitHub Copilot CLI", group: "ai" },
  { key: "goose", label: "Goose", group: "ai" },
  { key: "grokcli", label: "Grok CLI", group: "ai" },
  { key: "hermesagent", label: "Hermes Agent", group: "ai" },
  { key: "cursor", label: "Cursor", group: "ai" },
  { key: "deepagents", label: "deepagents-cli", group: "ai" },
  { key: "factorydroid", label: "Factory Droid", group: "ai" },
  { key: "opencode", label: "OpenCode", group: "ai" },
  { key: "cline", label: "Cline", group: "ai" },
  { key: "kilo", label: "Kilo Code", group: "ai" },
  { key: "roo", label: "Roo Code", group: "ai" },
  { key: "rovodev", label: "Rovodev (Atlassian)", group: "ai" },
  { key: "takt", label: "Takt", group: "ai" },
  { key: "vibe", label: "Vibe Code", group: "ai" },
  { key: "qwencode", label: "Qwen Code", group: "ai" },
  { key: "reasonix", label: "Reasonix", group: "ai" },
  { key: "kiro", label: "Kiro ⚠️", group: "ai" },
  { key: "kiro-cli", label: "Kiro CLI", group: "ai" },
  { key: "kiro-ide", label: "Kiro IDE", group: "ai" },
  { key: "antigravity-ide", label: "Google Antigravity IDE", group: "ai" },
  { key: "antigravity-cli", label: "Google Antigravity CLI", group: "ai" },
  { key: "antigravity", label: "Google Antigravity ⚠️", group: "ai" },
  { key: "junie", label: "JetBrains Junie", group: "ai" },
  { key: "augmentcode", label: "AugmentCode", group: "ai" },
  { key: "devin", label: "Devin Desktop", group: "ai" },
  { key: "warp", label: "Warp", group: "ai" },
  { key: "replit", label: "Replit", group: "ai" },
  { key: "pi", label: "Pi Coding Agent", group: "ai" },
  { key: "zed", label: "Zed", group: "ai" },
];
