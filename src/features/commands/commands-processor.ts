import { basename, join, relative } from "node:path";

import { z } from "zod/mini";

import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { checkPathTraversal, findFilesByGlobs } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { AgentsmdCommand } from "./agentsmd-command.js";
import { AntigravityCommand } from "./antigravity-command.js";
import { ClaudecodeCommand } from "./claudecode-command.js";
import { ClineCommand } from "./cline-command.js";
import { CodexcliCommand } from "./codexcli-command.js";
import { CopilotCommand } from "./copilot-command.js";
import { CursorCommand } from "./cursor-command.js";
import { FactorydroidCommand } from "./factorydroid-command.js";
import { GeminiCliCommand } from "./geminicli-command.js";
import { KiloCommand } from "./kilo-command.js";
import { KiroCommand } from "./kiro-command.js";
import { OpenCodeCommand } from "./opencode-command.js";
import { RooCommand } from "./roo-command.js";
import { RulesyncCommand } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

/**
 * Factory entry for each tool command class.
 * Stores the class reference and metadata for a tool.
 */
type ToolCommandFactory = {
  class: {
    isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean;
    fromRulesyncCommand(params: ToolCommandFromRulesyncCommandParams): ToolCommand;
    fromFile(params: ToolCommandFromFileParams): Promise<ToolCommand>;
    forDeletion(params: ToolCommandForDeletionParams): ToolCommand;
    getSettablePaths(options?: { global?: boolean }): ToolCommandSettablePaths;
  };
  meta: {
    /** File extension for the command file */
    extension: "md" | "toml" | "prompt.md";
    /** Whether the tool supports project-level commands */
    supportsProject: boolean;
    /** Whether the tool supports global (user-level) commands */
    supportsGlobal: boolean;
    /** Whether the command is simulated (embedded in rules) */
    isSimulated: boolean;
    /** Whether the tool supports subdirectory paths in commands */
    supportsSubdirectory: boolean;
  };
};

/**
 * Supported tool targets for CommandsProcessor.
 * Using a tuple to preserve order for consistent iteration.
 */
const commandsProcessorToolTargetTuple = [
  "agentsmd",
  "antigravity",
  "claudecode",
  "claudecode-legacy",
  "cline",
  "codexcli",
  "copilot",
  "cursor",
  "factorydroid",
  "geminicli",
  "kilo",
  "kiro",
  "opencode",
  "roo",
] as const;

export type CommandsProcessorToolTarget = (typeof commandsProcessorToolTargetTuple)[number];

// Schema for runtime validation
export const CommandsProcessorToolTargetSchema = z.enum(commandsProcessorToolTargetTuple);

