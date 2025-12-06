import { basename, join } from "node:path";
import { z } from "zod/mini";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { findFilesByGlobs } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { AgentsmdCommand } from "./agentsmd-command.js";
import { AntigravityCommand } from "./antigravity-command.js";
import { ClaudecodeCommand } from "./claudecode-command.js";
import { CodexcliCommand } from "./codexcli-command.js";
import { CopilotCommand } from "./copilot-command.js";
import { CursorCommand } from "./cursor-command.js";
import { GeminiCliCommand } from "./geminicli-command.js";
import { OpencodeCommand } from "./opencode-command.js";
import { RooCommand } from "./roo-command.js";
import { RulesyncCommand } from "./rulesync-command.js";
import {
  ToolCommand,
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
  "codexcli",
  "copilot",
  "cursor",
  "geminicli",
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
      meta: { extension: "md", supportsProject: true, supportsGlobal: false, isSimulated: true },
    },
  ],
  [
    "antigravity",
    {
      class: AntigravityCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: false, isSimulated: false },
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: true, isSimulated: false },
    },
  ],
  [
    "codexcli",
    {
      class: CodexcliCommand,
      meta: { extension: "md", supportsProject: false, supportsGlobal: true, isSimulated: false },
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
      },
    },
  ],
  [
    "cursor",
    {
      class: CursorCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: true, isSimulated: false },
    },
  ],
  [
    "geminicli",
    {
      class: GeminiCliCommand,
      meta: { extension: "toml", supportsProject: true, supportsGlobal: true, isSimulated: false },
    },
  ],
  [
    "opencode",
    {
      class: OpencodeCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: true, isSimulated: false },
    },
  ],
  [
    "roo",
    {
      class: RooCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: false, isSimulated: false },
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
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
  }) {
    super({ baseDir });
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

    const toolCommands = rulesyncCommands
      .map((rulesyncCommand) => {
        if (!factory.class.isTargetedByRulesyncCommand(rulesyncCommand)) {
          return null;
        }
        return factory.class.fromRulesyncCommand({
          baseDir: this.baseDir,
          rulesyncCommand,
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

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync command files from .rulesync/commands/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const rulesyncCommandPaths = await findFilesByGlobs(
      join(RulesyncCommand.getSettablePaths().relativeDirPath, "*.md"),
    );

    const rulesyncCommands = await Promise.all(
      rulesyncCommandPaths.map((path) =>
        RulesyncCommand.fromFile({ relativeFilePath: basename(path) }),
      ),
    );

    logger.info(`Successfully loaded ${rulesyncCommands.length} rulesync commands`);
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

    const commandFilePaths = await findFilesByGlobs(
      join(this.baseDir, paths.relativeDirPath, `*.${factory.meta.extension}`),
    );

    const toolCommands = await Promise.all(
      commandFilePaths.map((path) =>
        factory.class.fromFile({
          baseDir: this.baseDir,
          relativeFilePath: basename(path),
          global: this.global,
        }),
      ),
    );

    const result = forDeletion ? toolCommands.filter((cmd) => cmd.isDeletable()) : toolCommands;

    logger.info(`Successfully loaded ${result.length} ${paths.relativeDirPath} commands`);
    return result;
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
}
