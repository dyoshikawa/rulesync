// OpenCode mapping for the `models` feature: models.dev-shaped source into
// `provider.<id>.models.<id>`, with keys as `{env:VAR}` references (never literal).
import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { z } from "zod/mini";

import {
  OPENCODE_GLOBAL_DIR,
  OPENCODE_JSON_FILE_NAME,
  OPENCODE_JSONC_FILE_NAME,
} from "../../constants/opencode-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { parseJsonc as parseJsoncStrict } from "../../utils/jsonc.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import {
  forTargetModelConfig,
  type ModelsDefault,
  type RulesyncModel,
  type RulesyncModelProvider,
} from "./rulesync-models.js";
import { RulesyncModels } from "./rulesync-models.js";
import {
  ToolModels,
  ToolModelsForDeletionParams,
  ToolModelsFromRulesyncModelsParams,
  ToolModelsParams,
  ToolModelsSettablePaths,
} from "./tool-models.js";

const OpencodeModelEntrySchema = z.looseObject({
  name: z.optional(z.string()),
  limit: z.optional(
    z.looseObject({
      context: z.optional(z.number()),
      output: z.optional(z.number()),
    }),
  ),
  tool_call: z.optional(z.boolean()),
  reasoning: z.optional(z.boolean()),
  modalities: z.optional(
    z.looseObject({
      input: z.optional(z.array(z.string())),
      output: z.optional(z.array(z.string())),
    }),
  ),
});

const OpencodeProviderEntrySchema = z.looseObject({
  npm: z.optional(z.string()),
  name: z.optional(z.string()),
  options: z.optional(
    z.looseObject({
      baseURL: z.optional(z.string()),
      apiKey: z.optional(z.string()),
    }),
  ),
  models: z.optional(z.record(z.string(), OpencodeModelEntrySchema)),
});

// Loose so every other OpenCode key survives untouched.
const OpencodeConfigSchema = z.looseObject({
  $schema: z.optional(z.string()),
  provider: z.optional(z.record(z.string(), OpencodeProviderEntrySchema)),
  model: z.optional(z.string()),
});

type OpencodeConfig = z.infer<typeof OpencodeConfigSchema>;

type OpencodeModelEntry = {
  name?: string;
  limit?: { context?: number; output?: number };
  tool_call?: boolean;
  reasoning?: boolean;
  modalities?: { input?: string[]; output?: string[] };
};

export type OpencodeProviderEntry = {
  npm?: string;
  name?: string;
  options?: { baseURL?: string; apiKey?: string };
  models: Record<string, OpencodeModelEntry>;
};

/** `${VAR}` becomes OpenCode's `{env:VAR}`; no `env` entry means no `apiKey`. */
export function toOpencodeApiKey(env: string[] | undefined): string | undefined {
  const name = env?.[0];
  return name ? `{env:${name}}` : undefined;
}

function toOpencodeModel(model: RulesyncModel): OpencodeModelEntry {
  const entry: OpencodeModelEntry = {};
  if (model.name !== undefined) entry.name = model.name;
  const context = model.limit?.context;
  const output = model.limit?.output;
  if (context !== undefined || output !== undefined) {
    entry.limit = {
      ...(context !== undefined && { context }),
      ...(output !== undefined && { output }),
    };
  }
  if (model.tool_call !== undefined) entry.tool_call = model.tool_call;
  if (model.reasoning !== undefined) entry.reasoning = model.reasoning;
  if (model.modalities !== undefined) {
    entry.modalities = {
      ...(model.modalities.input !== undefined && { input: model.modalities.input }),
      ...(model.modalities.output !== undefined && { output: model.modalities.output }),
    };
  }
  return entry;
}

export function toOpencodeProviders(
  providers: Record<string, RulesyncModelProvider>,
): Record<string, OpencodeProviderEntry> {
  const out: Record<string, OpencodeProviderEntry> = {};
  for (const [id, provider] of Object.entries(providers)) {
    const models: Record<string, OpencodeModelEntry> = {};
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      models[modelId] = toOpencodeModel(model);
    }
    const apiKey = toOpencodeApiKey(provider.env);
    out[id] = {
      ...(provider.npm !== undefined && { npm: provider.npm }),
      ...(provider.name !== undefined && { name: provider.name }),
      ...((provider.api !== undefined || apiKey !== undefined) && {
        options: {
          ...(provider.api !== undefined && { baseURL: provider.api }),
          ...(apiKey !== undefined && { apiKey }),
        },
      }),
      models,
    };
  }
  return out;
}

/** A `provider` + `model` pair becomes OpenCode's `<provider>/<model>` string. */
export function toOpencodeDefault(defaultValue: ModelsDefault | undefined): string | undefined {
  if (!defaultValue) return undefined;
  return `${defaultValue.provider}/${defaultValue.model}`;
}

export class OpencodeModels extends ToolModels {
  private readonly json: OpencodeConfig;

  constructor(params: ToolModelsParams) {
    super(params);
    this.json = OpencodeConfigSchema.parse(parseJsonc(this.fileContent || "{}"));
  }

  /** opencode.json may contain other settings, so it is never deleted. */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolModelsSettablePaths {
    if (global) {
      return {
        relativeDirPath: OPENCODE_GLOBAL_DIR,
        relativeFilePath: OPENCODE_JSON_FILE_NAME,
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: OPENCODE_JSON_FILE_NAME,
    };
  }

  // fromFile lands in part 2 with import; generate only needs the writer below.
  static async fromRulesyncModels({
    outputRoot = process.cwd(),
    rulesyncModels,
    validate = true,
    global = false,
    logger,
  }: ToolModelsFromRulesyncModelsParams): Promise<OpencodeModels> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);
    // Preserve whichever twin exists so the other scope's content is patched,
    // not shadowed by a new file.
    const jsoncContent = await readFileContentOrNull(join(jsonDir, OPENCODE_JSONC_FILE_NAME));
    const jsonContent =
      jsoncContent === null
        ? await readFileContentOrNull(join(jsonDir, OPENCODE_JSON_FILE_NAME))
        : null;
    const fileContent = jsoncContent ?? jsonContent;
    const relativeFilePath =
      jsoncContent !== null || jsonContent === null
        ? OPENCODE_JSONC_FILE_NAME
        : OPENCODE_JSON_FILE_NAME;

    const { providers, default: defaultValue } = forTargetModelConfig({
      config: rulesyncModels.getJson(),
      toolTarget: "opencode",
    });

    return new OpencodeModels({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      // Keyed by the base settable paths: a resolved `.jsonc` twin shares the
      // `.json` ownership declaration. `model` is retracted when no default
      // is declared.
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(basePaths),
        feature: "models",
        existingContent: fileContent ?? "",
        patch: {
          provider: toOpencodeProviders(providers),
          model: toOpencodeDefault(defaultValue),
        },
        filePath: join(jsonDir, relativeFilePath),
        logger,
      }),
      validate,
    });
  }

  // Import lands in part 2 of this series; until then the generate-only
  // processor reports it as unsupported (see ModelsProcessor).
  toRulesyncModels(): RulesyncModels {
    throw new Error("models import is not supported yet (tracked in #3195).");
  }

  validate(): ValidationResult {
    // Parse fileContent directly since this.json may not be initialized yet
    // when validate() is called from parent constructor
    const json = parseJsoncStrict(this.fileContent || "{}");
    const result = OpencodeConfigSchema.safeParse(json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolModelsForDeletionParams): OpencodeModels {
    return new OpencodeModels({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
