import { join, relative } from "node:path";

import { z } from "zod/mini";

import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { checkPathTraversal, directoryExists, findFilesByGlobs } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { AgentsmdSubagent } from "./agentsmd-subagent.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { CodexCliSubagent } from "./codexcli-subagent.js";
import { CopilotSubagent } from "./copilot-subagent.js";
import { CursorSubagent } from "./cursor-subagent.js";
import { DeepagentsSubagent } from "./deepagents-subagent.js";
import { FactorydroidSubagent } from "./factorydroid-subagent.js";
import { GeminiCliSubagent } from "./geminicli-subagent.js";
import { JunieSubagent } from "./junie-subagent.js";
import { KiloSubagent } from "./kilo-subagent.js";
import { KiroSubagent } from "./kiro-subagent.js";
import { OpenCodeSubagent } from "./opencode-subagent.js";
import { RooSubagent } from "./roo-subagent.js";
import { RovodevSubagent } from "./rovodev-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SimulatedSubagent } from "./simulated-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Factory entry for each tool subagent class.
 * Stores the class reference and metadata for a tool.
 */
type ToolSubagentFactory = {
  class: {
    isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean;
    fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent;
    fromFile(params: ToolSubagentFromFileParams): Promise<ToolSubagent>;
    forDeletion(params: ToolSubagentForDeletionParams): ToolSubagent;
    getSettablePaths(options?: { global?: boolean }): ToolSubagentSettablePaths;
  };
  meta: {
    /** Whether the tool supports simulated subagents (embedded in rules) */
    supportsSimulated: boolean;
    /** Whether the tool supports global (user-level) subagents */
    supportsGlobal: boolean;
    /** File pattern for import (e.g., "*.md", "*.json") */
    filePattern: string;
    /** Whether the tool supports nested relative paths for subagents */
    supportsSubdirectory: boolean;
  };
};

/**
 * Supported tool targets for SubagentsProcessor.
 * Using a tuple to preserve order for consistent iteration.
 */
const subagentsProcessorToolTargetTuple = [
  "kilo",
  "agentsmd",
  "claudecode",
  "claudecode-legacy",
  "codexcli",
  "copilot",
  "cursor",
  "deepagents",
  "factorydroid",
  "geminicli",
  "junie",
  "kiro",
  "opencode",
  "roo",
  "rovodev",
] as const;

export type SubagentsProcessorToolTarget = (typeof subagentsProcessorToolTargetTuple)[number];

// Schema for runtime validation
export const SubagentsProcessorToolTargetSchema = z.enum(subagentsProcessorToolTargetTuple);

