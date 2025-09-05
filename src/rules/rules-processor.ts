import { basename, join } from "node:path";
import { XMLBuilder } from "fast-xml-parser";
import { z } from "zod/mini";
import { RULESYNC_RULES_DIR, RULESYNC_RULES_DIR_LEGACY } from "../constants/paths.js";
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
import { ToolRule, ToolRuleFromFileParams } from "./tool-rule.js";
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
    const files = await findFilesByGlobs(join(RULESYNC_RULES_DIR, "*.md"));
    logger.debug(`Found ${files.length} rulesync files`);
    return Promise.all(
      files.map((file) => RulesyncRule.fromFile({ relativeFilePath: basename(file) })),
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
    root,
    nonRoot,
  }: {
    root?: {
      relativeDirPath: string;
      relativeFilePath: string;
      fromFile: (params: ToolRuleFromFileParams) => Promise<ToolRule>;
    };
    nonRoot?: {
      relativeDirPath: string;
      fromFile: (params: ToolRuleFromFileParams) => Promise<ToolRule>;
      extension: "md" | "mdc";
    };
  }) {
    const rootToolRules = await (async () => {
      if (!root) {
        return [];
      }

      const rootFilePaths = await findFilesByGlobs(
        join(this.baseDir, root.relativeDirPath ?? ".", root.relativeFilePath),
      );
      return await Promise.all(
        rootFilePaths.map((filePath) =>
          root.fromFile({
            baseDir: this.baseDir,
            relativeFilePath: basename(filePath),
          }),
        ),
      );
    })();
    logger.debug(`Found ${rootToolRules.length} root tool rule files`);

    const nonRootToolRules = await (async () => {
      if (!nonRoot) {
        return [];
      }

      const nonRootFilePaths = await findFilesByGlobs(
        join(this.baseDir, nonRoot.relativeDirPath, `*.${nonRoot.extension}`),
      );
      return await Promise.all(
        nonRootFilePaths.map((filePath) =>
          nonRoot.fromFile({
            baseDir: this.baseDir,
            relativeFilePath: basename(filePath),
          }),
        ),
      );
    })();
    logger.debug(`Found ${nonRootToolRules.length} non-root tool rule files`);

    return [...rootToolRules, ...nonRootToolRules];
  }

  /**
   * Load AGENTS.md rule configuration
   */
  private async loadAgentsmdRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fromFile: (params) => AgentsMdRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: ".agents/memories",
        fromFile: (params) => AgentsMdRule.fromFile(params),
        extension: "md",
      },
    });
  }

  private async loadWarpRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: ".",
        relativeFilePath: "WARP.md",
        fromFile: (params) => WarpRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: ".warp/memories",
        fromFile: (params) => WarpRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Amazon Q Developer CLI rule configurations from .amazonq/rules/ directory
   */
  private async loadAmazonqcliRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: ".amazonq/rules",
        fromFile: (params) => AmazonQCliRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load AugmentCode rule configurations from .augment/rules/ directory
   */
  private async loadAugmentcodeRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: ".augment/rules",
        fromFile: (params) => AugmentcodeRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load AugmentCode legacy rule configuration from .augment-guidelines file and .augment/rules/ directory
   */
  private async loadAugmentcodeLegacyRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: ".",
        relativeFilePath: ".augment-guidelines",
        fromFile: (params) => AugmentcodeLegacyRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: ".augment/rules",
        fromFile: (params) => AugmentcodeLegacyRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Claude Code rule configuration from CLAUDE.md file
   */
  private async loadClaudecodeRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
        fromFile: (params) => ClaudecodeRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: ".claude/memories",
        fromFile: (params) => ClaudecodeRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Cline rule configurations from .clinerules/ directory
   */
  private async loadClineRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: ".clinerules",
        fromFile: (params) => ClineRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load OpenAI Codex CLI rule configuration from AGENTS.md and .codex/memories/*.md files
   */
  private async loadCodexcliRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fromFile: (params) => CodexcliRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: ".codex/memories",
        fromFile: (params) => CodexcliRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load GitHub Copilot rule configuration from .github/copilot-instructions.md file
   */
  private async loadCopilotRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: ".",
        relativeFilePath: ".github/copilot-instructions.md",
        fromFile: (params) => CopilotRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: ".github/instructions",
        fromFile: (params) => CopilotRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Cursor rule configurations from .cursor/rules/ directory
   */
  private async loadCursorRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: ".cursor/rules",
        fromFile: (params) => CursorRule.fromFile(params),
        extension: "mdc",
      },
    });
  }

  /**
   * Load Gemini CLI rule configuration from GEMINI.md file
   */
  private async loadGeminicliRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: ".",
        relativeFilePath: "GEMINI.md",
        fromFile: (params) => GeminiCliRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: ".gemini/memories",
        fromFile: (params) => GeminiCliRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load JetBrains Junie rule configuration from .junie/guidelines.md file
   */
  private async loadJunieRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: ".",
        relativeFilePath: ".junie/guidelines.md",
        fromFile: (params) => JunieRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: ".junie/memories",
        fromFile: (params) => JunieRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Kiro rule configurations from .kiro/steering/ directory
   */
  private async loadKiroRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: ".kiro/steering",
        fromFile: (params) => KiroRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load OpenCode rule configuration from AGENTS.md file and .opencode/memories/*.md files
   */
  private async loadOpencodeRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fromFile: (params) => OpenCodeRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: ".opencode/memories",
        fromFile: (params) => OpenCodeRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Qwen Code rule configuration from QWEN.md file and .qwen/memories/*.md files
   */
  private async loadQwencodeRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: ".",
        relativeFilePath: "QWEN.md",
        fromFile: (params) => QwencodeRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: ".qwen/memories",
        fromFile: (params) => QwencodeRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Roo Code rule configurations from .roo/rules/ directory
   */
  private async loadRooRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: ".roo/rules",
        fromFile: (params) => RooRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Windsurf rule configurations from .windsurf/rules/ directory
   */
  private async loadWindsurfRules(): Promise<ToolRule[]> {
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: ".windsurf/rules",
        fromFile: (params) => WindsurfRule.fromFile(params),
        extension: "md",
      },
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