/**
 * Factory Map mapping tool targets to their command factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
const toolCommandFactories = new Map<CommandsProcessorToolTarget, ToolCommandFactory>([
  [
    "agentsmd",
    {
      class: AgentsmdCommand,
      meta: {
        extension: "md",
        supportsProject: true,
        supportsGlobal: false,
        isSimulated: true,
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "antigravity",
    {
      class: AntigravityCommand,
      meta: {
        extension: "md",
        supportsProject: true,
        supportsGlobal: false,
        isSimulated: false,
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeCommand,
      meta: {
        extension: "md",
        supportsProject: true,
        supportsGlobal: true,
        isSimulated: false,
        supportsSubdirectory: true,
      },
    },
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeCommand,
      meta: {
        extension: "md",
        supportsProject: true,
        supportsGlobal: true,
        isSimulated: false,
        supportsSubdirectory: true,
      },
    },
  ],
  [
    "cline",
    {
      class: ClineCommand,
      meta: {
        extension: "md",
        supportsProject: true,
        supportsGlobal: true,
        isSimulated: false,
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "codexcli",
    {
      class: CodexcliCommand,
      meta: {
        extension: "md",
        supportsProject: false,
        supportsGlobal: true,
        isSimulated: false,
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "copilot",
    {
      class: CopilotCommand,
      meta: {
        extension: "prompt.md",
        supportsProject: true,
        supportsGlobal: false,
        isSimulated: false,
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "cursor",
    {
      class: CursorCommand,
      meta: {
        extension: "md",
        supportsProject: true,
        supportsGlobal: true,
        isSimulated: false,
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "factorydroid",
    {
      class: FactorydroidCommand,
      meta: {
        extension: "md",
        supportsProject: true,
        supportsGlobal: true,
        isSimulated: true,
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "geminicli",
    {
      class: GeminiCliCommand,
      meta: {
        extension: "toml",
        supportsProject: true,
        supportsGlobal: true,
        isSimulated: false,
        supportsSubdirectory: true,
      },
    },
  ],
  [
    "kilo",
    {
      class: KiloCommand,
      meta: {
        extension: "md",
        supportsProject: true,
        supportsGlobal: true,
        isSimulated: false,
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "kiro",
    {
      class: KiroCommand,
      meta: {
        extension: "md",
        supportsProject: true,
        supportsGlobal: false,
        isSimulated: false,
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "opencode",
    {
      class: OpenCodeCommand,
      meta: {
        extension: "md",
        supportsProject: true,
        supportsGlobal: true,
        isSimulated: false,
        supportsSubdirectory: true,
      },
    },
  ],
  [
    "roo",
    {
      class: RooCommand,
      meta: {
        extension: "md",
        supportsProject: true,
        supportsGlobal: false,
        isSimulated: false,
        supportsSubdirectory: true,
      },
    },
  ],
]);

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: CommandsProcessorToolTarget) => ToolCommandFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolCommandFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

// Derive tool target arrays from factory metadata
const allToolTargetKeys = [...toolCommandFactories.keys()];

const commandsProcessorToolTargets: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolCommandFactories.get(target);
  return factory?.meta.supportsProject ?? false;
});

const commandsProcessorToolTargetsSimulated: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolCommandFactories.get(target);
  return factory?.meta.isSimulated ?? false;
});

export const commandsProcessorToolTargetsGlobal: ToolTarget[] = allToolTargetKeys.filter(
  (target) => {
    const factory = toolCommandFactories.get(target);
    return factory?.meta.supportsGlobal ?? false;
  },
);

export class CommandsProcessor extends FeatureProcessor {
  private readonly toolTarget: CommandsProcessorToolTarget;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
    getFactory = defaultGetFactory,
    dryRun = false,
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
    dryRun?: boolean;
  }) {
    super({ baseDir, dryRun });
    const result = CommandsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for CommandsProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.getFactory = getFactory;
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncCommands = rulesyncFiles.filter(
      (file): file is RulesyncCommand => file instanceof RulesyncCommand,
    );

    const factory = this.getFactory(this.toolTarget);
    const flattenedPathOrigins = new Map<string, string>();

    const toolCommands = rulesyncCommands
      .map((rulesyncCommand) => {
        if (!factory.class.isTargetedByRulesyncCommand(rulesyncCommand)) {
          return null;
        }
        const originalRelativePath = rulesyncCommand.getRelativeFilePath();
        const commandToConvert = factory.meta.supportsSubdirectory
          ? rulesyncCommand
          : this.flattenRelativeFilePath(rulesyncCommand);
        if (!factory.meta.supportsSubdirectory) {
          const flattenedPath = commandToConvert.getRelativeFilePath();
          const firstOrigin = flattenedPathOrigins.get(flattenedPath);
          if (firstOrigin && firstOrigin !== originalRelativePath) {
            logger.warn(
              `Command path collision detected while flattening for ${this.toolTarget}: "${firstOrigin}" and "${originalRelativePath}" both map to "${flattenedPath}". Only the last processed command will be used.`,
            );
          } else if (!firstOrigin) {
            flattenedPathOrigins.set(flattenedPath, originalRelativePath);
          }
        }
        return factory.class.fromRulesyncCommand({
          baseDir: this.baseDir,
          rulesyncCommand: commandToConvert,
          global: this.global,
        });
      })
      .filter((command): command is ToolCommand => command !== null);

    return toolCommands;
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolCommands = toolFiles.filter(
      (file): file is ToolCommand => file instanceof ToolCommand,
    );

    const rulesyncCommands = toolCommands.map((toolCommand) => {
      return toolCommand.toRulesyncCommand();
    });

    return rulesyncCommands;
  }

  private flattenRelativeFilePath(rulesyncCommand: RulesyncCommand): RulesyncCommand {
    const flatPath = basename(rulesyncCommand.getRelativeFilePath());
    if (flatPath === rulesyncCommand.getRelativeFilePath()) return rulesyncCommand;
    return rulesyncCommand.withRelativeFilePath(flatPath);
  }

  private safeRelativePath(basePath: string, fullPath: string): string {
    const rel = relative(basePath, fullPath);
    checkPathTraversal({ relativePath: rel, intendedRootDir: basePath });
    return rel;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync command files from .rulesync/commands/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const basePath = RulesyncCommand.getSettablePaths().relativeDirPath;
    const rulesyncCommandPaths = await findFilesByGlobs(join(basePath, "**", "*.md"));

    const rulesyncCommands = await Promise.all(
      rulesyncCommandPaths.map((path) =>
        RulesyncCommand.fromFile({ relativeFilePath: this.safeRelativePath(basePath, path) }),
      ),
    );

    logger.debug(`Successfully loaded ${rulesyncCommands.length} rulesync commands`);
    return rulesyncCommands;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific command configurations and parse them into ToolCommand instances
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
      ? join(baseDirFull, "**", `*.${factory.meta.extension}`)
      : join(baseDirFull, `*.${factory.meta.extension}`);
    const commandFilePaths = await findFilesByGlobs(globPattern);

    if (forDeletion) {
      const toolCommands = commandFilePaths
        .map((path) =>
          factory.class.forDeletion({
            baseDir: this.baseDir,
            relativeDirPath: paths.relativeDirPath,
            relativeFilePath: this.safeRelativePath(baseDirFull, path),
            global: this.global,
          }),
        )
        .filter((cmd) => cmd.isDeletable());

      logger.debug(`Successfully loaded ${toolCommands.length} ${paths.relativeDirPath} commands`);
      return toolCommands;
    }

    const toolCommands = await Promise.all(
      commandFilePaths.map((path) =>
        factory.class.fromFile({
          baseDir: this.baseDir,
          relativeFilePath: this.safeRelativePath(baseDirFull, path),
          global: this.global,
        }),
      ),
    );

    logger.debug(`Successfully loaded ${toolCommands.length} ${paths.relativeDirPath} commands`);
    return toolCommands;
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
      return [...commandsProcessorToolTargetsGlobal];
    }
    if (!includeSimulated) {
      return commandsProcessorToolTargets.filter(
        (target) => !commandsProcessorToolTargetsSimulated.includes(target),
      );
    }
    return [...commandsProcessorToolTargets];
  }

  static getToolTargetsSimulated(): ToolTarget[] {
    return [...commandsProcessorToolTargetsSimulated];
  }

  /**
   * Get the factory for a specific tool target.
   * This is a static version of the internal getFactory for external use.
   * @param target - The tool target. Must be a valid CommandsProcessorToolTarget.
   * @returns The factory for the target, or undefined if not found.
   */
  static getFactory(target: ToolTarget): ToolCommandFactory | undefined {
    // Validate that target is supported
    const result = CommandsProcessorToolTargetSchema.safeParse(target);
    if (!result.success) {
      return undefined;
    }
    return toolCommandFactories.get(result.data);
  }
}
