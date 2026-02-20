import { join } from "node:path";
import { z } from "zod/mini";

import {
  RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
  RULESYNC_IGNORE_RELATIVE_FILE_PATH,
  RULESYNC_IGNORE_YAML_RELATIVE_FILE_PATH,
} from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { fileExists } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { AugmentcodeIgnore } from "./augmentcode-ignore.js";
import { ClaudecodeIgnore } from "./claudecode-ignore.js";
import { ClineIgnore } from "./cline-ignore.js";
import { CursorIgnore } from "./cursor-ignore.js";
import { GeminiCliIgnore } from "./geminicli-ignore.js";
import {
  IgnoreRule,
  convertIgnoreRulesToClaudeDenyPatterns,
  convertIgnoreRulesToPathPatterns,
  parseIgnoreRulesFromText,
} from "./ignore-rules.js";
import { JunieIgnore } from "./junie-ignore.js";
import { KiloIgnore } from "./kilo-ignore.js";
import { KiroIgnore } from "./kiro-ignore.js";
import { QwencodeIgnore } from "./qwencode-ignore.js";
import { RooIgnore } from "./roo-ignore.js";
import { RulesyncIgnoreYaml } from "./rulesync-ignore-yaml.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";
import { WindsurfIgnore } from "./windsurf-ignore.js";
import { ZedIgnore } from "./zed-ignore.js";

const ignoreProcessorToolTargets: ToolTarget[] = [
  "augmentcode",
  "claudecode",
  "claudecode-legacy",
  "cline",
  "cursor",
  "geminicli",
  "junie",
  "kilo",
  "kiro",
  "qwencode",
  "roo",
  "windsurf",
  "zed",
];

export const IgnoreProcessorToolTargetSchema = z.enum(ignoreProcessorToolTargets);

export type IgnoreProcessorToolTarget = z.infer<typeof IgnoreProcessorToolTargetSchema>;

type ToolIgnoreFactory = {
  class: {
    fromRulesyncIgnore(
      params: ToolIgnoreFromRulesyncIgnoreParams,
    ): ToolIgnore | Promise<ToolIgnore>;
    fromFile(params: ToolIgnoreFromFileParams): Promise<ToolIgnore>;
    forDeletion(params: ToolIgnoreForDeletionParams): ToolIgnore;
    getSettablePaths(): ToolIgnoreSettablePaths;
  };
};

const toolIgnoreFactories = new Map<IgnoreProcessorToolTarget, ToolIgnoreFactory>([
  ["augmentcode", { class: AugmentcodeIgnore }],
  ["claudecode", { class: ClaudecodeIgnore }],
  ["claudecode-legacy", { class: ClaudecodeIgnore }],
  ["cline", { class: ClineIgnore }],
  ["cursor", { class: CursorIgnore }],
  ["geminicli", { class: GeminiCliIgnore }],
  ["junie", { class: JunieIgnore }],
  ["kilo", { class: KiloIgnore }],
  ["kiro", { class: KiroIgnore }],
  ["qwencode", { class: QwencodeIgnore }],
  ["roo", { class: RooIgnore }],
  ["windsurf", { class: WindsurfIgnore }],
  ["zed", { class: ZedIgnore }],
]);

type GetFactory = (target: IgnoreProcessorToolTarget) => ToolIgnoreFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolIgnoreFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

