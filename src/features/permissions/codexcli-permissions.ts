import { join } from "node:path";

import * as smolToml from "smol-toml";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionEntry } from "../../types/permissions.js";
import { joinPatternForBash } from "../../types/permissions.js";
import { readOrInitializeFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import type { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

// Codex CLI action mapping: canonical → codex
const CANONICAL_TO_CODEX_ACTION: Record<PermissionAction, string> = {
  allow: "allow",
  ask: "prompt",
  deny: "forbidden",
};

// Codex CLI action mapping: codex → canonical
const CODEX_TO_CANONICAL_ACTION: Record<string, PermissionAction> = {
  allow: "allow",
  prompt: "ask",
  forbidden: "deny",
};

type CodexPrefixRule = {
  pattern: Array<{ token: string }>;
  decision: string;
};

export class CodexcliPermissions extends ToolPermissions {
  private readonly toml: smolToml.TomlTable;

  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
      validate: false,
    });

    this.toml = this.fileContent ? smolToml.parse(this.fileContent) : {};

    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return { relativeDirPath: ".codex", relativeFilePath: "config.toml" };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<CodexcliPermissions> {
    const paths = this.getSettablePaths();
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = await readOrInitializeFileContent(filePath, smolToml.stringify({}));

    return new CodexcliPermissions({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncPermissions({
    baseDir = process.cwd(),
    rulesyncPermissions,
    validate = true,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<CodexcliPermissions> {
    const paths = this.getSettablePaths();
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(filePath, smolToml.stringify({}));
    const configToml = smolToml.parse(existingContent);

    const config = rulesyncPermissions.getJson();

    // Filter to bash-only entries; warn about skipped non-bash entries
    const bashEntries: PermissionEntry[] = [];
    const skippedTools = new Set<string>();

    for (const entry of config.permissions) {
      if (entry.tool === "bash") {
        bashEntries.push(entry);
      } else {
        skippedTools.add(entry.tool);
      }
    }

    if (skippedTools.size > 0) {
      logger.warn(
        `Codex CLI only supports bash permissions. Skipped tool(s): ${[...skippedTools].join(", ")}`,
      );
    }

    // Convert to Codex prefix_rules format
    const prefixRules: CodexPrefixRule[] = bashEntries.map((entry) => {
      // Omit trailing "*" tokens (prefix matching in Codex)
      const tokens = [...entry.pattern];
      while (tokens.length > 0 && tokens[tokens.length - 1] === "*") {
        tokens.pop();
      }

      return {
        pattern: tokens.map((t) => ({ token: t })),
        decision: CANONICAL_TO_CODEX_ACTION[entry.action],
      };
    });

    // Preserve existing config, replace rules.prefix_rules
    const existingRules =
      typeof configToml.rules === "object" && configToml.rules !== null
        ? // eslint-disable-next-line no-type-assertion/no-type-assertion
          (configToml.rules as Record<string, unknown>)
        : {};

    // eslint-disable-next-line no-type-assertion/no-type-assertion
    configToml.rules = {
      ...existingRules,
      prefix_rules: prefixRules,
    } as smolToml.TomlTable;

    return new CodexcliPermissions({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(configToml),
      validate,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const rules = this.toml.rules as Record<string, unknown> | undefined;
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const prefixRules = (rules?.prefix_rules ?? []) as CodexPrefixRule[];
    const entries: PermissionEntry[] = [];

    for (const rule of prefixRules) {
      const tokens = rule.pattern.map((p) => p.token);
      const action = CODEX_TO_CANONICAL_ACTION[rule.decision];
      if (!action) continue;

      // Reconstruct the pattern - add trailing "*" for prefix matching
      const pattern = tokens.length > 0 ? [...tokens, "*"] : ["*"];

      entries.push({
        tool: "bash",
        pattern,
        action,
      });
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permissions: entries }, null, 2),
    });
  }

  /**
   * Get the pattern as a human-readable string for Codex format
   */
  static formatPatternForDisplay(entry: PermissionEntry): string {
    return joinPatternForBash(entry.pattern);
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): CodexcliPermissions {
    return new CodexcliPermissions({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
