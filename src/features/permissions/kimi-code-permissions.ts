import { join } from "node:path";

import { KIMI_CODE_CONFIG_FILE_NAME } from "../../constants/kimi-code-paths.js";
import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import {
  getKimiCodeConfigSharedFileKey,
  getKimiCodeRelativeDirPath,
  getKimiCodeSharedConfigWritePaths,
  getKimiCodeRulesyncOutputRoot,
} from "../../utils/kimi-code.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  KIMI_CODE_CONFIG_SHARED_FILE_KEY,
  parseSharedConfig,
  stringifySharedConfig,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions, withoutBlankPermissionPatterns } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

type KimiCodePermissionsParams = Omit<AiFileParams, "relativeDirPath" | "relativeFilePath">;

type KimiCodePermissionRule = {
  decision: PermissionAction;
  pattern: string;
  scope?: string;
  reason?: string;
};

const CATEGORY_TO_KIMI_CODE_TOOL: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  grep: "Grep",
  glob: "Glob",
  websearch: "WebSearch",
  webfetch: "FetchURL",
  agent: "Agent",
};

function buildKimiCodePattern(category: string, pattern: string): string | null {
  if (category.startsWith("mcp__")) {
    return pattern === "*" || pattern === "" ? category : null;
  }
  if (category === "mcp") {
    return pattern === "*" || pattern === "" ? "mcp__*" : `mcp__${pattern}`;
  }
  const tool = CATEGORY_TO_KIMI_CODE_TOOL[category];
  if (!tool) {
    return null;
  }
  return pattern === "*" || pattern === "" ? tool : `${tool}(${pattern})`;
}

/**
 * Merge the authored `[tools]` entries over whatever the existing `config.toml`
 * already had. Every value is carried through exactly as it stands, including
 * an empty list: for Kimi, `enabled = []` is an allowlist admitting nothing —
 * the strictest possible setting — while the key being absent means no
 * allowlist at all. Rewriting one into the other would silently unlock every
 * tool, so nothing here is normalized or dropped.
 *
 * Returns `undefined` when neither side has anything, leaving the key unwritten.
 */
