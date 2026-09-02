import { basename, dirname, join, relative } from "node:path";

import { z } from "zod/mini";

import {
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
  SUBAGENTS_FEATURE_SUBDIR,
} from "../../constants/rulesync-paths.js";
import {
  ClaimedIdentities,
  FeatureProcessor,
  mergeByCaseInsensitiveIdentity,
} from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { subagentsProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import {
  assertWritablePathInsideRoot,
  directoryExists,
  directoryExistsStrict,
  findFilesByGlobs,
  isFileSystemError,
  listDirectoryEntryNames,
} from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { AgentsmdSubagent } from "./agentsmd-subagent.js";
import { AntigravityCliSubagent } from "./antigravity-cli-subagent.js";
import { AntigravityIdeSubagent } from "./antigravity-ide-subagent.js";
import { AntigravityPluginSubagent } from "./antigravity-plugin-subagent.js";
import { AugmentcodeSubagent } from "./augmentcode-subagent.js";
import { ClaudecodePluginSubagent } from "./claudecode-plugin-subagent.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { ClineSubagent } from "./cline-subagent.js";
import { CodexCliSubagent } from "./codexcli-subagent.js";
import { CopilotSubagent } from "./copilot-subagent.js";
import { CopilotcliSubagent } from "./copilotcli-subagent.js";
import { CursorSubagent } from "./cursor-subagent.js";
import { DeepagentsSubagent } from "./deepagents-subagent.js";
import { DevinSubagent } from "./devin-subagent.js";
import { FactorydroidSubagent } from "./factorydroid-subagent.js";
import { GooseSubagent } from "./goose-subagent.js";
import { GrokcliSubagent } from "./grokcli-subagent.js";
import { HermesagentSubagent } from "./hermesagent-subagent.js";
import { JunieSubagent } from "./junie-subagent.js";
import { KiloSubagent } from "./kilo-subagent.js";
import { KimiCodeSubagent } from "./kimi-code-subagent.js";
import { KiroCliSubagent } from "./kiro-cli-subagent.js";
import { KiroIdeSubagent } from "./kiro-ide-subagent.js";
import { KiroSubagent } from "./kiro-subagent.js";
import { OpenCodeSubagent } from "./opencode-subagent.js";
import { QwencodeSubagent } from "./qwencode-subagent.js";
import { ReasonixSubagent } from "./reasonix-subagent.js";
import { RooSubagent } from "./roo-subagent.js";
import { RovodevSubagent } from "./rovodev-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SimulatedSubagent } from "./simulated-subagent.js";
import { TaktSubagent } from "./takt-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";
import { VibeSubagent } from "./vibe-subagent.js";
import { ZcodeSubagent } from "./zcode-subagent.js";
import { ZoocodeSubagent } from "./zoocode-subagent.js";

/**
 * Factory entry for each tool subagent class.
 * Stores the class reference and metadata for a tool.
 */
type ToolSubagentFactory = {
  class: {
    isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean;
    fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent;
    /**
     * Optional aggregation hook. Tools whose native format collapses N subagents
     * into a single shared file (e.g. Roo's `.roomodes`) implement this to emit
     * one tool file holding every targeted subagent. When absent, the processor
     * falls back to mapping each rulesync subagent independently.
     */
    fromRulesyncSubagents?(params: {
      outputRoot?: string;
      rulesyncSubagents: RulesyncSubagent[];
      global?: boolean;
    }): ToolSubagent | ToolSubagent[];
    fromFile(params: ToolSubagentFromFileParams): Promise<ToolSubagent>;
    forDeletion(params: ToolSubagentForDeletionParams): ToolSubagent;
    getSettablePaths(options?: { global?: boolean }): ToolSubagentSettablePaths;
    /**
     * Optional import-only hook: load extra subagents that are not discoverable
     * as standalone files (e.g. OpenCode agents defined inline in
     * `opencode.json`). Invoked by {@link loadToolFiles} for the import
     * direction only, never for orphan deletion.
     */
    loadAdditionalImportFiles?(params: {
      outputRoot: string;
      global: boolean;
    }): Promise<ToolSubagent[]>;
    /**
     * Optional content-aware ownership filter for tools whose subagent files
     * share a directory with another feature's output (e.g. Reasonix subagent
     * profiles living in `.reasonix/skills/` next to regular skills). When
     * present, {@link SubagentsProcessor.loadToolFiles} calls it for every
     * discovered file — for both import and orphan-deletion enumeration — and
     * skips files it returns false for.
     */
    isFileOwned?(params: {
      outputRoot: string;
      relativeDirPath: string;
      relativeFilePath: string;
    }): Promise<boolean>;
  };
  meta: {
    /** Whether the tool supports project-level subagents */
    supportsProject: boolean;
    /** Whether the tool supports simulated subagents (embedded in rules) */
    supportsSimulated: boolean;
    /** Whether the tool supports global (user-level) subagents */
    supportsGlobal: boolean;
    /**
     * File pattern for import (e.g., "*.md", "*.json").
     *
     * A glob, not a filesystem path, so multi-segment patterns are spelled with
     * `/` literally rather than joined with `node:path`'s `join`: on Windows
     * `join` would separate the segments with a backslash, which only works by
     * accident because `findFilesByGlobs` rewrites backslashes.
     */
    filePattern: string;
  };
};

/**
 * Supported tool targets for SubagentsProcessor.
 * Using a tuple to preserve order for consistent iteration.
 */

export type SubagentsProcessorToolTarget = (typeof subagentsProcessorToolTargetTuple)[number];

// Schema for runtime validation
export const SubagentsProcessorToolTargetSchema = z.enum(subagentsProcessorToolTargetTuple);

/**
 * Factory Map mapping tool targets to their subagent factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
export const toolSubagentFactories = new Map<SubagentsProcessorToolTarget, ToolSubagentFactory>([
  [
    "agentsmd",
    {
      class: AgentsmdSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: true,
        supportsGlobal: false,
        filePattern: "*.md",
      },
    },
  ],
  [
    "antigravity-cli",
    {
      // Antigravity custom agents (CLI v1.1.6+) are Markdown files with YAML
      // frontmatter under `.agents/agents/` (project) and the shared
      // `~/.gemini/config/agents/` (global).
      // https://antigravity.google/docs/subagents
      class: AntigravityCliSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "antigravity-ide",
    {
      class: AntigravityIdeSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "antigravity-plugin",
    {
      // Plugin bundles ship agents in `<plugin_name>/agents/`; bundles are a
      // project-scope artifact the user stages globally themselves.
      // https://antigravity.google/docs/cli/plugins
      class: AntigravityPluginSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: false,
        filePattern: "*.md",
      },
    },
  ],
  [
    "augmentcode",
    {
      // AugmentCode (Auggie CLI) subagents are native Markdown files under
      // .augment/agents/ (project) and ~/.augment/agents/ (global).
      // https://docs.augmentcode.com/cli/subagents
      class: AugmentcodeSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "claudecode-plugin",
    {
      class: ClaudecodePluginSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: false,
        filePattern: "*.md",
      },
    },
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "cline",
    {
      // Cline file-based agents are YAML files (`<name>.yaml`) with a YAML
      // frontmatter block (`name`/`description`) and a system prompt body,
      // stored under `.cline/agents/` (project) and `~/.cline/agents/` (global).
      // https://github.com/cline/cline/blob/main/apps/vscode/src/core/task/tools/subagent/AgentConfigLoader.ts
      class: ClineSubagent,
      // isYamlFile() upstream accepts .yml alongside .yaml, so import scans both.
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.{yaml,yml}",
      },
    },
  ],
  [
    "codexcli",
    {
      class: CodexCliSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.toml",
      },
    },
  ],
  [
    "copilot",
    {
      class: CopilotSubagent,
      // VS Code Copilot custom agents support both project (.github/agents/) and
      // user-profile/global (~/.copilot/agents/) scopes.
      // Reference: https://code.visualstudio.com/docs/copilot/agents/custom-agents
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "copilotcli",
    {
      class: CopilotcliSubagent,
      // Copilot CLI custom agents support both project (.github/agents/) and
      // user/global (~/.copilot/agents/) scopes natively.
      // Reference: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.agent.md",
      },
    },
  ],
  [
    "cursor",
    {
      class: CursorSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "deepagents",
    {
      class: DeepagentsSubagent,
      // deepagents (dcode) discovers each subagent as a directory containing an
      // AGENTS.md file (`.deepagents/agents/<name>/AGENTS.md`). Flat `.md` files
      // in the agents root are ignored by the loader, so the glob must descend
      // one level and match the per-agent AGENTS.md file.
      // https://github.com/langchain-ai/deepagents/blob/main/libs/code/deepagents_code/subagents.py
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        // dcode discovers user-level subagents in `~/.deepagents/<agent_name>/agents/`.
        supportsGlobal: true,
        filePattern: "*/AGENTS.md",
      },
    },
  ],
  [
    "devin",
    {
      // Devin Local custom subagent profiles are native AGENT.md files in a
      // directory-per-agent layout: `.devin/agents/<name>/AGENT.md` (project)
      // and `~/.config/devin/agents/<name>/AGENT.md` (global). The flat agents
      // root is not scanned, so the glob descends one level to the AGENT.md file.
      // https://docs.devin.ai/cli/subagents
      class: DevinSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*/AGENT.md",
      },
    },
  ],
  [
    "factorydroid",
    {
      // Factory Droid custom droids are native Markdown files under
      // .factory/droids/ (project) and ~/.factory/droids/ (global).
      // https://docs.factory.ai/cli/configuration/custom-droids
      class: FactorydroidSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "goose",
    {
      class: GooseSubagent,
      // Custom agents are Markdown files under .goose/agents/ (project) and
      // ~/.config/goose/agents/ (global); the old sub-recipe YAML surface was
      // never read by Goose's agent discovery.
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "hermesagent",
    {
      class: HermesagentSubagent,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsSimulated: false,
        filePattern: "*.json",
      },
    },
  ],
  [
    "grokcli",
    {
      class: GrokcliSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "junie",
    {
      class: JunieSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "kiro",
    {
      class: KiroSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: false,
        filePattern: "*.json",
      },
    },
  ],
  [
    // Kiro CLI loads agent configs from both `.kiro/agents/` (workspace) and
    // `~/.kiro/agents/` (global); local agents take precedence over global
    // ones with the same name. https://kiro.dev/docs/cli/custom-agents/configuration-reference/
    "kiro-cli",
    {
      class: KiroCliSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.json",
      },
    },
  ],
  [
    // Kiro IDE loads custom agents from `.kiro/agents/` (workspace) and
    // `~/.kiro/agents/` (global). https://kiro.dev/docs/chat/subagents/
    "kiro-ide",
    {
      class: KiroIdeSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "kilo",
    {
      class: KiloSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "kimi-code",
    {
      class: KimiCodeSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "**/*.md",
      },
    },
  ],
  [
    "opencode",
    {
      class: OpenCodeSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "qwencode",
    {
      // Qwen Code subagents are native Markdown + YAML frontmatter under
      // `.qwen/agents/` (project) and `~/.qwen/agents/` (user/global).
      class: QwencodeSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "reasonix",
    {
      // DeepSeek-Reasonix native subagents are Skill profiles: directory-layout
      // `<name>/SKILL.md` files under `.reasonix/skills/` (project) and
      // `~/.reasonix/skills/` (global), whose frontmatter declares
      // `invocation: manual` and `runAs: subagent`.
      // https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SUBAGENT_PROFILES.md
      class: ReasonixSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*/SKILL.md",
      },
    },
  ],
  [
    "roo",
    {
      // Roo Code reads project custom modes from a single aggregated `.roomodes`
      // file at the workspace root (YAML). rulesync collapses every targeted
      // subagent into that file's `customModes` array.
      // https://roocodeinc.github.io/Roo-Code/features/custom-modes
      class: RooSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: false,
        filePattern: ".roomodes",
      },
    },
  ],
  [
    "zoocode",
    {
      // Zoo Code keeps Roo's aggregated `.roomodes` file; the subclass adds
      // the post-fork per-mode `allowedMcpServers` allowlist (v3.60.0+) via
      // the `zoocode:` frontmatter section.
      // https://docs.zoocode.dev/features/custom-modes
      class: ZoocodeSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: false,
        filePattern: ".roomodes",
      },
    },
  ],
  [
    "rovodev",
    {
      class: RovodevSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "takt",
    {
      class: TaktSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
  [
    "vibe",
    {
      class: VibeSubagent,
      meta: {
        supportsProject: true,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.toml",
      },
    },
  ],
  [
    "zcode",
    {
      // ZCode subagents are Markdown files with YAML frontmatter under
      // `~/.zcode/agents/`. Global only: the current Beta manages user-level
      // subagents there, and workspace/project-level ones are "not available
      // yet".
      // https://zcode.z.ai/en/docs/subagents
      class: ZcodeSubagent,
      meta: {
        supportsProject: false,
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
      },
    },
  ],
]);

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: SubagentsProcessorToolTarget) => ToolSubagentFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolSubagentFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

// Derive tool target arrays from factory metadata
const allToolTargetKeys = [...toolSubagentFactories.keys()];

export const subagentsProcessorToolTargets: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolSubagentFactories.get(target);
  return factory?.meta.supportsProject ?? false;
});

