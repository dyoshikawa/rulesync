import { basename, join } from "node:path";
import { XMLBuilder } from "fast-xml-parser";
import { z } from "zod/mini";
import { RULESYNC_RULES_DIR_LEGACY } from "../constants/paths.js";
import { FeatureProcessor } from "../types/feature-processor.js";
import { RulesyncFile } from "../types/rulesync-file.js";
import { ToolFile } from "../types/tool-file.js";
import { ToolTarget } from "../types/tool-targets.js";
import { findFilesByGlobs } from "../utils/file.js";
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
import { WarpRule } from "./warp-rule.js";
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
  "warp",
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
        case "warp":
          return WarpRule.fromRulesyncRule({
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
      case "warp": {
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
    const legacyFiles = await findFilesByGlobs(join(RULESYNC_RULES_DIR_LEGACY, "*.md"));
    logger.debug(`Found ${legacyFiles.length} rulesync files`);
    return Promise.all(
      legacyFiles.map((file) => RulesyncRule.fromFile({ relativeFilePath: basename(file) })),
    );
  }

  async loadRulesyncFilesLegacy(): Promise<RulesyncFile[]> {
    const legacyFiles = await findFilesByGlobs(join(RULESYNC_RULES_DIR_LEGACY, "*.md"));
    logger.debug(`Found ${legacyFiles.length} legacy rulesync files`);
    return Promise.all(
      legacyFiles.map((file) => RulesyncRule.fromFileLegacy({ relativeFilePath: basename(file) })),
    );
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific rule configurations and parse them into ToolRule instances
   */
  async loadToolFiles(): Promise<ToolFile[]> {
    try {
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
        case "warp":
          return await this.loadWarpRules();
        case "windsurf":
          return await this.loadWindsurfRules();
        default:
          throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      }
    } catch (error) {
      logger.debug(`No tool files found`, error);
      return [];
    }
  }

  private async loadToolRulesDefault({
    toolTarget,
    rootPaths,
    nonRootPaths,
  }: {
    toolTarget: RulesProcessorToolTarget;
    rootPaths?: { relativeDirPath?: string; relativeFilePath: string };
    nonRootPaths?: { relativeDirPath: string };
  }) {
    const rootToolRules = await (async () => {
      if (!rootPaths) {
        return [];
      }

      const rootFilePaths = await findFilesByGlobs(
        join(this.baseDir, rootPaths.relativeDirPath ?? ".", rootPaths.relativeFilePath),
      );
      return await Promise.all(
        rootFilePaths.map((filePath) => {
          switch (toolTarget) {
            case "agentsmd":
              return AgentsMdRule.fromFile({ relativeFilePath: basename(filePath) });
            case "amazonqcli":
              return AmazonQCliRule.fromFile({ relativeFilePath: basename(filePath) });
            case "augmentcode":
              return AugmentcodeRule.fromFile({ relativeFilePath: basename(filePath) });
            case "augmentcode-legacy":
              return AugmentcodeLegacyRule.fromFile({ relativeFilePath: basename(filePath) });
            case "claudecode":
              return ClaudecodeRule.fromFile({ relativeFilePath: basename(filePath) });
            case "cline":
              return ClineRule.fromFile({ relativeFilePath: basename(filePath) });
            case "codexcli":
              return CodexcliRule.fromFile({ relativeFilePath: basename(filePath) });
            case "copilot":
              return CopilotRule.fromFile({ relativeFilePath: basename(filePath) });
            case "cursor":
              return CursorRule.fromFile({ relativeFilePath: basename(filePath) });
            case "geminicli":
              return GeminiCliRule.fromFile({ relativeFilePath: basename(filePath) });
            case "junie":
              return JunieRule.fromFile({ relativeFilePath: basename(filePath) });
            case "kiro":
              return KiroRule.fromFile({ relativeFilePath: basename(filePath) });
            case "opencode":
              return OpenCodeRule.fromFile({ relativeFilePath: basename(filePath) });
            case "qwencode":
              return QwencodeRule.fromFile({ relativeFilePath: basename(filePath) });
            case "roo":
              return RooRule.fromFile({ relativeFilePath: basename(filePath) });
            case "warp":
              return WarpRule.fromFile({ relativeFilePath: basename(filePath) });
            case "windsurf":
              return WindsurfRule.fromFile({ relativeFilePath: basename(filePath) });
            default:
              throw new Error(`Unsupported tool target: ${toolTarget}`);
          }
        }),
      );
    })();
    logger.debug(`Found ${rootToolRules.length} root tool rule files`);

    const nonRootToolRules = await (async () => {
      if (!nonRootPaths) {
        return [];
      }

      const nonRootFilePaths = await findFilesByGlobs(
        join(this.baseDir, nonRootPaths.relativeDirPath),
      );
      return await Promise.all(
        nonRootFilePaths.map((filePath) =>
          ToolRule.fromFile({ relativeFilePath: basename(filePath) }),
        ),
      );
    })();
    logger.debug(`Found ${nonRootToolRules.length} non-root tool rule files`);

    const results = await Promise.allSettled(
      [...rootToolRules, ...nonRootToolRules].map((toolRule) => {
        switch (toolTarget) {
          case "agentsmd":
            return AgentsMdRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "amazonqcli":
            return AmazonQCliRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "augmentcode":
            return AugmentcodeRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "augmentcode-legacy":
            return AugmentcodeLegacyRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "claudecode":
            return ClaudecodeRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "cline":
            return ClineRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "codexcli":
            return CodexcliRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "copilot":
            return CopilotRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "cursor":
            return CursorRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "geminicli":
            return GeminiCliRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "junie":
            return JunieRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "kiro":
            return KiroRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "opencode":
            return OpenCodeRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "qwencode":
            return QwencodeRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "roo":
            return RooRule.fromFile({ relativeFilePath: basename(toolRule.getRelativeFilePath()) });
          case "warp":
            return WarpRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          case "windsurf":
            return WindsurfRule.fromFile({
              relativeFilePath: basename(toolRule.getRelativeFilePath()),
            });
          default:
            throw new Error(`Unsupported tool target: ${toolTarget}`);
        }
      }),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<ToolRule> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  /**
   * Load AGENTS.md rule configuration
   */
  private async loadAgentsmdRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "agentsmd",
      rootPaths: { relativeFilePath: "AGENTS.md" },
      nonRootPaths: { relativeDirPath: ".agents/memories" },
    });
  }

  private async loadWarpRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "warp",
      rootPaths: { relativeFilePath: "WARP.md" },
      nonRootPaths: { relativeDirPath: ".warp/memories" },
    });
  }

  /**
   * Load Amazon Q Developer CLI rule configurations from .amazonq/rules/ directory
   */
  private async loadAmazonqcliRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "amazonqcli",
      nonRootPaths: { relativeDirPath: ".amazonq/rules" },
    });
  }

  /**
   * Load AugmentCode rule configurations from .augment/rules/ directory
   */
  private async loadAugmentcodeRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "augmentcode",
      nonRootPaths: { relativeDirPath: ".augment/rules" },
    });
  }

  /**
   * Load AugmentCode legacy rule configuration from .augment-guidelines file and .augment/rules/ directory
   */
  private async loadAugmentcodeLegacyRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "augmentcode-legacy",
      rootPaths: { relativeFilePath: ".augment-guidelines" },
      nonRootPaths: { relativeDirPath: ".augment/rules" },
    });
  }

  /**
   * Load Claude Code rule configuration from CLAUDE.md file
   */
  private async loadClaudecodeRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "claudecode",
      rootPaths: { relativeFilePath: "CLAUDE.md" },
      nonRootPaths: { relativeDirPath: ".claude/memories" },
    });
  }

  /**
   * Load Cline rule configurations from .clinerules/ directory
   */
  private async loadClineRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "cline",
      nonRootPaths: { relativeDirPath: ".clinerules" },
    });
  }

  /**
   * Load OpenAI Codex CLI rule configuration from AGENTS.md and .codex/memories/*.md files
   */
  private async loadCodexcliRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "codexcli",
      rootPaths: { relativeFilePath: "AGENTS.md" },
      nonRootPaths: { relativeDirPath: ".codex/memories" },
    });
  }

  /**
   * Load GitHub Copilot rule configuration from .github/copilot-instructions.md file
   */
  private async loadCopilotRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "copilot",
      rootPaths: { relativeFilePath: ".github/copilot-instructions.md" },
      nonRootPaths: { relativeDirPath: ".github/instructions" },
    });
  }

  /**
   * Load Cursor rule configurations from .cursor/rules/ directory
   */
  private async loadCursorRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "cursor",
      nonRootPaths: { relativeDirPath: ".cursor/rules" },
    });
  }

  /**
   * Load Gemini CLI rule configuration from GEMINI.md file
   */
  private async loadGeminicliRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "geminicli",
      rootPaths: { relativeFilePath: "GEMINI.md" },
    });
  }

  /**
   * Load JetBrains Junie rule configuration from .junie/guidelines.md file
   */
  private async loadJunieRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "junie",
      rootPaths: { relativeDirPath: ".junie", relativeFilePath: "guidelines.md" },
      nonRootPaths: { relativeDirPath: ".junie/memories" },
    });
  }

  /**
   * Load Kiro rule configurations from .kiro/steering/ directory
   */
  private async loadKiroRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "kiro",
      nonRootPaths: { relativeDirPath: ".kiro/steering" },
    });
  }

  /**
   * Load OpenCode rule configuration from AGENTS.md file and .opencode/memories/*.md files
   */
  private async loadOpencodeRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "opencode",
      rootPaths: { relativeFilePath: "AGENTS.md" },
      nonRootPaths: { relativeDirPath: ".opencode/memories" },
    });
  }

  /**
   * Load Qwen Code rule configuration from QWEN.md file and .qwen/memories/*.md files
   */
  private async loadQwencodeRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "qwencode",
      rootPaths: { relativeFilePath: "QWEN.md" },
      nonRootPaths: { relativeDirPath: ".qwen/memories" },
    });
  }

  /**
   * Load Roo Code rule configurations from .roo/rules/ directory
   */
  private async loadRooRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "roo",
      nonRootPaths: { relativeDirPath: ".roo/rules" },
    });
  }

  /**
   * Load Windsurf rule configurations from .windsurf/rules/ directory
   */
  private async loadWindsurfRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      toolTarget: "windsurf",
      nonRootPaths: { relativeDirPath: ".windsurf/rules" },
    });
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets(): ToolTarget[] {
    return rulesProcessorToolTargets;
  }

  private generateXmlReferencesSection(toolRules: ToolRule[]): string {
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

  private generateReferencesSection(toolRules: ToolRule[]): string {
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
