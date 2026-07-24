import { join } from "node:path";

import { KIMI_CODE_CONFIG_FILE_NAME } from "../../constants/kimi-code-paths.js";
import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { readFileContent } from "../../utils/file.js";
import {
  getKimiCodeRelativeDirPath,
  getKimiCodeRulesyncOutputRoot,
} from "../../utils/kimi-code.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  KIMI_CODE_CONFIG_SHARED_FILE_KEY,
  parseSharedConfig,
  stringifySharedConfig,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
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

  shouldMergeExistingFileContent(): boolean {
    return true;
  }

  setFileContent(fileContent: string): void {
    const paths = KimiCodePermissions.getSettablePaths({ global: this.global });
    this.fileContent = applySharedConfigPatch({
      fileKey: KIMI_CODE_CONFIG_SHARED_FILE_KEY,
      feature: "permissions",
      existingContent: fileContent,
      patch: parseSharedConfig({ format: "toml", fileContent: this.fileContent }),
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
    return new KimiCodePermissions({
      outputRoot,
      fileContent: stringifySharedConfig({
        format: "toml",
        document: {
          ...(defaultPermissionMode && {
            default_permission_mode: defaultPermissionMode,
          }),
          permission: {
            rules: canonicalToKimiCodeRules({ config, logger }),
          },
        },
      }),
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
    const toolOverride = {
      ...(defaultPermissionMode === "manual" ||
      defaultPermissionMode === "yolo" ||
      defaultPermissionMode === "auto"
        ? { defaultPermissionMode }
        : {}),
      ...(nativeRules.length > 0 && { rules: nativeRules }),
    };
    return new RulesyncPermissions({
      outputRoot: getKimiCodeRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
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
