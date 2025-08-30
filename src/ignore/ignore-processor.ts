import { join } from "node:path";
import { z } from "zod/mini";
import { FeatureProcessor } from "../types/feature-processor.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { logger } from "../utils/logger.js";
import { AugmentcodeIgnore } from "./augmentcode-ignore.js";
import { ClineIgnore } from "./cline-ignore.js";
import { CodexcliIgnore } from "./codexcli-ignore.js";
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
  "augmentcode",
  "cline",
  "codexcli",
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
    this.toolTarget = IgnoreProcessorToolTargetSchema.parse(toolTarget);
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
    const rulesyncIgnores = await this.loadRulesyncIgnores();
    return rulesyncIgnores;
  }

  async loadRulesyncIgnores(): Promise<RulesyncIgnore[]> {
    return [await RulesyncIgnore.fromFilePath({ filePath: ".rulesyncignore" })];
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific ignore configurations and parse them into ToolIgnore instances
   */
  async loadToolFiles(): Promise<ToolFile[]> {
    const toolIgnores = await this.loadToolIgnores();
    return toolIgnores;
  }

  async loadToolIgnores(): Promise<ToolIgnore[]> {
    switch (this.toolTarget) {
      case "augmentcode":
        return await this.loadAugmentcodeIgnores();
      case "cline":
        return await this.loadClineIgnores();
      case "codexcli":
        return await this.loadCodexcliIgnores();
      case "cursor":
        return await this.loadCursorIgnores();
      case "geminicli":
        return await this.loadGeminicliIgnores();
      case "junie":
        return await this.loadJunieIgnores();
      case "kiro":
        return await this.loadKiroIgnores();
      case "qwencode":
        return await this.loadQwencodeIgnores();
      case "roo":
        return await this.loadRooIgnores();
      case "windsurf":
        return await this.loadWindsurfIgnores();
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    }
  }

  private async loadCodexcliIgnores(): Promise<ToolIgnore[]> {
    // OpenAI Codex CLI doesn't have native ignore file support yet
    // Look for proposed .codexignore or .aiexclude files in project root
    const supportedFiles = CodexcliIgnore.getSupportedIgnoreFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const codexcliIgnore = await CodexcliIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded Codex CLI ignore file: ${ignoreFilePath}`);
        return [codexcliIgnore];
      } catch (error) {
        // Continue to next file if this one fails
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    // If no ignore files found, return empty array (common case)
    logger.debug(
      "No Codex CLI ignore files found, which is expected since .codexignore is not yet implemented",
    );
    return [];
  }

  private async loadAugmentcodeIgnores(): Promise<ToolIgnore[]> {
    const supportedFiles = AugmentcodeIgnore.getSupportedIgnoreFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const augmentcodeIgnore = await AugmentcodeIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded AugmentCode ignore file: ${ignoreFilePath}`);
        return [augmentcodeIgnore];
      } catch (error) {
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    logger.debug("No AugmentCode ignore files found");
    return [];
  }

  private async loadClineIgnores(): Promise<ToolIgnore[]> {
    const supportedFiles = ClineIgnore.getSupportedIgnoreFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const clineIgnore = await ClineIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded Cline ignore file: ${ignoreFilePath}`);
        return [clineIgnore];
      } catch (error) {
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    logger.debug("No Cline ignore files found");
    return [];
  }

  private async loadCopilotIgnores(): Promise<ToolIgnore[]> {
    // GitHub Copilot doesn't use traditional ignore files
    // This method returns empty array as Copilot uses Web UI content exclusion
    logger.debug("GitHub Copilot uses Web UI content exclusion, no file-based ignore support");
    return [];
  }

  private async loadCursorIgnores(): Promise<ToolIgnore[]> {
    const supportedFiles = CursorIgnore.getSupportedIgnoreFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const cursorIgnore = await CursorIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded Cursor ignore file: ${ignoreFilePath}`);
        return [cursorIgnore];
      } catch (error) {
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    logger.debug("No Cursor ignore files found");
    return [];
  }

  private async loadGeminicliIgnores(): Promise<ToolIgnore[]> {
    const supportedFiles = GeminiCliIgnore.getSupportedFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const geminicliIgnore = await GeminiCliIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded Gemini CLI ignore file: ${ignoreFilePath}`);
        return [geminicliIgnore];
      } catch (error) {
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    logger.debug("No Gemini CLI ignore files found");
    return [];
  }

  private async loadJunieIgnores(): Promise<ToolIgnore[]> {
    const supportedFiles = JunieIgnore.getSupportedFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const junieIgnore = await JunieIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded JetBrains Junie ignore file: ${ignoreFilePath}`);
        return [junieIgnore];
      } catch (error) {
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    logger.debug("No JetBrains Junie ignore files found");
    return [];
  }

  private async loadKiroIgnores(): Promise<ToolIgnore[]> {
    const supportedFiles = KiroIgnore.getSupportedFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const kiroIgnore = await KiroIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded Kiro ignore file: ${ignoreFilePath}`);
        return [kiroIgnore];
      } catch (error) {
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    logger.debug("No Kiro ignore files found");
    return [];
  }

  private async loadQwencodeIgnores(): Promise<ToolIgnore[]> {
    const supportedFiles = QwencodeIgnore.getSupportedFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const qwencodeIgnore = await QwencodeIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded Qwen Code ignore file: ${ignoreFilePath}`);
        return [qwencodeIgnore];
      } catch (error) {
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    logger.debug("No Qwen Code ignore files found");
    return [];
  }

  private async loadRooIgnores(): Promise<ToolIgnore[]> {
    const supportedFiles = RooIgnore.getSupportedIgnoreFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const rooIgnore = await RooIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded Roo Code ignore file: ${ignoreFilePath}`);
        return [rooIgnore];
      } catch (error) {
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    logger.debug("No Roo Code ignore files found");
    return [];
  }

  private async loadWindsurfIgnores(): Promise<ToolIgnore[]> {
    const supportedFiles = WindsurfIgnore.getSupportedFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const windsurfIgnore = await WindsurfIgnore.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".",
          relativeFilePath: filename,
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded Windsurf ignore file: ${ignoreFilePath}`);
        return [windsurfIgnore];
      } catch (error) {
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    logger.debug("No Windsurf ignore files found");
    return [];
  }

  async writeRulesyncIgnoresFromToolIgnores(toolIgnores: ToolIgnore[]): Promise<void> {
    const rulesyncIgnores = toolIgnores.map((toolIgnore) => {
      return toolIgnore.toRulesyncIgnore();
    });

    await this.writeAiFiles(rulesyncIgnores);
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
      throw new Error(`No .rulesyncignore found.`);
    }

    const toolIgnores = [rulesyncIgnore].map((rulesyncIgnore) => {
      switch (this.toolTarget) {
        case "augmentcode":
          return AugmentcodeIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncIgnore,
          });
        case "cline":
          return ClineIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncIgnore,
          });
        case "codexcli":
          return CodexcliIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncIgnore,
          });
        case "cursor":
          return CursorIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncIgnore,
          });
        case "geminicli":
          return GeminiCliIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncIgnore,
          });
        case "junie":
          return JunieIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncIgnore,
          });
        case "kiro":
          return KiroIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncIgnore,
          });
        case "qwencode":
          return QwencodeIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncIgnore,
          });
        case "roo":
          return RooIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncIgnore,
          });
        case "windsurf":
          return WindsurfIgnore.fromRulesyncIgnore({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncIgnore,
          });
        default:
          throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      }
    });

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
  static getToolTargets(): ToolTarget[] {
    return ignoreProcessorToolTargets;
  }
}
