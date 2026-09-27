// OpenCode mapping for the `models` feature.
//
// Source shape (`.rulesync/models.jsonc`) reuses models.dev field names, and
// OpenCode's own `provider.<id>.models.<id>` config accepts the same model
// fields — so the model entry is close to an identity mapping. The provider
// entry splits into OpenCode's `options.baseURL` / `options.apiKey`, with the
// key spelled as OpenCode's `{env:VAR}` reference form. A literal key is never
// written: a provider without `env` gets no `apiKey`.
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
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
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
  ToolModelsFromFileParams,
  ToolModelsFromRulesyncModelsParams,
  ToolModelsParams,
  ToolModelsSettablePaths,
} from "./tool-models.js";

// Matches OpenCode's `{env:VAR}` reference; the negative lookbehind avoids
// matching Cursor's `${env:VAR}` spelling.
const OPENCODE_ENV_VAR_PATTERN = /(?<!\$)\{env:([^}:]+)\}/g;

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

// Loose so `mcp`, `permission`, `instructions` and every other OpenCode key
// survive the round-trip untouched.
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

/**
 * The `mcp` feature's `${VAR}` reference form becomes OpenCode's `{env:VAR}`
 * spelling. A provider without an `env` entry gets no `apiKey` at all.
 */
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

/** Inverse of {@link toOpencodeApiKey}: `{env:VAR}` back to `env: ["VAR"]`. */
function fromOpencodeApiKey(apiKey: string | undefined): string[] | undefined {
  if (!apiKey) return undefined;
  const match = OPENCODE_ENV_VAR_PATTERN.exec(apiKey);
  OPENCODE_ENV_VAR_PATTERN.lastIndex = 0;
  return match?.[1] ? [match[1]] : undefined;
}

/** Inverse of {@link toOpencodeDefault}: split on the first `/` only, so model
 * ids that contain `/` stay unambiguous. Returns undefined when the value
 * names no provider. */
function fromOpencodeDefault(model: string | undefined): ModelsDefault | undefined {
  if (!model) return undefined;
  const slash = model.indexOf("/");
  if (slash <= 0) return undefined;
  return { provider: model.slice(0, slash), model: model.slice(slash + 1) };
}

type OpencodeProviderEntryShape = z.infer<typeof OpencodeProviderEntrySchema>;
type OpencodeModelEntryShape = z.infer<typeof OpencodeModelEntrySchema>;

function fromOpencodeModel(modelId: string, model: OpencodeModelEntryShape): RulesyncModel {
  return {
    id: modelId,
    ...(model.name !== undefined && { name: model.name }),
    ...((model.limit?.context !== undefined || model.limit?.output !== undefined) && {
      limit: {
        ...(model.limit?.context !== undefined && { context: model.limit.context }),
        ...(model.limit?.output !== undefined && { output: model.limit.output }),
      },
    }),
    ...(model.tool_call !== undefined && { tool_call: model.tool_call }),
    ...(model.reasoning !== undefined && { reasoning: model.reasoning }),
    ...(model.modalities !== undefined && { modalities: model.modalities }),
  };
}

function fromOpencodeProviders(
  providers: Record<string, OpencodeProviderEntryShape>,
): Record<string, RulesyncModelProvider> {
  const out: Record<string, RulesyncModelProvider> = {};
  for (const [id, provider] of Object.entries(providers)) {
    // Defense in depth: the source schema rejects these keys, but this input
    // is a tool file, and `out[id] = ...` on `__proto__` would set the
    // prototype instead of an entry.
    if (isPrototypePollutionKey(id)) continue;
    const models: Record<string, RulesyncModel> = {};
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      if (isPrototypePollutionKey(modelId)) continue;
      models[modelId] = fromOpencodeModel(modelId, model);
    }
    const env = fromOpencodeApiKey(provider.options?.apiKey);
    out[id] = {
      ...(provider.name !== undefined && { name: provider.name }),
      ...(provider.options?.baseURL !== undefined && { api: provider.options.baseURL }),
      ...(env !== undefined && { env }),
      ...(provider.npm !== undefined && { npm: provider.npm }),
      models,
    };
  }
  return out;
}

export class OpencodeModels extends ToolModels {
  private readonly json: OpencodeConfig;

  constructor(params: ToolModelsParams) {
    super(params);
    this.json = OpencodeConfigSchema.parse(parseJsonc(this.fileContent || "{}"));
  }

  getJson(): OpencodeConfig {
    return this.json;
  }

  /**
   * opencode.json may contain other settings, so it should not be deleted.
   */
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

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolModelsFromFileParams): Promise<OpencodeModels> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = OPENCODE_JSONC_FILE_NAME;

    const jsoncPath = join(jsonDir, OPENCODE_JSONC_FILE_NAME);
    const jsonPath = join(jsonDir, OPENCODE_JSON_FILE_NAME);

    // Always try JSONC first (preferred format), then fall back to JSON
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = OPENCODE_JSON_FILE_NAME;
      }
    }

    const fileContentToUse = fileContent ?? '{"provider":{}}';
    const json = parseJsonc(fileContentToUse);
    const newJson = { ...json, provider: json.provider ?? {} };

    return new OpencodeModels({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  static async fromRulesyncModels({
    outputRoot = process.cwd(),
    rulesyncModels,
    validate = true,
    global = false,
    logger,
  }: ToolModelsFromRulesyncModelsParams): Promise<OpencodeModels> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = OPENCODE_JSONC_FILE_NAME;

    const jsoncPath = join(jsonDir, OPENCODE_JSONC_FILE_NAME);
    const jsonPath = join(jsonDir, OPENCODE_JSON_FILE_NAME);

    // Try JSONC first (preferred format), then fall back to JSON
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = OPENCODE_JSON_FILE_NAME;
      }
    }

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

  toRulesyncModels(): RulesyncModels {
    const defaultValue = fromOpencodeDefault(this.json.model);
    return this.toRulesyncModelsDefault({
      fileContent: JSON.stringify(
        {
          providers: fromOpencodeProviders(this.json.provider ?? {}),
          ...(defaultValue !== undefined && { default: defaultValue }),
        },
        null,
        2,
      ),
    });
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
