import { basename, dirname } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_AIIGNORE_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor, pickLastRootWithFile } from "../../types/feature-processor.js";
import type { FeatureOptions } from "../../types/features.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { ignoreProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { isFileNotFoundError } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { getRulesyncSourceCandidates } from "../../utils/rulesync-source-path.js";
import { AiassistantIgnore } from "./aiassistant-ignore.js";
import { AntigravityCliIgnore } from "./antigravity-cli-ignore.js";
import { AugmentcodeIgnore } from "./augmentcode-ignore.js";
import { ClaudecodeIgnore } from "./claudecode-ignore.js";
import { ClineIgnore } from "./cline-ignore.js";
import { CursorIgnore } from "./cursor-ignore.js";
import { DevinIgnore } from "./devin-ignore.js";
import { HermesagentIgnore } from "./hermesagent-ignore.js";
import { JunieIgnore } from "./junie-ignore.js";
import { KiloIgnore } from "./kilo-ignore.js";
import { KiroIgnore } from "./kiro-ignore.js";
import { QwencodeIgnore } from "./qwencode-ignore.js";
import { ReasonixIgnore } from "./reasonix-ignore.js";
import { RooIgnore } from "./roo-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreSettablePaths,
  ToolIgnoreSettablePathsParams,
} from "./tool-ignore.js";
import { VibeIgnore } from "./vibe-ignore.js";
import { WarpIgnore } from "./warp-ignore.js";
import { ZedIgnore } from "./zed-ignore.js";

export type IgnoreProcessorToolTarget = (typeof ignoreProcessorToolTargetTuple)[number];

export const IgnoreProcessorToolTargetSchema = z.enum(ignoreProcessorToolTargetTuple);

type ToolIgnoreFactory = {
  class: {
    fromRulesyncIgnore(
      params: ToolIgnoreFromRulesyncIgnoreParams,
    ): ToolIgnore | Promise<ToolIgnore>;
    fromFile(params: ToolIgnoreFromFileParams): Promise<ToolIgnore>;
    forDeletion(params: ToolIgnoreForDeletionParams): ToolIgnore;
    getSettablePaths(params?: ToolIgnoreSettablePathsParams): ToolIgnoreSettablePaths;
    getAuxiliaryFiles?(params: {
      toolIgnore: ToolIgnore;
      outputRoot?: string;
    }): Promise<ToolFile[]> | ToolFile[];
    canDeleteAuxiliaryFiles?(params: { outputRoot: string }): Promise<boolean> | boolean;
  };
};

export const toolIgnoreFactories = new Map<IgnoreProcessorToolTarget, ToolIgnoreFactory>([
  ["aiassistant", { class: AiassistantIgnore }],
  ["antigravity-cli", { class: AntigravityCliIgnore }],
  ["augmentcode", { class: AugmentcodeIgnore }],
  ["claudecode", { class: ClaudecodeIgnore }],
  ["claudecode-legacy", { class: ClaudecodeIgnore }],
  ["cline", { class: ClineIgnore }],
  ["cursor", { class: CursorIgnore }],
  ["hermesagent", { class: HermesagentIgnore }],
  ["junie", { class: JunieIgnore }],
  ["kilo", { class: KiloIgnore }],
  ["kiro", { class: KiroIgnore }],
  ["kiro-cli", { class: KiroIgnore }],
  ["kiro-ide", { class: KiroIgnore }],
  ["qwencode", { class: QwencodeIgnore }],
  ["reasonix", { class: ReasonixIgnore }],
  ["roo", { class: RooIgnore }],
  // Zoo Code keeps Roo's `.rooignore`; the class is shared (mirrors kiro-ide).
  ["zoocode", { class: RooIgnore }],
  ["devin", { class: DevinIgnore }],
  ["vibe", { class: VibeIgnore }],
  ["warp", { class: WarpIgnore }],
  ["zed", { class: ZedIgnore }],
]);

