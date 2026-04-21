import { join } from "node:path";

import * as smolToml from "smol-toml";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  CODEXCLI_HOOK_EVENTS,
  CODEXCLI_TO_CANONICAL_EVENT_NAMES,
  CANONICAL_TO_CODEXCLI_EVENT_NAMES,
} from "../../types/hooks.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { RulesyncHooks } from "./rulesync-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import { canonicalToToolHooks, toolHooksToCanonical } from "./tool-hooks-converter.js";
import {
  ToolHooks,
  type ToolHooksForDeletionParams,
  type ToolHooksFromFileParams,
  type ToolHooksFromRulesyncHooksParams,
  type ToolHooksSettablePaths,
} from "./tool-hooks.js";

const CODEXCLI_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  supportedEvents: CODEXCLI_HOOK_EVENTS,
  canonicalToToolEventNames: CANONICAL_TO_CODEXCLI_EVENT_NAMES,
  toolToCanonicalEventNames: CODEXCLI_TO_CANONICAL_EVENT_NAMES,
  projectDirVar: "",
  supportedHookTypes: new Set(["command"]),
  passthroughFields: ["name", "description"],
};

/**
 * Build the content for `.codex/config.toml` with `[features] codex_hooks = true`.
 * Reads the existing file (if any), parses TOML, sets the flag, and returns the content
 * without writing to disk. The caller is responsible for writing via the normal write phase.
 */
async function buildCodexConfigTomlContent({ baseDir }: { baseDir: string }): Promise<string> {
  const configPath = join(baseDir, ".codex", "config.toml");
  const existingContent = (await readFileContentOrNull(configPath)) ?? smolToml.stringify({});
  let configToml: smolToml.TomlPrimitive;
  try {
    configToml = smolToml.parse(existingContent);
  } catch (error) {
    throw new Error(
      `Failed to parse existing Codex CLI config at ${configPath}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }

  if (typeof configToml.features !== "object" || configToml.features === null) {
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    configToml.features = {} as smolToml.TomlTable;
  }
  // eslint-disable-next-line no-type-assertion/no-type-assertion
  (configToml.features as smolToml.TomlTable).codex_hooks = true;

  return smolToml.stringify(configToml);
}

/**
 * Represents the `.codex/config.toml` file as a generated ToolFile,
 * so it goes through the normal write phase and respects dry-run mode.
 */
export class CodexcliConfigToml extends ToolFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromBaseDir({ baseDir }: { baseDir: string }): Promise<CodexcliConfigToml> {
    const fileContent = await buildCodexConfigTomlContent({ baseDir });
    return new CodexcliConfigToml({
      baseDir,
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
      fileContent,
    });
  }
}

export class CodexcliHooks extends ToolHooks {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolHooksSettablePaths {
    return { relativeDirPath: ".codex", relativeFilePath: "hooks.json" };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<CodexcliHooks> {
    const paths = CodexcliHooks.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new CodexcliHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncHooks({
    baseDir = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false,
  }: ToolHooksFromRulesyncHooksParams & { global?: boolean }): Promise<CodexcliHooks> {
    const paths = CodexcliHooks.getSettablePaths({ global });
    const config = rulesyncHooks.getJson();
    const codexHooks = canonicalToToolHooks({
      config,
      toolOverrideHooks: config.codexcli?.hooks,
      converterConfig: CODEXCLI_CONVERTER_CONFIG,
    });
    const fileContent = JSON.stringify({ hooks: codexHooks }, null, 2);

    return new CodexcliHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncHooks(): RulesyncHooks {
    let parsed: { hooks?: unknown };
    try {
      parsed = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Codex CLI hooks content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }
    const hooks = toolHooksToCanonical({
      hooks: parsed.hooks,
      converterConfig: CODEXCLI_CONVERTER_CONFIG,
    });
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify({ version: 1, hooks }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): CodexcliHooks {
    return new CodexcliHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }

  static async getAuxiliaryFiles({
    baseDir = process.cwd(),
  }: {
    baseDir?: string;
    global?: boolean;
  } = {}): Promise<ToolFile[]> {
    return [await CodexcliConfigToml.fromBaseDir({ baseDir })];
  }
}
