import { z } from "zod/mini";

import { RULESYNC_MODELS_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { modelsProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import type { Logger } from "../../utils/logger.js";
import { OpencodeModels } from "./opencode-models.js";
import { RulesyncModels } from "./rulesync-models.js";
import { ToolModels } from "./tool-models.js";

export type ModelsProcessorToolTarget = (typeof modelsProcessorToolTargetTuple)[number];

export const ModelsProcessorToolTargetSchema = z.enum(modelsProcessorToolTargetTuple);

// Single-tool map for the processor registry. Per-tool metadata (project vs
// global support) returns when a second tool lands; OpenCode supports both.
export const toolModelsFactories = new Map<ModelsProcessorToolTarget, unknown>([
  ["opencode", { class: OpencodeModels }],
]);

export class ModelsProcessor extends FeatureProcessor {
  private readonly toolTarget: ModelsProcessorToolTarget;
  private readonly global: boolean;

  constructor({
    outputRoot = process.cwd(),
    inputRoots,
    toolTarget,
    global = false,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoots?: readonly [string, ...string[]] | readonly string[];
    toolTarget: ToolTarget;
    global?: boolean;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({ outputRoot, inputRoots, dryRun, logger });
    const result = ModelsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for ModelsProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
  }

  /** Absence is ordinary: the feature does nothing without its source file. */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    try {
      return [await RulesyncModels.fromRoots({ inputRoots: this.inputRoots, logger: this.logger })];
    } catch (error) {
      this.reportRulesyncSourceLoadError({
        message: `Failed to load a Rulesync models file (${RULESYNC_MODELS_RELATIVE_FILE_PATH})`,
        error,
      });
      return [];
    }
  }

  // Tool-file reads land in part 2 with import; generate only needs the
  // deletion branch below for the orphan sweep.
  async loadToolFiles({
    forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    const paths = OpencodeModels.getSettablePaths({ global: this.global });

    if (forDeletion) {
      const toolModels = OpencodeModels.forDeletion({
        outputRoot: this.outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: paths.relativeFilePath,
        global: this.global,
      });
      return toolModels.isDeletable() ? [toolModels] : [];
    }

    throw new Error("models tool-file reads are not supported yet (tracked in #3195).");
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncModels = rulesyncFiles.find(
      (file): file is RulesyncModels => file instanceof RulesyncModels,
    );

    if (!rulesyncModels) {
      throw new Error(`No ${RULESYNC_MODELS_RELATIVE_FILE_PATH} found.`);
    }

    return [
      await OpencodeModels.fromRulesyncModels({
        outputRoot: this.outputRoot,
        rulesyncModels,
        global: this.global,
        logger: this.logger,
      }),
    ];
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolModelsList = toolFiles.filter(
      (file): file is ToolModels => file instanceof ToolModels,
    );

    const rulesyncModelsList = toolModelsList.map((toolModels) => {
      return toolModels.toRulesyncModels();
    });

    return rulesyncModelsList;
  }

  // OpenCode supports both scopes; per-tool metadata returns with tool two.
  static getToolTargets(_params: { global?: boolean } = {}): ToolTarget[] {
    return ["opencode"];
  }
}
