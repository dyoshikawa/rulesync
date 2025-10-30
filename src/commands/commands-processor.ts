import { basename, join } from "node:path";
import { z } from "zod/mini";
import { FeatureProcessor } from "../types/feature-processor.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { findFilesByGlobs } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { formatZodError } from "../utils/zod-error.js";
import { AgentsmdCommand } from "./agentsmd-command.js";
import { ClaudecodeCommand } from "./claudecode-command.js";
import { CodexcliCommand } from "./codexcli-command.js";
import { CopilotCommand } from "./copilot-command.js";
import { CursorCommand } from "./cursor-command.js";
import { GeminiCliCommand } from "./geminicli-command.js";
import { RooCommand } from "./roo-command.js";
import { RulesyncCommand } from "./rulesync-command.js";
import { ToolCommand } from "./tool-command.js";

const commandsProcessorToolTargets: ToolTarget[] = [
  "agentsmd",
  "claudecode",
  "geminicli",
  "roo",
  "copilot",
  "cursor",
];
export const CommandsProcessorToolTargetSchema = z.enum(
  // codexcli is not in the list of tool targets but we add it here because it is a valid tool target for global mode generation
  commandsProcessorToolTargets.concat("codexcli"),
);

const commandsProcessorToolTargetsSimulated: ToolTarget[] = ["agentsmd"];
export const commandsProcessorToolTargetsGlobal: ToolTarget[] = [
  "claudecode",
  "cursor",
  "geminicli",
  "codexcli",
];

export type CommandsProcessorToolTarget = z.infer<typeof CommandsProcessorToolTargetSchema>;