export class IgnoreProcessor extends FeatureProcessor {
  private readonly toolTarget: IgnoreProcessorToolTarget;
  private readonly getFactory: GetFactory;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
    getFactory = defaultGetFactory,
    dryRun = false,
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    getFactory?: GetFactory;
    dryRun?: boolean;
  }) {
    super({ baseDir, dryRun });
    const result = IgnoreProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for IgnoreProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.getFactory = getFactory;
  }

  async writeToolIgnoresFromRulesyncIgnores(rulesyncIgnores: RulesyncFile[]): Promise<void> {
    const toolIgnores = await this.convertRulesyncFilesToToolFiles(rulesyncIgnores);
    await this.writeAiFiles(toolIgnores);
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync ignore files from .rulesync/ignore/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    try {
      const yamlPath = join(process.cwd(), RULESYNC_IGNORE_YAML_RELATIVE_FILE_PATH);
      const hasYaml = await fileExists(yamlPath);
      if (hasYaml) {
        const hasAiignore = await fileExists(
          join(process.cwd(), RULESYNC_AIIGNORE_RELATIVE_FILE_PATH),
        );
        const hasLegacyIgnore = await fileExists(
          join(process.cwd(), RULESYNC_IGNORE_RELATIVE_FILE_PATH),
        );
        if (hasAiignore || hasLegacyIgnore) {
          logger.warn(
            `Found both ${RULESYNC_IGNORE_YAML_RELATIVE_FILE_PATH} and legacy ignore files. Using ${RULESYNC_IGNORE_YAML_RELATIVE_FILE_PATH} as source of truth.`,
          );
        }

        const rulesyncIgnoreYaml = await RulesyncIgnoreYaml.fromFile();
        for (const warning of rulesyncIgnoreYaml.getWarnings()) {
          logger.warn(`[ignore] ${warning}`);
        }
        return [rulesyncIgnoreYaml];
      }

      return [await RulesyncIgnore.fromFile()];
    } catch (error) {
      logger.error(
        `Failed to load rulesync ignore file (${RULESYNC_IGNORE_YAML_RELATIVE_FILE_PATH} or ${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      );
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
      const factory = this.getFactory(this.toolTarget);
      const paths = factory.class.getSettablePaths();

      if (forDeletion) {
        const toolIgnore = factory.class.forDeletion({
          baseDir: this.baseDir,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath,
        });

        const toolIgnores = toolIgnore.isDeletable() ? [toolIgnore] : [];
        return toolIgnores;
      }

      const toolIgnores = await this.loadToolIgnores();
      return toolIgnores;
    } catch (error) {
      const errorMessage = `Failed to load tool files for ${this.toolTarget}: ${formatError(error)}`;
      if (error instanceof Error && error.message.includes("no such file or directory")) {
        logger.debug(errorMessage);
      } else {
        logger.error(errorMessage);
      }
      return [];
    }
  }

  async loadToolIgnores(): Promise<ToolIgnore[]> {
    const factory = this.getFactory(this.toolTarget);
    return [await factory.class.fromFile({ baseDir: this.baseDir })];
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert RulesyncFile[] to ToolFile[]
   */
  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncIgnoreYaml = rulesyncFiles.find(
      (file): file is RulesyncIgnoreYaml => file instanceof RulesyncIgnoreYaml,
    );

    if (rulesyncIgnoreYaml) {
      const rules = rulesyncIgnoreYaml.getRules();
      const rulesyncIgnore = this.createRulesyncIgnoreForToolTarget({
        rules,
      });

      const factory = this.getFactory(this.toolTarget);
      const toolIgnore = await factory.class.fromRulesyncIgnore({
        baseDir: this.baseDir,
        rulesyncIgnore,
      });

      return [toolIgnore];
    }

    const rulesyncIgnore = rulesyncFiles.find(
      (file): file is RulesyncIgnore => file instanceof RulesyncIgnore,
    );

    if (!rulesyncIgnore) {
      throw new Error(`No ${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH} found.`);
    }

    const factory = this.getFactory(this.toolTarget);
    const toolIgnore = await factory.class.fromRulesyncIgnore({
      baseDir: this.baseDir,
      rulesyncIgnore,
    });

    return [toolIgnore];
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert ToolFile[] to RulesyncFile[]
   */
  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolIgnores = toolFiles.filter((file): file is ToolIgnore => file instanceof ToolIgnore);
    if (toolIgnores.length === 0) {
      return [];
    }

    const rules: IgnoreRule[] = [];
    for (const toolIgnore of toolIgnores) {
      const rulesyncIgnore = toolIgnore.toRulesyncIgnore();
      const parsed = parseIgnoreRulesFromText(rulesyncIgnore.getFileContent());
      for (const warning of parsed.warnings) {
        logger.warn(`[ignore] ${warning}`);
      }
      rules.push(...parsed.rules);
    }

    const rulesyncIgnoreYaml = RulesyncIgnoreYaml.fromRules({
      baseDir: this.baseDir,
      rules,
    });
    return [rulesyncIgnoreYaml];
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

  private createRulesyncIgnoreForToolTarget({ rules }: { rules: IgnoreRule[] }): RulesyncIgnore {
    const { recommended } = RulesyncIgnore.getSettablePaths();

    if (this.toolTarget === "claudecode" || this.toolTarget === "claudecode-legacy") {
      const denyPatterns = convertIgnoreRulesToClaudeDenyPatterns(rules);
      return new RulesyncIgnore({
        baseDir: this.baseDir,
        relativeDirPath: recommended.relativeDirPath,
        relativeFilePath: recommended.relativeFilePath,
        fileContent: denyPatterns.join("\n"),
      });
    }

    const projected = convertIgnoreRulesToPathPatterns(rules);
    for (const warning of projected.warnings) {
      logger.warn(`[ignore] ${warning}`);
    }
    return new RulesyncIgnore({
      baseDir: this.baseDir,
      relativeDirPath: recommended.relativeDirPath,
      relativeFilePath: recommended.relativeFilePath,
      fileContent: projected.patterns.join("\n"),
    });
  }
}
