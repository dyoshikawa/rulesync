import { join } from "node:path";

import { KIMI_CODE_CONFIG_FILE_NAME, KIMI_CODE_DIR } from "../../constants/kimi-code-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { readFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
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

const KIMI_CODE_TOOL_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_TO_KIMI_CODE_TOOL).map(([category, tool]) => [tool, category]),
);

function buildKimiCodePattern(category: string, pattern: string): string | null {
  if (category.startsWith("mcp__")) {
    return category;
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
  const result: KimiCodePermissionRule[] = [];
  const overrideRules = config["kimi-code"]?.rules ?? [];
  result.push(...overrideRules);

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
      const kimiCodePattern = buildKimiCodePattern(category, pattern);
      if (!kimiCodePattern) {
        continue;
      }
      result.push({
        decision,
        pattern: kimiCodePattern,
        scope: "user",
      });
    }
  }
  return result;
}

function parseKimiCodePattern(pattern: string): { category: string; pattern: string } | null {
  if (pattern.startsWith("mcp__")) {
    return pattern === "mcp__*"
      ? { category: "mcp", pattern: "*" }
      : { category: pattern, pattern: "*" };
  }
  const opening = pattern.indexOf("(");
  const hasArgument = opening >= 0 && pattern.endsWith(")");
  const tool = hasArgument ? pattern.slice(0, opening) : pattern;
  const category = KIMI_CODE_TOOL_TO_CATEGORY[tool];
  if (!category) {
    return null;
  }
  return {
    category,
    pattern: hasArgument ? pattern.slice(opening + 1, -1) : "*",
  };
}

function kimiCodeRulesToCanonical(rules: unknown): {
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
    const parsed = parseKimiCodePattern(pattern);
    const hasNativeOnlyFields =
      (typeof raw.scope === "string" && raw.scope !== "user") || typeof raw.reason === "string";
    if (!parsed || hasNativeOnlyFields) {
      nativeRules.push({
        decision,
        pattern,
        ...(typeof raw.scope === "string" && { scope: raw.scope }),
        ...(typeof raw.reason === "string" && { reason: raw.reason }),
      });
      continue;
    }
    const categoryRules = (permission[parsed.category] ??= {});
    // Kimi uses first-match-wins semantics. A later duplicate is unreachable,
    // so keep the first canonical value instead of reversing its effect.
    categoryRules[parsed.pattern] ??= decision;
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
      ...KimiCodePermissions.getSettablePaths(),
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: KIMI_CODE_DIR,
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
    const paths = KimiCodePermissions.getSettablePaths();
    this.fileContent = applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "permissions",
      existingContent: fileContent,
      patch: parseSharedConfig({ format: "toml", fileContent: this.fileContent }),
      filePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<KimiCodePermissions> {
    const paths = this.getSettablePaths();
    return new KimiCodePermissions({
      outputRoot,
      fileContent: await readFileContent(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      ),
      validate,
      global: true,
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
    const { permission, nativeRules } = kimiCodeRulesToCanonical(permissionConfig.rules);
    const defaultPermissionMode = config.default_permission_mode;
    const toolOverride = {
      ...(defaultPermissionMode === "manual" ||
      defaultPermissionMode === "yolo" ||
      defaultPermissionMode === "auto"
        ? { defaultPermissionMode }
        : {}),
      ...(nativeRules.length > 0 && { rules: nativeRules }),
    };
    return this.toRulesyncPermissionsDefault({
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
