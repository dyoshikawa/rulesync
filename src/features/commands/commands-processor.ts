import { basename, join, relative } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_COMMANDS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { commandsProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { checkPathTraversal, findFilesByGlobs } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { AgentsmdCommand } from "./agentsmd-command.js";
import { AntigravityCliCommand } from "./antigravity-cli-command.js";
import { AntigravityIdeCommand } from "./antigravity-ide-command.js";
import { AugmentcodeCommand } from "./augmentcode-command.js";
import { ClaudecodeCommand } from "./claudecode-command.js";
import { ClineCommand } from "./cline-command.js";
import { CodexcliCommand } from "./codexcli-command.js";
import { CopilotCommand } from "./copilot-command.js";
import { CursorCommand } from "./cursor-command.js";
import { DevinCommand } from "./devin-command.js";
import { FactorydroidCommand } from "./factorydroid-command.js";
import { GooseCommand } from "./goose-command.js";
import { HermesagentCommand } from "./hermesagent-command.js";
import { JunieCommand } from "./junie-command.js";
import { KiloCommand } from "./kilo-command.js";
import { KiroCliCommand } from "./kiro-cli-command.js";
import { KiroCommand } from "./kiro-command.js";
import { KiroIdeCommand } from "./kiro-ide-command.js";
import { OpenCodeCommand } from "./opencode-command.js";
import { PiCommand } from "./pi-command.js";
import { QwencodeCommand } from "./qwencode-command.js";
import { RooCommand } from "./roo-command.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { TaktCommand } from "./takt-command.js";
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
    /**
     * Optional import-only hook: load extra commands that are not discoverable
     * as standalone files (e.g. OpenCode commands defined inline in
     * `opencode.json`). Invoked by {@link loadToolFiles} for the import
     * direction only, never for orphan deletion.
     */
    loadAdditionalImportFiles?(params: {
      outputRoot: string;
      global: boolean;
    }): Promise<ToolCommand[]>;
  };
  meta: {
    /** File extension for the command file */
    extension: "md" | "toml" | "prompt.md" | "yaml";
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

export type CommandsProcessorToolTarget = (typeof commandsProcessorToolTargetTuple)[number];

// Schema for runtime validation
export const CommandsProcessorToolTargetSchema = z.enum(commandsProcessorToolTargetTuple);

/**
 * Factory Map mapping tool targets to their command factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
export const toolCommandFactories = new Map<CommandsProcessorToolTarget, ToolCommandFactory>([
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
    "antigravity-cli",
    {
      class: AntigravityCliCommand,
      meta: {
        // The Antigravity CLI (`agy`) reads workflow slash commands from the
        // shared `.agents/workflows/` directory (project) and its own
        // `~/.gemini/antigravity-cli/global_workflows/` tree (global).
        extension: "md",
        supportsProject: true,
        supportsGlobal: true,
        isSimulated: false,
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "antigravity-ide",
    {
      class: AntigravityIdeCommand,
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
    "augmentcode",
    {
      class: AugmentcodeCommand,
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
        // Factory Droid custom slash commands are native Markdown files under
        // .factory/commands/ (project) and ~/.factory/commands/ (personal/global).
        // https://docs.factory.ai/cli/configuration/custom-slash-commands
        extension: "md",
        supportsProject: true,
        supportsGlobal: true,
        isSimulated: false,
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "goose",
    {
      class: GooseCommand,
      meta: {
        extension: "yaml",
        supportsProject: true,
        supportsGlobal: true,
        isSimulated: false,
        // Non-recursive: project recipes live flat in `.goose/recipes/`, while
        // subagent sub-recipes live in `.goose/recipes/subagents/` and must not
        // be picked up by the command importer.
        supportsSubdirectory: false,
      },
    },
  ],
  [
    "hermesagent",
    {
      class: HermesagentCommand,
      meta: {
        extension: "md",
        supportsProject: false,
        supportsGlobal: true,
        isSimulated: false,
        supportsSubdirectory: true,
      },
    },
  ],
  [
    "junie",
    {
      class: JunieCommand,
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
    "kiro-cli",
    {
      class: KiroCliCommand,
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
    "kiro-ide",
    {
      class: KiroIdeCommand,
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
    "pi",
    {
      class: PiCommand,
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
    "qwencode",
    {
      // Qwen Code custom commands are native Markdown files (TOML is deprecated
      // upstream) under `.qwen/commands/` (project) / `~/.qwen/commands/`
      // (global), with subdirectory namespacing (`git/commit.md` -> `/git:commit`).
      class: QwencodeCommand,
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
  [
    "takt",
    {
      class: TaktCommand,
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
    "devin",
    {
      class: DevinCommand,
      meta: {
        // Devin workflows live under `.devin/workflows/*.md` (project) and
        // `~/.codeium/windsurf/global_workflows/*.md` (global). Flat Markdown
        // files with optional frontmatter; no subdirectory nesting.
        extension: "md",
        supportsProject: true,
        supportsGlobal: true,
        isSimulated: false,
        supportsSubdirectory: false,
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

const commandsProcessorToolTargetsGlobal: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolCommandFactories.get(target);
  return factory?.meta.supportsGlobal ?? false;
});

export class CommandsProcessor extends FeatureProcessor {
  private readonly toolTarget: CommandsProcessorToolTarget;
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
            this.logger.warn(
              `Command path collision detected while flattening for ${this.toolTarget}: "${firstOrigin}" and "${originalRelativePath}" both map to "${flattenedPath}". Only the last processed command will be used.`,
            );
          } else if (!firstOrigin) {
            flattenedPathOrigins.set(flattenedPath, originalRelativePath);
          }
        }
        return factory.class.fromRulesyncCommand({
          outputRoot: this.outputRoot,
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
    const basePath = join(this.inputRoot, RulesyncCommand.getSettablePaths().relativeDirPath);
    const rulesyncCommandPaths = await findFilesByGlobs(join(basePath, "**", "*.md"));

    const rulesyncCommands = await Promise.all(
      rulesyncCommandPaths.map((path) =>
        RulesyncCommand.fromFile({
          outputRoot: this.inputRoot,
          relativeFilePath: this.safeRelativePath(basePath, path),
        }),
      ),
    );

    this.logger.debug(`Successfully loaded ${rulesyncCommands.length} rulesync commands`);
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

    const outputRootFull = join(this.outputRoot, paths.relativeDirPath);
    const globPattern = factory.meta.supportsSubdirectory
      ? join(outputRootFull, "**", `*.${factory.meta.extension}`)
      : join(outputRootFull, `*.${factory.meta.extension}`);
    const commandFilePaths = await findFilesByGlobs(globPattern);

    if (forDeletion) {
      const toolCommands = commandFilePaths
        .map((path) =>
          factory.class.forDeletion({
            outputRoot: this.outputRoot,
            relativeDirPath: paths.relativeDirPath,
            relativeFilePath: this.safeRelativePath(outputRootFull, path),
            global: this.global,
          }),
        )
        .filter((cmd) => cmd.isDeletable());

      this.logger.debug(
        `Successfully loaded ${toolCommands.length} ${paths.relativeDirPath} commands`,
      );
      return toolCommands;
    }

    const toolCommands = await Promise.all(
      commandFilePaths.map((path) =>
        factory.class.fromFile({
          outputRoot: this.outputRoot,
          relativeFilePath: this.safeRelativePath(outputRootFull, path),
          global: this.global,
        }),
      ),
    );

    // Import-only: merge in commands defined outside the standalone-file layout
    // (e.g. OpenCode's inline `command` block in `opencode.json`). A standalone
    // Markdown file with the same relative path takes precedence.
    if (factory.class.loadAdditionalImportFiles) {
      const seen = new Set(toolCommands.map((command) => command.getRelativeFilePath()));
      const additionalCommands = await factory.class.loadAdditionalImportFiles({
        outputRoot: this.outputRoot,
        global: this.global,
      });
      for (const command of additionalCommands) {
        const key = command.getRelativeFilePath();
        if (seen.has(key)) {
          this.logger.warn(
            `Duplicate ${this.toolTarget} command "${key}" defined inline; ` +
              `keeping the standalone file and ignoring the inline copy.`,
          );
          continue;
        }
        seen.add(key);
        toolCommands.push(command);
      }
    }

    this.logger.debug(
      `Successfully loaded ${toolCommands.length} ${paths.relativeDirPath} commands`,
    );
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
   * Convention section describing how simulated custom slash commands are invoked,
   * embedded into a tool's root rule (e.g. AGENTS.md) by the rules feature.
   */
  static getSimulatedConventionSection(): string {
    return `## Simulated Custom Slash Commands

Custom slash commands allow you to define frequently-used prompts as Markdown files that you can execute.

### Syntax

Users can use following syntax to invoke a custom command.

\`\`\`txt
s/<command> [arguments]
\`\`\`

This syntax employs a double slash (\`s/\`) to prevent conflicts with built-in slash commands.
The \`s\` in \`s/\` stands for *simulate*. Because custom slash commands are not built-in, this syntax provides a pseudo way to invoke them.

When users call a custom slash command, you have to look for the markdown file, \`${join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "{command}.md")}\`, then execute the contents of that file as the block of operations.`;
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
