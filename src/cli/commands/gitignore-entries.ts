import { RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import {
  ALL_FEATURES_WITH_WILDCARD,
  type Feature,
  type RulesyncFeatures,
} from "../../types/features.js";
import { ALL_TOOL_TARGETS_WITH_WILDCARD, type ToolTarget } from "../../types/tool-targets.js";
import { logger } from "../../utils/logger.js";

export type GitignoreEntryTag = {
  readonly target: ToolTarget | "common";
  readonly feature: Feature | "general";
  readonly entry: string;
};

export const GITIGNORE_ENTRY_REGISTRY: ReadonlyArray<GitignoreEntryTag> = [
  // Common / general
  { target: "common", feature: "general", entry: `${RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH}/` },
  { target: "common", feature: "general", entry: ".rulesync/rules/*.local.md" },
  { target: "common", feature: "general", entry: "rulesync.local.jsonc" },
  { target: "common", feature: "general", entry: "!.rulesync/.aiignore" },

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
  { target: "claudecode", feature: "rules", entry: "**/.claude/CLAUDE.local.md" },
  { target: "claudecode", feature: "rules", entry: "**/.claude/rules/" },
  { target: "claudecode", feature: "commands", entry: "**/.claude/commands/" },
  { target: "claudecode", feature: "subagents", entry: "**/.claude/agents/" },
  { target: "claudecode", feature: "skills", entry: "**/.claude/skills/" },
  { target: "claudecode", feature: "mcp", entry: "**/.mcp.json" },
  { target: "claudecode", feature: "general", entry: "**/.claude/memories/" },
  { target: "claudecode", feature: "general", entry: "**/.claude/settings.local.json" },

  // Cline
  { target: "cline", feature: "rules", entry: "**/.clinerules/" },
  { target: "cline", feature: "rules", entry: "**/.clinerules/workflows/" },
  { target: "cline", feature: "ignore", entry: "**/.clineignore" },
  { target: "cline", feature: "mcp", entry: "**/.cline/mcp.json" },

  // Codex CLI
  { target: "codexcli", feature: "ignore", entry: "**/.codexignore" },
  { target: "codexcli", feature: "skills", entry: "**/.codex/skills/" },
  { target: "codexcli", feature: "subagents", entry: "**/.codex/agents/" },
  { target: "codexcli", feature: "general", entry: "**/.codex/memories/" },
  { target: "codexcli", feature: "general", entry: "**/.codex/config.toml" },

  // Cursor
  { target: "cursor", feature: "rules", entry: "**/.cursor/" },
  { target: "cursor", feature: "ignore", entry: "**/.cursorignore" },

  // Factory Droid
  { target: "factorydroid", feature: "rules", entry: "**/.factory/rules/" },
  { target: "factorydroid", feature: "commands", entry: "**/.factory/commands/" },
  { target: "factorydroid", feature: "subagents", entry: "**/.factory/droids/" },
  { target: "factorydroid", feature: "skills", entry: "**/.factory/skills/" },
  { target: "factorydroid", feature: "mcp", entry: "**/.factory/mcp.json" },
  { target: "factorydroid", feature: "general", entry: "**/.factory/settings.json" },

  // Gemini CLI
  { target: "geminicli", feature: "rules", entry: "**/GEMINI.md" },
  { target: "geminicli", feature: "commands", entry: "**/.gemini/commands/" },
  { target: "geminicli", feature: "subagents", entry: "**/.gemini/subagents/" },
  { target: "geminicli", feature: "skills", entry: "**/.gemini/skills/" },
  { target: "geminicli", feature: "ignore", entry: "**/.geminiignore" },
  { target: "geminicli", feature: "general", entry: "**/.gemini/memories/" },

  // Goose
  { target: "goose", feature: "rules", entry: "**/.goosehints" },
  { target: "goose", feature: "rules", entry: "**/.goose/" },
  { target: "goose", feature: "ignore", entry: "**/.gooseignore" },

  // GitHub Copilot
  { target: "copilot", feature: "rules", entry: "**/.github/copilot-instructions.md" },
  { target: "copilot", feature: "rules", entry: "**/.github/instructions/" },
  { target: "copilot", feature: "commands", entry: "**/.github/prompts/" },
  { target: "copilot", feature: "subagents", entry: "**/.github/agents/" },
  { target: "copilot", feature: "skills", entry: "**/.github/skills/" },
  { target: "copilot", feature: "hooks", entry: "**/.github/hooks/" },
  { target: "copilot", feature: "mcp", entry: "**/.vscode/mcp.json" },

  // Junie
  { target: "junie", feature: "rules", entry: "**/.junie/guidelines.md" },
  { target: "junie", feature: "mcp", entry: "**/.junie/mcp.json" },
  { target: "junie", feature: "skills", entry: "**/.junie/skills/" },
  { target: "junie", feature: "subagents", entry: "**/.junie/agents/" },

  // Kilo Code
  { target: "kilo", feature: "rules", entry: "**/.kilocode/rules/" },
  { target: "kilo", feature: "skills", entry: "**/.kilocode/skills/" },
  { target: "kilo", feature: "skills", entry: "**/.kilocode/workflows/" },
  { target: "kilo", feature: "mcp", entry: "**/.kilocode/mcp.json" },
  { target: "kilo", feature: "ignore", entry: "**/.kilocodeignore" },

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
  target: ToolTarget | "common",
  selectedTargets: ReadonlyArray<string> | undefined,
): boolean => {
  if (target === "common") return true;
  if (!selectedTargets || selectedTargets.length === 0) return true;
  if (selectedTargets.includes("*")) return true;
  return selectedTargets.includes(target);
};

const isFeatureSelected = (
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
  if (target === "common") return true;
  const targetFeatures = features[target];
  if (!targetFeatures) return true;
  if (targetFeatures.includes("*")) return true;
  return targetFeatures.includes(feature);
};

const warnInvalidTargets = (targets: ReadonlyArray<string>): void => {
  const validTargets = new Set<string>(ALL_TOOL_TARGETS_WITH_WILDCARD);
  for (const target of targets) {
    if (!validTargets.has(target)) {
      logger.warn(
        `Unknown target '${target}'. Valid targets: ${ALL_TOOL_TARGETS_WITH_WILDCARD.join(", ")}`,
      );
    }
  }
};

const warnInvalidFeatures = (features: RulesyncFeatures): void => {
  const validFeatures = new Set<string>(ALL_FEATURES_WITH_WILDCARD);
  if (Array.isArray(features)) {
    for (const feature of features) {
      if (!validFeatures.has(feature)) {
        logger.warn(
          `Unknown feature '${feature}'. Valid features: ${ALL_FEATURES_WITH_WILDCARD.join(", ")}`,
        );
      }
    }
  } else {
    for (const targetFeatures of Object.values(features)) {
      if (!targetFeatures) continue;
      for (const feature of targetFeatures) {
        if (!validFeatures.has(feature)) {
          logger.warn(
            `Unknown feature '${feature}'. Valid features: ${ALL_FEATURES_WITH_WILDCARD.join(", ")}`,
          );
        }
      }
    }
  }
};

export const filterGitignoreEntries = (params?: FilterGitignoreEntriesParams): string[] => {
  const { targets, features } = params ?? {};

  if (targets && targets.length > 0) {
    warnInvalidTargets(targets);
  }
  if (features) {
    warnInvalidFeatures(features);
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of GITIGNORE_ENTRY_REGISTRY) {
    if (!isTargetSelected(tag.target, targets)) continue;
    if (!isFeatureSelected(tag.feature, tag.target, features)) continue;
    if (seen.has(tag.entry)) continue;
    seen.add(tag.entry);
    result.push(tag.entry);
  }

  return result;
};
