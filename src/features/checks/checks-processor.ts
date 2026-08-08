import { join, relative } from "node:path";

import { z } from "zod/mini";

import { AUGMENTCODE_CODE_REVIEW_GUIDELINES_FILE_NAME } from "../../constants/augmentcode-paths.js";
import { CURSOR_BUGBOT_FILE_NAME } from "../../constants/cursor-paths.js";
import { ROVODEV_REVIEW_AGENT_FILE_NAME } from "../../constants/rovodev-paths.js";
import { TAKT_CONFIG_FILE_NAME } from "../../constants/takt-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { checksProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { directoryExists, findFilesByGlobs, listDirectoryFiles } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { AmpCheck } from "./amp-check.js";
import { AugmentcodeCheck } from "./augmentcode-check.js";
import { CursorCheck } from "./cursor-check.js";
import { HermesagentCheck } from "./hermesagent-check.js";
import { RovodevCheck } from "./rovodev-check.js";
import { RulesyncCheck } from "./rulesync-check.js";
import { TaktCheck } from "./takt-check.js";
import {
  ToolCheck,
  ToolCheckForDeletionParams,
  ToolCheckFromFileParams,
  ToolCheckFromRulesyncCheckParams,
  ToolCheckFromRulesyncChecksParams,
  ToolCheckSettablePaths,
} from "./tool-check.js";

/**
 * Factory entry for each tool check class.
 * Stores the class reference and metadata for a tool.
 */
type ToolCheckFactory = {
  class: {
    isTargetedByRulesyncCheck(rulesyncCheck: RulesyncCheck): boolean;
    fromRulesyncCheck(params: ToolCheckFromRulesyncCheckParams): ToolCheck;
    /** Set instead of `fromRulesyncCheck` when checks share one output file. */
    fromRulesyncChecks?(params: ToolCheckFromRulesyncChecksParams): Promise<ToolCheck[]>;
    fromFile(params: ToolCheckFromFileParams): Promise<ToolCheck>;
    forDeletion(params: ToolCheckForDeletionParams): ToolCheck;
    getSettablePaths(options?: { global?: boolean }): ToolCheckSettablePaths;
    getAuxiliaryFiles?(params: {
      toolChecks: ToolCheck[];
      outputRoot?: string;
      global?: boolean;
    }): Promise<ToolFile[]> | ToolFile[];
    canDeleteAuxiliaryFiles?(params: { outputRoot: string }): Promise<boolean> | boolean;
  };
  meta: {
    /** Whether the tool supports global (user-level) checks */
    supportsGlobal: boolean;
    /** File pattern for import (e.g., "*.md") */
    filePattern: string;
    /**
     * Whether the upstream reviewer reads this output from the **committed**
     * repository (Cursor Bugbot, Rovo Dev's code reviewer). The gitignore
     * derivation skips such outputs — ignoring them would disable the very
     * feature the adapter generates. Future checks adapters whose upstream
     * reads from the committed tree (e.g. Goose `.agents/checks/`) should set
     * this too.
     */
    committedOutput?: boolean;
  };
};

/**
 * Supported tool targets for ChecksProcessor.
 * Using a tuple to preserve order for consistent iteration.
 */
export type ChecksProcessorToolTarget = (typeof checksProcessorToolTargetTuple)[number];

// Schema for runtime validation
export const ChecksProcessorToolTargetSchema = z.enum(checksProcessorToolTargetTuple);

