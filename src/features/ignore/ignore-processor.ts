import { z } from "zod/mini";
import { RULESYNC_AIIGNORE_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";
import { AmazonqcliIgnore } from "./amazonqcli-ignore.js";
import { AugmentcodeIgnore } from "./augmentcode-ignore.js";
import { ClaudecodeIgnore } from "./claudecode-ignore.js";
import { ClineIgnore } from "./cline-ignore.js";
import { CursorIgnore } from "./cursor-ignore.js";
import { GeminiCliIgnore } from "./geminicli-ignore.js";
import { JunieIgnore } from "./junie-ignore.js";
import { KiroIgnore } from "./kiro-ignore.js";
import { QwencodeIgnore } from "./qwencode-ignore.js";
import { RooIgnore } from "./roo-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";
import { WindsurfIgnore } from "./windsurf-ignore.js";

const ignoreProcessorToolTargets: ToolTarget[] = [
  "amazonqcli",
  "augmentcode",
  "claudecode",
  "cline",
  "cursor",
  "geminicli",
  "junie",
  "kiro",
  "qwencode",
  "roo",
  "windsurf",
];

export const IgnoreProcessorToolTargetSchema = z.enum(ignoreProcessorToolTargets);

export type IgnoreProcessorToolTarget = z.infer<typeof IgnoreProcessorToolTargetSchema>;

export class IgnoreProcessor extends FeatureProcessor {
  private readonly toolTarget: IgnoreProcessorToolTarget;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
  }: { baseDir?: string; toolTarget: IgnoreProcessorToolTarget }) {
    super({ baseDir });
    const result = IgnoreProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for IgnoreProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
  }

  async writeToolIgnoresFromRulesyncIgnores(rulesyncIgnores: RulesyncIgnore[]): Promise<void> {
    const toolIgnores = await this.convertRulesyncFilesToToolFiles(rulesyncIgnores);
    await this.writeAiFiles(toolIgnores);
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync ignore files from .rulesync/ignore/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    try {
      return [await RulesyncIgnore.fromFile()];
    } catch (error) {
      logger.error(`Failed to load rulesync files: ${formatError(error)}`);
      return [];
    }
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific ignore configurations and parse them into ToolIgnore instances
   */
  async loadToolFiles({
    forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    try {
      const toolIgnores = await this.loadToolIgnores();

      if (forDeletion) {
        return toolIgnores.filter((toolFile) => toolFile.isDeletable());
      }

      return toolIgnores;
    } catch (error) {
      const errorMessage = `Failed to load tool files: ${formatError(error)}`;
      if (error instanceof Error && error.message.includes("no such file or directory")) {
        logger.debug(errorMessage);
      } else {
        logger.error(errorMessage);
      }
      return [];
    }
  }

  async loadToolIgnores(): Promise<ToolIgnore[]> {
    switch (this.toolTarget) {
      case "amazonqcli":
        return [await AmazonqcliIgnore.fromFile({ baseDir: this.baseDir })];
      case "augmentcode":
        return [await AugmentcodeIgnore.fromFile({ baseDir: this.baseDir })];
      case "claudecode":
        return [await ClaudecodeIgnore.fromFile({ baseDir: this.baseDir })];
      case "cline":
        return [await ClineIgnore.fromFile({ baseDir: this.baseDir })];
      case "cursor":
        return [await CursorIgnore.fromFile({ baseDir: this.baseDir })];
      case "geminicli":
        return [await GeminiCliIgnore.fromFile({ baseDir: this.baseDir })];
      case "junie":
        return [await JunieIgnore.fromFile({ baseDir: this.baseDir })];
      case "kiro":
        return [await KiroIgnore.fromFile({ baseDir: this.baseDir })];
      case "qwencode":
        return [await QwencodeIgnore.fromFile({ baseDir: this.baseDir })];
      case "roo":
        return [await RooIgnore.fromFile({ baseDir: this.baseDir })];
      case "windsurf":
        return [await WindsurfIgnore.fromFile({ baseDir: this.baseDir })];
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    }
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert RulesyncFile[] to ToolFile[]
   */
  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncIgnore = rulesyncFiles.find(
      (file): file is RulesyncIgnore => file instanceof RulesyncIgnore,
    );

    if (!rulesyncIgnore) {
      throw new Error(`No ${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH} found.`);
    }

    const toolIgnores = await Promise.all(
      [rulesyncIgnore].map(async (rulesyncIgnore) => {
        switch (this.toolTarget) {
          case "amazonqcli":
            return AmazonqcliIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              rulesyncIgnore,
            });
          case "augmentcode":
            return AugmentcodeIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              rulesyncIgnore,
            });
          case "claudecode":
            return await ClaudecodeIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              rulesyncIgnore,
            });
          case "cline":
            return ClineIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              rulesyncIgnore,
            });
          case "cursor":
            return CursorIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              rulesyncIgnore,
            });
          case "geminicli":
            return GeminiCliIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              rulesyncIgnore,
            });
          case "junie":
            return JunieIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              rulesyncIgnore,
            });
          case "kiro":
            return KiroIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              rulesyncIgnore,
            });
          case "qwencode":
            return QwencodeIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              rulesyncIgnore,
            });
          case "roo":
            return RooIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              rulesyncIgnore,
            });
          case "windsurf":
            return WindsurfIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              rulesyncIgnore,
            });
          default:
            throw new Error(`Unsupported tool target: ${this.toolTarget}`);
        }
      }),
    );

    return toolIgnores;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert ToolFile[] to RulesyncFile[]
   */
  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolIgnores = toolFiles.filter((file): file is ToolIgnore => file instanceof ToolIgnore);

    const rulesyncIgnores = toolIgnores.map((toolIgnore) => {
      return toolIgnore.toRulesyncIgnore();
    });

    return rulesyncIgnores;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({ global = false }: { global?: boolean } = {}): ToolTarget[] {
    if (global) {
      throw new Error("IgnoreProcessor does not support global mode");
    }
    return ignoreProcessorToolTargets;
  }
}
