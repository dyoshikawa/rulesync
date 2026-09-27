import { z } from "zod/mini";

import { RULESYNC_MODELS_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { modelsProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { isFileNotFoundError } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { OpencodeModels } from "./opencode-models.js";
import { RulesyncModels } from "./rulesync-models.js";
import {
  ToolModels,
  ToolModelsForDeletionParams,
  ToolModelsFromFileParams,
  ToolModelsFromRulesyncModelsParams,
  ToolModelsSettablePaths,
} from "./tool-models.js";

/**
 * Supported tool targets for ModelsProcessor.
 * Using a tuple to preserve order for consistent iteration.
 */
export type ModelsProcessorToolTarget = (typeof modelsProcessorToolTargetTuple)[number];

// Schema for runtime validation
export const ModelsProcessorToolTargetSchema = z.enum(modelsProcessorToolTargetTuple);

/**
 * Factory entry for each tool models class.
 * Stores the class reference and metadata for a tool.
 */
type ToolModelsFactory = {
  class: {
    fromRulesyncModels(
      params: ToolModelsFromRulesyncModelsParams & { global?: boolean },
    ): ToolModels | Promise<ToolModels>;
    fromFile(params: ToolModelsFromFileParams): Promise<ToolModels>;
    forDeletion(params: ToolModelsForDeletionParams): ToolModels;
    getSettablePaths(options?: { global?: boolean }): ToolModelsSettablePaths;
  };
  meta: {
    /** Whether the tool supports project-level models configuration */
    supportsProject: boolean;
    /** Whether the tool supports global (user-level) models configuration */
    supportsGlobal: boolean;
  };
};

/**
 * Factory Map mapping tool targets to their models factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
export const toolModelsFactories = new Map<ModelsProcessorToolTarget, ToolModelsFactory>([
  [
    "opencode",
    {
      class: OpencodeModels,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
      },
    },
  ],
]);

// Derive tool target arrays from factory metadata
const allToolTargetKeys = [...toolModelsFactories.keys()];

const modelsProcessorToolTargets: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolModelsFactories.get(target);
  return factory?.meta.supportsProject ?? false;
});

const modelsProcessorToolTargetsGlobal: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolModelsFactories.get(target);
  return factory?.meta.supportsGlobal ?? false;
});

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: ModelsProcessorToolTarget) => ToolModelsFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolModelsFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

export class ModelsProcessor extends FeatureProcessor {
  private readonly toolTarget: ModelsProcessorToolTarget;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;

  constructor({
    outputRoot = process.cwd(),
    inputRoots,
    toolTarget,
    global = false,
    getFactory = defaultGetFactory,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoots?: readonly [string, ...string[]] | readonly string[];
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
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
    this.getFactory = getFactory;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse the rulesync models file from .rulesync/ directory.
   * Absence is ordinary (the feature does nothing without its source file).
   */
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

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific models configurations and parse them into ToolModels instances
   */
  async loadToolFiles({
    forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    try {
      const factory = this.getFactory(this.toolTarget);
      const paths = factory.class.getSettablePaths({ global: this.global });

      if (forDeletion) {
        const toolModels = factory.class.forDeletion({
          outputRoot: this.outputRoot,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath,
          global: this.global,
        });

        const toolModelsList = toolModels.isDeletable() ? [toolModels] : [];
        this.logger.debug(
          `Successfully loaded ${toolModelsList.length} ${this.toolTarget} models files`,
        );
        return toolModelsList;
      }

      const toolModelsList = [
        await factory.class.fromFile({
          outputRoot: this.outputRoot,
          validate: true,
          global: this.global,
          logger: this.logger,
        }),
      ];
      this.logger.debug(
        `Successfully loaded ${toolModelsList.length} ${this.toolTarget} models files`,
      );
      return toolModelsList;
    } catch (error) {
      const errorMessage = `Failed to load models files for tool target: ${this.toolTarget}: ${formatError(error)}`;
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

  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert RulesyncFile[] to ToolFile[]
   */
  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncModels = rulesyncFiles.find(
      (file): file is RulesyncModels => file instanceof RulesyncModels,
    );

    if (!rulesyncModels) {
      throw new Error(`No ${RULESYNC_MODELS_RELATIVE_FILE_PATH} found.`);
    }

    const factory = this.getFactory(this.toolTarget);
    const toolModelsList = await Promise.all(
      [rulesyncModels].map(async (models) => {
        return await factory.class.fromRulesyncModels({
          outputRoot: this.outputRoot,
          rulesyncModels: models,
          global: this.global,
          logger: this.logger,
        });
      }),
    );

    return [...toolModelsList];
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert ToolFile[] to RulesyncFile[]
   */
  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolModelsList = toolFiles.filter(
      (file): file is ToolModels => file instanceof ToolModels,
    );

    const rulesyncModelsList = toolModelsList.map((toolModels) => {
      return toolModels.toRulesyncModels();
    });

    return rulesyncModelsList;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({ global = false }: { global?: boolean } = {}): ToolTarget[] {
    if (global) {
      return modelsProcessorToolTargetsGlobal;
    }
    return modelsProcessorToolTargets;
  }
}