export const subagentsProcessorToolTargetsSimulated: ToolTarget[] = allToolTargetKeys.filter(
  (target) => {
    const factory = toolSubagentFactories.get(target);
    return factory?.meta.supportsSimulated ?? false;
  },
);

const subagentsProcessorToolTargetsGlobal: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolSubagentFactories.get(target);
  return factory?.meta.supportsGlobal ?? false;
});

/**
 * Stands in for a discovery root when a subagent came from a tool's own config
 * file rather than a directory (see `loadAdditionalImportFiles`). The angle
 * brackets keep it from ever matching a real relative directory path.
 */
const INLINE_SOURCE = "<inline>";

/**
 * The single "root" of the post-conversion output guard, which de-duplicates
 * `.rulesync/subagents/` paths rather than discovery roots.
 */
const OUTPUT_SOURCE = "<output>";

export class SubagentsProcessor extends FeatureProcessor {
  private readonly toolTarget: SubagentsProcessorToolTarget;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;

  constructor({
    outputRoot = process.cwd(),
    inputRoots,
    toolTarget,
    global = false,
    getFactory = defaultGetFactory,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoots?: readonly [string, ...string[]] | readonly string[];
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({ outputRoot, inputRoots, dryRun, logger });
    const result = SubagentsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for SubagentsProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.getFactory = getFactory;
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncSubagents = rulesyncFiles.filter(
      (file): file is RulesyncSubagent => file instanceof RulesyncSubagent,
    );

    const factory = this.getFactory(this.toolTarget);

    const targeted = rulesyncSubagents.filter((rulesyncSubagent) =>
      factory.class.isTargetedByRulesyncSubagent(rulesyncSubagent),
    );

    // Tools whose native format aggregates every subagent into a single shared
    // file (e.g. Roo's `.roomodes`) implement `fromRulesyncSubagents` to emit
    // one tool file holding all targeted subagents. Otherwise map one-to-one.
    if (factory.class.fromRulesyncSubagents) {
      if (targeted.length === 0) {
        return [];
      }
      const toolSubagents = factory.class.fromRulesyncSubagents({
        outputRoot: this.outputRoot,
        rulesyncSubagents: targeted,
        global: this.global,
      });

      return Array.isArray(toolSubagents) ? toolSubagents : [toolSubagents];
    }

    return targeted.map((rulesyncSubagent) =>
      factory.class.fromRulesyncSubagent({
        outputRoot: this.outputRoot,
        relativeDirPath: RulesyncSubagent.getSettablePaths().relativeDirPath,
        rulesyncSubagent: rulesyncSubagent,
        global: this.global,
        logger: this.logger,
      }),
    );
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolSubagents = toolFiles.filter(
      (file): file is ToolSubagent => file instanceof ToolSubagent,
    );

    const rulesyncSubagents: RulesyncSubagent[] = [];

    for (const toolSubagent of toolSubagents) {
      // Skip simulated subagents as they can't be converted back to rulesync
      if (toolSubagent instanceof SimulatedSubagent) {
        this.logger.debug(
          `Skipping simulated subagent conversion: ${toolSubagent.getRelativeFilePath()}`,
        );
        continue;
      }

      // Tools whose native format aggregates many subagents into one file
      // (e.g. Roo's `.roomodes`) fan out to N rulesync subagents on import.
      if (toolSubagent.toRulesyncSubagents) {
        rulesyncSubagents.push(...toolSubagent.toRulesyncSubagents());
        continue;
      }

      rulesyncSubagents.push(toolSubagent.toRulesyncSubagent());
    }

    const uniqueRulesyncSubagents: RulesyncSubagent[] = [];
    // The last guard before `.rulesync/subagents/`, and the one the fan-out
    // above only reaches: two spellings of a name inside a single aggregate
    // file (`.roomodes`) never pass through the per-root de-duplication. Case
    // is folded here for the same reason it is folded there — the two paths
    // are one file on macOS and Windows. Roo lowercases its slugs, so a
    // fan-out collides exactly rather than only in case today; the
    // case-folded half of the guard is what keeps that an implementation
    // detail of the adapter rather than a correctness requirement.
    const claimedOutputPaths = new ClaimedIdentities();
    for (const rulesyncSubagent of rulesyncSubagents) {
      const outputPath = join(
        rulesyncSubagent.getRelativeDirPath(),
        rulesyncSubagent.getRelativeFilePath(),
      );
      const claimed = claimedOutputPaths.claim({ identity: outputPath, source: OUTPUT_SOURCE });
      if (claimed !== null) {
        this.logger.warn(
          claimed.spelling === outputPath
            ? `Multiple ${this.toolTarget} subagents resolve to "${outputPath}"; keeping the first and ignoring this copy.`
            : `${this.toolTarget} subagent "${outputPath}" differs only in case from "${claimed.spelling}", which is the same file on a case-insensitive filesystem; keeping the first and ignoring this copy.`,
        );
        continue;
      }
      uniqueRulesyncSubagents.push(rulesyncSubagent);
    }

    return uniqueRulesyncSubagents;
  }

  /**
   * Load subagent files from a single source-tree's `subagents/` subtree.
   * `sourceTree` is the source tree itself (e.g. `/repo/.rulesync` or
   * `/repo/.rulesync.local`).
   */
  private async loadRulesyncFilesForRoot(sourceTree: string): Promise<RulesyncSubagent[]> {
    const treeParent = dirname(sourceTree);
    const treeName = basename(sourceTree);
    const treeSubagentsDirPath = join(treeName, SUBAGENTS_FEATURE_SUBDIR);
    const subagentsDir = join(sourceTree, SUBAGENTS_FEATURE_SUBDIR);

    // Strict: a source directory symlinked at a tree that is missing must not
    // read as "this feature has no sources", which would let `--delete` sweep
    // away everything generated from it.
    const dirExists = await directoryExistsStrict(subagentsDir);
    if (!dirExists) {
      this.logger.debug(`Rulesync subagents directory not found: ${subagentsDir}`);
      return [];
    }

    const entries = await listDirectoryEntryNames(subagentsDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      this.logger.debug(`No markdown files found in rulesync subagents directory: ${subagentsDir}`);
      return [];
    }

    this.logger.debug(`Found ${mdFiles.length} subagent files in ${subagentsDir}`);

    const rulesyncSubagents: RulesyncSubagent[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(subagentsDir, mdFile);

      try {
        const rulesyncSubagent = await RulesyncSubagent.fromFile({
          outputRoot: treeParent,
          relativeDirPath: treeSubagentsDirPath,
          relativeFilePath: mdFile,
          validate: true,
        });

        rulesyncSubagents.push(rulesyncSubagent);
        this.logger.debug(`Successfully loaded subagent: ${mdFile}`);
      } catch (error) {
        // A file that could not be read at all is a different matter from one
        // that would not parse: it says nothing about whether the subagent is
        // still wanted, so letting the sweep run on it would delete output this
        // run simply could not load.
        if (isFileSystemError(error)) {
          this.reportRulesyncSourceLoadError({
            message: `Failed to read subagent file ${filepath}`,
            error,
          });
          continue;
        }

        // Deliberately a warning, not a source-load failure. `subagents/` is a
        // directory users also keep ordinary Markdown in (a README, notes), and
        // failing the run on those would both break every later `generate` and
        // freeze this feature's orphan sweep, so a subagent deleted from the
        // source would never be removed from the tool tree.
        this.logger.warn(`Failed to load subagent file ${filepath}: ${formatError(error)}`);
        continue;
      }
    }

    return rulesyncSubagents;
  }

  /**
   * Implementation of abstract method from Processor
   * Load and parse rulesync subagent files from every configured input root's
   * `.rulesync/subagents/` directory, merging by relative file path so a
   * subagent with the same target path from a later root replaces the
   * earlier root's copy.
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const perRoot = await Promise.all(
      this.inputRoots.map((root) => this.loadRulesyncFilesForRoot(root)),
    );

    const rulesyncSubagents = mergeByCaseInsensitiveIdentity({
      perRoot,
      identity: (subagent) => subagent.getRelativeFilePath(),
      artifactName: "subagent",
      logger: this.logger,
    });

    if (rulesyncSubagents.length === 0) {
      this.logger.debug(`No valid subagents found`);
      return [];
    }

    this.logger.debug(`Successfully loaded ${rulesyncSubagents.length} rulesync subagents`);

    return rulesyncSubagents;
  }

  /**
   * Implementation of abstract method from Processor
   * Load tool-specific subagent configurations and parse them into ToolSubagent instances
   */
  async loadToolFiles({
    forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });

    // Orphan deletion must only ever target the canonical generation directory,
    // so that import-only discovery roots (e.g. Junie's `.agents/`) are never
    // removed. Importing, on the other hand, scans every discovery root.
    const roots = forDeletion
      ? [paths.relativeDirPath]
      : [paths.relativeDirPath, ...(paths.importDirPaths ?? [])];

    const toolSubagents: ToolFile[] = [];
    // Tracks subagent relative paths already loaded so that a duplicate in a
    // lower-precedence import root does not silently shadow an earlier one.
    // Case is folded: the loaded subagents are written back into one
    // `.rulesync/subagents/` tree, where two spellings of a path are a single
    // file on macOS and Windows.
    const claimedRelativeFilePaths = new ClaimedIdentities();
    for (const root of roots) {
      const rootOutputRoot = typeof root === "string" ? this.outputRoot : root.outputRoot;
      const dirPath = typeof root === "string" ? root : root.relativeDirPath;
      const baseDir = join(rootOutputRoot, dirPath);
      if (forDeletion && (await directoryExists(baseDir))) {
        await assertWritablePathInsideRoot({
          rootPath: rootOutputRoot,
          targetPath: baseDir,
        });
      }
      const subagentFilePaths = await findFilesByGlobs(factory.meta.filePattern, {
        cwd: baseDir,
        followSymbolicLinks: !forDeletion,
      });

      // Compute the per-subagent file path relative to the tool's base directory.
      // For flat layouts (e.g. `<name>.md`) this is identical to `basename(path)`,
      // while for directory-per-agent layouts (e.g. deepagents' `<name>/AGENTS.md`)
      // it preserves the subdirectory so the subagent name is not lost.
      const toRelativeFilePath = (path: string): string => relative(baseDir, path);

      // Tools sharing their directory with another feature (see the
      // `isFileOwned` factory hook) claim only the files that carry their
      // ownership marker; everything else is skipped for both import and
      // orphan deletion so foreign files are never mis-imported or removed.
      let ownedFilePaths = subagentFilePaths;
      if (factory.class.isFileOwned) {
        const ownership = await Promise.all(
          subagentFilePaths.map((path) =>
            // Called through factory.class so a future implementation may
            // safely reference `this` (its own statics), like the other hooks.
            factory.class.isFileOwned!({
              outputRoot: rootOutputRoot,
              relativeDirPath: dirPath,
              relativeFilePath: toRelativeFilePath(path),
            }),
          ),
        );
        ownedFilePaths = subagentFilePaths.filter((_, index) => ownership[index]);
      }

      if (forDeletion) {
        await Promise.all(
          ownedFilePaths.map((path) =>
            assertWritablePathInsideRoot({
              rootPath: baseDir,
              targetPath: path,
            }),
          ),
        );
        toolSubagents.push(
          ...ownedFilePaths
            .map((path) =>
              factory.class.forDeletion({
                outputRoot: rootOutputRoot,
                relativeDirPath: dirPath,
                relativeFilePath: toRelativeFilePath(path),
                global: this.global,
              }),
            )
            .filter((subagent) => subagent.isDeletable()),
        );
        continue;
      }

      const loaded = await Promise.all(
        ownedFilePaths.map((path) =>
          factory.class.fromFile({
            outputRoot: rootOutputRoot,
            relativeDirPath: dirPath,
            relativeFilePath: toRelativeFilePath(path),
            global: this.global,
          }),
        ),
      );

      toolSubagents.push(
        ...this.claimStandaloneSubagents({ loaded, dirPath, claimedRelativeFilePaths }),
      );
    }

    // Import-only: merge in subagents defined outside the standalone-file layout
    // (e.g. OpenCode's inline `agent` block in `opencode.json`). A standalone
    // Markdown file with the same relative path takes precedence.
    if (!forDeletion && factory.class.loadAdditionalImportFiles) {
      const additionalSubagents = await factory.class.loadAdditionalImportFiles({
        outputRoot: this.outputRoot,
        global: this.global,
      });
      toolSubagents.push(
        ...this.claimInlineSubagents({ additionalSubagents, claimedRelativeFilePaths }),
      );
    }

    this.logger.debug(
      `Successfully loaded ${toolSubagents.length} ${this.toolTarget} subagents from ${roots.length} root(s)`,
    );
    return toolSubagents;
  }