export class CommandsProcessor extends FeatureProcessor {
  private readonly toolTarget: CommandsProcessorToolTarget;
  private readonly global: boolean;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
  }: { baseDir?: string; toolTarget: CommandsProcessorToolTarget; global?: boolean }) {
    super({ baseDir });
    const result = CommandsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for CommandsProcessor: ${toolTarget}. ${formatZodError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncCommands = rulesyncFiles.filter(
      (file): file is RulesyncCommand => file instanceof RulesyncCommand,
    );

    const toolCommands = rulesyncCommands
      .map((rulesyncCommand) => {
        switch (this.toolTarget) {
          case "agentsmd":
            if (!AgentsmdCommand.isTargetedByRulesyncCommand(rulesyncCommand)) {
              return null;
            }
            return AgentsmdCommand.fromRulesyncCommand({
              baseDir: this.baseDir,
              rulesyncCommand: rulesyncCommand,
            });
          case "claudecode":
            if (!ClaudecodeCommand.isTargetedByRulesyncCommand(rulesyncCommand)) {
              return null;
            }
            return ClaudecodeCommand.fromRulesyncCommand({
              baseDir: this.baseDir,
              rulesyncCommand: rulesyncCommand,
              global: this.global,
            });
          case "geminicli":
            if (!GeminiCliCommand.isTargetedByRulesyncCommand(rulesyncCommand)) {
              return null;
            }
            return GeminiCliCommand.fromRulesyncCommand({
              baseDir: this.baseDir,
              rulesyncCommand: rulesyncCommand,
              global: this.global,
            });
          case "roo":
            if (!RooCommand.isTargetedByRulesyncCommand(rulesyncCommand)) {
              return null;
            }
            return RooCommand.fromRulesyncCommand({
              baseDir: this.baseDir,
              rulesyncCommand: rulesyncCommand,
            });
          case "copilot":
            if (!CopilotCommand.isTargetedByRulesyncCommand(rulesyncCommand)) {
              return null;
            }
            return CopilotCommand.fromRulesyncCommand({
              baseDir: this.baseDir,
              rulesyncCommand: rulesyncCommand,
            });
          case "cursor":
            if (!CursorCommand.isTargetedByRulesyncCommand(rulesyncCommand)) {
              return null;
            }
            return CursorCommand.fromRulesyncCommand({
              baseDir: this.baseDir,
              rulesyncCommand: rulesyncCommand,
              global: this.global,
            });
          case "codexcli":
            if (!CodexcliCommand.isTargetedByRulesyncCommand(rulesyncCommand)) {
              return null;
            }
            return CodexcliCommand.fromRulesyncCommand({
              baseDir: this.baseDir,
              rulesyncCommand: rulesyncCommand,
              global: this.global,
            });
          default:
            throw new Error(`Unsupported tool target: ${this.toolTarget}`);
        }
      })
      .filter(
        (
          command,
        ): command is
          | AgentsmdCommand
          | ClaudecodeCommand
          | GeminiCliCommand
          | RooCommand
          | CopilotCommand
          | CursorCommand
          | CodexcliCommand => command !== null,
      );

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

    const rulesyncCommands = (
      await Promise.allSettled(
        rulesyncCommandPaths.map((path) =>
          RulesyncCommand.fromFile({ relativeFilePath: basename(path) }),
        ),
      )
    )
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    logger.info(`Successfully loaded ${rulesyncCommands.length} rulesync commands`);
    return rulesyncCommands;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific command configurations and parse them into ToolCommand instances
   */
  async loadToolFiles(): Promise<ToolFile[]> {
    switch (this.toolTarget) {
      case "agentsmd":
        return await this.loadAgentsmdCommands();
      case "claudecode":
        return await this.loadClaudecodeCommands();
      case "geminicli":
        return await this.loadGeminicliCommands();
      case "roo":
        return await this.loadRooCommands();
      case "copilot":
        return await this.loadCopilotCommands();
      case "cursor":
        return await this.loadCursorCommands();
      case "codexcli":
        return await this.loadCodexcliCommands();
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    }
  }

  async loadToolFilesToDelete(): Promise<ToolFile[]> {
    return this.loadToolFiles();
  }

  private async loadToolCommandDefault({
    toolTarget,
    relativeDirPath,
    extension,
  }: {
    toolTarget: "agentsmd" | "claudecode" | "geminicli" | "roo" | "copilot" | "cursor" | "codexcli";
    relativeDirPath: string;
    extension: "md" | "toml" | "prompt.md";
  }): Promise<ToolCommand[]> {
    const commandFilePaths = await findFilesByGlobs(
      join(this.baseDir, relativeDirPath, `*.${extension}`),
    );

    const toolCommands = (
      await Promise.allSettled(
        commandFilePaths.map((path) => {
          switch (toolTarget) {
            case "agentsmd":
              return AgentsmdCommand.fromFile({
                baseDir: this.baseDir,
                relativeFilePath: basename(path),
              });
            case "claudecode":
              return ClaudecodeCommand.fromFile({
                baseDir: this.baseDir,
                relativeFilePath: basename(path),
                global: this.global,
              });
            case "geminicli":
              return GeminiCliCommand.fromFile({
                baseDir: this.baseDir,
                relativeFilePath: basename(path),
                global: this.global,
              });
            case "roo":
              return RooCommand.fromFile({
                baseDir: this.baseDir,
                relativeFilePath: basename(path),
              });
            case "copilot":
              return CopilotCommand.fromFile({
                baseDir: this.baseDir,
                relativeFilePath: basename(path),
              });
            case "cursor":
              return CursorCommand.fromFile({
                baseDir: this.baseDir,
                relativeFilePath: basename(path),
                global: this.global,
              });
            case "codexcli":
              return CodexcliCommand.fromFile({
                baseDir: this.baseDir,
                relativeFilePath: basename(path),
                global: this.global,
              });
            default:
              throw new Error(`Unsupported tool target: ${toolTarget}`);
          }
        }),
      )
    )

      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    logger.info(`Successfully loaded ${toolCommands.length} ${relativeDirPath} commands`);
    return toolCommands;
  }

  /**
   * Load Agents.md command configurations from .agents/commands/ directory
   */
  private async loadAgentsmdCommands(): Promise<ToolCommand[]> {
    return await this.loadToolCommandDefault({
      toolTarget: "agentsmd",
      relativeDirPath: AgentsmdCommand.getSettablePaths().relativeDirPath,
      extension: "md",
    });
  }

  /**
   * Load Copilot command configurations from .github/prompts/ directory
   */
  private async loadCopilotCommands(): Promise<ToolCommand[]> {
    return await this.loadToolCommandDefault({
      toolTarget: "copilot",
      relativeDirPath: CopilotCommand.getSettablePaths().relativeDirPath,
      extension: "prompt.md",
    });
  }

  /**
   * Load Claude Code command configurations from .claude/commands/ directory
   */
  private async loadClaudecodeCommands(): Promise<ToolCommand[]> {
    const paths = ClaudecodeCommand.getSettablePaths({ global: this.global });
    return await this.loadToolCommandDefault({
      toolTarget: "claudecode",
      relativeDirPath: paths.relativeDirPath,
      extension: "md",
    });
  }

  /**
   * Load Cursor command configurations from .cursor/commands/ directory
   */
  private async loadCursorCommands(): Promise<ToolCommand[]> {
    const paths = CursorCommand.getSettablePaths({ global: this.global });
    return await this.loadToolCommandDefault({
      toolTarget: "cursor",
      relativeDirPath: paths.relativeDirPath,
      extension: "md",
    });
  }

  /**
   * Load Gemini CLI command configurations from .gemini/commands/ directory
   */
  private async loadGeminicliCommands(): Promise<ToolCommand[]> {
    const paths = GeminiCliCommand.getSettablePaths({ global: this.global });
    return await this.loadToolCommandDefault({
      toolTarget: "geminicli",
      relativeDirPath: paths.relativeDirPath,
      extension: "toml",
    });
  }

  /**
   * Load Codex CLI command configurations from .codex/prompts/ directory
   */
  private async loadCodexcliCommands(): Promise<ToolCommand[]> {
    const paths = CodexcliCommand.getSettablePaths({ global: this.global });
    return await this.loadToolCommandDefault({
      toolTarget: "codexcli",
      relativeDirPath: paths.relativeDirPath,
      extension: "md",
    });
  }

  /**
   * Load Roo Code command configurations from .roo/commands/ directory
   */
  private async loadRooCommands(): Promise<ToolCommand[]> {
    return await this.loadToolCommandDefault({
      toolTarget: "roo",
      relativeDirPath: RooCommand.getSettablePaths().relativeDirPath,
      extension: "md",
    });
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({
    includeSimulated = false,
  }: {
    includeSimulated?: boolean;
  } = {}): ToolTarget[] {
    if (!includeSimulated) {
      return commandsProcessorToolTargets.filter(
        (target) => !commandsProcessorToolTargetsSimulated.includes(target),
      );
    }

    return commandsProcessorToolTargets;
  }

  static getToolTargetsSimulated(): ToolTarget[] {
    return commandsProcessorToolTargetsSimulated;
  }

  static getToolTargetsGlobal(): ToolTarget[] {
    return commandsProcessorToolTargetsGlobal;
  }
}
