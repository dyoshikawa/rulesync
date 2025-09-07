import { basename, join } from "node:path";
import { z } from "zod/mini";
import { FeatureProcessor } from "../types/feature-processor.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { directoryExists, findFilesByGlobs, listDirectoryFiles } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { CodexCliSubagent } from "./codexcli-subagent.js";
import { CopilotSubagent } from "./copilot-subagent.js";
import { CursorSubagent } from "./cursor-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SimulatedSubagent } from "./simulated-subagent.js";
import { ToolSubagent } from "./tool-subagent.js";

export const subagentsProcessorToolTargets: ToolTarget[] = [
  "claudecode",
  "copilot",
  "cursor",
  "codexcli",
];

export const subagentsProcessorToolTargetsSimulated: ToolTarget[] = [
  "copilot",
  "cursor",
  "codexcli",
];
export const SubagentsProcessorToolTargetSchema = z.enum(subagentsProcessorToolTargets);

export type SubagentsProcessorToolTarget = z.infer<typeof SubagentsProcessorToolTargetSchema>;

export class SubagentsProcessor extends FeatureProcessor {
  private readonly toolTarget: SubagentsProcessorToolTarget;

  constructor({
    baseDir = ".",
    toolTarget,
  }: { baseDir?: string; toolTarget: SubagentsProcessorToolTarget }) {
    super({ baseDir });
    this.toolTarget = SubagentsProcessorToolTargetSchema.parse(toolTarget);
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncSubagents = rulesyncFiles.filter(
      (file): file is RulesyncSubagent => file instanceof RulesyncSubagent,
    );

    const toolSubagents = rulesyncSubagents.map((rulesyncSubagent) => {
      switch (this.toolTarget) {
        case "claudecode":
          return ClaudecodeSubagent.fromRulesyncSubagent({
            baseDir: this.baseDir,
            relativeDirPath: RulesyncSubagent.getSettablePaths().relativeDirPath,
            rulesyncSubagent: rulesyncSubagent,
          });
        case "copilot":
          return CopilotSubagent.fromRulesyncSubagent({
            baseDir: this.baseDir,
            relativeDirPath: RulesyncSubagent.getSettablePaths().relativeDirPath,
            rulesyncSubagent: rulesyncSubagent,
          });
        case "cursor":
          return CursorSubagent.fromRulesyncSubagent({
            baseDir: this.baseDir,
            relativeDirPath: RulesyncSubagent.getSettablePaths().relativeDirPath,
            rulesyncSubagent: rulesyncSubagent,
          });
        case "codexcli":
          return CodexCliSubagent.fromRulesyncSubagent({
            baseDir: this.baseDir,
            relativeDirPath: RulesyncSubagent.getSettablePaths().relativeDirPath,
            rulesyncSubagent: rulesyncSubagent,
          });
        default:
          throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      }
    });

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
        logger.debug(
          `Skipping simulated subagent conversion: ${toolSubagent.getRelativeFilePath()}`,
        );
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
    const subagentsDir = join(this.baseDir, RulesyncSubagent.getSettablePaths().relativeDirPath);

    // Check if directory exists
    const dirExists = await directoryExists(subagentsDir);
    if (!dirExists) {
      logger.debug(`Rulesync subagents directory not found: ${subagentsDir}`);
      return [];
    }

    // Read all markdown files from the directory
    const entries = await listDirectoryFiles(subagentsDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      logger.debug(`No markdown files found in rulesync subagents directory: ${subagentsDir}`);
      return [];
    }

    logger.info(`Found ${mdFiles.length} subagent files in ${subagentsDir}`);

    // Parse all files and create RulesyncSubagent instances using fromFilePath
    const rulesyncSubagents: RulesyncSubagent[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(subagentsDir, mdFile);

      try {
        const rulesyncSubagent = await RulesyncSubagent.fromFile({
          relativeFilePath: mdFile,
          validate: true,
        });

        rulesyncSubagents.push(rulesyncSubagent);
        logger.debug(`Successfully loaded subagent: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load subagent file ${filepath}:`, error);
        continue;
      }
    }

    if (rulesyncSubagents.length === 0) {
      logger.debug(`No valid subagents found in ${subagentsDir}`);
      return [];
    }

    logger.info(`Successfully loaded ${rulesyncSubagents.length} rulesync subagents`);
    return rulesyncSubagents;
  }

  /**
   * Implementation of abstract method from Processor
   * Load tool-specific subagent configurations and parse them into ToolSubagent instances
   */
  async loadToolFiles(): Promise<ToolFile[]> {
    switch (this.toolTarget) {
      case "claudecode":
        return await this.loadClaudecodeSubagents();
      case "copilot":
        return await this.loadCopilotSubagents();
      case "cursor":
        return await this.loadCursorSubagents();
      case "codexcli":
        return await this.loadCodexCliSubagents();
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    }
  }

  /**
   * Load Claude Code subagent configurations from .claude/agents/ directory
   */
  private async loadClaudecodeSubagents(): Promise<ToolSubagent[]> {
    return await this.loadToolSubagentsDefault({
      relativeDirPath: ClaudecodeSubagent.getSettablePaths().nonRoot.relativeDirPath,
      fromFile: (relativeFilePath) => ClaudecodeSubagent.fromFile({ relativeFilePath }),
    });
  }

  /**
   * Load Copilot subagent configurations from .copilot/subagents/ directory
   */
  private async loadCopilotSubagents(): Promise<ToolSubagent[]> {
    return await this.loadToolSubagentsDefault({
      relativeDirPath: CopilotSubagent.getSettablePaths().nonRoot.relativeDirPath,
      fromFile: (relativeFilePath) => CopilotSubagent.fromFile({ relativeFilePath }),
    });
  }

  /**
   * Load Cursor subagent configurations from .cursor/subagents/ directory
   */
  private async loadCursorSubagents(): Promise<ToolSubagent[]> {
    return await this.loadToolSubagentsDefault({
      relativeDirPath: CursorSubagent.getSettablePaths().nonRoot.relativeDirPath,
      fromFile: (relativeFilePath) => CursorSubagent.fromFile({ relativeFilePath }),
    });
  }

  /**
   * Load CodexCli subagent configurations from .codex/subagents/ directory
   */
  private async loadCodexCliSubagents(): Promise<ToolSubagent[]> {
    return await this.loadToolSubagentsDefault({
      relativeDirPath: CodexCliSubagent.getSettablePaths().nonRoot.relativeDirPath,
      fromFile: (relativeFilePath) => CodexCliSubagent.fromFile({ relativeFilePath }),
    });
  }

  private async loadToolSubagentsDefault({
    relativeDirPath,
    fromFile,
  }: {
    relativeDirPath: string;
    fromFile: (relativeFilePath: string) => Promise<ToolSubagent>;
  }): Promise<ToolSubagent[]> {
    const paths = await findFilesByGlobs(join(this.baseDir, relativeDirPath, "*.md"));

    const subagents = (await Promise.allSettled(paths.map((path) => fromFile(basename(path)))))
      .filter((r): r is PromiseFulfilledResult<ToolSubagent> => r.status === "fulfilled")
      .map((r) => r.value);

    logger.info(`Successfully loaded ${subagents.length} ${relativeDirPath} subagents`);

    return subagents;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({
    excludeSimulated = false,
  }: {
    excludeSimulated?: boolean;
  } = {}): ToolTarget[] {
    if (excludeSimulated) {
      return subagentsProcessorToolTargets.filter(
        (target) => !subagentsProcessorToolTargetsSimulated.includes(target),
      );
    }

    return subagentsProcessorToolTargets;
  }
}
