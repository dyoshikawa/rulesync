import { basename, join } from "node:path";
import { XMLBuilder } from "fast-xml-parser";
import { z } from "zod/mini";
import { RULESYNC_RULES_DIR_LEGACY } from "../constants/paths.js";
import { FeatureProcessor } from "../types/feature-processor.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import {
  directoryExists,
  fileExists,
  findFilesByGlobs,
  listDirectoryFiles,
} from "../utils/file.js";
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
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "amazonqcli":
          return AmazonQCliRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "augmentcode":
          return AugmentcodeRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "augmentcode-legacy":
          return AugmentcodeLegacyRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "claudecode":
          return ClaudecodeRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "cline":
          return ClineRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "codexcli":
          return CodexcliRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "copilot":
          return CopilotRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "cursor":
          return CursorRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "geminicli":
          return GeminiCliRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "junie":
          return JunieRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "kiro":
          return KiroRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "opencode":
          return OpenCodeRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "qwencode":
          return QwencodeRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "roo":
          return RooRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        case "windsurf":
          return WindsurfRule.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: rulesyncRule,
            validate: true,
          });
        default:
          throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      }
    });

    const rootRuleIndex = toolRules.findIndex((rule) => rule.isRoot());
    if (rootRuleIndex === -1) {
      return toolRules;
    }

    switch (this.toolTarget) {
      case "agentsmd": {
        const rootRule = toolRules[rootRuleIndex];
        rootRule?.setFileContent(
          this.generateXmlReferencesSection(toolRules) + rootRule.getFileContent(),
        );
        return toolRules;
      }
      case "augmentcode-legacy": {
        const rootRule = toolRules[rootRuleIndex];
        rootRule?.setFileContent(
          this.generateXmlReferencesSection(toolRules) + rootRule.getFileContent(),
        );
        return toolRules;
      }
      case "claudecode": {
        const rootRule = toolRules[rootRuleIndex];
        rootRule?.setFileContent(
          this.generateReferencesSection(toolRules) + rootRule.getFileContent(),
        );
        return toolRules;
      }
      case "codexcli": {
        const rootRule = toolRules[rootRuleIndex];
        rootRule?.setFileContent(
          this.generateXmlReferencesSection(toolRules) + rootRule.getFileContent(),
        );
        return toolRules;
      }
      case "copilot": {
        const rootRule = toolRules[rootRuleIndex];
        rootRule?.setFileContent(
          this.generateXmlReferencesSection(toolRules) + rootRule.getFileContent(),
        );
        return toolRules;
      }
      case "geminicli": {
        const rootRule = toolRules[rootRuleIndex];
        rootRule?.setFileContent(
          this.generateXmlReferencesSection(toolRules) + rootRule.getFileContent(),
        );
        return toolRules;
      }
      case "kiro": {
        const rootRule = toolRules[rootRuleIndex];
        rootRule?.setFileContent(
          this.generateXmlReferencesSection(toolRules) + rootRule.getFileContent(),
        );
        return toolRules;
      }
      case "opencode": {
        const rootRule = toolRules[rootRuleIndex];
        rootRule?.setFileContent(
          this.generateXmlReferencesSection(toolRules) + rootRule.getFileContent(),
        );
        return toolRules;
      }
      case "qwencode": {
        const rootRule = toolRules[rootRuleIndex];
        rootRule?.setFileContent(
          this.generateXmlReferencesSection(toolRules) + rootRule.getFileContent(),
        );
        return toolRules;
      }
      default:
        return toolRules;
    }
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
    const entries = await listDirectoryFiles(rulesDir);
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

  async loadLegacyRulesyncFiles(): Promise<RulesyncFile[]> {
    const legacyFiles = await findFilesByGlobs(join(RULESYNC_RULES_DIR_LEGACY, "*.md"));
    return Promise.all(
      legacyFiles.map((file) => RulesyncRule.fromLegacyFile({ relativeFilePath: file })),
    );
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
        validate: true,
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
      (filePath, relativeFilePath) =>
        AmazonQCliRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".amazonq/rules",
          relativeFilePath,
          filePath,
          validate: true,
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
      (filePath, relativeFilePath) =>
        AugmentcodeRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".augment/rules",
          relativeFilePath,
          filePath,
          validate: true,
        }),
      "AugmentCode",
    );
  }

  /**
   * Load AugmentCode legacy rule configuration from .augment-guidelines file and .augment/rules/ directory
   */
  private async loadAugmentcodeLegacyRules(): Promise<ToolRule[]> {
    const toolRules: ToolRule[] = [];

    // Check for root file
    const guidelinesFile = join(this.baseDir, ".augment-guidelines");
    if (await fileExists(guidelinesFile)) {
      try {
        const augmentcodeLegacyRule = await AugmentcodeLegacyRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".",
          relativeFilePath: ".augment-guidelines",
          filePath: guidelinesFile,
          validate: true,
        });
        toolRules.push(augmentcodeLegacyRule);
        logger.info(`Successfully loaded AugmentCode legacy guidelines`);
      } catch (error) {
        logger.warn(`Failed to load AugmentCode legacy guidelines file ${guidelinesFile}:`, error);
      }
    }

    // Check for non-root files in .augment/rules/
    const rulesDir = join(this.baseDir, ".augment", "rules");
    if (await directoryExists(rulesDir)) {
      const dirRules = await this.loadToolRulesFromDirectory(
        rulesDir,
        (filePath, relativeFilePath) =>
          AugmentcodeLegacyRule.fromFilePath({
            baseDir: this.baseDir,
            relativeDirPath: join(".augment", "rules"),
            relativeFilePath,
            filePath,
            validate: true,
          }),
        "AugmentCode Legacy",
      );
      toolRules.push(...dirRules);
    }

    return toolRules;
  }

  /**
   * Load Claude Code rule configuration from CLAUDE.md file
   */
  private async loadClaudecodeRules(): Promise<ToolRule[]> {
    const claudeMemoriesDir = join(this.baseDir, ".claude", "memories");

    // Check if the memories directory exists
    if (!(await directoryExists(claudeMemoriesDir))) {
      logger.debug(`Claude Code memories directory not found: ${claudeMemoriesDir}`);

      // Fall back to check for legacy CLAUDE.md file
      const claudeFile = join(this.baseDir, "CLAUDE.md");
      if (!(await fileExists(claudeFile))) {
        logger.debug(`Claude Code memory file not found: ${claudeFile}`);
        return [];
      }

      try {
        const claudecodeRule = await ClaudecodeRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".",
          relativeFilePath: "CLAUDE.md",
          filePath: claudeFile,
          validate: true,
        });

        logger.info(`Successfully loaded Claude Code memory file`);
        return [claudecodeRule];
      } catch (error) {
        logger.warn(`Failed to load Claude Code memory file ${claudeFile}:`, error);
        return [];
      }
    }

    // Load from .claude/memories directory
    const entries = await listDirectoryFiles(claudeMemoriesDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      logger.debug(
        `No markdown files found in Claude Code memories directory: ${claudeMemoriesDir}`,
      );
      return [];
    }

    logger.info(`Found ${mdFiles.length} Claude Code memory files in ${claudeMemoriesDir}`);

    const toolRules: ToolRule[] = [];

    for (const mdFile of mdFiles) {
      const filePath = join(claudeMemoriesDir, mdFile);

      try {
        const claudecodeRule = await ClaudecodeRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: join(".claude", "memories"),
          relativeFilePath: mdFile,
          filePath: filePath,
          validate: true,
        });

        toolRules.push(claudecodeRule);
        logger.debug(`Successfully loaded Claude Code memory file: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load Claude Code memory file ${filePath}:`, error);
        continue;
      }
    }

    logger.info(`Successfully loaded ${toolRules.length} Claude Code memory files`);
    return toolRules;
  }

  /**
   * Load Cline rule configurations from .clinerules/ directory
   */
  private async loadClineRules(): Promise<ToolRule[]> {
    return this.loadToolRulesFromDirectory(
      join(this.baseDir, ".clinerules"),
      (filePath, relativeFilePath) =>
        ClineRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".clinerules",
          relativeFilePath,
          filePath,
          validate: true,
        }),
      "Cline",
    );
  }

  /**
   * Load OpenAI Codex CLI rule configuration from AGENTS.md and .codex/memories/*.md files
   */
  private async loadCodexcliRules(): Promise<ToolRule[]> {
    const rules: ToolRule[] = [];

    // Load root file (AGENTS.md)
    const agentsFile = join(this.baseDir, "AGENTS.md");
    if (await fileExists(agentsFile)) {
      try {
        const codexcliRule = await CodexcliRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".",
          relativeFilePath: "AGENTS.md",
          filePath: agentsFile,
          validate: true,
        });
        rules.push(codexcliRule);
        logger.info(`Successfully loaded OpenAI Codex CLI agents file`);
      } catch (error) {
        logger.warn(`Failed to load OpenAI Codex CLI agents file ${agentsFile}:`, error);
      }
    }

    // Load non-root files from .codex/memories/
    const memoriesDir = join(this.baseDir, ".codex", "memories");
    if (await directoryExists(memoriesDir)) {
      try {
        const entries = await listDirectoryFiles(memoriesDir);
        const mdFiles = entries.filter((file) => file.endsWith(".md"));

        for (const mdFile of mdFiles) {
          const filePath = join(memoriesDir, mdFile);
          try {
            const codexcliRule = await CodexcliRule.fromFilePath({
              baseDir: this.baseDir,
              relativeDirPath: join(".codex", "memories"),
              relativeFilePath: mdFile,
              filePath,
              validate: true,
            });
            rules.push(codexcliRule);
          } catch (error) {
            logger.warn(`Failed to load Codex CLI memories file ${filePath}:`, error);
          }
        }

        if (mdFiles.length > 0) {
          logger.info(`Successfully loaded ${mdFiles.length} OpenAI Codex CLI memory files`);
        }
      } catch (error) {
        logger.warn(`Failed to read OpenAI Codex CLI memories directory ${memoriesDir}:`, error);
      }
    }

    if (rules.length === 0) {
      logger.warn(`No OpenAI Codex CLI rule files found`);
    }

    return rules;
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
        validate: true,
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
      (filePath) =>
        CursorRule.fromFilePath({
          filePath,
          validate: true,
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
        validate: true,
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
      return [];
    }

    const junieRule = await JunieRule.fromFilePath({
      baseDir: this.baseDir,
      relativeDirPath: ".junie",
      relativeFilePath: "guidelines.md",
      filePath: guidelinesFile,
      validate: true,
    });

    logger.info(`Successfully loaded JetBrains Junie guidelines file`);
    return [junieRule];
  }

  /**
   * Load Kiro rule configurations from .kiro/steering/ directory
   */
  private async loadKiroRules(): Promise<ToolRule[]> {
    return this.loadToolRulesFromDirectory(
      join(this.baseDir, ".kiro", "steering"),
      (filePath, relativeFilePath) =>
        KiroRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".kiro/steering",
          relativeFilePath,
          filePath,
          validate: true,
        }),
      "Kiro",
    );
  }

  /**
   * Load OpenCode rule configuration from AGENTS.md file and .opencode/memories/*.md files
   */
  private async loadOpencodeRules(): Promise<ToolRule[]> {
    const rules: ToolRule[] = [];

    // Load root file (AGENTS.md)
    const agentsFile = join(this.baseDir, "AGENTS.md");
    if (await fileExists(agentsFile)) {
      try {
        const opencodeRule = await OpenCodeRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".",
          relativeFilePath: "AGENTS.md",
          filePath: agentsFile,
          validate: true,
        });
        rules.push(opencodeRule);
        logger.info(`Successfully loaded OpenCode agents file`);
      } catch (error) {
        logger.warn(`Failed to load OpenCode agents file ${agentsFile}:`, error);
      }
    }

    // Load non-root files from .opencode/memories/
    const memoriesDir = join(this.baseDir, ".opencode", "memories");
    if (await directoryExists(memoriesDir)) {
      try {
        const entries = await listDirectoryFiles(memoriesDir);
        const mdFiles = entries.filter((file) => file.endsWith(".md"));

        for (const mdFile of mdFiles) {
          const filePath = join(memoriesDir, mdFile);
          try {
            const opencodeRule = await OpenCodeRule.fromFilePath({
              baseDir: this.baseDir,
              relativeDirPath: join(".opencode", "memories"),
              relativeFilePath: mdFile,
              filePath,
              validate: true,
            });
            rules.push(opencodeRule);
          } catch (error) {
            logger.warn(`Failed to load OpenCode memories file ${filePath}:`, error);
          }
        }

        if (mdFiles.length > 0) {
          logger.info(`Successfully loaded ${mdFiles.length} OpenCode memory files`);
        }
      } catch (error) {
        logger.warn(`Failed to read OpenCode memories directory ${memoriesDir}:`, error);
      }
    }

    if (rules.length === 0) {
      logger.warn(`No OpenCode rule files found`);
    }

    return rules;
  }

  /**
   * Load Qwen Code rule configuration from QWEN.md file and .qwen/memories/*.md files
   */
  private async loadQwencodeRules(): Promise<ToolRule[]> {
    const rules: ToolRule[] = [];

    // Load root file (QWEN.md)
    const qwenFile = join(this.baseDir, "QWEN.md");
    if (await fileExists(qwenFile)) {
      try {
        const qwencodeRule = await QwencodeRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".",
          relativeFilePath: "QWEN.md",
          filePath: qwenFile,
          validate: true,
        });
        rules.push(qwencodeRule);
        logger.info(`Successfully loaded Qwen Code memory file`);
      } catch (error) {
        logger.warn(`Failed to load Qwen Code memory file ${qwenFile}:`, error);
      }
    }

    // Load non-root files from .qwen/memories/
    const memoriesDir = join(this.baseDir, ".qwen", "memories");
    if (await directoryExists(memoriesDir)) {
      try {
        const entries = await listDirectoryFiles(memoriesDir);
        const mdFiles = entries.filter((file) => file.endsWith(".md"));

        for (const mdFile of mdFiles) {
          const filePath = join(memoriesDir, mdFile);
          try {
            const qwencodeRule = await QwencodeRule.fromFilePath({
              baseDir: this.baseDir,
              relativeDirPath: join(".qwen", "memories"),
              relativeFilePath: mdFile,
              filePath,
              validate: true,
            });
            rules.push(qwencodeRule);
          } catch (error) {
            logger.warn(`Failed to load Qwen Code memories file ${filePath}:`, error);
          }
        }

        if (mdFiles.length > 0) {
          logger.info(`Successfully loaded ${mdFiles.length} Qwen Code memory files`);
        }
      } catch (error) {
        logger.warn(`Failed to read Qwen Code memories directory ${memoriesDir}:`, error);
      }
    }

    if (rules.length === 0) {
      logger.warn(`No Qwen Code rule files found`);
    }

    return rules;
  }

  /**
   * Load Roo Code rule configurations from .roo/rules/ directory
   */
  private async loadRooRules(): Promise<ToolRule[]> {
    return this.loadToolRulesFromDirectory(
      join(this.baseDir, ".roo", "rules"),
      (filePath, relativeFilePath) =>
        RooRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".roo/rules",
          relativeFilePath,
          filePath,
          validate: true,
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
      (filePath, relativeFilePath) =>
        WindsurfRule.fromFilePath({
          baseDir: this.baseDir,
          relativeDirPath: ".windsurf/rules",
          relativeFilePath,
          filePath,
          validate: true,
        }),
      "Windsurf",
    );
  }

  /**
   * Common helper method to load tool rules from a directory with parallel processing
   */
  private async loadToolRulesFromDirectory(
    dirPath: string,
    ruleFactory: (filePath: string, relativeFilePath: string) => Promise<ToolRule>,
    toolName: string,
  ): Promise<ToolRule[]> {
    if (!(await directoryExists(dirPath))) {
      logger.warn(`${toolName} rules directory not found: ${dirPath}`);
      return [];
    }

    const entries = await listDirectoryFiles(dirPath);
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

    return allTools;
  }

  public generateXmlReferencesSection(toolRules: ToolRule[]): string {
    const toolRulesWithoutRoot = toolRules.filter((rule) => !rule.isRoot());

    if (toolRulesWithoutRoot.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push(
      "Please also reference the following documents as needed. In this case, `@` stands for the project root directory.",
    );
    lines.push("");

    // Build XML structure using fast-xml-parser XMLBuilder
    const documentsData = {
      Documents: {
        Document: toolRulesWithoutRoot.map((rule) => {
          const rulesyncRule = rule.toRulesyncRule();
          const frontmatter = rulesyncRule.getFrontmatter();

          const relativePath = `@${rule.getRelativePathFromCwd()}`;
          const document: Record<string, string> = {
            Path: relativePath,
          };

          if (frontmatter.description) {
            document.Description = frontmatter.description;
          }

          if (frontmatter.globs && frontmatter.globs.length > 0) {
            document.FilePatterns = frontmatter.globs.join(", ");
          }

          return document;
        }),
      },
    };

    const builder = new XMLBuilder({
      format: true,
      ignoreAttributes: false,
      suppressEmptyNode: false,
    });

    const xmlContent = builder.build(documentsData);
    lines.push(xmlContent);

    return lines.join("\n") + "\n";
  }

  public generateReferencesSection(toolRules: ToolRule[]): string {
    const toolRulesWithoutRoot = toolRules.filter((rule) => !rule.isRoot());

    if (toolRulesWithoutRoot.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push("Please also reference the following documents as needed:");
    lines.push("");

    for (const rule of toolRulesWithoutRoot) {
      // Get frontmatter by converting to rulesync rule
      const rulesyncRule = rule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      // Escape double quotes in description
      const escapedDescription = frontmatter.description?.replace(/"/g, '\\"');
      const globsText = frontmatter.globs?.join(",");

      lines.push(
        `@${rule.getRelativePathFromCwd()} description: "${escapedDescription}" globs: "${globsText}"`,
      );
    }

    return lines.join("\n") + "\n";
  }
}
