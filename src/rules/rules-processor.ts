import { basename, join } from "node:path";
import { XMLBuilder } from "fast-xml-parser";
import { z } from "zod/mini";
import { CodexCliCommand } from "../commands/codexcli-command.js";
import { CommandsProcessor } from "../commands/commands-processor.js";
import { CopilotCommand } from "../commands/copilot-command.js";
import { CursorCommand } from "../commands/cursor-command.js";
import { GeminiCliCommand } from "../commands/geminicli-command.js";
import { RooCommand } from "../commands/roo-command.js";
import { CodexCliSubagent } from "../subagents/codexcli-subagent.js";
import { CopilotSubagent } from "../subagents/copilot-subagent.js";
import { CursorSubagent } from "../subagents/cursor-subagent.js";
import { GeminiCliSubagent } from "../subagents/geminicli-subagent.js";
import { RooSubagent } from "../subagents/roo-subagent.js";
import { SubagentsProcessor } from "../subagents/subagents-processor.js";
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

export const rulesProcessorToolTargetsGlobal: ToolTarget[] = ["claudecode", "codexcli"];

export class RulesProcessor extends FeatureProcessor {
  private readonly toolTarget: RulesProcessorToolTarget;
  private readonly simulateCommands: boolean;
  private readonly simulateSubagents: boolean;
  private readonly global: boolean;

