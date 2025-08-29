import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/mini";
import { FeatureProcessor } from "../types/feature-processor.js";
import type { ToolTarget } from "../types/index.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { directoryExists, fileExists } from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { AgentsMdRule } from "./agentsmd-rule.js";
import { AmazonQCliRule } from "./amazonqcli-rule.js";
import { AugmentcodeLegacyRule } from "./augmentcode-legacy-rule.js";
import { AugmentcodeRule } from "./augmentcode-rule.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { ClineRule } from "./cline-rule.js";
import { CodexcliRule } from "./codexcli-rule.js";
import { CopilotRule } from "./copilot-rule.js";
import { CursorRule } from "./cursor-rule.js";
import { GeminiCliRule } from "./geminicli-rule.js";
import { JunieRule } from "./junie-rule.js";
import { KiroRule } from "./kiro-rule.js";
import { OpenCodeRule } from "./opencode-rule.js";
import { QwencodeRule } from "./qwencode-rule.js";
import { RooRule } from "./roo-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule } from "./tool-rule.js";
import { WindsurfRule } from "./windsurf-rule.js";

const rulesProcessorToolTargets: ToolTarget[] = [
  "agentsmd",
  "amazonqcli",
  "augmentcode",
  "augmentcode-legacy",
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
export const RulesProcessorToolTargetSchema = z.enum(rulesProcessorToolTargets);

export type RulesProcessorToolTarget = z.infer<typeof RulesProcessorToolTargetSchema>;

export class RulesProcessor extends FeatureProcessor {
  private readonly toolTarget: RulesProcessorToolTarget;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
  }: { baseDir?: string; toolTarget: RulesProcessorToolTarget }) {
    super({ baseDir });
    this.toolTarget = RulesProcessorToolTargetSchema.parse(toolTarget);
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncRules = rulesyncFiles.filter(
      (file): file is RulesyncRule => file instanceof RulesyncRule,
    );

    const toolRules = rulesyncRules.map((rulesyncRule) => {
      switch (this.toolTarget) {
        case "agentsmd":
          return AgentsMdRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "amazonqcli":
          return AmazonQCliRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".amazonq/rules",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "augmentcode":
          return AugmentcodeRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".augment/rules",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "augmentcode-legacy":
          return AugmentcodeLegacyRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "claudecode":
          return ClaudecodeRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: join(".claude", "memories"),
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "cline":
          return ClineRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".clinerules",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "codexcli":
          return CodexcliRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "copilot":
          return CopilotRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".github",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "cursor":
          return CursorRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".cursor/rules",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "geminicli":
          return GeminiCliRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "junie":
          return JunieRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".junie",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "kiro":
          return KiroRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".kiro/steering",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "opencode":
          return OpenCodeRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "qwencode":
          return QwencodeRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "roo":
          return RooRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".roo/rules",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        case "windsurf":
          return WindsurfRule.fromRulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: ".windsurf/rules",
            rulesyncRule: rulesyncRule,
            validate: false,
          });
        default:
          throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      }
    });

    return toolRules;
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolRules = toolFiles.filter((file): file is ToolRule => file instanceof ToolRule);

    const rulesyncRules = toolRules.map((toolRule) => {
      return toolRule.toRulesyncRule();
    });

    return rulesyncRules;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync rule files from .rulesync/rules/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const rulesDir = join(this.baseDir, ".rulesync", "rules");

    // Check if directory exists
    const dirExists = await directoryExists(rulesDir);
    if (!dirExists) {
      logger.debug(`Rulesync rules directory not found: ${rulesDir}`);
      return [];
    }

    // Read all markdown files from the directory
    const entries = await readdir(rulesDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      logger.debug(`No markdown files found in rulesync rules directory: ${rulesDir}`);
      return [];
    }

    logger.info(`Found ${mdFiles.length} rule files in ${rulesDir}`);

    // Parse all files and create RulesyncRule instances using fromFilePath
    const rulesyncRules: RulesyncRule[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(rulesDir, mdFile);

      try {
        const rulesyncRule = await RulesyncRule.fromFilePath({
          filePath: filepath,
        });

        rulesyncRules.push(rulesyncRule);
        logger.debug(`Successfully loaded rule: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load rule file ${filepath}:`, error);
        continue;
      }
    }

    if (rulesyncRules.length === 0) {
      logger.debug(`No valid rules found in ${rulesDir}`);
      return [];
    }

    logger.info(`Successfully loaded ${rulesyncRules.length} rulesync rules`);
    return rulesyncRules;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific rule configurations and parse them into ToolRule instances
   */
  async loadToolFiles(): Promise<ToolFile[]> {
    switch (this.toolTarget) {
      case "agentsmd":
        return await this.loadAgentsmdRules();
      case "amazonqcli":
        return await this.loadAmazonqcliRules();
      case "augmentcode":
        return await this.loadAugmentcodeRules();
      case "augmentcode-legacy":
        return await this.loadAugmentcodeLegacyRules();
      case "claudecode":
        return await this.loadClaudecodeRules();
      case "cline":
        return await this.loadClineRules();
      case "codexcli":
        return await this.loadCodexcliRules();
      case "copilot":
        return await this.loadCopilotRules();
      case "cursor":
        return await this.loadCursorRules();
      case "geminicli":
        return await this.loadGeminicliRules();
      case "junie":
        return await this.loadJunieRules();
      case "kiro":
        return await this.loadKiroRules();
      case "opencode":
        return await this.loadOpencodeRules();
      case "qwencode":
        return await this.loadQwencodeRules();
      case "roo":
        return await this.loadRooRules();
      case "windsurf":
        return await this.loadWindsurfRules();
      default:
        throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    }
  }

  /**
   * Load AGENTS.md rule configuration
   */
  private async loadAgentsmdRules(): Promise<ToolRule[]> {
    const agentsFile = join(this.baseDir, "AGENTS.md");

    if (!(await fileExists(agentsFile))) {
      logger.warn(`AGENTS.md file not found: ${agentsFile}`);
      return [];
    }

    try {
      const agentsmdRule = await AgentsMdRule.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsFile,
        validate: false,
      });

      logger.info(`Successfully loaded AGENTS.md rule`);
      return [agentsmdRule];
    } catch (error) {
      logger.warn(`Failed to load AGENTS.md file ${agentsFile}:`, error);
      return [];
    }
  }

  /**
   * Load Amazon Q Developer CLI rule configurations from .amazonq/rules/ directory
   */
  private async loadAmazonqcliRules(): Promise<ToolRule[]> {
    return this.loadToolRulesFromDirectory(
      join(this.baseDir, ".amazonq", "rules"),
      ".amazonq/rules",
      (filePath, relativeFilePath) =>
        AmazonQCliRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".amazonq/rules",
          relativeFilePath,
          filePath,
          validate: false,
        }),
      "Amazon Q Developer CLI",
    );
  }

  /**
   * Load AugmentCode rule configurations from .augment/rules/ directory
   */
  private async loadAugmentcodeRules(): Promise<ToolRule[]> {
    return this.loadToolRulesFromDirectory(
      join(this.baseDir, ".augment", "rules"),
      ".augment/rules",
      (filePath, relativeFilePath) =>
        AugmentcodeRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".augment/rules",
          relativeFilePath,
          filePath,
          validate: false,
        }),
      "AugmentCode",
    );
  }

  /**
   * Load AugmentCode legacy rule configuration from .augment-guidelines file
   */
  private async loadAugmentcodeLegacyRules(): Promise<ToolRule[]> {
    const guidelinesFile = join(this.baseDir, ".augment-guidelines");

    if (!(await fileExists(guidelinesFile))) {
      logger.warn(`AugmentCode legacy guidelines file not found: ${guidelinesFile}`);
      return [];
    }

    try {
      const augmentcodeLegacyRule = await AugmentcodeLegacyRule.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".",
        relativeFilePath: ".augment-guidelines",
        filePath: guidelinesFile,
        validate: false,
      });

      logger.info(`Successfully loaded AugmentCode legacy guidelines`);
      return [augmentcodeLegacyRule];
    } catch (error) {
      logger.warn(`Failed to load AugmentCode legacy guidelines file ${guidelinesFile}:`, error);
      return [];
    }
  }

  /**
   * Load Claude Code rule configuration from CLAUDE.md file
   */
  private async loadClaudecodeRules(): Promise<ToolRule[]> {
    const claudeFile = join(this.baseDir, "CLAUDE.md");

    if (!(await fileExists(claudeFile))) {
      logger.warn(`Claude Code memory file not found: ${claudeFile}`);
      return [];
    }

    try {
      const claudecodeRule = await ClaudecodeRule.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
        filePath: claudeFile,
        validate: false,
      });

      logger.info(`Successfully loaded Claude Code memory file`);
      return [claudecodeRule];
    } catch (error) {
      logger.warn(`Failed to load Claude Code memory file ${claudeFile}:`, error);
      return [];
    }
  }

  /**
   * Load Cline rule configurations from .clinerules/ directory
   */
  private async loadClineRules(): Promise<ToolRule[]> {
    return this.loadToolRulesFromDirectory(
      join(this.baseDir, ".clinerules"),
      ".clinerules",
      (filePath, relativeFilePath) =>
        ClineRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".clinerules",
          relativeFilePath,
          filePath,
          validate: false,
        }),
      "Cline",
    );
  }

  /**
   * Load OpenAI Codex CLI rule configuration from AGENTS.md file
   */
  private async loadCodexcliRules(): Promise<ToolRule[]> {
    const agentsFile = join(this.baseDir, "AGENTS.md");

    if (!(await fileExists(agentsFile))) {
      logger.warn(`OpenAI Codex CLI agents file not found: ${agentsFile}`);
      return [];
    }

    try {
      const codexcliRule = await CodexcliRule.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsFile,
        validate: false,
      });

      logger.info(`Successfully loaded OpenAI Codex CLI agents file`);
      return [codexcliRule];
    } catch (error) {
      logger.warn(`Failed to load OpenAI Codex CLI agents file ${agentsFile}:`, error);
      return [];
    }
  }

  /**
   * Load GitHub Copilot rule configuration from .github/copilot-instructions.md file
   */
  private async loadCopilotRules(): Promise<ToolRule[]> {
    const copilotFile = join(this.baseDir, ".github", "copilot-instructions.md");

    if (!(await fileExists(copilotFile))) {
      logger.warn(`GitHub Copilot instructions file not found: ${copilotFile}`);
      return [];
    }

    try {
      const copilotRule = await CopilotRule.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        filePath: copilotFile,
        validate: false,
      });

      logger.info(`Successfully loaded GitHub Copilot instructions file`);
      return [copilotRule];
    } catch (error) {
      logger.warn(`Failed to load GitHub Copilot instructions file ${copilotFile}:`, error);
      return [];
    }
  }

  /**
   * Load Cursor rule configurations from .cursor/rules/ directory
   */
  private async loadCursorRules(): Promise<ToolRule[]> {
    return this.loadToolRulesFromDirectory(
      join(this.baseDir, ".cursor", "rules"),
      ".cursor/rules",
      (filePath, relativeFilePath) =>
        CursorRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".cursor/rules",
          relativeFilePath,
          filePath,
          validate: false,
        }),
      "Cursor",
    );
  }

  /**
   * Load Gemini CLI rule configuration from GEMINI.md file
   */
  private async loadGeminicliRules(): Promise<ToolRule[]> {
    const geminiFile = join(this.baseDir, "GEMINI.md");

    if (!(await fileExists(geminiFile))) {
      logger.warn(`Gemini CLI memory file not found: ${geminiFile}`);
      return [];
    }

    try {
      const geminicliRule = await GeminiCliRule.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".",
        relativeFilePath: "GEMINI.md",
        filePath: geminiFile,
        validate: false,
      });

      logger.info(`Successfully loaded Gemini CLI memory file`);
      return [geminicliRule];
    } catch (error) {
      logger.warn(`Failed to load Gemini CLI memory file ${geminiFile}:`, error);
      return [];
    }
  }

  /**
   * Load JetBrains Junie rule configuration from .junie/guidelines.md file
   */
  private async loadJunieRules(): Promise<ToolRule[]> {
    const guidelinesFile = join(this.baseDir, ".junie", "guidelines.md");

    if (!(await fileExists(guidelinesFile))) {
      logger.warn(`JetBrains Junie guidelines file not found: ${guidelinesFile}`);
      return [];
    }

    try {
      const junieRule = await JunieRule.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".junie",
        relativeFilePath: "guidelines.md",
        filePath: guidelinesFile,
        validate: false,
      });

      logger.info(`Successfully loaded JetBrains Junie guidelines file`);
      return [junieRule];
    } catch (error) {
      logger.warn(`Failed to load JetBrains Junie guidelines file ${guidelinesFile}:`, error);
      return [];
    }
  }

  /**
   * Load Kiro rule configurations from .kiro/steering/ directory
   */
  private async loadKiroRules(): Promise<ToolRule[]> {
    return this.loadToolRulesFromDirectory(
      join(this.baseDir, ".kiro", "steering"),
      ".kiro/steering",
      (filePath, relativeFilePath) =>
        KiroRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".kiro/steering",
          relativeFilePath,
          filePath,
          validate: false,
        }),
      "Kiro",
    );
  }

  /**
   * Load OpenCode rule configuration from AGENTS.md file
   */
  private async loadOpencodeRules(): Promise<ToolRule[]> {
    const agentsFile = join(this.baseDir, "AGENTS.md");

    if (!(await fileExists(agentsFile))) {
      logger.warn(`OpenCode agents file not found: ${agentsFile}`);
      return [];
    }

    try {
      const opencodeRule = await OpenCodeRule.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        filePath: agentsFile,
        validate: false,
      });

      logger.info(`Successfully loaded OpenCode agents file`);
      return [opencodeRule];
    } catch (error) {
      logger.warn(`Failed to load OpenCode agents file ${agentsFile}:`, error);
      return [];
    }
  }

  /**
   * Load Qwen Code rule configuration from QWEN.md file
   */
  private async loadQwencodeRules(): Promise<ToolRule[]> {
    const qwenFile = join(this.baseDir, "QWEN.md");

    if (!(await fileExists(qwenFile))) {
      logger.warn(`Qwen Code memory file not found: ${qwenFile}`);
      return [];
    }

    try {
      const qwencodeRule = await QwencodeRule.fromFilePath({
        baseDir: this.baseDir,
        relativeDirPath: ".",
        relativeFilePath: "QWEN.md",
        filePath: qwenFile,
        validate: false,
      });

      logger.info(`Successfully loaded Qwen Code memory file`);
      return [qwencodeRule];
    } catch (error) {
      logger.warn(`Failed to load Qwen Code memory file ${qwenFile}:`, error);
      return [];
    }
  }

  /**
   * Load Roo Code rule configurations from .roo/rules/ directory
   */
  private async loadRooRules(): Promise<ToolRule[]> {
    return this.loadToolRulesFromDirectory(
      join(this.baseDir, ".roo", "rules"),
      ".roo/rules",
      (filePath, relativeFilePath) =>
        RooRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".roo/rules",
          relativeFilePath,
          filePath,
          validate: false,
        }),
      "Roo Code",
    );
  }

  /**
   * Load Windsurf rule configurations from .windsurf/rules/ directory
   */
  private async loadWindsurfRules(): Promise<ToolRule[]> {
    return this.loadToolRulesFromDirectory(
      join(this.baseDir, ".windsurf", "rules"),
      ".windsurf/rules",
      (filePath, relativeFilePath) =>
        WindsurfRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".windsurf/rules",
          relativeFilePath,
          filePath,
          validate: false,
        }),
      "Windsurf",
    );
  }

  /**
   * Common helper method to load tool rules from a directory with parallel processing
   */
  private async loadToolRulesFromDirectory(
    dirPath: string,
    relativeDirPath: string,
    ruleFactory: (filePath: string, relativeFilePath: string) => Promise<ToolRule>,
    toolName: string,
  ): Promise<ToolRule[]> {
    if (!(await directoryExists(dirPath))) {
      logger.warn(`${toolName} rules directory not found: ${dirPath}`);
      return [];
    }

    const entries = await readdir(dirPath);
    const mdFiles = entries.filter((file) => file.endsWith(".md") || file.endsWith(".mdc"));

    if (mdFiles.length === 0) {
      logger.info(`No rule files found in ${dirPath}`);
      return [];
    }

    logger.info(`Found ${mdFiles.length} ${toolName} rule files in ${dirPath}`);

    // Use Promise.allSettled for parallel processing with better error handling
    const results = await Promise.allSettled(
      mdFiles.map(async (mdFile) => {
        const filepath = join(dirPath, mdFile);
        return {
          rule: await ruleFactory(filepath, mdFile),
          filename: mdFile,
        };
      }),
    );

    const toolRules: ToolRule[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        toolRules.push(result.value.rule);
        logger.debug(`Successfully loaded ${toolName} rule: ${result.value.filename}`);
      } else {
        logger.warn(`Failed to load ${toolName} rule file ${mdFiles[index]}:`, result.reason);
      }
    }

    logger.info(`Successfully loaded ${toolRules.length} ${toolName} rules`);
    return toolRules;
  }

  async writeToolRulesFromRulesyncRules(rulesyncRules: RulesyncRule[]): Promise<void> {
    const toolRules = await this.convertRulesyncFilesToToolFiles(rulesyncRules);
    await this.writeAiFiles(toolRules);
  }

  async writeRulesyncRulesFromToolRules(toolRules: ToolRule[]): Promise<void> {
    const rulesyncRules = await this.convertToolFilesToRulesyncFiles(toolRules);
    await this.writeAiFiles(rulesyncRules);
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets(): ToolTarget[] {
    return rulesProcessorToolTargets;
  }

  /**
   * Map ToolTarget to RulesProcessorToolTarget
   */
  private static mapToolTargetToRulesProcessorTarget(
    tool: ToolTarget,
  ): RulesProcessorToolTarget | null {
    const mappings: Record<ToolTarget, RulesProcessorToolTarget | null> = {
      agentsmd: "agentsmd",
      amazonqcli: "amazonqcli",
      augmentcode: "augmentcode",
      "augmentcode-legacy": "augmentcode-legacy",
      claudecode: "claudecode",
      cline: "cline",
      codexcli: "codexcli",
      copilot: "copilot",
      cursor: "cursor",
      geminicli: "geminicli",
      junie: "junie",
      kiro: "kiro",
      opencode: "opencode",
      qwencode: "qwencode",
      roo: "roo",
      windsurf: "windsurf",
    };

    return mappings[tool] || null;
  }

  /**
   * Check if a tool is supported by RulesProcessor
   */
  static isToolSupported(tool: ToolTarget): boolean {
    return RulesProcessor.mapToolTargetToRulesProcessorTarget(tool) !== null;
  }

  /**
   * Get all supported tools
   */
  static getSupportedTools(): ToolTarget[] {
    const allTools: ToolTarget[] = [
      "agentsmd",
      "amazonqcli",
      "augmentcode",
      "augmentcode-legacy",
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

    return allTools.filter((tool) => RulesProcessor.isToolSupported(tool));
  }

  /**
   * Create a RulesProcessor instance for the specified tool and base directory
   * Returns null if the tool is not supported
   */
  static create(tool: ToolTarget, baseDir: string): RulesProcessor | null {
    const rulesProcessorToolTarget = RulesProcessor.mapToolTargetToRulesProcessorTarget(tool);

    if (!rulesProcessorToolTarget) {
      logger.warn(`No RulesProcessor mapping found for tool: ${tool}`);
      return null;
    }

    try {
      const processor = new RulesProcessor({
        baseDir,
        toolTarget: rulesProcessorToolTarget,
      });

      logger.debug(`Created RulesProcessor for tool: ${tool}, baseDir: ${baseDir}`);
      return processor;
    } catch (error) {
      logger.error(`Failed to create RulesProcessor for tool ${tool}:`, error);
      return null;
    }
  }
}