/**
 * Factory Map mapping tool targets to their subagent factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
const toolSubagentFactories = new Map<SubagentsProcessorToolTarget, ToolSubagentFactory>([
  [
    "agentsmd",
    {
      class: AgentsmdSubagent,
      meta: {
        supportsSimulated: true,
        supportsGlobal: false,
        filePattern: "*.md",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeSubagent,
      meta: {
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeSubagent,
      meta: {
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "codexcli",
    {
      class: CodexCliSubagent,
      meta: {
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.toml",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "copilot",
    {
      class: CopilotSubagent,
      meta: {
        supportsSimulated: false,
        supportsGlobal: false,
        filePattern: "*.md",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "cursor",
    {
      class: CursorSubagent,
      meta: {
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "deepagents",
    {
      class: DeepagentsSubagent,
      meta: {
        supportsSimulated: false,
        supportsGlobal: false,
        filePattern: "*.md",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "factorydroid",
    {
      class: FactorydroidSubagent,
      meta: {
        supportsSimulated: true,
        supportsGlobal: false,
        filePattern: "*.md",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "geminicli",
    {
      class: GeminiCliSubagent,
      meta: {
        supportsSimulated: false,
        supportsGlobal: false,
        filePattern: "*.md",
        supportsSubdirectory: true,
      },
    },
  ],
  [
    "junie",
    {
      class: JunieSubagent,
      meta: {
        supportsSimulated: false,
        supportsGlobal: false,
        filePattern: "*.md",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "kiro",
    {
      class: KiroSubagent,
      meta: {
        supportsSimulated: false,
        supportsGlobal: false,
        filePattern: "*.json",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "kilo",
    {
      class: KiloSubagent,
      meta: {
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "opencode",
    {
      class: OpenCodeSubagent,
      meta: {
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "roo",
    {
      class: RooSubagent,
      meta: {
        supportsSimulated: true,
        supportsGlobal: false,
        filePattern: "*.md",
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "rovodev",
    {
      class: RovodevSubagent,
      meta: {
        supportsSimulated: false,
        supportsGlobal: true,
        filePattern: "*.md",
        supportsSubdirectory: false,
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
    baseDir = process.cwd(),
    toolTarget,
    global = false,
    getFactory = defaultGetFactory,
    dryRun = false,
    logger,
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({ baseDir, dryRun, logger });
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

    const toolSubagents = rulesyncSubagents
      .map((rulesyncSubagent) => {
        if (!factory.class.isTargetedByRulesyncSubagent(rulesyncSubagent)) {
          return null;
        }
        return factory.class.fromRulesyncSubagent({
          baseDir: this.baseDir,
          relativeDirPath: RulesyncSubagent.getSettablePaths().relativeDirPath,
          rulesyncSubagent: rulesyncSubagent,
          global: this.global,
        });
      })
      .filter((subagent): subagent is ToolSubagent => subagent !== null);

    return toolSubagents;
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

      rulesyncSubagents.push(toolSubagent.toRulesyncSubagent());
    }

    return rulesyncSubagents;
  }

  private safeRelativePath(basePath: string, fullPath: string): string {
    const relativePath = relative(basePath, fullPath);
    checkPathTraversal({ relativePath, intendedRootDir: basePath });
    return relativePath;
  }

  /**
   * Implementation of abstract method from Processor
   * Load and parse rulesync subagent files from .rulesync/subagents/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const factory = this.getFactory(this.toolTarget);
    const subagentsDir = join(process.cwd(), RulesyncSubagent.getSettablePaths().relativeDirPath);

    // Check if directory exists
    const dirExists = await directoryExists(subagentsDir);
    if (!dirExists) {
      this.logger.debug(`Rulesync subagents directory not found: ${subagentsDir}`);
      return [];
    }

    const globPattern = factory.meta.supportsSubdirectory
      ? join(subagentsDir, "**", "*.md")
      : join(subagentsDir, "*.md");
    const mdFiles = await findFilesByGlobs(globPattern);

    if (mdFiles.length === 0) {
      this.logger.debug(`No markdown files found in rulesync subagents directory: ${subagentsDir}`);
      return [];
    }

    this.logger.debug(`Found ${mdFiles.length} subagent files in ${subagentsDir}`);

    // Parse all files and create RulesyncSubagent instances using fromFilePath
    const rulesyncSubagents: RulesyncSubagent[] = [];

    for (const filePath of mdFiles) {
      const relativeFilePath = this.safeRelativePath(subagentsDir, filePath);

      try {
        const rulesyncSubagent = await RulesyncSubagent.fromFile({
          relativeFilePath,
          validate: true,
        });

        rulesyncSubagents.push(rulesyncSubagent);
        this.logger.debug(`Successfully loaded subagent: ${relativeFilePath}`);
      } catch (error) {
        this.logger.warn(`Failed to load subagent file ${filePath}: ${formatError(error)}`);
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
    const baseDirFull = join(this.baseDir, paths.relativeDirPath);
    const globPattern = factory.meta.supportsSubdirectory
      ? join(baseDirFull, "**", factory.meta.filePattern)
      : join(baseDirFull, factory.meta.filePattern);

    const subagentFilePaths = await findFilesByGlobs(globPattern);

    if (forDeletion) {
      const toolSubagents = subagentFilePaths
        .map((path) =>
          factory.class.forDeletion({
            baseDir: this.baseDir,
            relativeDirPath: paths.relativeDirPath,
            relativeFilePath: this.safeRelativePath(baseDirFull, path),
            global: this.global,
          }),
        )
        .filter((subagent) => subagent.isDeletable());

      this.logger.debug(
        `Successfully loaded ${toolSubagents.length} ${paths.relativeDirPath} subagents`,
      );
      return toolSubagents;
    }

    const toolSubagents = await Promise.all(
      subagentFilePaths.map((path) =>
        factory.class.fromFile({
          baseDir: this.baseDir,
          relativeFilePath: this.safeRelativePath(baseDirFull, path),
          global: this.global,
        }),
      ),
    );

    this.logger.debug(
      `Successfully loaded ${toolSubagents.length} ${paths.relativeDirPath} subagents`,
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