  constructor({
    baseDir = ".",
    toolTarget,
    simulateCommands = false,
    simulateSubagents = false,
    global = false,
  }: {
    baseDir?: string;
    toolTarget: RulesProcessorToolTarget;
    global?: boolean;
    simulateCommands?: boolean;
    simulateSubagents?: boolean;
  }) {
    super({ baseDir });
    this.toolTarget = RulesProcessorToolTargetSchema.parse(toolTarget);
    this.global = global;
    this.simulateCommands = simulateCommands;
    this.simulateSubagents = simulateSubagents;
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncRules = rulesyncFiles.filter(
      (file): file is RulesyncRule => file instanceof RulesyncRule,
    );

    const toolRules = rulesyncRules
      .map((rulesyncRule) => {
        switch (this.toolTarget) {
          case "agentsmd":
            if (!AgentsMdRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return AgentsMdRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "amazonqcli":
            if (!AmazonQCliRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return AmazonQCliRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "augmentcode":
            if (!AugmentcodeRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return AugmentcodeRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "augmentcode-legacy":
            if (!AugmentcodeLegacyRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return AugmentcodeLegacyRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "claudecode":
            if (!ClaudecodeRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return ClaudecodeRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
              global: this.global,
            });
          case "cline":
            if (!ClineRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return ClineRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "codexcli":
            if (!CodexcliRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return CodexcliRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
              global: this.global,
            });
          case "copilot":
            if (!CopilotRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return CopilotRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "cursor":
            if (!CursorRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return CursorRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "geminicli":
            if (!GeminiCliRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return GeminiCliRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "junie":
            if (!JunieRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return JunieRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "kiro":
            if (!KiroRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return KiroRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "opencode":
            if (!OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return OpenCodeRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "qwencode":
            if (!QwencodeRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return QwencodeRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "roo":
            if (!RooRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return RooRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "warp":
            if (!WarpRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return WarpRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          case "windsurf":
            if (!WindsurfRule.isTargetedByRulesyncRule(rulesyncRule)) {
              return null;
            }
            return WindsurfRule.fromRulesyncRule({
              baseDir: this.baseDir,
              rulesyncRule: rulesyncRule,
              validate: true,
            });
          default:
            throw new Error(`Unsupported tool target: ${this.toolTarget}`);
        }
      })
      .filter((rule): rule is ToolRule => rule !== null);

    const isSimulated = this.simulateCommands || this.simulateSubagents;

    // For enabling simulated commands and subagents in Cursor, an additional convention rule is needed.
    if (isSimulated && this.toolTarget === "cursor") {
      toolRules.push(
        new CursorRule({
          baseDir: this.baseDir,
          frontmatter: {
            alwaysApply: true,
          },
          body: this.generateAdditionalConventionsSection({
            commands: { relativeDirPath: CursorCommand.getSettablePaths().relativeDirPath },
            subagents: {
              relativeDirPath: CursorSubagent.getSettablePaths().relativeDirPath,
            },
          }),
          relativeDirPath: CursorRule.getSettablePaths().nonRoot.relativeDirPath,
          relativeFilePath: "additional-conventions.mdc",
          validate: true,
        }),
      );
    }

    if (isSimulated && this.toolTarget === "roo") {
      toolRules.push(
        new RooRule({
          baseDir: this.baseDir,
          relativeDirPath: RooRule.getSettablePaths().nonRoot.relativeDirPath,
          relativeFilePath: "additional-conventions.md",
          fileContent: this.generateAdditionalConventionsSection({
            commands: { relativeDirPath: RooCommand.getSettablePaths().relativeDirPath },
            subagents: {
              relativeDirPath: RooSubagent.getSettablePaths().relativeDirPath,
            },
          }),
          validate: true,
        }),
      );
    }

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
          this.generateXmlReferencesSection(toolRules) +
            this.generateAdditionalConventionsSection({
              commands: { relativeDirPath: CodexCliCommand.getSettablePaths().relativeDirPath },
              subagents: {
                relativeDirPath: CodexCliSubagent.getSettablePaths().relativeDirPath,
              },
            }) +
            rootRule.getFileContent(),
        );
        return toolRules;
      }
      case "copilot": {
        const rootRule = toolRules[rootRuleIndex];
        rootRule?.setFileContent(
          this.generateXmlReferencesSection(toolRules) +
            this.generateAdditionalConventionsSection({
              commands: { relativeDirPath: CopilotCommand.getSettablePaths().relativeDirPath },
              subagents: {
                relativeDirPath: CopilotSubagent.getSettablePaths().relativeDirPath,
              },
            }) +
            rootRule.getFileContent(),
        );
        return toolRules;
      }
      case "geminicli": {
        const rootRule = toolRules[rootRuleIndex];
        rootRule?.setFileContent(
          this.generateXmlReferencesSection(toolRules) +
            this.generateAdditionalConventionsSection({
              commands: { relativeDirPath: GeminiCliCommand.getSettablePaths().relativeDirPath },
              subagents: {
                relativeDirPath: GeminiCliSubagent.getSettablePaths().relativeDirPath,
              },
            }) +
            rootRule.getFileContent(),
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
    const files = await findFilesByGlobs(join(".rulesync/rules", "*.md"));
    logger.debug(`Found ${files.length} rulesync files`);
    return Promise.all(
      files.map((file) => RulesyncRule.fromFile({ relativeFilePath: basename(file) })),
    );
  }

  async loadRulesyncFilesLegacy(): Promise<RulesyncFile[]> {
    const legacyFiles = await findFilesByGlobs(join(".rulesync", "*.md"));
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

  async loadToolFilesToDelete(): Promise<ToolFile[]> {
    return this.loadToolFiles();
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
    const settablePaths = AgentsMdRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: settablePaths.root.relativeDirPath,
        relativeFilePath: settablePaths.root.relativeFilePath,
        fromFile: (params) => AgentsMdRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => AgentsMdRule.fromFile(params),
        extension: "md",
      },
    });
  }

  private async loadWarpRules(): Promise<ToolRule[]> {
    const settablePaths = WarpRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: settablePaths.root.relativeDirPath,
        relativeFilePath: settablePaths.root.relativeFilePath,
        fromFile: (params) => WarpRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => WarpRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Amazon Q Developer CLI rule configurations from .amazonq/rules/ directory
   */
  private async loadAmazonqcliRules(): Promise<ToolRule[]> {
    const settablePaths = AmazonQCliRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => AmazonQCliRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load AugmentCode rule configurations from .augment/rules/ directory
   */
  private async loadAugmentcodeRules(): Promise<ToolRule[]> {
    const settablePaths = AugmentcodeRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => AugmentcodeRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load AugmentCode legacy rule configuration from .augment-guidelines file and .augment/rules/ directory
   */
  private async loadAugmentcodeLegacyRules(): Promise<ToolRule[]> {
    const settablePaths = AugmentcodeLegacyRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: settablePaths.root.relativeDirPath,
        relativeFilePath: settablePaths.root.relativeFilePath,
        fromFile: (params) => AugmentcodeLegacyRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => AugmentcodeLegacyRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Claude Code rule configuration from CLAUDE.md file
   */
  private async loadClaudecodeRules(): Promise<ToolRule[]> {
    const settablePaths = this.global
      ? ClaudecodeRule.getSettablePathsGlobal()
      : ClaudecodeRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: settablePaths.root.relativeDirPath,
        relativeFilePath: settablePaths.root.relativeFilePath,
        fromFile: (params) => ClaudecodeRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => ClaudecodeRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Cline rule configurations from .clinerules/ directory
   */
  private async loadClineRules(): Promise<ToolRule[]> {
    const settablePaths = ClineRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => ClineRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load OpenAI Codex CLI rule configuration from AGENTS.md and .codex/memories/*.md files
   */
  private async loadCodexcliRules(): Promise<ToolRule[]> {
    const settablePaths = CodexcliRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: settablePaths.root.relativeDirPath,
        relativeFilePath: settablePaths.root.relativeFilePath,
        fromFile: (params) => CodexcliRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => CodexcliRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load GitHub Copilot rule configuration from .github/copilot-instructions.md file
   */
  private async loadCopilotRules(): Promise<ToolRule[]> {
    const settablePaths = CopilotRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: settablePaths.root.relativeDirPath,
        relativeFilePath: settablePaths.root.relativeFilePath,
        fromFile: (params) => CopilotRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => CopilotRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Cursor rule configurations from .cursor/rules/ directory
   */
  private async loadCursorRules(): Promise<ToolRule[]> {
    const settablePaths = CursorRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => CursorRule.fromFile(params),
        extension: "mdc",
      },
    });
  }

  /**
   * Load Gemini CLI rule configuration from GEMINI.md file
   */
  private async loadGeminicliRules(): Promise<ToolRule[]> {
    const settablePaths = GeminiCliRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: settablePaths.root.relativeDirPath,
        relativeFilePath: settablePaths.root.relativeFilePath,
        fromFile: (params) => GeminiCliRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => GeminiCliRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load JetBrains Junie rule configuration from .junie/guidelines.md file
   */
  private async loadJunieRules(): Promise<ToolRule[]> {
    const settablePaths = JunieRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: settablePaths.root.relativeDirPath,
        relativeFilePath: settablePaths.root.relativeFilePath,
        fromFile: (params) => JunieRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => JunieRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Kiro rule configurations from .kiro/steering/ directory
   */
  private async loadKiroRules(): Promise<ToolRule[]> {
    const settablePaths = KiroRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => KiroRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load OpenCode rule configuration from AGENTS.md file and .opencode/memories/*.md files
   */
  private async loadOpencodeRules(): Promise<ToolRule[]> {
    const settablePaths = OpenCodeRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: settablePaths.root.relativeDirPath,
        relativeFilePath: settablePaths.root.relativeFilePath,
        fromFile: (params) => OpenCodeRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => OpenCodeRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Qwen Code rule configuration from QWEN.md file and .qwen/memories/*.md files
   */
  private async loadQwencodeRules(): Promise<ToolRule[]> {
    const settablePaths = QwencodeRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      root: {
        relativeDirPath: settablePaths.root.relativeDirPath,
        relativeFilePath: settablePaths.root.relativeFilePath,
        fromFile: (params) => QwencodeRule.fromFile(params),
      },
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => QwencodeRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Roo Code rule configurations from .roo/rules/ directory
   */
  private async loadRooRules(): Promise<ToolRule[]> {
    const settablePaths = RooRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
        fromFile: (params) => RooRule.fromFile(params),
        extension: "md",
      },
    });
  }

  /**
   * Load Windsurf rule configurations from .windsurf/rules/ directory
   */
  private async loadWindsurfRules(): Promise<ToolRule[]> {
    const settablePaths = WindsurfRule.getSettablePaths();
    return await this.loadToolRulesDefault({
      nonRoot: {
        relativeDirPath: settablePaths.nonRoot.relativeDirPath,
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

  static getToolTargetsGlobal(): ToolTarget[] {
    return rulesProcessorToolTargetsGlobal;
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
      // Escape double quotes in description
      const escapedDescription = rule.getDescription()?.replace(/"/g, '\\"');
      const globsText = rule.getGlobs()?.join(",");

      lines.push(
        `@${rule.getRelativePathFromCwd()} description: "${escapedDescription}" globs: "${globsText}"`,
      );
    }

    return lines.join("\n") + "\n";
  }

  private generateAdditionalConventionsSection({
    commands,
    subagents,
  }: {
    commands: {
      relativeDirPath: string;
    };
    subagents: {
      relativeDirPath: string;
    };
  }): string {
    const overview = `# Additional Conventions Beyond the Built-in Functions

As this project's AI coding tool, you must follow the additional conventions below, in addition to the built-in functions.`;

    const commandsSection = `## Simulated Custom Slash Commands

Custom slash commands allow you to define frequently-used prompts as Markdown files that you can execute.

### Syntax

Users can use following syntax to invoke a custom command.

\`\`\`txt
s/<command> [arguments]
\`\`\`

This syntax employs a double slash (\`s/\`) to prevent conflicts with built-in slash commands.  
The \`s\` in \`s/\` stands for *simulate*. Because custom slash commands are not built-in, this syntax provides a pseudo way to invoke them.

When users call a custom slash command, you have to look for the markdown file, \`${join(commands.relativeDirPath, "{command}.md")}\`, then execute the contents of that file as the block of operations.`;

    const subagentsSection = `## Simulated Subagents

Simulated subagents are specialized AI assistants that can be invoked to handle specific types of tasks. In this case, it can be appear something like custom slash commands simply. Simulated subagents can be called by custom slash commands.

When users call a simulated subagent, it will look for the corresponding markdown file, \`${join(subagents.relativeDirPath, "{subagent}.md")}\`, and execute its contents as the block of operations.

For example, if the user instructs \`Call planner subagent to plan the refactoring\`, you have to look for the markdown file, \`${join(subagents.relativeDirPath, "planner.md")}\`, and execute its contents as the block of operations.`;

    const result =
      [
        overview,
        ...(this.simulateCommands &&
        CommandsProcessor.getToolTargetsSimulated().includes(this.toolTarget)
          ? [commandsSection]
          : []),
        ...(this.simulateSubagents &&
        SubagentsProcessor.getToolTargetsSimulated().includes(this.toolTarget)
          ? [subagentsSection]
          : []),
      ].join("\n\n") + "\n\n";
    return result;
  }
}