const ignoreProcessorToolTargets: ToolTarget[] = [...toolIgnoreFactories.keys()];
const ignoreProcessorGlobalToolTargets: ToolTarget[] = [
  "devin",
  "kiro",
  "kiro-cli",
  "kiro-ide",
  "reasonix",
  "zed",
];

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
  private readonly featureOptions: FeatureOptions | undefined;
  private readonly global: boolean;

  constructor({
    outputRoot = process.cwd(),
    inputRoots,
    toolTarget,
    getFactory = defaultGetFactory,
    global = false,
    dryRun = false,
    logger,
    featureOptions,
  }: {
    outputRoot?: string;
    inputRoots?: readonly [string, ...string[]] | readonly string[];
    toolTarget: ToolTarget;
    getFactory?: GetFactory;
    global?: boolean;
    dryRun?: boolean;
    logger: Logger;
    featureOptions?: FeatureOptions;
  }) {
    super({ outputRoot, inputRoots, dryRun, logger });
    const result = IgnoreProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for IgnoreProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.getFactory = getFactory;
    this.featureOptions = featureOptions;
    this.global = global;
  }

  async writeToolIgnoresFromRulesyncIgnores(rulesyncIgnores: RulesyncIgnore[]): Promise<void> {
    const toolIgnores = await this.convertRulesyncFilesToToolFiles(rulesyncIgnores);
    await this.writeAiFiles(toolIgnores);
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   *
   * Load and parse the rulesync ignore file. `inputRoots[i]` is a source
   * tree itself (e.g. `/repo/.rulesync.local`); the recommended `.aiignore`
   * lives directly inside it. The legacy `.rulesyncignore` is shared at the
   * project root, so it is intentionally not considered when choosing which
   * source tree wins; `RulesyncIgnore.fromFile` still uses it as a fallback
   * for the chosen tree.
   *
   * When multiple input roots are configured, the last root that provides
   * an ignore file wins entirely (whole-file replacement — no line-level
   * merge in this slice; see the "Deliberately out of scope" section of
   * the inputRoots plan for context). If no root has the file, fall back
   * to the primary root's path so `RulesyncIgnore.fromFile` raises the same
   * `RulesyncSourceNotFoundError` it would in the single-root case.
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const paths = RulesyncIgnore.getSettablePaths();
    const relativePaths = getRulesyncSourceCandidates({ paths })
      .filter((candidate) => candidate.relativeDirPath === paths.recommended.relativeDirPath)
      .map((candidate) => candidate.relativeFilePath);
    try {
      const winningRoot = await pickLastRootWithFile({
        inputRoots: this.inputRoots,
        relativePaths,
        logger: this.logger,
        artifactName: "The ignore file (.aiignore)",
      });
      const sourceTree = winningRoot ?? this.inputRoots[0];

      return [
        await RulesyncIgnore.fromFile({
          outputRoot: dirname(sourceTree),
          relativeDirPath: basename(sourceTree),
        }),
      ];
    } catch (error) {
      this.reportRulesyncSourceLoadError({
        message: `Failed to load rulesync ignore file (${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH})`,
        error,
      });
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
      const paths = factory.class.getSettablePaths({
        options: this.featureOptions,
        global: this.global,
      });

      if (forDeletion) {
        const toolIgnore = factory.class.forDeletion({
          outputRoot: this.outputRoot,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath,
          global: this.global,
        });
        const hasOwnershipGuard = factory.class.canDeleteAuxiliaryFiles !== undefined;
        const canDelete =
          !hasOwnershipGuard ||
          (await factory.class.canDeleteAuxiliaryFiles?.({ outputRoot: this.outputRoot })) === true;
        if (!canDelete) return [];
        const auxiliaryFiles = hasOwnershipGuard
          ? await factory.class.getAuxiliaryFiles?.({
              toolIgnore,
              outputRoot: this.outputRoot,
            })
          : [];
        return [toolIgnore, ...(auxiliaryFiles ?? [])].filter((file) => file.isDeletable());
      }

      const toolIgnores = await this.loadToolIgnores();
      return toolIgnores;
    } catch (error) {
      const errorMessage = `Failed to load tool files for ${this.toolTarget}: ${formatError(error)}`;
      // The tool's own config simply not being there yet is the normal first
      // run, so it stays at debug. Matching on `code` rather than on the
      // message keeps a wrapped or localized error from being read as absence.
      if (isFileNotFoundError(error)) {
        this.logger.debug(errorMessage);
      } else {
        this.logger.error(errorMessage);
      }
      return [];
    }
  }

  async loadToolIgnores(): Promise<ToolIgnore[]> {
    const factory = this.getFactory(this.toolTarget);
    return [
      await factory.class.fromFile({
        outputRoot: this.outputRoot,
        options: this.featureOptions,
        global: this.global,
      }),
    ];
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
      throw new Error(`No ${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH} found.`);
    }

    const factory = this.getFactory(this.toolTarget);
    const toolIgnore = await factory.class.fromRulesyncIgnore({
      outputRoot: this.outputRoot,
      rulesyncIgnore,
      options: this.featureOptions,
      global: this.global,
    });

    const auxiliaryFiles = await factory.class.getAuxiliaryFiles?.({
      toolIgnore,
      outputRoot: this.outputRoot,
    });
    return auxiliaryFiles ? [toolIgnore, ...auxiliaryFiles] : [toolIgnore];
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
  static getToolTargets({ global = false }: { global?: boolean } = {}): ToolTarget[] {
    if (global) {
      return ignoreProcessorGlobalToolTargets;
    }
    return ignoreProcessorToolTargets;
  }
}
