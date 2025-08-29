import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/mini";
import { FeatureProcessor } from "../types/feature-processor.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { directoryExists } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { AugmentcodeIgnore } from "./augmentcode-ignore.js";
import { ClaudecodeIgnore } from "./claudecode-ignore.js";
import { ClineIgnore } from "./cline-ignore.js";
import { CodexcliIgnore } from "./codexcli-ignore.js";
import { CopilotIgnore } from "./copilot-ignore.js";
import { CursorIgnore } from "./cursor-ignore.js";
import { GeminiCliIgnore } from "./geminicli-ignore.js";
import { JunieIgnore } from "./junie-ignore.js";
import { KiroIgnore } from "./kiro-ignore.js";
import { OpencodeIgnore } from "./opencode-ignore.js";
import { QwencodeIgnore } from "./qwencode-ignore.js";
import { RooIgnore } from "./roo-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";
import { WindsurfIgnore } from "./windsurf-ignore.js";

const ignoreProcessorToolTargets: ToolTarget[] = [
  "augmentcode",
  "claudecode",
  "cline",
  "codexcli",
  "copilot",
  "cursor",
  "geminicli",
  "junie",
  "kiro",
  "opencode",
  "qwencode",
  "roo",
  "windsurf",
];

export const IgnoreProcessorToolTargetSchema = z.enum(ignoreProcessorToolTargets);

export type IgnoreProcessorToolTarget = z.infer<typeof IgnoreProcessorToolTargetSchema>;

export class IgnoreProcessor extends FeatureProcessor {
  private readonly toolTarget: IgnoreProcessorToolTarget;

  constructor({ baseDir = process.cwd(), toolTarget }: { baseDir?: string; toolTarget: IgnoreProcessorToolTarget }) {
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
    const ignoreDir = join(this.baseDir, ".rulesync", "ignore");

    // Check if directory exists
    if (!(await directoryExists(ignoreDir))) {
      throw new Error(`Rulesync ignore directory not found: ${ignoreDir}`);
    }

    // Read all markdown files from the directory
    const entries = await readdir(ignoreDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      throw new Error(`No markdown files found in rulesync ignore directory: ${ignoreDir}`);
    }

    logger.info(`Found ${mdFiles.length} ignore files in ${ignoreDir}`);

    // Parse all files and create RulesyncIgnore instances using fromFilePath
    const rulesyncIgnores: RulesyncIgnore[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(ignoreDir, mdFile);

      try {
        const rulesyncIgnore = await RulesyncIgnore.fromFilePath({
          filePath: filepath,
        });

        rulesyncIgnores.push(rulesyncIgnore);
        logger.debug(`Successfully loaded ignore: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load ignore file ${filepath}:`, error);
        continue;
      }
    }

    if (rulesyncIgnores.length === 0) {
      throw new Error(`No valid ignore files found in ${ignoreDir}`);
    }

    logger.info(`Successfully loaded ${rulesyncIgnores.length} rulesync ignores`);
    return rulesyncIgnores;
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
      case "claudecode":
        return await this.loadClaudecodeIgnores();
      case "cline":
        return await this.loadClineIgnores();
      case "codexcli":
        return await this.loadCodexcliIgnores();
      case "copilot":
        return await this.loadCopilotIgnores();
      case "cursor":
        return await this.loadCursorIgnores();
      case "geminicli":
        return await this.loadGeminicliIgnores();
      case "junie":
        return await this.loadJunieIgnores();
      case "kiro":
        return await this.loadKiroIgnores();
      case "opencode":
        return await this.loadOpencodeIgnores();
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

  private async loadClaudecodeIgnores(): Promise<ToolIgnore[]> {
    // Claude Code uses settings.json files for configuration
    const supportedFiles = ClaudecodeIgnore.getSupportedFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, ".claude", filename);

      try {
        const claudeCodeIgnore = await ClaudecodeIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded Claude Code ignore file: ${ignoreFilePath}`);
        return [claudeCodeIgnore];
      } catch (error) {
        // Continue to next file if this one fails
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    // If no ignore files found, return empty array
    logger.debug("No Claude Code configuration files found");
    return [];
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

  private async loadOpencodeIgnores(): Promise<ToolIgnore[]> {
    // OpenCode uses .gitignore primarily, but may have opencode.json with permission controls
    const supportedFiles = OpencodeIgnore.getSupportedFileNames();

    for (const filename of supportedFiles) {
      const ignoreFilePath = join(this.baseDir, filename);

      try {
        const opencodeIgnore = await OpencodeIgnore.fromFilePath({
          filePath: ignoreFilePath,
        });

        logger.info(`Successfully loaded OpenCode ignore file: ${ignoreFilePath}`);
        return [opencodeIgnore];
      } catch (error) {
        // Continue to next file if this one fails
        logger.debug(`Failed to load ${ignoreFilePath}:`, error);
      }
    }

    // If no ignore files found, return empty array (common case for OpenCode)
    logger.debug(
      "No OpenCode configuration files found, which is expected as OpenCode primarily relies on .gitignore",
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

  private async loadAmazonqcliIgnores(): Promise<ToolIgnore[]> {
    // Amazon Q Developer CLI currently doesn't have native ignore file support
    logger.debug("Amazon Q Developer CLI doesn't have native ignore file support");
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
    const rulesyncIgnores = rulesyncFiles.filter(
      (file): file is RulesyncIgnore => file instanceof RulesyncIgnore,
    );

    const toolIgnores = rulesyncIgnores
      .filter((rulesyncIgnore) => {
        const frontmatter = rulesyncIgnore.getFrontmatter();
        const targets = frontmatter.targets;

        // Check if this ignore file targets the current tool or wildcard
        if (Array.isArray(targets)) {
          if (targets.length === 1 && targets[0] === "*") {
            return true; // Wildcard target
          }
          // targets is ToolTargets (string[]) when not wildcard
          return targets.some((target: string): target is ToolTarget => target === this.toolTarget);
        }
        return false;
      })
      .map((rulesyncIgnore) => {
        switch (this.toolTarget) {
          case "augmentcode":
            return AugmentcodeIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              relativeDirPath: ".",
              rulesyncIgnore,
            });
          case "claudecode":
            return ClaudecodeIgnore.fromRulesyncIgnore({
              baseDir: this.baseDir,
              relativeDirPath: ".claude",
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
          case "copilot":
            return CopilotIgnore.fromRulesyncIgnore({
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
          case "opencode":
            return OpencodeIgnore.fromRulesyncIgnore({
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
    const toolIgnores = toolFiles.filter(
      (file): file is ToolIgnore => file instanceof ToolIgnore,
    );

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