/**
 * Factory Map mapping tool targets to their check factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
export const toolCheckFactories = new Map<ChecksProcessorToolTarget, ToolCheckFactory>([
  [
    "amp",
    {
      // Amp reads code review checks from `.agents/checks/` (project) and
      // `~/.config/amp/checks/` (global) as Markdown files with YAML frontmatter.
      // https://ampcode.com/manual
      class: AmpCheck,
      meta: { supportsGlobal: true, filePattern: "*.md" },
    },
  ],
  [
    "augmentcode",
    {
      // Augment Code Review reads one YAML guidelines file of named areas, so
      // every check targeting AugmentCode collapses into
      // `.augment/code_review_guidelines.yaml`.
      // https://docs.augmentcode.com/codereview/review-guidelines
      class: AugmentcodeCheck,
      // `committedOutput`: the reviewer reads the guidelines from the committed
      // repository, so the derived .gitignore must not ignore the file.
      meta: {
        supportsGlobal: false,
        filePattern: AUGMENTCODE_CODE_REVIEW_GUIDELINES_FILE_NAME,
        committedOutput: true,
      },
    },
  ],
  [
    "cursor",
    {
      // Bugbot reads one aggregated instruction file per directory, so every
      // check targeting Cursor collapses into the root `.cursor/BUGBOT.md`.
      // https://cursor.com/docs/bugbot
      class: CursorCheck,
      // `committedOutput`: Bugbot only sees BUGBOT.md when it is checked into
      // the repository, so the derived .gitignore must not ignore it.
      meta: { supportsGlobal: false, filePattern: CURSOR_BUGBOT_FILE_NAME, committedOutput: true },
    },
  ],
  [
    "hermesagent",
    {
      class: HermesagentCheck,
      meta: { supportsGlobal: false, filePattern: "*.json" },
    },
  ],
  [
    "rovodev",
    {
      // Rovo Dev reads one plain-Markdown instruction file for code reviews, so
      // every check targeting it collapses into `.rovodev/.review-agent.md`.
      // https://support.atlassian.com/rovo/docs/set-custom-instructions-for-code-reviews/
      class: RovodevCheck,
      // `committedOutput`: Rovo Dev's code reviewer reads .review-agent.md
      // from the committed repository, so the derived .gitignore must not
      // ignore it.
      meta: {
        supportsGlobal: false,
        filePattern: ROVODEV_REVIEW_AGENT_FILE_NAME,
        committedOutput: true,
      },
    },
  ],
  [
    "takt",
    {
      // Takt's quality gates live in the `workflow_overrides` block of the
      // shared `.takt/config.yaml`, so every check collapses into that one file.
      // https://github.com/nrslib/takt/blob/main/docs/workflows.md
      class: TaktCheck,
      meta: { supportsGlobal: true, filePattern: TAKT_CONFIG_FILE_NAME },
    },
  ],
]);

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: ChecksProcessorToolTarget) => ToolCheckFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolCheckFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

// Derive tool target arrays from factory metadata
const allToolTargetKeys = [...toolCheckFactories.keys()];

export const checksProcessorToolTargets: ToolTarget[] = allToolTargetKeys;

const checksProcessorToolTargetsGlobal: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolCheckFactories.get(target);
  return factory?.meta.supportsGlobal ?? false;
});

export class ChecksProcessor extends FeatureProcessor {
  private readonly toolTarget: ChecksProcessorToolTarget;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;

  constructor({
    outputRoot = process.cwd(),
    inputRoot = process.cwd(),
    toolTarget,
    global = false,
    getFactory = defaultGetFactory,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoot?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({ outputRoot, inputRoot, dryRun, logger });
    const result = ChecksProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for ChecksProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.getFactory = getFactory;
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncChecks = rulesyncFiles.filter(
      (file): file is RulesyncCheck => file instanceof RulesyncCheck,
    );

    const factory = this.getFactory(this.toolTarget);

    const targeted = rulesyncChecks.filter((rulesyncCheck) =>
      factory.class.isTargetedByRulesyncCheck(rulesyncCheck),
    );

    const toolChecks = factory.class.fromRulesyncChecks
      ? await factory.class.fromRulesyncChecks({
          outputRoot: this.outputRoot,
          relativeDirPath: RulesyncCheck.getSettablePaths().relativeDirPath,
          rulesyncChecks: targeted,
          global: this.global,
          logger: this.logger,
        })
      : targeted.map((rulesyncCheck) =>
          factory.class.fromRulesyncCheck({
            outputRoot: this.outputRoot,
            relativeDirPath: RulesyncCheck.getSettablePaths().relativeDirPath,
            rulesyncCheck,
            global: this.global,
          }),
        );
    const auxiliaryFiles = await factory.class.getAuxiliaryFiles?.({
      toolChecks,
      outputRoot: this.outputRoot,
      global: this.global,
    });
    return auxiliaryFiles ? [...toolChecks, ...auxiliaryFiles] : toolChecks;
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolChecks = toolFiles.filter((file): file is ToolCheck => file instanceof ToolCheck);

    return toolChecks.flatMap((toolCheck) => toolCheck.toRulesyncChecks());
  }

  /**
   * Implementation of abstract method from Processor
   * Load and parse rulesync check files from .rulesync/checks/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const checksDir = join(this.inputRoot, RulesyncCheck.getSettablePaths().relativeDirPath);

    const dirExists = await directoryExists(checksDir);
    if (!dirExists) {
      this.logger.debug(`Rulesync checks directory not found: ${checksDir}`);
      return [];
    }

    const entries = await listDirectoryFiles(checksDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      this.logger.debug(`No markdown files found in rulesync checks directory: ${checksDir}`);
      return [];
    }

    this.logger.debug(`Found ${mdFiles.length} check files in ${checksDir}`);

    const rulesyncChecks: RulesyncCheck[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(checksDir, mdFile);

      try {
        const rulesyncCheck = await RulesyncCheck.fromFile({
          outputRoot: this.inputRoot,
          relativeFilePath: mdFile,
          validate: true,
        });

        rulesyncChecks.push(rulesyncCheck);
        this.logger.debug(`Successfully loaded check: ${mdFile}`);
      } catch (error) {
        this.logger.warn(`Failed to load check file ${filepath}: ${formatError(error)}`);
        continue;
      }
    }

    this.logger.debug(`Successfully loaded ${rulesyncChecks.length} rulesync checks`);
    return rulesyncChecks;
  }

  /**
   * Implementation of abstract method from Processor
   * Load tool-specific check files and parse them into ToolCheck instances
   */
  async loadToolFiles({
    forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });

    const baseDir = join(this.outputRoot, paths.relativeDirPath);
    const checkFilePaths = await findFilesByGlobs(join(baseDir, factory.meta.filePattern));

    const toRelativeFilePath = (path: string): string => relative(baseDir, path);

    if (forDeletion) {
      const toolChecks = checkFilePaths
        .map((path) =>
          factory.class.forDeletion({
            outputRoot: this.outputRoot,
            relativeDirPath: paths.relativeDirPath,
            relativeFilePath: toRelativeFilePath(path),
            global: this.global,
          }),
        )
        .filter((check) => check.isDeletable());
      const hasOwnershipGuard = factory.class.canDeleteAuxiliaryFiles !== undefined;
      const canDelete =
        !hasOwnershipGuard ||
        (await factory.class.canDeleteAuxiliaryFiles?.({ outputRoot: this.outputRoot })) === true;
      if (!canDelete) return [];
      const auxiliaryFiles = hasOwnershipGuard
        ? await factory.class.getAuxiliaryFiles?.({
            toolChecks,
            outputRoot: this.outputRoot,
            global: this.global,
          })
        : [];
      return [...toolChecks, ...(auxiliaryFiles ?? [])].filter((file) => file.isDeletable());
    }

    const loaded = await Promise.all(
      checkFilePaths.map((path) =>
        factory.class.fromFile({
          outputRoot: this.outputRoot,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: toRelativeFilePath(path),
          global: this.global,
        }),
      ),
    );

    this.logger.debug(
      `Successfully loaded ${loaded.length} ${this.toolTarget} checks from ${paths.relativeDirPath}`,
    );
    return loaded;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({
    global = false,
  }: {
    global?: boolean;
    includeSimulated?: boolean;
  } = {}): ToolTarget[] {
    if (global) {
      return [...checksProcessorToolTargetsGlobal];
    }
    return [...checksProcessorToolTargets];
  }

  // Checks have no simulated mode; declared for parity with the processor
  // registry surface, which reads getToolTargetsSimulated when present.
  static getToolTargetsSimulated(): ToolTarget[] {
    return [];
  }

  /**
   * Get the factory for a specific tool target.
   * This is a static version of the internal getFactory for external use.
   * @param target - The tool target. Must be a valid ChecksProcessorToolTarget.
   * @returns The factory for the target, or undefined if not found.
   */
  static getFactory(target: ToolTarget): ToolCheckFactory | undefined {
    const result = ChecksProcessorToolTargetSchema.safeParse(target);
    if (!result.success) {
      return undefined;
    }
    return toolCheckFactories.get(result.data);
  }
}