  /**
   * Keeps the subagents from one discovery root whose import identity is still
   * unclaimed, warning about each copy that loses. Split out of
   * `loadToolFiles` so the two de-duplication passes stay readable side by
   * side (and so that method stays within the linter's complexity budget).
   *
   * When more than one discovery root is scanned (e.g. Junie's `.junie/agents/`
   * plus `.agents/`), two roots can hold a subagent with the same relative
   * path. Downstream conversion keys by that path, so a later one would
   * silently overwrite an earlier one. Warn instead of failing, keeping the
   * earlier (higher-precedence) root's file.
   */
  private claimStandaloneSubagents({
    loaded,
    dirPath,
    claimedRelativeFilePaths,
  }: {
    loaded: readonly ToolSubagent[];
    dirPath: string;
    claimedRelativeFilePaths: ClaimedIdentities;
  }): ToolFile[] {
    const deduped: ToolFile[] = [];

    for (const subagent of loaded) {
      const key = subagent.getImportIdentity();
      const claimed = claimedRelativeFilePaths.claim({ identity: key, source: dirPath });
      if (claimed === null) {
        deduped.push(subagent);
        continue;
      }

      // The winner is only in a "higher-precedence directory" when it came
      // from an earlier root; two spellings inside one directory collide just
      // as well, and saying otherwise sends the user looking for a root that
      // is not involved.
      const keptFrom =
        claimed.source === dirPath
          ? `the earlier one in ${dirPath}`
          : `the one from the higher-precedence ${claimed.source}`;
      this.logger.warn(
        claimed.spelling === key
          ? `Duplicate ${this.toolTarget} subagent "${key}" found in ${dirPath}; ` +
              `keeping ${keptFrom} and ignoring this copy.`
          : `Duplicate ${this.toolTarget} subagent "${key}" found in ${dirPath} differs only ` +
              `in case from "${claimed.spelling}"; keeping ${keptFrom} and ignoring this copy.`,
      );
    }

    return deduped;
  }