function mergeKimiCodeToolsSection({
  existingContent,
  patch,
}: {
  existingContent: string;
  patch: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  let existing: unknown;
  try {
    existing = parseSharedConfig({ format: "toml", fileContent: existingContent }).tools;
  } catch {
    existing = undefined;
  }
  const merged: Record<string, unknown> = {
    ...(isRecord(existing) ? existing : {}),
    ...(isRecord(patch.tools) ? patch.tools : {}),
  };
  if (Object.keys(merged).length === 0) {
    return undefined;
  }
  warnAboutMistypedToolLists(merged);
  return merged;
}

/**
 * Build Kimi's `[tools]` section from a rulesync override, or read one back on
 * import. Entries pass through verbatim: the section uses agent-file tool syntax
 * (exact built-in names, `mcp__server__*` globs), not the canonical
 * category/pattern shape, and an empty list is a meaningful setting rather than
 * an omission.
 *
 * On import the two lists rulesync models are only carried across when they are
 * string arrays, because that is what the override schema accepts; a
 * hand-written value of some other type stays in `config.toml`, which the merge
 * above preserves.
 *
 * Note that this section is registered in Kimi's v2 engine, so today it applies
 * under `kimi web` and experimental `kimi -p` rather than the interactive TUI.
 *
 * @see https://moonshotai.github.io/kimi-code/en/configuration/config-files.html#tools
 */
function buildKimiCodeToolsSection(tools: unknown): Record<string, unknown> | undefined {
  if (!isRecord(tools)) {
    return undefined;
  }
  const section = Object.fromEntries(
    Object.entries(tools).filter(([key, value]) =>
      key === "enabled" || key === "disabled" ? isStringList(value) : true,
    ),
  );
  return Object.keys(section).length > 0 ? section : undefined;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Report a `[tools]` list carried through with a type Kimi does not accept.
 * The value is kept — deleting a user's setting to work around their typo would
 * be worse — but Kimi validates the section as a whole, so a bad sibling value can
 * take rulesync's own list down with it. rulesync is the only party that sees
 * both, so it says so.
 */
function warnAboutMistypedToolLists(section: Record<string, unknown>): void {
  for (const key of ["enabled", "disabled"] as const) {
    if (key in section && !isStringList(section[key])) {
      warnWithFallback(
        undefined,
        `Kimi Code permissions: \`[tools] ${key}\` in ${KIMI_CODE_CONFIG_SHARED_FILE_KEY} is not a list of strings. It is left as written, but Kimi may reject the whole \`[tools]\` section — including entries rulesync generated.`,
      );
    }
  }
}

function canonicalToKimiCodeRules({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): KimiCodePermissionRule[] {
  const canonicalRules: KimiCodePermissionRule[] = [];
  const overrideRules = config["kimi-code"]?.rules ?? [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const isSupported =
      category === "mcp" ||
      category.startsWith("mcp__") ||
      CATEGORY_TO_KIMI_CODE_TOOL[category] !== undefined;
    if (!isSupported) {
      if (Object.keys(rules).length > 0) {
        logger?.warn(`Kimi Code permissions: skipping unsupported category "${category}".`);
      }
      continue;
    }
    for (const [pattern, decision] of Object.entries(rules)) {
      if (category.startsWith("mcp__") && pattern !== "*" && pattern !== "") {
        if (decision === "deny") {
          logger?.warn(
            `Kimi Code permissions: broadening argument-specific deny for "${category}" to the whole MCP tool because Kimi does not match MCP tool arguments.`,
          );
          canonicalRules.push({
            decision,
            pattern: category,
            scope: "user",
          });
        } else {
          logger?.warn(
            `Kimi Code permissions: skipping argument-specific ${decision} for "${category}" because Kimi does not match MCP tool arguments.`,
          );
        }
        continue;
      }
      const kimiCodePattern = buildKimiCodePattern(category, pattern);
      if (!kimiCodePattern) {
        continue;
      }
      canonicalRules.push({
        decision,
        pattern: kimiCodePattern,
        scope: "user",
      });
    }
  }
  return [...overrideRules, ...sortKimiCodeRulesFailClosed(canonicalRules)];
}

function getKimiCodePatternSpecificity(pattern: string): {
  tool: string;
  toolLiteralLength: number;
  toolWildcardCount: number;
  literalLength: number;
  wildcardCount: number;
  hasArguments: boolean;
} {
  const opening = pattern.indexOf("(");
  const hasArguments = opening >= 0 && pattern.endsWith(")");
  const tool = hasArguments ? pattern.slice(0, opening) : pattern;
  const argument = hasArguments ? pattern.slice(opening + 1, -1) : "";
  return {
    tool,
    toolLiteralLength: tool.replaceAll("*", "").replaceAll("?", "").length,
    toolWildcardCount: [...tool].filter((character) => "*?".includes(character)).length,
    literalLength: argument
      .replaceAll("*", "")
      .replaceAll("?", "")
      .replaceAll("[", "")
      .replaceAll("]", "").length,
    wildcardCount: [...argument].filter((character) => "*?[]".includes(character)).length,
    hasArguments,
  };
}

function sortKimiCodeRulesFailClosed(rules: KimiCodePermissionRule[]): KimiCodePermissionRule[] {
  const actionPriority: Record<PermissionAction, number> = {
    deny: 0,
    ask: 1,
    allow: 2,
  };
  return rules
    .map((rule, index) => ({
      rule,
      index,
      specificity: getKimiCodePatternSpecificity(rule.pattern),
    }))
    .toSorted((left, right) => {
      const actionOrder = actionPriority[left.rule.decision] - actionPriority[right.rule.decision];
      if (actionOrder !== 0) return actionOrder;
      if (left.specificity.tool.startsWith("mcp__") && right.specificity.tool.startsWith("mcp__")) {
        const toolLiteralOrder =
          right.specificity.toolLiteralLength - left.specificity.toolLiteralLength;
        if (toolLiteralOrder !== 0) return toolLiteralOrder;
        const toolWildcardOrder =
          left.specificity.toolWildcardCount - right.specificity.toolWildcardCount;
        if (toolWildcardOrder !== 0) return toolWildcardOrder;
      }
      const toolOrder = left.specificity.tool.localeCompare(right.specificity.tool);
      if (toolOrder !== 0) return toolOrder;
      if (left.specificity.hasArguments !== right.specificity.hasArguments) {
        return left.specificity.hasArguments ? -1 : 1;
      }
      const literalOrder = right.specificity.literalLength - left.specificity.literalLength;
      if (literalOrder !== 0) return literalOrder;
      const wildcardOrder = left.specificity.wildcardCount - right.specificity.wildcardCount;
      if (wildcardOrder !== 0) return wildcardOrder;
      return left.index - right.index;
    })
    .map(({ rule }) => rule);
}

function preserveKimiCodeRules(rules: unknown): {
  permission: PermissionsConfig["permission"];
  nativeRules: KimiCodePermissionRule[];
} {
  const permission: PermissionsConfig["permission"] = {};
  const nativeRules: KimiCodePermissionRule[] = [];
  if (!Array.isArray(rules)) {
    return { permission, nativeRules };
  }

  for (const raw of rules) {
    if (!isRecord(raw)) {
      continue;
    }
    const decision = raw.decision;
    const pattern = raw.pattern;
    if (
      (decision !== "allow" && decision !== "ask" && decision !== "deny") ||
      typeof pattern !== "string"
    ) {
      continue;
    }
    nativeRules.push({
      decision,
      pattern,
      ...(typeof raw.scope === "string" && { scope: raw.scope }),
      ...(typeof raw.reason === "string" && { reason: raw.reason }),
    });
  }

  return { permission, nativeRules };
}

/**
 * Kimi Code permission rules in the shared user `config.toml`.
 *
 * @see https://moonshotai.github.io/kimi-code/en/configuration/config-files.html
 */
export class KimiCodePermissions extends ToolPermissions {
  constructor(params: KimiCodePermissionsParams) {
    super({
      ...params,
      ...KimiCodePermissions.getSettablePaths({ global: params.global ?? true }),
    });
  }

  static getSettablePaths({
    global = true,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: getKimiCodeRelativeDirPath({ global }),
      relativeFilePath: KIMI_CODE_CONFIG_FILE_NAME,
    };
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  override isDeletable(): boolean {
    return false;
  }

  /**
   * `config.toml` under both spellings its directory can take.
   * @see getKimiCodeSharedConfigWritePaths
   */
  static getExtraSharedWritePaths(): SharedWritePath[] {
    return getKimiCodeSharedConfigWritePaths();
  }

  shouldMergeExistingFileContent(): boolean {
    return true;
  }

  setFileContent(fileContent: string): void {
    const paths = KimiCodePermissions.getSettablePaths({ global: this.global });
    const patch = parseSharedConfig({ format: "toml", fileContent: this.fileContent });
    // The gateway replaces an owned key wholesale, and `tools` is a table, so
    // it is recomputed from the existing file: authoring only `enabled` must
    // not delete a hand-written `disabled` list.
    const mergedTools = mergeKimiCodeToolsSection({ existingContent: fileContent, patch });
    this.fileContent = applySharedConfigPatch({
      fileKey: getKimiCodeConfigSharedFileKey({ global: this.global }),
      feature: "permissions",
      existingContent: fileContent,
      patch: { ...patch, ...(mergedTools && { tools: mergedTools }) },
      filePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = true,
  }: ToolPermissionsFromFileParams): Promise<KimiCodePermissions> {
    const paths = this.getSettablePaths({ global });
    return new KimiCodePermissions({
      outputRoot,
      fileContent: await readFileContent(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      ),
      validate,
      global,
    });
  }

  static fromRulesyncPermissions({
    outputRoot,
    rulesyncPermissions,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): KimiCodePermissions {
    const config = rulesyncPermissions.getJson();
    const defaultPermissionMode = config["kimi-code"]?.defaultPermissionMode;
    const tools = buildKimiCodeToolsSection(config["kimi-code"]?.tools);
    const document = {
      ...(defaultPermissionMode && {
        default_permission_mode: defaultPermissionMode,
      }),
      ...(tools && { tools }),
      permission: {
        rules: canonicalToKimiCodeRules({ config, logger }),
      },
    };

    let fileContent: string;
    try {
      fileContent = stringifySharedConfig({ format: "toml", document });
    } catch (error) {
      // The `kimi-code.tools` override is a passthrough block, so a value TOML
      // cannot represent (a null inside a list, say) reaches the serializer.
      // Name the file and the block, which the serializer's own message does not.
      throw new Error(
        `Failed to serialize ${KIMI_CODE_CONFIG_SHARED_FILE_KEY}; check the \`kimi-code.tools\` override for values TOML cannot represent: ${formatError(error)}`,
        { cause: error },
      );
    }

    return new KimiCodePermissions({
      outputRoot,
      fileContent,
      global: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const config = parseSharedConfig({
      format: "toml",
      fileContent: this.getFileContent(),
    });
    const permissionConfig = isRecord(config.permission) ? config.permission : {};
    const { permission, nativeRules } = preserveKimiCodeRules(permissionConfig.rules);
    const defaultPermissionMode = config.default_permission_mode;
    const tools = buildKimiCodeToolsSection(config.tools);
    const toolOverride = {
      ...(defaultPermissionMode === "manual" ||
      defaultPermissionMode === "yolo" ||
      defaultPermissionMode === "auto"
        ? { defaultPermissionMode }
        : {}),
      ...(nativeRules.length > 0 && { rules: nativeRules }),
      ...(tools && { tools }),
    };
    return new RulesyncPermissions({
      outputRoot: getKimiCodeRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: withoutBlankPermissionPatterns({
        fileContent: JSON.stringify(
          {
            permission,
            ...(Object.keys(toolOverride).length > 0 && {
              "kimi-code": toolOverride,
            }),
          },
          null,
          2,
        ),
      }),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
  }: ToolPermissionsForDeletionParams): KimiCodePermissions {
    return new KimiCodePermissions({
      outputRoot,
      fileContent: "",
      validate: false,
      global: true,
    });
  }
}
