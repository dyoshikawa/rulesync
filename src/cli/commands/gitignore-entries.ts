import { RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import {
  ALL_FEATURES_WITH_WILDCARD,
  type Feature,
  type RulesyncFeatures,
} from "../../types/features.js";
import { ALL_TOOL_TARGETS_WITH_WILDCARD, type ToolTarget } from "../../types/tool-targets.js";
import type { Logger } from "../../utils/logger.js";

type GitignoreEntryTarget = ToolTarget | "common";

export type GitignoreEntryTag = {
  readonly target: GitignoreEntryTarget | ReadonlyArray<GitignoreEntryTarget>;
  readonly feature: Feature | "general";
  readonly entry: string;
};

const normalizeGitignoreEntryTargets = (
  target: GitignoreEntryTag["target"],
): ReadonlyArray<GitignoreEntryTarget> => {
  return typeof target === "string" ? [target] : target;
};

export const GITIGNORE_ENTRY_REGISTRY: ReadonlyArray<GitignoreEntryTag> = [
  // Common / general
  {
    target: "common",
    feature: "general",
    entry: `${RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH}/`,
  },
  { target: "common", feature: "general", entry: ".rulesync/rules/*.local.md" },
  { target: "common", feature: "general", entry: "rulesync.local.jsonc" },
  { target: "common", feature: "general", entry: "!.rulesync/.aiignore" },
  // AGENTS.local.md is placed in common scope (not rovodev-only) so that
  // local rule files are always gitignored regardless of which targets are enabled.
  // This prevents accidental commits when a user disables the rovodev target.
  { target: "common", feature: "general", entry: "**/AGENTS.local.md" },

  // AGENTS.md
  { target: "agentsmd", feature: "rules", entry: "**/AGENTS.md" },
  { target: "agentsmd", feature: "rules", entry: "**/.agents/" },

  // Augment Code
  { target: "augmentcode", feature: "rules", entry: "**/.augment/rules/" },
  { target: "augmentcode", feature: "rules", entry: "**/.augment-guidelines" },
  { target: "augmentcode", feature: "ignore", entry: "**/.augmentignore" },

  // Claude Code
  { target: "claudecode", feature: "rules", entry: "**/CLAUDE.md" },
  { target: "claudecode", feature: "rules", entry: "**/CLAUDE.local.md" },
  { target: "claudecode", feature: "rules", entry: "**/.claude/CLAUDE.md" },
  {
    target: "claudecode",
    feature: "rules",
    entry: "**/.claude/CLAUDE.local.md",
  },
  { target: "claudecode", feature: "rules", entry: "**/.claude/rules/" },
  { target: "claudecode", feature: "commands", entry: "**/.claude/commands/" },
  { target: "claudecode", feature: "subagents", entry: "**/.claude/agents/" },
  { target: "claudecode", feature: "skills", entry: "**/.claude/skills/" },
  { target: "claudecode", feature: "mcp", entry: "**/.mcp.json" },
  { target: "claudecode", feature: "general", entry: "**/.claude/memories/" },
  {
    target: "claudecode",
    feature: "general",
    entry: "**/.claude/settings.local.json",
  },

  // Cline
  { target: "cline", feature: "rules", entry: "**/.clinerules/" },
  { target: "cline", feature: "commands", entry: "**/.clinerules/workflows/" },
  { target: "cline", feature: "ignore", entry: "**/.clineignore" },
  { target: "cline", feature: "mcp", entry: "**/.cline/mcp.json" },

  // Codex CLI
  { target: "codexcli", feature: "ignore", entry: "**/.codexignore" },
  { target: "codexcli", feature: "skills", entry: "**/.codex/skills/" },
  { target: "codexcli", feature: "subagents", entry: "**/.codex/agents/" },
  { target: "codexcli", feature: "general", entry: "**/.codex/memories/" },
  { target: "codexcli", feature: "general", entry: "**/.codex/config.toml" },
  { target: "codexcli", feature: "hooks", entry: "**/.codex/hooks.json" },

  // Cursor
  { target: "cursor", feature: "rules", entry: "**/.cursor/" },
  { target: "cursor", feature: "ignore", entry: "**/.cursorignore" },

  // deepagents-cli
  { target: "deepagents", feature: "rules", entry: "**/.deepagents/AGENTS.md" },
  { target: "deepagents", feature: "rules", entry: "**/.deepagents/memories/" },
  { target: "deepagents", feature: "mcp", entry: "**/.deepagents/.mcp.json" },
  { target: "deepagents", feature: "skills", entry: "**/.deepagents/skills/" },
  {
    target: "deepagents",
    feature: "subagents",
    entry: "**/.deepagents/agents/",
  },
  {
    target: "deepagents",
    feature: "hooks",
    entry: "**/.deepagents/hooks.json",
  },

  // Factory Droid
  { target: "factorydroid", feature: "rules", entry: "**/.factory/rules/" },
  {
    target: "factorydroid",
    feature: "commands",
    entry: "**/.factory/commands/",
  },
  {
    target: "factorydroid",
    feature: "subagents",
    entry: "**/.factory/droids/",
  },
  { target: "factorydroid", feature: "skills", entry: "**/.factory/skills/" },
  { target: "factorydroid", feature: "mcp", entry: "**/.factory/mcp.json" },
  {
    target: "factorydroid",
    feature: "general",
    entry: "**/.factory/settings.json",
  },

  // Gemini CLI
  { target: "geminicli", feature: "rules", entry: "**/GEMINI.md" },
  { target: "geminicli", feature: "commands", entry: "**/.gemini/commands/" },
  { target: "geminicli", feature: "subagents", entry: "**/.gemini/agents/" },
  { target: "geminicli", feature: "skills", entry: "**/.gemini/skills/" },
  { target: "geminicli", feature: "ignore", entry: "**/.geminiignore" },
  { target: "geminicli", feature: "general", entry: "**/.gemini/memories/" },

  // Goose
  { target: "goose", feature: "rules", entry: "**/.goosehints" },
  { target: "goose", feature: "rules", entry: "**/.goose/" },
  { target: "goose", feature: "ignore", entry: "**/.gooseignore" },

  // GitHub Copilot
  {
    target: ["copilot", "copilotcli"],
    feature: "rules",
    entry: "**/.github/copilot-instructions.md",
  },
  {
    target: ["copilot", "copilotcli"],
    feature: "rules",
    entry: "**/.github/instructions/",
  },
  { target: "copilot", feature: "commands", entry: "**/.github/prompts/" },
  { target: "copilot", feature: "subagents", entry: "**/.github/agents/" },
  { target: "copilot", feature: "skills", entry: "**/.github/skills/" },
  { target: "copilot", feature: "hooks", entry: "**/.github/hooks/" },
  { target: "copilot", feature: "mcp", entry: "**/.vscode/mcp.json" },

  // GitHub Copilot CLI
  {
    target: "copilotcli",
    feature: "mcp",
    entry: "**/.copilot/mcp-config.json",
  },

  // Junie
  { target: "junie", feature: "rules", entry: "**/.junie/guidelines.md" },
  { target: "junie", feature: "mcp", entry: "**/.junie/mcp.json" },
  { target: "junie", feature: "skills", entry: "**/.junie/skills/" },
  { target: "junie", feature: "subagents", entry: "**/.junie/agents/" },

  // Kilo Code
  { target: "kilo", feature: "rules", entry: "**/.kilo/rules/" },
  { target: "kilo", feature: "skills", entry: "**/.kilo/skills/" },
  { target: "kilo", feature: "commands", entry: "**/.kilo/workflows/" },
  { target: "kilo", feature: "mcp", entry: "**/.kilo/mcp.json" },
  { target: "kilo", feature: "ignore", entry: "**/.kiloignore" },

  // Kiro
  { target: "kiro", feature: "rules", entry: "**/.kiro/steering/" },
  { target: "kiro", feature: "commands", entry: "**/.kiro/prompts/" },
  { target: "kiro", feature: "skills", entry: "**/.kiro/skills/" },
  { target: "kiro", feature: "subagents", entry: "**/.kiro/agents/" },
  { target: "kiro", feature: "mcp", entry: "**/.kiro/settings/mcp.json" },
  { target: "kiro", feature: "ignore", entry: "**/.aiignore" },

  // OpenCode
  { target: "opencode", feature: "commands", entry: "**/.opencode/command/" },
  { target: "opencode", feature: "subagents", entry: "**/.opencode/agent/" },
  { target: "opencode", feature: "skills", entry: "**/.opencode/skill/" },
  { target: "opencode", feature: "mcp", entry: "**/.opencode/plugins/" },
  { target: "opencode", feature: "general", entry: "**/.opencode/memories/" },

  // Qwen Code
  { target: "qwencode", feature: "rules", entry: "**/QWEN.md" },
  { target: "qwencode", feature: "general", entry: "**/.qwen/memories/" },

  // Replit
  { target: "replit", feature: "rules", entry: "**/replit.md" },

  // Roo
  { target: "roo", feature: "rules", entry: "**/.roo/rules/" },
  { target: "roo", feature: "skills", entry: "**/.roo/skills/" },
  { target: "roo", feature: "ignore", entry: "**/.rooignore" },
  { target: "roo", feature: "mcp", entry: "**/.roo/mcp.json" },
  { target: "roo", feature: "subagents", entry: "**/.roo/subagents/" },

  // Rovodev
  {
    target: "rovodev",
    feature: "general",
    entry: "**/.rovodev/AGENTS.md",
  },
  { target: "rovodev", feature: "subagents", entry: "**/.rovodev/subagents/" },
  { target: "rovodev", feature: "skills", entry: "**/.rovodev/skills/" },
  {
    target: "rovodev",
    feature: "general",
    entry: "**/.rovodev/.rulesync/",
  },
  { target: "rovodev", feature: "skills", entry: "**/.agents/skills/" },

  // Warp
  { target: "warp", feature: "rules", entry: "**/.warp/" },
  { target: "warp", feature: "rules", entry: "**/WARP.md" },
] as const;

export const ALL_GITIGNORE_ENTRIES: ReadonlyArray<string> = GITIGNORE_ENTRY_REGISTRY.map(
  (tag) => tag.entry,
);

type FilterGitignoreEntriesParams = {
  readonly targets?: ReadonlyArray<string>;
  readonly features?: RulesyncFeatures;
};

const isTargetSelected = (
  target: GitignoreEntryTag["target"],
  selectedTargets: ReadonlyArray<string> | undefined,
): boolean => {
  const targets = normalizeGitignoreEntryTargets(target);

  if (targets.includes("common")) return true;
  if (!selectedTargets || selectedTargets.length === 0) return true;
  if (selectedTargets.includes("*")) return true;
  return targets.some((candidate) => selectedTargets.includes(candidate));
};

const getSelectedGitignoreEntryTargets = (
  target: GitignoreEntryTag["target"],
  selectedTargets: ReadonlyArray<string> | undefined,
): ReadonlyArray<GitignoreEntryTarget> => {
  const targets = normalizeGitignoreEntryTargets(target);

  if (targets.includes("common")) return ["common"];
  if (!selectedTargets || selectedTargets.length === 0 || selectedTargets.includes("*")) {
    return targets;
  }

  return targets.filter((candidate) => selectedTargets.includes(candidate));
};

const isFeatureSelectedForTarget = (
  feature: Feature | "general",
  target: ToolTarget | "common",
  features: RulesyncFeatures | undefined,
): boolean => {
  if (feature === "general") return true;
  if (!features) return true;

  if (Array.isArray(features)) {
    if (features.length === 0) return true;
    if (features.includes("*")) return true;
    return features.includes(feature);
  }

  // Object format: per-target features
  // NOTE: Unlike Config.getFeatures(target) which returns [] for missing keys,
  // gitignore intentionally treats missing keys as "no restriction" (include all features).
  // This is because gitignore filtering is additive — users specify which targets to restrict,
  // and unmentioned targets should default to including all their entries.
  if (target === "common") return true;
  const targetFeatures = features[target];
  if (!targetFeatures) return true;
  if (targetFeatures.includes("*")) return true;
  return targetFeatures.includes(feature);
};

const isFeatureSelected = (
  feature: Feature | "general",
  target: GitignoreEntryTag["target"],
  features: RulesyncFeatures | undefined,
): boolean => {
  return normalizeGitignoreEntryTargets(target).some((candidate) =>
    isFeatureSelectedForTarget(feature, candidate, features),
  );
};

const warnInvalidTargets = (targets: ReadonlyArray<string>, logger?: Logger): void => {
  const validTargets = new Set<string>(ALL_TOOL_TARGETS_WITH_WILDCARD);
  for (const target of targets) {
    if (!validTargets.has(target)) {
      logger?.warn(
        `Unknown target '${target}'. Valid targets: ${ALL_TOOL_TARGETS_WITH_WILDCARD.join(", ")}`,
      );
    }
  }
};

const warnInvalidFeatures = (features: RulesyncFeatures, logger?: Logger): void => {
  const validFeatures = new Set<string>(ALL_FEATURES_WITH_WILDCARD);
  const warned = new Set<string>();
  const warnOnce = (feature: string): void => {
    if (!validFeatures.has(feature) && !warned.has(feature)) {
      warned.add(feature);
      logger?.warn(
        `Unknown feature '${feature}'. Valid features: ${ALL_FEATURES_WITH_WILDCARD.join(", ")}`,
      );
    }
  };
  if (Array.isArray(features)) {
    for (const feature of features) {
      warnOnce(feature);
    }
  } else {
    for (const targetFeatures of Object.values(features)) {
      if (!targetFeatures) continue;
      for (const feature of targetFeatures) {
        warnOnce(feature);
      }
    }
  }
};

export const filterGitignoreEntries = (
  params?: FilterGitignoreEntriesParams & { logger?: Logger },
): string[] => {
  const { targets, features, logger } = params ?? {};

  if (targets && targets.length > 0) {
    warnInvalidTargets(targets, logger);
  }
  if (features) {
    warnInvalidFeatures(features, logger);
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of GITIGNORE_ENTRY_REGISTRY) {
    if (!isTargetSelected(tag.target, targets)) continue;
    const selectedTagTargets = getSelectedGitignoreEntryTargets(tag.target, targets);
    if (!isFeatureSelected(tag.feature, selectedTagTargets, features)) continue;
    if (seen.has(tag.entry)) continue;
    seen.add(tag.entry);
    result.push(tag.entry);
  }

  return result;
};
