import { join, relative } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { subagentsProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { directoryExists, findFilesByGlobs, listDirectoryFiles } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { AgentsmdSubagent } from "./agentsmd-subagent.js";
import { AugmentcodeSubagent } from "./augmentcode-subagent.js";
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
import { KiroCliSubagent } from "./kiro-cli-subagent.js";
import { KiroIdeSubagent } from "./kiro-ide-subagent.js";
import { KiroSubagent } from "./kiro-subagent.js";
import { OpenCodeSubagent } from "./opencode-subagent.js";
import { QwencodeSubagent } from "./qwencode-subagent.js";
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
  };
  meta: {
    /** Whether the tool supports simulated subagents (embedded in rules) */
    supportsSimulated: boolean;
    /** Whether the tool supports global (user-level) subagents */
    supportsGlobal: boolean;
    /** File pattern for import (e.g., "*.md", "*.json") */
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
      meta: { supportsSimulated: true, supportsGlobal: false, filePattern: "*.md" },
    },
  ],
  [
    "augmentcode",
    {
      // AugmentCode (Auggie CLI) subagents are native Markdown files under
      // .augment/agents/ (project) and ~/.augment/agents/ (global).
      // https://docs.augmentcode.com/cli/subagents
      class: AugmentcodeSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
    },
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
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
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.yaml" },
    },
  ],
  [
    "codexcli",
    {
      class: CodexCliSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.toml" },
    },
  ],
  [
    "copilot",
    {
      class: CopilotSubagent,
      // VS Code Copilot custom agents support both project (.github/agents/) and
      // user-profile/global (~/.copilot/agents/) scopes.
      // Reference: https://code.visualstudio.com/docs/copilot/agents/custom-agents
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
    },
  ],
  [
    "copilotcli",
    {
      class: CopilotcliSubagent,
      // Copilot CLI custom agents support both project (.github/agents/) and
      // user/global (~/.copilot/agents/) scopes natively.
      // Reference: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.agent.md" },
    },
  ],
  [
    "cursor",
    {
      class: CursorSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
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
        supportsSimulated: false,
        // dcode discovers user-level subagents in `~/.deepagents/<agent_name>/agents/`.
        supportsGlobal: true,
        filePattern: join("*", "AGENTS.md"),
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
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: join("*", "AGENT.md"),
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
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
    },
  ],
  [
    "goose",
    {
      class: GooseSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.yaml" },
    },
  ],
  [
    "hermesagent",
    {
      class: HermesagentSubagent,
      meta: {
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
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
    },
  ],
  [
    "junie",
    {
      class: JunieSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
    },
  ],
  [
    "kiro",
    {
      class: KiroSubagent,
      meta: { supportsSimulated: false, supportsGlobal: false, filePattern: "*.json" },
    },
  ],
  [
    "kiro-cli",
    {
      class: KiroCliSubagent,
      meta: { supportsSimulated: false, supportsGlobal: false, filePattern: "*.json" },
    },
  ],
  [
    "kiro-ide",
    {
      class: KiroIdeSubagent,
      meta: { supportsSimulated: false, supportsGlobal: false, filePattern: "*.md" },
    },
  ],
  [
    "kilo",
    {
      class: KiloSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
    },
  ],
  [
    "opencode",
    {
      class: OpenCodeSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
    },
  ],
  [
    "qwencode",
    {
      // Qwen Code subagents are native Markdown + YAML frontmatter under
      // `.qwen/agents/` (project) and `~/.qwen/agents/` (user/global).
      class: QwencodeSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
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
      meta: { supportsSimulated: false, supportsGlobal: false, filePattern: ".roomodes" },
    },
  ],
  [
    "rovodev",
    {
      class: RovodevSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
    },
  ],
  [
    "takt",
    {
      class: TaktSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" },
    },
  ],
  [
    "vibe",
    {
      class: VibeSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.toml" },
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

export const subagentsProcessorToolTargets: ToolTarget[] = allToolTargetKeys;

export const subagentsProcessorToolTargetsSimulated: ToolTarget[] = allToolTargetKeys.filter(
  (target) => {
    const factory = toolSubagentFactories.get(target);
    return factory?.meta.supportsSimulated ?? false;
  },
);

export const subagentsProcessorToolTargetsGlobal: ToolTarget[] = allToolTargetKeys.filter(
  (target) => {
    const factory = toolSubagentFactories.get(target);
    return factory?.meta.supportsGlobal ?? false;
  },
);

export class SubagentsProcessor extends FeatureProcessor {
  private readonly toolTarget: SubagentsProcessorToolTarget;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;

  constructor({
    outputRoot = process.cwd(),
    inputRoot = process.cwd(),
    toolTarget,
    global = false,
    getFactory = defaultGetFactory,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoot?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({ outputRoot, inputRoot, dryRun, logger });
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

    return rulesyncSubagents;
  }

  /**
   * Implementation of abstract method from Processor
   * Load and parse rulesync subagent files from .rulesync/subagents/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const subagentsDir = join(this.inputRoot, RulesyncSubagent.getSettablePaths().relativeDirPath);

    // Check if directory exists
    const dirExists = await directoryExists(subagentsDir);
    if (!dirExists) {
      this.logger.debug(`Rulesync subagents directory not found: ${subagentsDir}`);
      return [];
    }

    // Read all markdown files from the directory
    const entries = await listDirectoryFiles(subagentsDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      this.logger.debug(`No markdown files found in rulesync subagents directory: ${subagentsDir}`);
      return [];
    }

    this.logger.debug(`Found ${mdFiles.length} subagent files in ${subagentsDir}`);

    // Parse all files and create RulesyncSubagent instances using fromFilePath
    const rulesyncSubagents: RulesyncSubagent[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(subagentsDir, mdFile);

      try {
        const rulesyncSubagent = await RulesyncSubagent.fromFile({
          outputRoot: this.inputRoot,
          relativeFilePath: mdFile,
          validate: true,
        });

        rulesyncSubagents.push(rulesyncSubagent);
        this.logger.debug(`Successfully loaded subagent: ${mdFile}`);
      } catch (error) {
        this.logger.warn(`Failed to load subagent file ${filepath}: ${formatError(error)}`);
        continue;
      }
    }

    if (rulesyncSubagents.length === 0) {
      this.logger.debug(`No valid subagents found in ${subagentsDir}`);
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
    const dirPaths = forDeletion
      ? [paths.relativeDirPath]
      : [paths.relativeDirPath, ...(paths.importDirPaths ?? [])];

    const toolSubagents: ToolFile[] = [];
    // Tracks subagent relative paths already loaded so that a duplicate in a
    // lower-precedence import root does not silently shadow an earlier one.
    const seenRelativeFilePaths = new Set<string>();
    for (const dirPath of dirPaths) {
      const baseDir = join(this.outputRoot, dirPath);
      const subagentFilePaths = await findFilesByGlobs(join(baseDir, factory.meta.filePattern));

      // Compute the per-subagent file path relative to the tool's base directory.
      // For flat layouts (e.g. `<name>.md`) this is identical to `basename(path)`,
      // while for directory-per-agent layouts (e.g. deepagents' `<name>/AGENTS.md`)
      // it preserves the subdirectory so the subagent name is not lost.
      const toRelativeFilePath = (path: string): string => relative(baseDir, path);

      if (forDeletion) {
        toolSubagents.push(
          ...subagentFilePaths
            .map((path) =>
              factory.class.forDeletion({
                outputRoot: this.outputRoot,
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
        subagentFilePaths.map((path) =>
          factory.class.fromFile({
            outputRoot: this.outputRoot,
            relativeDirPath: dirPath,
            relativeFilePath: toRelativeFilePath(path),
            global: this.global,
          }),
        ),
      );

      // When more than one discovery root is scanned (e.g. Junie's
      // `.junie/agents/` plus `.agents/`), two roots can hold a subagent with
      // the same relative path. Downstream conversion keys by that path, so a
      // later one would silently overwrite an earlier one. Warn instead of
      // failing, keeping the earlier (higher-precedence) root's file.
      const deduped: ToolFile[] = [];
      for (const subagent of loaded) {
        const key = subagent.getRelativeFilePath();
        if (seenRelativeFilePaths.has(key)) {
          this.logger.warn(
            `Duplicate ${this.toolTarget} subagent "${key}" found in ${dirPath}; ` +
              `keeping the one from a higher-precedence directory and ignoring this copy.`,
          );
          continue;
        }
        seenRelativeFilePaths.add(key);
        deduped.push(subagent);
      }
      toolSubagents.push(...deduped);
    }

    // Import-only: merge in subagents defined outside the standalone-file layout
    // (e.g. OpenCode's inline `agent` block in `opencode.json`). A standalone
    // Markdown file with the same relative path takes precedence.
    if (!forDeletion && factory.class.loadAdditionalImportFiles) {
      const additionalSubagents = await factory.class.loadAdditionalImportFiles({
        outputRoot: this.outputRoot,
        global: this.global,
      });
      for (const subagent of additionalSubagents) {
        const key = subagent.getRelativeFilePath();
        if (seenRelativeFilePaths.has(key)) {
          this.logger.warn(
            `Duplicate ${this.toolTarget} subagent "${key}" defined inline; ` +
              `keeping the standalone file and ignoring the inline copy.`,
          );
          continue;
        }
        seenRelativeFilePaths.add(key);
        toolSubagents.push(subagent);
      }
    }

    this.logger.debug(
      `Successfully loaded ${toolSubagents.length} ${this.toolTarget} subagents from ${dirPaths.join(", ")}`,
    );
    return toolSubagents;
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
