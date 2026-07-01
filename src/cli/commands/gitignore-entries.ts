import {
  CLAUDECODE_DIR,
  CLAUDECODE_LOCAL_RULE_FILE_NAME,
  CLAUDECODE_MEMORIES_DIR_NAME,
  CLAUDECODE_SETTINGS_LOCAL_FILE_NAME,
} from "../../constants/claudecode-paths.js";
import { RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import {
  ALL_FEATURES_WITH_WILDCARD,
  type Feature,
  type RulesyncFeatures,
} from "../../types/features.js";
import { ALL_TOOL_TARGETS_WITH_WILDCARD } from "../../types/tool-targets.js";
import type { Logger } from "../../utils/logger.js";
import {
  deriveAllGitignoreEntries,
  type GitignoreEntryTag,
  type GitignoreEntryTarget,
} from "./gitignore-derive.js";

const normalizeGitignoreEntryTargets = (
  target: GitignoreEntryTag["target"],
): ReadonlyArray<GitignoreEntryTarget> => {
  return typeof target === "string" ? [target] : target;
};

// Hand-maintained entries that are NOT derivable from any tool's
// getSettablePaths, because they are not rulesync-owned generated outputs:
//   - rulesync's own meta files (`.rulesync/**`, `rulesync.local.jsonc`, the
//     `AGENTS.local.md` / `CLAUDE.local.md` local-root files, the `.aiignore`
//     un-ignore exception)
//   - third-party tool by-products rulesync never writes but gitignores as a
//     convenience (`.claude/*.lock`, `.takt/runs/`, lock files, …)
//   - the `.codexignore` ghost (codexcli has no ignore processor)
// Everything a tool actually emits is derived below from getSettablePaths.
export const HAND_MAINTAINED_GITIGNORE_ENTRIES: ReadonlyArray<GitignoreEntryTag> = [
  // rulesync's own meta files (common scope).
  {
    target: "common",
    feature: "general",
    entry: `${RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH}/`,
  },
  { target: "common", feature: "general", entry: ".rulesync/rules/*.local.md" },
  { target: "common", feature: "general", entry: "rulesync.local.jsonc" },
  // AGENTS.local.md is placed in common scope (not rovodev-only) so that
  // local rule files are always gitignored regardless of which targets are enabled.
  { target: "common", feature: "general", entry: "**/AGENTS.local.md" },

  // Local-root rule files: materialized outside getSettablePaths.
  { target: "claudecode", feature: "rules", entry: `**/${CLAUDECODE_LOCAL_RULE_FILE_NAME}` },
  {
    target: "claudecode",
    feature: "rules",
    entry: `**/${CLAUDECODE_DIR}/${CLAUDECODE_LOCAL_RULE_FILE_NAME}`,
  },

  // Third-party tool by-products rulesync gitignores but never writes itself.
  { target: "claudecode", feature: "general", entry: `**/${CLAUDECODE_DIR}/*.lock` },
  {
    target: "claudecode",
    feature: "general",
    entry: `**/${CLAUDECODE_DIR}/${CLAUDECODE_SETTINGS_LOCAL_FILE_NAME}`,
  },
  {
    target: "claudecode",
    feature: "general",
    entry: `**/${CLAUDECODE_DIR}/${CLAUDECODE_MEMORIES_DIR_NAME}/`,
  },
  { target: "opencode", feature: "general", entry: "**/.opencode/package-lock.json" },
  { target: "rovodev", feature: "general", entry: "**/.rovodev/.rulesync/" },
  { target: "takt", feature: "general", entry: "**/.takt/runs/" },
  { target: "takt", feature: "general", entry: "**/.takt/tasks/" },
  { target: "takt", feature: "general", entry: "**/.takt/.cache/" },
  { target: "takt", feature: "general", entry: "**/.takt/config.yaml" },

  // Augment Code's legacy single-file rules path: accepted on import but never
  // generated (so not in getSettablePaths), gitignored as a convenience.
  { target: "augmentcode", feature: "rules", entry: "**/.augment-guidelines" },

  // Shared trees and global-scope outputs not produced via project getSettablePaths.
  { target: "rovodev", feature: "skills", entry: "**/.agents/skills/" },
  // The `prompts.yml` manifest is produced via `RovodevCommand.getAuxiliaryFiles`,
  // not `getSettablePaths` (only the sibling `.rovodev/prompts/` content-file
  // directory is derived automatically), so it needs a hand-maintained entry.
  { target: "rovodev", feature: "commands", entry: "**/.rovodev/prompts.yml" },
  { target: "devin", feature: "skills", entry: "**/.codeium/windsurf/skills/" },
  { target: "copilotcli", feature: "subagents", entry: "**/.copilot/agents/" },
  { target: "copilotcli", feature: "mcp", entry: "**/.copilot/mcp-config.json" },
  { target: "copilotcli", feature: "hooks", entry: "**/.copilot/hooks/" },
  { target: "deepagents", feature: "hooks", entry: "**/.deepagents/hooks.json" },

  // Roo aggregates subagents into a single `.roomodes` file (no settable path).
  { target: "roo", feature: "subagents", entry: "**/.roomodes" },

  // codexcli has no ignore processor; its `.codexignore` is a ghost entry.
  { target: "codexcli", feature: "ignore", entry: "**/.codexignore" },
];

export const GITIGNORE_ENTRY_REGISTRY: ReadonlyArray<GitignoreEntryTag> = [
  ...HAND_MAINTAINED_GITIGNORE_ENTRIES,

  // Every entry a tool actually emits, derived from its getSettablePaths.
  ...deriveAllGitignoreEntries(),

  // Keep this after ignore entries like Junie's "**/.aiignore" so the exception remains effective.
  { target: "common", feature: "general", entry: "!.rulesync/.aiignore" },
];

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

const isFeatureSelected = (
  feature: Feature | "general",
  features: RulesyncFeatures | undefined,
): boolean => {
  if (feature === "general") return true;
  if (!features) return true;
  if (features.length === 0) return true;
  if (features.includes("*")) return true;
  return features.includes(feature);
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
  for (const feature of features) {
    if (!validFeatures.has(feature) && !warned.has(feature)) {
      warned.add(feature);
      logger?.warn(
        `Unknown feature '${feature}'. Valid features: ${ALL_FEATURES_WITH_WILDCARD.join(", ")}`,
      );
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
    if (!isFeatureSelected(tag.feature, features)) continue;
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