  /**
   * The same claim-or-warn pass for subagents defined inline in a tool's own
   * config file (see `loadAdditionalImportFiles`), which are scanned after
   * every standalone file so a Markdown file of the same name wins.
   */
  private claimInlineSubagents({
    additionalSubagents,
    claimedRelativeFilePaths,
  }: {
    additionalSubagents: readonly ToolSubagent[];
    claimedRelativeFilePaths: ClaimedIdentities;
  }): ToolFile[] {
    const deduped: ToolFile[] = [];

    for (const subagent of additionalSubagents) {
      const key = subagent.getImportIdentity();
      const claimed = claimedRelativeFilePaths.claim({ identity: key, source: INLINE_SOURCE });
      if (claimed === null) {
        deduped.push(subagent);
        continue;
      }

      // Two inline entries can collide with each other, with no standalone
      // file anywhere — so the winner is only "the standalone file" when the
      // claim did not come from this same inline pass.
      const kept =
        claimed.source === INLINE_SOURCE
          ? "the earlier inline definition"
          : `the standalone file in ${claimed.source}`;
      this.logger.warn(
        claimed.spelling === key
          ? `Duplicate ${this.toolTarget} subagent "${key}" defined inline; ` +
              `keeping ${kept} and ignoring the inline copy.`
          : `Inline ${this.toolTarget} subagent "${key}" differs only in case from ` +
              `"${claimed.spelling}"; keeping ${kept} and ignoring the inline copy.`,
      );
    }

    return deduped;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({
    global = false,
    includeSimulated = false,
  }: {
    global?: boolean;
    includeSimulated?: boolean;
  } = {}): ToolTarget[] {
    if (global) {
      return [...subagentsProcessorToolTargetsGlobal];
    }
    if (!includeSimulated) {
      return subagentsProcessorToolTargets.filter(
        (target) => !subagentsProcessorToolTargetsSimulated.includes(target),
      );
    }
    return [...subagentsProcessorToolTargets];
  }

  static getToolTargetsSimulated(): ToolTarget[] {
    return [...subagentsProcessorToolTargetsSimulated];
  }

  /**
   * Convention section describing how simulated subagents are invoked, embedded
   * into a tool's root rule (e.g. AGENTS.md) by the rules feature.
   */
  static getSimulatedConventionSection(): string {
    return `## Simulated Subagents

Simulated subagents are specialized AI assistants that can be invoked to handle specific types of tasks. In this case, it can be appear something like custom slash commands simply. Simulated subagents can be called by custom slash commands.

When users call a simulated subagent, it will look for the corresponding markdown file, \`${join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "{subagent}.md")}\`, and execute its contents as the block of operations.

For example, if the user instructs \`Call planner subagent to plan the refactoring\`, you have to look for the markdown file, \`${join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md")}\`, and execute its contents as the block of operations.`;
  }

  /**
   * Get the factory for a specific tool target.
   * This is a static version of the internal getFactory for external use.
   * @param target - The tool target. Must be a valid SubagentsProcessorToolTarget.
   * @returns The factory for the target, or undefined if not found.
   */
  static getFactory(target: ToolTarget): ToolSubagentFactory | undefined {
    // Validate that target is supported
    const result = SubagentsProcessorToolTargetSchema.safeParse(target);
    if (!result.success) {
      return undefined;
    }
    return toolSubagentFactories.get(result.data);
  }
}
