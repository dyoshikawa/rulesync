import { join } from "node:path";

import { uniq } from "es-toolkit";
import { z } from "zod/mini";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * Cline CLI loads command permissions from the `CLINE_COMMAND_PERMISSIONS` environment variable.
 * Cline supports only `allow` and `deny` (no `ask`), and only for shell commands.
 * Schema:
 * ```json
 * { "allow": ["pattern1", ...], "deny": ["pattern2", ...], "allowRedirects": false }
 * ```
 *
 * Rulesync writes the JSON to `.cline/command-permissions.json` so users can do:
 * `export CLINE_COMMAND_PERMISSIONS=$(cat .cline/command-permissions.json)`
 */

const ClineCommandPermissionsSchema = z.looseObject({
  allow: z.optional(z.array(z.string())),
  deny: z.optional(z.array(z.string())),
  allowRedirects: z.optional(z.boolean()),
});

type ClineCommandPermissions = z.infer<typeof ClineCommandPermissionsSchema>;

export class ClinePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: ".cline",
      relativeFilePath: "command-permissions.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<ClinePermissions> {
    const paths = ClinePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new ClinePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    global = false,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<ClinePermissions> {
    const paths = ClinePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    let existing: ClineCommandPermissions;
    try {
      const parsed = JSON.parse(existingContent);
      const result = ClineCommandPermissionsSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(formatError(result.error));
      }
      existing = result.data;
    } catch (error) {
      throw new Error(
        `Failed to parse existing Cline command-permissions at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const allow: string[] = [];
    const deny: string[] = [];

    for (const [category, rules] of Object.entries(config.permission)) {
      if (category !== "bash") {
        // Strong warning: Cline does not support non-shell categories at all, so the user's intent
        // for `read` / `edit` / `write` / `webfetch` / `websearch` deny rules is silently dropped.
        // Use `error` rather than `warn` to make this conspicuous in CI logs. Cline cannot enforce
        // these so users should rely on a different tool (e.g. ignore feature) to constrain reads.
        logger?.error(
          `Cline command permissions only support shell commands. Category '${category}' is ` +
            `dropped entirely; Cline cannot enforce it. Consider using the rulesync ignore feature ` +
            `for read/write restrictions.`,
        );
        continue;
      }
      for (const [pattern, action] of Object.entries(rules)) {
        if (action === "ask") {
          // `ask` cannot be expressed in Cline (which only knows allow/deny), so the rule is
          // dropped. Surface as `error` to make the silent loss visible.
          logger?.error(
            `Cline command permissions do not support 'ask'. Skipping rule: bash:${pattern}. ` +
              `Cline cannot prompt the user for shell commands.`,
          );
          continue;
        }
        if (action === "allow") {
          allow.push(pattern);
        } else if (action === "deny") {
          deny.push(pattern);
        }
      }
    }

    const dedupedAllow = uniq(allow.toSorted());
    const dedupedDeny = uniq(deny.toSorted());
    const denySet = new Set(dedupedDeny);
    const collisions = dedupedAllow.filter((p) => denySet.has(p));
    if (collisions.length > 0) {
      logger?.warn(
        `Cline command permissions: pattern(s) ${collisions
          .map((p) => `'${p}'`)
          .join(", ")} appear in both 'allow' and 'deny'. Cline's evaluation order is not ` +
          `documented to guarantee deny-priority; the resulting behavior is undefined. ` +
          `Consider removing the duplicate rule from rulesync.`,
      );
    }

    const next: ClineCommandPermissions = {
      ...existing,
      allow: dedupedAllow,
      deny: dedupedDeny,
      allowRedirects: existing.allowRedirects ?? false,
    };

    return new ClinePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(next, null, 2),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let parsed: ClineCommandPermissions;
    try {
      const json = JSON.parse(this.getFileContent());
      const result = ClineCommandPermissionsSchema.safeParse(json);
      if (!result.success) {
        throw new Error(formatError(result.error));
      }
      parsed = result.data;
    } catch (error) {
      throw new Error(
        `Failed to parse Cline permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const bashRules: Record<string, PermissionAction> = {};
    for (const pattern of parsed.allow ?? []) {
      bashRules[pattern] = "allow";
    }
    for (const pattern of parsed.deny ?? []) {
      bashRules[pattern] = "deny";
    }

    const config: PermissionsConfig =
      Object.keys(bashRules).length > 0 ? { permission: { bash: bashRules } } : { permission: {} };

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): ClinePermissions {
    return new ClinePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ allow: [], deny: [], allowRedirects: false }, null, 2),
      validate: false,
    });
  }
}
