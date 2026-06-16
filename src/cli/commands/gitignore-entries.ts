import { GITIGNORE_DESTINATION_KEY } from "../../config/config.js";
import {
  CLAUDECODE_AGENTS_DIR_PATH,
  CLAUDECODE_COMMANDS_DIR_PATH,
  CLAUDECODE_DIR,
  CLAUDECODE_LOCAL_RULE_FILE_NAME,
  CLAUDECODE_MCP_FILE_NAME,
  CLAUDECODE_MEMORIES_DIR_NAME,
  CLAUDECODE_RULE_FILE_NAME,
  CLAUDECODE_RULES_DIR_NAME,
  CLAUDECODE_SETTINGS_LOCAL_FILE_NAME,
  CLAUDECODE_SKILLS_DIR_PATH,
} from "../../constants/claudecode-paths.js";
import { RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import {
  ALL_FEATURES_WITH_WILDCARD,
  type Feature,
  isFeatureValueEnabled,
  type RulesyncFeatures,
} from "../../types/features.js";
import { ALL_TOOL_TARGETS_WITH_WILDCARD, type ToolTarget } from "../../types/tool-targets.js";
import { toPosixPath } from "../../utils/file.js";
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
  // AGENTS.local.md is placed in common scope (not rovodev-only) so that
  // local rule files are always gitignored regardless of which targets are enabled.
  // This prevents accidental commits when a user disables the rovodev target.
  { target: "common", feature: "general", entry: "**/AGENTS.local.md" },

  // AGENTS.md
  {
    target: ["agentsmd", "amp", "antigravity-cli", "antigravity-ide", "pi", "vibe", "warp"],
    feature: "rules",
    entry: "**/AGENTS.md",
  },
  { target: "agentsmd", feature: "rules", entry: "**/.agents/" },

  // Amp
  // Amp reads project rules from a root `AGENTS.md` (handled by the shared
  // AGENTS.md entry above) plus `.agents/memories/*.md` non-root rules. Agent
  // Skills come from the shared `.agents/skills/` project tree. The
  // `.amp/settings.json` permissions file is a user-managed file (like other
  // tools' settings.json), so it is intentionally not gitignored.
  { target: "amp", feature: "rules", entry: "**/.agents/memories/" },
  { target: "amp", feature: "skills", entry: "**/.agents/skills/" },

  // Antigravity (IDE + CLI, Antigravity 2.0)
  // Both targets share the `.agents/` project tree and both write a root
  // `AGENTS.md` (handled by the shared AGENTS.md entry above). Global-scope
  // paths (under the home directory, e.g. `~/.gemini/GEMINI.md`) are
  // intentionally not gitignored.
  {
    target: ["antigravity-ide", "antigravity-cli"],
    feature: "rules",
    entry: "**/.agents/rules/",
  },
  { target: "antigravity-cli", feature: "ignore", entry: "**/.geminiignore" },
  {
    target: "antigravity-ide",
    feature: "commands",
    entry: "**/.agents/workflows/",
  },
  {
    target: ["antigravity-ide", "antigravity-cli"],
    feature: "skills",
    entry: "**/.agents/skills/",
  },
  {
    target: ["antigravity-ide", "antigravity-cli"],
    feature: "mcp",
    entry: "**/.agents/mcp_config.json",
  },
  {
    target: ["antigravity-ide", "antigravity-cli"],
    feature: "hooks",
    entry: "**/.agents/hooks.json",
  },

  // Augment Code
  { target: "augmentcode", feature: "rules", entry: "**/.augment/rules/" },
  { target: "augmentcode", feature: "rules", entry: "**/.augment-guidelines" },
  { target: "augmentcode", feature: "commands", entry: "**/.augment/commands/" },
  { target: "augmentcode", feature: "subagents", entry: "**/.augment/agents/" },
  { target: "augmentcode", feature: "skills", entry: "**/.augment/skills/" },
  { target: "augmentcode", feature: "ignore", entry: "**/.augmentignore" },
  { target: "augmentcode", feature: "permissions", entry: "**/.augment/settings.json" },
  { target: "augmentcode", feature: "hooks", entry: "**/.augment/settings.json" },
  // settings.json is shared with permissions/hooks; re-tag it under `mcp` so
  // target+feature filtering still resolves the file for MCP runs.
  { target: "augmentcode", feature: "mcp", entry: "**/.augment/settings.json" },

  // Claude Code
  { target: "claudecode", feature: "rules", entry: `**/${CLAUDECODE_RULE_FILE_NAME}` },
  { target: "claudecode", feature: "rules", entry: `**/${CLAUDECODE_LOCAL_RULE_FILE_NAME}` },
  {
    target: "claudecode",
    feature: "rules",
    entry: `**/${CLAUDECODE_DIR}/${CLAUDECODE_RULE_FILE_NAME}`,
  },
  {
    target: "claudecode",
    feature: "rules",
    entry: `**/${CLAUDECODE_DIR}/${CLAUDECODE_LOCAL_RULE_FILE_NAME}`,
  },
  {
    target: "claudecode",
    feature: "rules",
    entry: `**/${CLAUDECODE_DIR}/${CLAUDECODE_RULES_DIR_NAME}/`,
  },
  {
    target: "claudecode",
    feature: "commands",
    entry: `**/${toPosixPath(CLAUDECODE_COMMANDS_DIR_PATH)}/`,
  },
  {
    target: "claudecode",
    feature: "subagents",
    entry: `**/${toPosixPath(CLAUDECODE_AGENTS_DIR_PATH)}/`,
  },
  {
    target: "claudecode",
    feature: "skills",
    entry: `**/${toPosixPath(CLAUDECODE_SKILLS_DIR_PATH)}/`,
  },
  { target: "claudecode", feature: "mcp", entry: `**/${CLAUDECODE_MCP_FILE_NAME}` },
  {
    target: "claudecode",
    feature: "general",
    entry: `**/${CLAUDECODE_DIR}/${CLAUDECODE_MEMORIES_DIR_NAME}/`,
  },
  {
    target: "claudecode",
    feature: "general",
    entry: `**/${CLAUDECODE_DIR}/${CLAUDECODE_SETTINGS_LOCAL_FILE_NAME}`,
  },
  { target: "claudecode", feature: "general", entry: `**/${CLAUDECODE_DIR}/*.lock` },

  // Cline
  { target: "cline", feature: "rules", entry: "**/.clinerules/" },
  { target: "cline", feature: "commands", entry: "**/.clinerules/workflows/" },
  { target: "cline", feature: "ignore", entry: "**/.clineignore" },
  // Cline reads MCP only from a global settings file
  // (`~/.cline/data/settings/cline_mcp_settings.json`), which lives under the
  // home directory and is not gitignored at the project level.
  { target: "cline", feature: "subagents", entry: "**/.cline/agents/" },
  { target: "cline", feature: "permissions", entry: "**/.cline/command-permissions.json" },

  // Codex CLI
  { target: "codexcli", feature: "ignore", entry: "**/.codexignore" },
  { target: "codexcli", feature: "skills", entry: "**/.agents/skills/" },
  { target: "codexcli", feature: "subagents", entry: "**/.codex/agents/" },
  { target: "codexcli", feature: "general", entry: "**/.codex/memories/" },
  { target: "codexcli", feature: "general", entry: "**/.codex/config.toml" },
  { target: "codexcli", feature: "hooks", entry: "**/.codex/hooks.json" },

  // Cursor
  { target: "cursor", feature: "rules", entry: "**/.cursor/" },
  { target: "cursor", feature: "ignore", entry: "**/.cursorignore" },
  // .cursor/cli.json (project) and .cursor/cli-config.json (global) are
  // already covered by the broader **/.cursor/ entry above; the additional
  // `permissions` and `hooks` tags below register the same prefix under the
  // matching feature so target+feature filtering still resolves correctly.
  { target: "cursor", feature: "permissions", entry: "**/.cursor/" },
  { target: "cursor", feature: "hooks", entry: "**/.cursor/" },

  // deepagents-cli
  // All rule content is folded into the single `.deepagents/AGENTS.md`; there is
  // no `.deepagents/memories/` directory.
  { target: "deepagents", feature: "rules", entry: "**/.deepagents/AGENTS.md" },
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
    feature: "hooks",
    entry: "**/.factory/hooks.json",
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
  // Goose recipes: commands map to top-level recipes (`.goose/recipes/*.yaml`)
  // and subagents to sub-recipes (`.goose/recipes/subagents/*.yaml`). These are
  // already covered by the broad `**/.goose/` rules entry above, but tagging
  // them per-feature keeps coverage correct under feature-filtered gitignore.
  { target: "goose", feature: "commands", entry: "**/.goose/recipes/" },
  { target: "goose", feature: "subagents", entry: "**/.goose/recipes/subagents/" },
  // Goose lifecycle hooks plugin (.agents/plugins/<name>/hooks/hooks.json)
  { target: "goose", feature: "hooks", entry: "**/.agents/plugins/" },
  // Goose reads MCP "extensions" only from the global user config
  // (`~/.config/goose/config.yaml`), which lives under the home directory and is
  // not gitignored at the project level (mirrors Cline's global-only MCP).

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
  // Copilot CLI shares the project `.github/skills/` location with the Copilot
  // IDE target; its personal skills live under `~/.copilot/skills/` (home dir,
  // not gitignored at the project level).
  { target: ["copilot", "copilotcli"], feature: "skills", entry: "**/.github/skills/" },
  { target: "copilot", feature: "hooks", entry: "**/.github/hooks/" },
  { target: "copilot", feature: "mcp", entry: "**/.vscode/mcp.json" },

  // GitHub Copilot CLI
  {
    target: "copilotcli",
    feature: "mcp",
    entry: "**/.copilot/mcp-config.json",
  },
  // Project: <project>/.github/agents/*.agent.md
  // Global: ~/.copilot/agents/
  { target: "copilotcli", feature: "subagents", entry: "**/.github/agents/" },
  { target: "copilotcli", feature: "subagents", entry: "**/.copilot/agents/" },
  // Project: <project>/.github/hooks/copilotcli-hooks.json
  // Global: ~/.copilot/hooks/copilot-hooks.json (rulesync convention pending
  //         official documentation of a global hooks location)
  { target: "copilotcli", feature: "hooks", entry: "**/.github/hooks/" },
  { target: "copilotcli", feature: "hooks", entry: "**/.copilot/hooks/" },

  // Junie
  { target: "junie", feature: "rules", entry: "**/.junie/guidelines.md" },
  { target: "junie", feature: "mcp", entry: "**/.junie/mcp/mcp.json" },
  { target: "junie", feature: "skills", entry: "**/.junie/skills/" },
  { target: "junie", feature: "subagents", entry: "**/.junie/agents/" },

  // Kilo Code
  { target: "kilo", feature: "rules", entry: "**/.kilo/rules/" },
  { target: "kilo", feature: "skills", entry: "**/.kilo/skills/" },
  { target: "kilo", feature: "commands", entry: "**/.kilo/workflows/" },
  { target: "kilo", feature: "mcp", entry: "**/.kilo/mcp.json" },
  { target: "kilo", feature: "ignore", entry: "**/.kilocodeignore" },
  // No `**/kilo.jsonc` entry: structurally identical to `opencode.jsonc` (no
  // entry). The Kilo translator preserves non-permissions Kilo settings on
  // round-trip, so the file is intended to be checked in by the user — adding
  // `**/kilo.jsonc` would be too aggressive.

  // Kiro
  { target: "kiro", feature: "rules", entry: "**/.kiro/steering/" },
  { target: "kiro", feature: "commands", entry: "**/.kiro/prompts/" },
  { target: "kiro", feature: "skills", entry: "**/.kiro/skills/" },
  { target: "kiro", feature: "subagents", entry: "**/.kiro/agents/" },
  { target: "kiro", feature: "mcp", entry: "**/.kiro/settings/mcp.json" },
  { target: "kiro", feature: "ignore", entry: "**/.aiignore" },
  // Kiro IDE and CLI write to the same `.kiro/` tree as the legacy `kiro` alias.
  // (Kiro IDE subagents are Markdown under `.kiro/agents/`, the CLI's are JSON —
  // both covered by the shared `**/.kiro/agents/` entry.)
  { target: ["kiro-cli", "kiro-ide"], feature: "rules", entry: "**/.kiro/steering/" },
  { target: ["kiro-cli", "kiro-ide"], feature: "commands", entry: "**/.kiro/prompts/" },
  { target: ["kiro-cli", "kiro-ide"], feature: "skills", entry: "**/.kiro/skills/" },
  { target: ["kiro-cli", "kiro-ide"], feature: "subagents", entry: "**/.kiro/agents/" },
  { target: ["kiro-cli", "kiro-ide"], feature: "mcp", entry: "**/.kiro/settings/mcp.json" },
  { target: ["kiro-cli", "kiro-ide"], feature: "ignore", entry: "**/.aiignore" },
  // Keep this after ignore entries like "**/.aiignore" so the exception remains effective.
  { target: "common", feature: "general", entry: "!.rulesync/.aiignore" },

  // OpenCode
  { target: "opencode", feature: "commands", entry: "**/.opencode/commands/" },
  { target: "opencode", feature: "subagents", entry: "**/.opencode/agents/" },
  { target: "opencode", feature: "skills", entry: "**/.opencode/skills/" },
  { target: "opencode", feature: "mcp", entry: "**/.opencode/plugins/" },
  { target: "opencode", feature: "general", entry: "**/.opencode/memories/" },
  {
    target: "opencode",
    feature: "general",
    entry: "**/.opencode/package-lock.json",
  },

  // Pi Coding Agent
  { target: "pi", feature: "rules", entry: "**/.agents/memories/" },
  { target: "pi", feature: "commands", entry: "**/.pi/prompts/" },
  { target: "pi", feature: "skills", entry: "**/.pi/skills/" },

  // Qwen Code
  { target: "qwencode", feature: "rules", entry: "**/QWEN.md" },
  { target: "qwencode", feature: "commands", entry: "**/.qwen/commands/" },
  { target: "qwencode", feature: "subagents", entry: "**/.qwen/agents/" },
  { target: "qwencode", feature: "skills", entry: "**/.qwen/skills/" },
  { target: "qwencode", feature: "ignore", entry: "**/.qwenignore" },
  { target: "qwencode", feature: "general", entry: "**/.qwen/memories/" },
  // mcp + hooks both write to `.qwen/settings.json`, shared with permissions.
  { target: "qwencode", feature: "permissions", entry: "**/.qwen/settings.json" },

  // Replit
  { target: "replit", feature: "rules", entry: "**/replit.md" },

  // Roo
  { target: "roo", feature: "rules", entry: "**/.roo/rules/" },
  { target: "roo", feature: "skills", entry: "**/.roo/skills/" },
  { target: "roo", feature: "ignore", entry: "**/.rooignore" },
  { target: "roo", feature: "mcp", entry: "**/.roo/mcp.json" },
  { target: "roo", feature: "subagents", entry: "**/.roomodes" },

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

  // TAKT
  // Each rulesync feature maps one-to-one onto a TAKT facet directory.
  { target: "takt", feature: "rules", entry: "**/.takt/facets/policies/" },
  { target: "takt", feature: "skills", entry: "**/.takt/facets/knowledge/" },
  { target: "takt", feature: "subagents", entry: "**/.takt/facets/personas/" },
  { target: "takt", feature: "commands", entry: "**/.takt/facets/instructions/" },
  { target: "takt", feature: "general", entry: "**/.takt/runs/" },
  { target: "takt", feature: "general", entry: "**/.takt/tasks/" },
  { target: "takt", feature: "general", entry: "**/.takt/.cache/" },
  { target: "takt", feature: "general", entry: "**/.takt/config.yaml" },

  // Devin (Devin Desktop). Since the rebrand (v3.0.12, 2026-06-02), project
  // rules/workflows/skills live under `.devin/`; MCP and hooks keep their
  // `.devin/` paths and the global skills path is unchanged.
  { target: "devin", feature: "rules", entry: "**/.devin/rules/" },
  { target: "devin", feature: "commands", entry: "**/.devin/workflows/" },
  { target: "devin", feature: "ignore", entry: "**/.devinignore" },
  { target: "devin", feature: "mcp", entry: "**/.windsurf/mcp_config.json" },
  { target: "devin", feature: "hooks", entry: "**/.windsurf/hooks.json" },
  { target: "devin", feature: "skills", entry: "**/.devin/skills/" },
  { target: "devin", feature: "skills", entry: "**/.codeium/windsurf/skills/" },
  // Devin Local custom subagent profiles: `.devin/agents/<name>/AGENT.md`
  // (project). The global path `~/.config/devin/agents/` lives under the home
  // directory and is not gitignored at the project level.
  { target: "devin", feature: "subagents", entry: "**/.devin/agents/" },

  // Vibe
  { target: "vibe", feature: "ignore", entry: "**/.vibeignore" },
  { target: "vibe", feature: "skills", entry: "**/.vibe/skills/" },
  { target: "vibe", feature: "subagents", entry: "**/.vibe/agents/" },
  { target: "vibe", feature: "mcp", entry: "**/.vibe/config.toml" },
  { target: "vibe", feature: "permissions", entry: "**/.vibe/config.toml" },
  // Experimental hooks live in `.vibe/hooks.toml`; the `enable_experimental_hooks`
  // flag is merged into the shared `.vibe/config.toml` (already covered above).
  { target: "vibe", feature: "hooks", entry: "**/.vibe/hooks.toml" },
  { target: "vibe", feature: "hooks", entry: "**/.vibe/config.toml" },

  // Warp
  // Warp reads project rules only from the root `AGENTS.md` (handled by the
  // shared AGENTS.md entry above); it does not read `.warp/memories/`, so no
  // rules entry under `.warp/` is emitted.
  { target: "warp", feature: "mcp", entry: "**/.warp/.mcp.json" },
  { target: "warp", feature: "skills", entry: "**/.warp/skills/" },

  // Zed
  // `.rules` is the project rules file. `.agents/skills/` is shared with the
  // antigravity targets (already registered above); re-tagging it for `zed`
  // ensures target-filtered gitignore runs still include it.
  // No entry for `.zed/settings.json` (MCP / ignore): it is a user-managed
  // file, like other tools' settings.json, so it is intentionally not ignored.
  { target: "zed", feature: "rules", entry: "**/.rules" },
  { target: "zed", feature: "skills", entry: "**/.agents/skills/" },
] as const;

