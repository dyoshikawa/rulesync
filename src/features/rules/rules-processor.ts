import { basename, join } from "node:path";
import { encode } from "@toon-format/toon";
import { z } from "zod/mini";
import {
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { findFilesByGlobs } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { AgentsmdCommand } from "../commands/agentsmd-command.js";
import { CommandsProcessor } from "../commands/commands-processor.js";
import { AgentsmdSkill } from "../skills/agentsmd-skill.js";
import { CopilotSkill } from "../skills/copilot-skill.js";
import { CursorSkill } from "../skills/cursor-skill.js";
import { GeminiCliSkill } from "../skills/geminicli-skill.js";
import { SkillsProcessor } from "../skills/skills-processor.js";
import { AgentsmdSubagent } from "../subagents/agentsmd-subagent.js";
import { CodexCliSubagent } from "../subagents/codexcli-subagent.js";
import { CopilotSubagent } from "../subagents/copilot-subagent.js";
import { CursorSubagent } from "../subagents/cursor-subagent.js";
import { GeminiCliSubagent } from "../subagents/geminicli-subagent.js";
import { RooSubagent } from "../subagents/roo-subagent.js";
import { SubagentsProcessor } from "../subagents/subagents-processor.js";
import { AgentsMdRule } from "./agentsmd-rule.js";
import { AmazonQCliRule } from "./amazonqcli-rule.js";
import { AntigravityRule } from "./antigravity-rule.js";
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
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
} from "./tool-rule.js";
import { WarpRule } from "./warp-rule.js";
import { WindsurfRule } from "./windsurf-rule.js";

const rulesProcessorToolTargets: ToolTarget[] = [
  "agentsmd",
  "amazonqcli",
  "antigravity",
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

/**
 * Reference section style for root rule content.
 * - `toon`: Uses TOON format for referencing non-root rules
 * - `claudecode`: Uses Claude Code specific reference format
 * - `none`: No reference section added to root rule
 */
type ReferenceSectionStyle = "toon" | "claudecode" | "none";

/**
 * Feature path configuration with path getter function.
 * If getRelativeDirPath returns empty string or throws, the feature will be skipped.
 */
type FeaturePathConfig = {
  /** Function to get the relative directory path for the feature. Returns null if not supported for the given mode. */
  getRelativeDirPath: (options?: { global?: boolean }) => string | null;
};

/**
 * Configuration for additional conventions (simulated features).
 * Specifies which simulated features are supported for the tool and their paths.
 */
type AdditionalConventionsConfig = {
  /** Command feature configuration */
  commands?: FeaturePathConfig;
  /** Subagent feature configuration */
  subagents?: FeaturePathConfig;
  /** Skill feature configuration */
  skills?: FeaturePathConfig;
};

/**
 * Factory entry for each tool rule class.
 * Stores the class reference and metadata for a tool.
 */
type ToolRuleFactory = {
  class: {
    isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean;
    fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): ToolRule;
    fromFile(params: ToolRuleFromFileParams): Promise<ToolRule>;
    getSettablePaths(options?: {
      global?: boolean;
    }): ToolRuleSettablePaths | ToolRuleSettablePathsGlobal;
  };
  meta: {
    /** File extension for the rule file */
    extension: "md" | "mdc";
    /** Whether this tool supports global (user scope) mode */
    supportsGlobal: boolean;
    /** How non-root rules are referenced in the root rule */
    referenceSectionStyle: ReferenceSectionStyle;
    /** Configuration for additional conventions (simulated features) */
    additionalConventions?: AdditionalConventionsConfig;
    /** Whether to create a separate rule file for additional conventions instead of prepending to root */
    createsSeparateConventionsRule?: boolean;
  };
};

