// Source schema for the `models` feature: model providers and model lists
// declared once in `.rulesync/models.jsonc`, reusing the models.dev field
// names verbatim so a block copied from models.dev/api.json stays valid.
import { basename, dirname, join } from "node:path";

import { z } from "zod/mini";

import {
  RULESYNC_MODELS_FILE_NAME,
  RULESYNC_MODELS_LEGACY_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { pickLastRootWithFile } from "../../types/feature-processor.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../../types/rulesync-file.js";
import { formatError } from "../../utils/error.js";
import { fileExistsStrict, readFileContent } from "../../utils/file.js";
import { droppedPollutionKeysError, parseJsoncReportingDroppedKeys } from "../../utils/jsonc.js";
import type { Logger } from "../../utils/logger.js";
import {
  getRulesyncSourceCandidates,
  RulesyncSourceNotFoundError,
  type RulesyncSourceSettablePaths,
} from "../../utils/rulesync-source-path.js";

// models.dev model fields reused verbatim so a block copied from
// models.dev/api.json stays valid. Only the fields rulesync maps are listed;
// unknown fields are stripped per tool (never guessed).
const ModelsDevLimitSchema = z.looseObject({
  context: z.optional(z.number()),
  input: z.optional(z.number()),
  output: z.optional(z.number()),
});

const ModelsDevModalitiesSchema = z.looseObject({
  input: z.optional(z.array(z.string())),
  output: z.optional(z.array(z.string())),
});

const RulesyncModelSchema = z.looseObject({
  id: z.string(),
  name: z.optional(z.string()),
  family: z.optional(z.string()),
  limit: z.optional(ModelsDevLimitSchema),
  tool_call: z.optional(z.boolean()),
  reasoning: z.optional(z.boolean()),
  attachment: z.optional(z.boolean()),
  modalities: z.optional(ModelsDevModalitiesSchema),
  temperature: z.optional(z.boolean()),
  open_weights: z.optional(z.boolean()),
  knowledge: z.optional(z.string()),
  release_date: z.optional(z.string()),
});

const RulesyncModelProviderSchema = z.looseObject({
  name: z.optional(z.string()),
  // models.dev provider fields: `api` is the OpenAI-compatible base URL,
  // `env` names the env vars holding the key, `npm` the AI SDK package.
  api: z.optional(z.string()),
  env: z.optional(z.array(z.string())),
  npm: z.optional(z.string()),
  doc: z.optional(z.string()),
  models: z.optional(z.record(z.string(), RulesyncModelSchema)),
});

const ModelsDefaultSchema = z.object({
  provider: z.string(),
  model: z.string(),
});

export const RulesyncModelsFileSchema = z.looseObject({
  $schema: z.optional(z.string()),
  providers: z.record(z.string(), RulesyncModelProviderSchema),
  default: z.optional(ModelsDefaultSchema),
  // Tool-scoped override blocks (preferred over a `targets` field):
  // `{ "opencode": { default: {...}, providers: {...} } }`.
  // A named provider replaces the shared one wholesale for that tool.
  opencode: z.optional(
    z.looseObject({
      default: z.optional(ModelsDefaultSchema),
      providers: z.optional(z.record(z.string(), RulesyncModelProviderSchema)),
    }),
  ),
  hermesagent: z.optional(
    z.looseObject({
      default: z.optional(ModelsDefaultSchema),
      providers: z.optional(z.record(z.string(), RulesyncModelProviderSchema)),
    }),
  ),
});

export type RulesyncModel = z.infer<typeof RulesyncModelSchema>;
export type RulesyncModelProvider = z.infer<typeof RulesyncModelProviderSchema>;
export type RulesyncModelsFile = z.infer<typeof RulesyncModelsFileSchema>;
export type ModelsDefault = z.infer<typeof ModelsDefaultSchema>;

export type RulesyncModelsParams = RulesyncFileParams;

export type RulesyncModelsFromFileParams = Pick<
  RulesyncFileFromFileParams,
  "outputRoot" | "validate" | "relativeDirPath"
>;

export type RulesyncModelsSettablePaths = RulesyncSourceSettablePaths;

export class RulesyncModels extends RulesyncFile {
  private readonly json: RulesyncModelsFile;
  /**
   * Prototype-pollution keys the parser removed. Reported as an error so a
   * provider named `__proto__` never vanishes silently.
   */
  private readonly droppedKeys: readonly string[];

  constructor(params: RulesyncModelsParams) {
    super(params);

    const { value, droppedKeys } = parseJsoncReportingDroppedKeys({ content: this.fileContent });
    this.json = value as RulesyncModelsFile;
    this.droppedKeys = droppedKeys;

    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): RulesyncModelsSettablePaths {
    return {
      recommended: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_MODELS_FILE_NAME,
      },
      legacy: [
        {
          relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
          relativeFilePath: RULESYNC_MODELS_LEGACY_FILE_NAME,
        },
      ],
    };
  }

  validate(): ValidationResult {
    if (this.droppedKeys.length > 0) {
      return {
        success: false,
        error: droppedPollutionKeysError({
          sourcePath: this.getRelativePathFromCwd(),
          droppedKeys: this.droppedKeys,
        }),
      };
    }
    const result = RulesyncModelsFileSchema.safeParse(this.json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  /**
   * Load the models source across input roots. Single-file feature: the last
   * root carrying the file wins the whole file.
   */
  static async fromRoots({
    inputRoots,
    validate = true,
    logger,
  }: {
    inputRoots: readonly [string, ...string[]];
    validate?: boolean;
    logger: Logger;
  }): Promise<RulesyncModels> {
    const winner = await pickLastRootWithFile({
      inputRoots: [...inputRoots],
      relativePaths: [RULESYNC_MODELS_FILE_NAME, RULESYNC_MODELS_LEGACY_FILE_NAME],
      logger,
      artifactName: "The models file",
    });

    // No root supplies the file: report absence against the primary root's
    // recommended path, matching the single-root behavior below.
    const anchor = winner ?? inputRoots[0];
    return this.fromFile({
      outputRoot: dirname(anchor),
      relativeDirPath: basename(anchor),
      validate,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    validate = true,
  }: RulesyncModelsFromFileParams): Promise<RulesyncModels> {
    const paths = this.getSettablePaths();
    const overrideDirPath = relativeDirPath;

    for (const candidate of getRulesyncSourceCandidates({ paths })) {
      const candidateDirPath = overrideDirPath ?? candidate.relativeDirPath;
      const filePath = join(outputRoot, candidateDirPath, candidate.relativeFilePath);

      if (!(await fileExistsStrict(filePath))) {
        continue;
      }

      try {
        const fileContent = await readFileContent(filePath);
        return new RulesyncModels({
          outputRoot,
          relativeDirPath: candidateDirPath,
          relativeFilePath: candidate.relativeFilePath,
          fileContent,
          validate,
        });
      } catch (error) {
        throw new Error(`Invalid models source file '${filePath}': ${formatError(error)}`, {
          cause: error,
        });
      }
    }

    const fallbackDirPath = overrideDirPath ?? paths.recommended.relativeDirPath;
    throw new RulesyncSourceNotFoundError(
      `No ${join(outputRoot, fallbackDirPath, paths.recommended.relativeFilePath)} found.`,
    );
  }

  getJson(): RulesyncModelsFile {
    return this.json;
  }

  getProviders(): Record<string, RulesyncModelProvider> {
    return this.json.providers ?? {};
  }

  getDefault(): ModelsDefault | undefined {
    return this.json.default;
  }
}

/**
 * Resolve the effective providers + default for one tool: shared providers
 * overlaid wholesale by the tool-scoped `providers` block, shared default
 * replaced by the tool-scoped `default` when present.
 */
export function forTargetModelConfig({
  config,
  toolTarget,
}: {
  config: RulesyncModelsFile;
  toolTarget: "opencode" | "hermesagent";
}): { providers: Record<string, RulesyncModelProvider>; default?: ModelsDefault } {
  const override = config[toolTarget];
  const providers: Record<string, RulesyncModelProvider> = {
    ...config.providers,
    ...override?.providers,
  };
  return { providers, default: override?.default ?? config.default };
}