export const ALL_GITIGNORE_ENTRIES: ReadonlyArray<string> = (() => {
  // The registry may register the SAME entry under multiple feature tags
  // The exported list dedupes while preserving the original insertion order.
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of GITIGNORE_ENTRY_REGISTRY) {
    if (seen.has(tag.entry)) continue;
    seen.add(tag.entry);
    result.push(tag.entry);
  }
  return result;
})();

type FilterGitignoreEntriesParams = {
  readonly targets?: ReadonlyArray<string>;
  readonly features?: RulesyncFeatures;
};

export type ResolvedGitignoreEntry = {
  readonly entry: string;
  readonly target: ReadonlyArray<GitignoreEntryTarget>;
  readonly feature: Feature | "general";
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
  if (Array.isArray(targetFeatures)) {
    if (targetFeatures.includes("*")) return true;
    return targetFeatures.includes(feature);
  }
  // Per-feature object form: feature is enabled when its value is truthy
  // (true or an options object). A wildcard "*" key enables all features.
  if (isFeatureValueEnabled(targetFeatures["*"])) return true;
  return isFeatureValueEnabled(targetFeatures[feature]);
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
      if (Array.isArray(targetFeatures)) {
        for (const feature of targetFeatures) {
          warnOnce(feature);
        }
      } else {
        for (const feature of Object.keys(targetFeatures)) {
          if (feature === GITIGNORE_DESTINATION_KEY) continue;
          warnOnce(feature);
        }
      }
    }
  }
};

export const filterGitignoreEntries = (
  params?: FilterGitignoreEntriesParams & { logger?: Logger },
): string[] => {
  return resolveGitignoreEntries(params).map((entry) => entry.entry);
};

export const resolveGitignoreEntries = (
  params?: FilterGitignoreEntriesParams & { logger?: Logger },
): ResolvedGitignoreEntry[] => {
  const { targets, features, logger } = params ?? {};

  if (targets && targets.length > 0) {
    warnInvalidTargets(targets, logger);
  }
  if (features) {
    warnInvalidFeatures(features, logger);
  }

  const seen = new Set<string>();
  const result: ResolvedGitignoreEntry[] = [];

  for (const tag of GITIGNORE_ENTRY_REGISTRY) {
    if (!isTargetSelected(tag.target, targets)) continue;
    const selectedTagTargets = getSelectedGitignoreEntryTargets(tag.target, targets);
    if (!isFeatureSelected(tag.feature, selectedTagTargets, features)) continue;
    if (seen.has(tag.entry)) continue;
    seen.add(tag.entry);
    result.push({
      entry: tag.entry,
      target: selectedTagTargets,
      feature: tag.feature,
    });
  }

  return result;
};