/**
 * Factory Map mapping tool targets to their rule factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
const toolRuleFactories = new Map<RulesProcessorToolTarget, ToolRuleFactory>([
  [
    "agentsmd",
    {
      class: AgentsMdRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        referenceSectionStyle: "toon",
        additionalConventions: {
          commands: {
            getRelativeDirPath: () => AgentsmdCommand.getSettablePaths().relativeDirPath,
          },
          subagents: {
            getRelativeDirPath: () => AgentsmdSubagent.getSettablePaths().relativeDirPath,
          },
          skills: {
            getRelativeDirPath: () => AgentsmdSkill.getSettablePaths().relativeDirPath,
          },
        },
      },
    },
  ],
  [
    "amazonqcli",
    {
      class: AmazonQCliRule,
      meta: { extension: "md", supportsGlobal: false, referenceSectionStyle: "none" },
    },
  ],
  [
    "antigravity",
    {
      class: AntigravityRule,
      meta: { extension: "md", supportsGlobal: false, referenceSectionStyle: "none" },
    },
  ],
  [
    "augmentcode",
    {
      class: AugmentcodeRule,
      meta: { extension: "md", supportsGlobal: false, referenceSectionStyle: "none" },
    },
  ],
  [
    "augmentcode-legacy",
    {
      class: AugmentcodeLegacyRule,
      meta: { extension: "md", supportsGlobal: false, referenceSectionStyle: "toon" },
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeRule,
      meta: { extension: "md", supportsGlobal: true, referenceSectionStyle: "claudecode" },
    },
  ],
  [
    "cline",
    {
      class: ClineRule,
      meta: { extension: "md", supportsGlobal: false, referenceSectionStyle: "none" },
    },
  ],
  [
    "codexcli",
    {
      class: CodexcliRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        referenceSectionStyle: "toon",
        additionalConventions: {
          subagents: {
            getRelativeDirPath: () => CodexCliSubagent.getSettablePaths().relativeDirPath,
          },
        },
      },
    },
  ],
  [
    "copilot",
    {
      class: CopilotRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        referenceSectionStyle: "none",
        additionalConventions: {
          subagents: {
            getRelativeDirPath: () => CopilotSubagent.getSettablePaths().relativeDirPath,
          },
          skills: {
            getRelativeDirPath: () => CopilotSkill.getSettablePaths().relativeDirPath,
          },
        },
      },
    },
  ],
  [
    "cursor",
    {
      class: CursorRule,
      meta: {
        extension: "mdc",
        supportsGlobal: false,
        referenceSectionStyle: "none",
        additionalConventions: {
          subagents: {
            getRelativeDirPath: () => CursorSubagent.getSettablePaths().relativeDirPath,
          },
          skills: {
            getRelativeDirPath: () => CursorSkill.getSettablePaths().relativeDirPath,
          },
        },
        createsSeparateConventionsRule: true,
      },
    },
  ],
  [
    "geminicli",
    {
      class: GeminiCliRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        referenceSectionStyle: "toon",
        additionalConventions: {
          subagents: {
            getRelativeDirPath: () => GeminiCliSubagent.getSettablePaths().relativeDirPath,
          },
          skills: {
            getRelativeDirPath: () => GeminiCliSkill.getSettablePaths().relativeDirPath,
          },
        },
      },
    },
  ],
  [
    "junie",
    {
      class: JunieRule,
      meta: { extension: "md", supportsGlobal: false, referenceSectionStyle: "none" },
    },
  ],
  [
    "kiro",
    {
      class: KiroRule,
      meta: { extension: "md", supportsGlobal: false, referenceSectionStyle: "toon" },
    },
  ],
  [
    "opencode",
    {
      class: OpenCodeRule,
      meta: { extension: "md", supportsGlobal: false, referenceSectionStyle: "toon" },
    },
  ],
  [
    "qwencode",
    {
      class: QwencodeRule,
      meta: { extension: "md", supportsGlobal: false, referenceSectionStyle: "toon" },
    },
  ],
  [
    "roo",
    {
      class: RooRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        referenceSectionStyle: "none",
        additionalConventions: {
          subagents: {
            getRelativeDirPath: () => RooSubagent.getSettablePaths().relativeDirPath,
          },
        },
        createsSeparateConventionsRule: true,
      },
    },
  ],
  [
    "warp",
    {
      class: WarpRule,
      meta: { extension: "md", supportsGlobal: false, referenceSectionStyle: "toon" },
    },
  ],
  [
    "windsurf",
    {
      class: WindsurfRule,
      meta: { extension: "md", supportsGlobal: false, referenceSectionStyle: "none" },
    },
  ],
]);

/**
 * Tool targets that support global (user scope) mode.
 * Derived from the factory meta configuration.
 */
