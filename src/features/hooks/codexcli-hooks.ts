import { join } from "node:path";

import * as smolToml from "smol-toml";

import {
  CODEXCLI_DIR,
  CODEXCLI_HOOKS_FILE_NAME,
  CODEXCLI_MCP_FILE_NAME,
} from "../../constants/codexcli-paths.js";
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
 * Build the content for `.codex/config.toml`, cleaning up the deprecated `codex_hooks` key.
 * Reads the existing file (if any), parses TOML, and returns the content without writing to
 * disk. The caller is responsible for writing via the normal write phase.
 *
 * Hooks are GA and enabled by default in Codex CLI, so `[features] hooks = true` is no longer
 * required and is intentionally NOT force-written here (doing so used to be harmless/idempotent,
 * but is now redundant and could mask a user's own `hooks = false` opt-out on a later edit).
 * See https://developers.openai.com/codex/hooks. Only the legacy `codex_hooks` alias — superseded
 * by `hooks` — is still cleaned up.
 */
async function buildCodexConfigTomlContent({
  outputRoot,
}: {
  outputRoot: string;
}): Promise<string> {
  const configPath = join(outputRoot, CODEXCLI_DIR, CODEXCLI_MCP_FILE_NAME);
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

  if (typeof configToml.features === "object" && configToml.features !== null) {
    delete (configToml.features as smolToml.TomlTable).codex_hooks;
  }

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

  static async fromOutputRoot({ outputRoot }: { outputRoot: string }): Promise<CodexcliConfigToml> {
    const fileContent = await buildCodexConfigTomlContent({ outputRoot });
    return new CodexcliConfigToml({
      outputRoot,
      relativeDirPath: CODEXCLI_DIR,
      relativeFilePath: CODEXCLI_MCP_FILE_NAME,
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
    return { relativeDirPath: CODEXCLI_DIR, relativeFilePath: CODEXCLI_HOOKS_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolHooksFromFileParams): Promise<CodexcliHooks> {
    const paths = CodexcliHooks.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"hooks":{}}';
    return new CodexcliHooks({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncHooks({
    outputRoot = process.cwd(),
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
      outputRoot,
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
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolHooksForDeletionParams): CodexcliHooks {
    return new CodexcliHooks({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false,
    });
  }

  static async getAuxiliaryFiles({
    outputRoot = process.cwd(),
  }: {
    outputRoot?: string;
    global?: boolean;
  } = {}): Promise<ToolFile[]> {
    return [await CodexcliConfigToml.fromOutputRoot({ outputRoot })];
  }
}