export const rulesProcessorToolTargetsGlobal: ToolTarget[] = Array.from(toolRuleFactories.entries())
  .filter(([_, factory]) => factory.meta.supportsGlobal)
  .map(([target]) => target);

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: RulesProcessorToolTarget) => ToolRuleFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolRuleFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

export class RulesProcessor extends FeatureProcessor {
  private readonly toolTarget: RulesProcessorToolTarget;
  private readonly simulateCommands: boolean;
  private readonly simulateSubagents: boolean;
  private readonly simulateSkills: boolean;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
    simulateCommands = false,
    simulateSubagents = false,
    simulateSkills = false,
    global = false,
    getFactory = defaultGetFactory,
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    simulateCommands?: boolean;
    simulateSubagents?: boolean;
    simulateSkills?: boolean;
    getFactory?: GetFactory;
  }) {
    super({ baseDir });
    const result = RulesProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for RulesProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.simulateCommands = simulateCommands;
    this.simulateSubagents = simulateSubagents;
    this.simulateSkills = simulateSkills;
    this.getFactory = getFactory;
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncRules = rulesyncFiles.filter(
      (file): file is RulesyncRule => file instanceof RulesyncRule,
    );

    const factory = this.getFactory(this.toolTarget);
    const { meta } = factory;

    const toolRules = rulesyncRules
      .map((rulesyncRule) => {
        if (!factory.class.isTargetedByRulesyncRule(rulesyncRule)) {
          return null;
        }
        return factory.class.fromRulesyncRule({
          baseDir: this.baseDir,
          rulesyncRule,
          validate: true,
          global: this.global,
        });
      })
      .filter((rule): rule is ToolRule => rule !== null);

    const isSimulated = this.simulateCommands || this.simulateSubagents || this.simulateSkills;

    // For tools that create a separate conventions rule file (e.g., cursor, roo)
    if (isSimulated && meta.createsSeparateConventionsRule && meta.additionalConventions) {
      const conventionsContent = this.generateAdditionalConventionsSectionFromMeta(meta);
      const settablePaths = factory.class.getSettablePaths();
      const nonRootPath = settablePaths.nonRoot;
      if (nonRootPath) {
        toolRules.push(
          factory.class.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: new RulesyncRule({
              baseDir: this.baseDir,
              relativeDirPath: nonRootPath.relativeDirPath,
              relativeFilePath: `additional-conventions.${meta.extension}`,
              frontmatter: {
                root: false,
                targets: [this.toolTarget],
              },
              body: conventionsContent,
            }),
            validate: true,
            global: this.global,
          }),
        );
      }
    }

    const rootRuleIndex = toolRules.findIndex((rule) => rule.isRoot());
    if (rootRuleIndex === -1) {
      return toolRules;
    }

    // For tools that don't create a separate conventions rule, prepend to the root rule
    const rootRule = toolRules[rootRuleIndex];
    if (!rootRule) {
      return toolRules;
    }

    // Generate reference section based on meta configuration
    const referenceSection = this.generateReferenceSectionFromMeta(meta, toolRules);

    // Generate additional conventions section (only if not creating a separate rule)
    const conventionsSection =
      !meta.createsSeparateConventionsRule && meta.additionalConventions
        ? this.generateAdditionalConventionsSectionFromMeta(meta)
        : "";

    // Prepend sections to root rule content
    const newContent = referenceSection + conventionsSection + rootRule.getFileContent();
    rootRule.setFileContent(newContent);

    return toolRules;
  }

  /**
   * Generate reference section based on meta configuration.
   */
  private generateReferenceSectionFromMeta(
    meta: ToolRuleFactory["meta"],
    toolRules: ToolRule[],
  ): string {
    switch (meta.referenceSectionStyle) {
      case "toon":
        return this.generateToonReferencesSection(toolRules);
      case "claudecode":
        return this.generateReferencesSection(toolRules);
      case "none":
      default:
        return "";
    }
  }

  /**
   * Generate additional conventions section based on meta configuration.
   */
  private generateAdditionalConventionsSectionFromMeta(meta: ToolRuleFactory["meta"]): string {
    const { additionalConventions } = meta;
    if (!additionalConventions) {
      return "";
    }

    const conventions: Parameters<typeof this.generateAdditionalConventionsSection>[0] = {};

    if (additionalConventions.commands) {
      const relativeDirPath = additionalConventions.commands.getRelativeDirPath({
        global: this.global,
      });
      if (relativeDirPath) {
        conventions.commands = { relativeDirPath };
      }
    }

    if (additionalConventions.subagents) {
      const relativeDirPath = additionalConventions.subagents.getRelativeDirPath({
        global: this.global,
      });
      if (relativeDirPath) {
        conventions.subagents = { relativeDirPath };
      }
    }

    if (additionalConventions.skills) {
      const relativeDirPath = additionalConventions.skills.getRelativeDirPath({
        global: this.global,
      });
      if (relativeDirPath) {
        conventions.skills = { relativeDirPath };
      }
    }

    return this.generateAdditionalConventionsSection(conventions);
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
    const files = await findFilesByGlobs(join(RULESYNC_RULES_RELATIVE_DIR_PATH, "*.md"));
    logger.debug(`Found ${files.length} rulesync files`);
    const rulesyncRules = await Promise.all(
      files.map((file) => RulesyncRule.fromFile({ relativeFilePath: basename(file) })),
    );

    const rootRules = rulesyncRules.filter((rule) => rule.getFrontmatter().root);

    // A root file should be only one
    if (rootRules.length > 1) {
      throw new Error("Multiple root rulesync rules found");
    }

    // If global is true, return only the root rule
    if (this.global) {
      const nonRootRules = rulesyncRules.filter((rule) => !rule.getFrontmatter().root);
      if (nonRootRules.length > 0) {
        logger.warn(
          `${nonRootRules.length} non-root rulesync rules found, but it's in global mode, so ignoring them`,
        );
      }
      return rootRules;
    }

    return rulesyncRules;
  }

  async loadRulesyncFilesLegacy(): Promise<RulesyncFile[]> {
    const legacyFiles = await findFilesByGlobs(join(RULESYNC_RELATIVE_DIR_PATH, "*.md"));
    logger.debug(`Found ${legacyFiles.length} legacy rulesync files`);
    return Promise.all(
      legacyFiles.map((file) => RulesyncRule.fromFileLegacy({ relativeFilePath: basename(file) })),
    );
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific rule configurations and parse them into ToolRule instances
   */
  async loadToolFiles({
    forDeletion: _forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    try {
      const factory = this.getFactory(this.toolTarget);
      const settablePaths = factory.class.getSettablePaths({ global: this.global });

      const rootToolRules = await (async () => {
        if (!settablePaths.root) {
          return [];
        }

        const rootFilePaths = await findFilesByGlobs(
          join(
            this.baseDir,
            settablePaths.root.relativeDirPath ?? ".",
            settablePaths.root.relativeFilePath,
          ),
        );
        return await Promise.all(
          rootFilePaths.map((filePath) =>
            factory.class.fromFile({
              baseDir: this.baseDir,
              relativeFilePath: basename(filePath),
              global: this.global,
            }),
          ),
        );
      })();
      logger.debug(`Found ${rootToolRules.length} root tool rule files`);

      const nonRootToolRules = await (async () => {
        if (!settablePaths.nonRoot) {
          return [];
        }

        const nonRootFilePaths = await findFilesByGlobs(
          join(this.baseDir, settablePaths.nonRoot.relativeDirPath, `*.${factory.meta.extension}`),
        );
        return await Promise.all(
          nonRootFilePaths.map((filePath) =>
            factory.class.fromFile({
              baseDir: this.baseDir,
              relativeFilePath: basename(filePath),
              global: this.global,
            }),
          ),
        );
      })();
      logger.debug(`Found ${nonRootToolRules.length} non-root tool rule files`);

      return [...rootToolRules, ...nonRootToolRules];
    } catch (error) {
      logger.error(`Failed to load tool files: ${formatError(error)}`);
      return [];
    }
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({ global = false }: { global?: boolean } = {}): ToolTarget[] {
    if (global) {
      return rulesProcessorToolTargetsGlobal;
    }
    return rulesProcessorToolTargets;
  }

  private generateToonReferencesSection(toolRules: ToolRule[]): string {
    const toolRulesWithoutRoot = toolRules.filter((rule) => !rule.isRoot());

    if (toolRulesWithoutRoot.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push(
      "Please also reference the following rules as needed. The list below is provided in TOON format, and `@` stands for the project root directory.",
    );
    lines.push("");

    const rules = toolRulesWithoutRoot.map((toolRule) => {
      const rulesyncRule = toolRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      const rule: {
        path: string;
        description?: string;
        applyTo?: string[];
      } = {
        path: `@${toolRule.getRelativePathFromCwd()}`,
      };

      if (frontmatter.description) {
        rule.description = frontmatter.description;
      }

      if (frontmatter.globs && frontmatter.globs.length > 0) {
        rule.applyTo = frontmatter.globs;
      }

      return rule;
    });

    const toonContent = encode({
      rules,
    });
    lines.push(toonContent);

    return lines.join("\n") + "\n\n";
  }

  private generateReferencesSection(toolRules: ToolRule[]): string {
    const toolRulesWithoutRoot = toolRules.filter((rule) => !rule.isRoot());

    if (toolRulesWithoutRoot.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push("Please also reference the following rules as needed:");
    lines.push("");

    for (const toolRule of toolRulesWithoutRoot) {
      // Escape double quotes in description
      const escapedDescription = toolRule.getDescription()?.replace(/"/g, '\\"');
      const globsText = toolRule.getGlobs()?.join(",");

      lines.push(
        `@${toolRule.getRelativePathFromCwd()} description: "${escapedDescription}" applyTo: "${globsText}"`,
      );
    }

    return lines.join("\n") + "\n\n";
  }

  private generateAdditionalConventionsSection({
    commands,
    subagents,
    skills,
  }: {
    commands?: {
      relativeDirPath: string;
    };
    subagents?: {
      relativeDirPath: string;
    };
    skills?: {
      relativeDirPath: string;
    };
  }): string {
    const overview = `# Additional Conventions Beyond the Built-in Functions

As this project's AI coding tool, you must follow the additional conventions below, in addition to the built-in functions.`;

    const commandsSection = commands
      ? `## Simulated Custom Slash Commands

Custom slash commands allow you to define frequently-used prompts as Markdown files that you can execute.

### Syntax

Users can use following syntax to invoke a custom command.

\`\`\`txt
s/<command> [arguments]
\`\`\`

This syntax employs a double slash (\`s/\`) to prevent conflicts with built-in slash commands.
The \`s\` in \`s/\` stands for *simulate*. Because custom slash commands are not built-in, this syntax provides a pseudo way to invoke them.

When users call a custom slash command, you have to look for the markdown file, \`${join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "{command}.md")}\`, then execute the contents of that file as the block of operations.`
      : "";

    const subagentsSection = subagents
      ? `## Simulated Subagents

Simulated subagents are specialized AI assistants that can be invoked to handle specific types of tasks. In this case, it can be appear something like custom slash commands simply. Simulated subagents can be called by custom slash commands.

When users call a simulated subagent, it will look for the corresponding markdown file, \`${join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "{subagent}.md")}\`, and execute its contents as the block of operations.

For example, if the user instructs \`Call planner subagent to plan the refactoring\`, you have to look for the markdown file, \`${join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md")}\`, and execute its contents as the block of operations.`
      : "";

    const skillsSection = skills
      ? `## Simulated Skills

Simulated skills are specialized capabilities that can be invoked to handle specific types of tasks.

When users invoke a simulated skill, look for the corresponding SKILL.md file in \`${join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, "{skill}/SKILL.md")}\` and execute its contents as the block of operations.

For example, if the user instructs \`Use the skill example-skill to achieve something\`, look for \`${join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, "example-skill/SKILL.md")}\` and execute its contents.

Additionally, you should proactively consider using available skills when they would help accomplish a task more effectively, even if the user doesn't explicitly request them.`
      : "";

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
        ...(this.simulateSkills &&
        SkillsProcessor.getToolTargetsSimulated().includes(this.toolTarget)
          ? [skillsSection]
          : []),
      ].join("\n\n") + "\n\n";
    return result;
  }
}
