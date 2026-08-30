import { join } from "node:path";

import { uniq } from "es-toolkit";
import { z } from "zod/mini";

import { CLINE_DIR, CLINE_PERMISSIONS_FILE_NAME } from "../../constants/cline-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  collectShellCommandRules,
  createShadowingRestrictionsTest,
  SHELL_PERMISSION_CATEGORY,
} from "./shell-command-categories.js";
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

type ClineTranslationResult = {
  allow: string[];
  deny: string[];
  droppedCategories: string[];
  translatedAskPatterns: string[];
  shadowedAllowPatterns: string[];
  /**
   * All-tools `deny` patterns written into the denylist that withheld no allow
   * rule, so nothing observed says they name a command Cline can block.
   */
  unenforcedAllToolsDenyPatterns: string[];
  ignoredAllToolsAllowPatterns: string[];
};

/**
 * Translate rulesync permission categories into Cline allow/deny command lists.
 * The `bash` category maps, and so do the restricting rules of the all-tools
 * `*` category — a rule written there covers shell commands too. Other
 * categories and `ask` rules are tracked separately so a single translation
 * notice can be surfaced by the caller.
 */
function translateClinePermissions(
  permission: PermissionsConfig["permission"],
): ClineTranslationResult {
  const allow: string[] = [];
  const deny: string[] = [];
  const translatedAskPatterns: string[] = [];
  const shadowedAllowPatterns: string[] = [];

  const droppedCategories = Object.keys(permission).filter(
    (category) =>
      category !== SHELL_PERMISSION_CATEGORY && category !== ALL_TOOLS_PERMISSION_CATEGORY,
  );
  const { rules, ignoredAllToolsAllowPatterns } = collectShellCommandRules(permission);
  // Cline has no `ask` list, so an `ask` rule has to land somewhere else, and
  // where depends on the category that wrote it. A `bash` rule is a command
  // pattern by construction: its `ask` becomes a `deny`, and its `deny` is
  // written as it stands, where Cline's documented deny-priority enforces it and
  // the allow rules beside it keep working.
  //
  // A rule under the all-tools `*` need not name a command at all — `secrets/**`
  // there denies a path — so neither list can be trusted to enforce it: such an
  // entry matches no command. Both its `ask` and its `deny` therefore withhold
  // the `allow` rules they cover instead (the `deny` is still written, for the
  // case where it *is* a command). Translating the `ask` to `deny` outright would
  // turn the ordinary catch-all `{"*": {"*": "ask"}}` into a block on every
  // command — one Cline's additive `deny` merge would then keep forever.
  const shadowingRestrictions = createShadowingRestrictionsTest(
    rules.filter(({ fromAllToolsCategory }) => fromAllToolsCategory),
  );
  const allToolsDenyPatterns: string[] = [];
  const withholdingPatterns = new Set<string>();

  for (const { pattern, action, fromAllToolsCategory } of rules) {
    if (action === "ask") {
      if (fromAllToolsCategory) {
        continue;
      }
      // A `bash` ask is a command pattern by construction. Translate it to `deny`
      // for fail-closed safety so the protective intent of the rule is preserved
      // instead of being silently dropped.
      translatedAskPatterns.push(pattern);
      deny.push(pattern);
      continue;
    }
    if (action === "deny") {
      deny.push(pattern);
      if (fromAllToolsCategory) {
        allToolsDenyPatterns.push(pattern);
      }
      continue;
    }
    const shadowing = shadowingRestrictions(pattern);
    if (shadowing.length > 0) {
      shadowedAllowPatterns.push(pattern);
      for (const restriction of shadowing) {
        withholdingPatterns.add(restriction);
      }
      continue;
    }
    allow.push(pattern);
  }

  // A `*` deny that overlapped some allow rule restricts whatever it names. One
  // that overlapped none may be a path pattern sitting in a command denylist,
  // where it blocks nothing — the author wrote it to stop something, so say so.
  const unenforcedAllToolsDenyPatterns = uniq(allToolsDenyPatterns).filter(
    (pattern) => !withholdingPatterns.has(pattern),
  );

  return {
    allow,
    deny,
    droppedCategories,
    translatedAskPatterns,
    shadowedAllowPatterns,
    unenforcedAllToolsDenyPatterns,
    ignoredAllToolsAllowPatterns,
  };
}

/**
 * Surface a single aggregated translation notice via `logger.warn` so that
 * (a) CI gates that treat `error` lines as failures don't fail spuriously, matching the
 * project convention used by every other permissions translator, and
 * (b) the user still sees one prominent "WARNING" message describing the translation.
 */
function warnClineTranslationNotices({
  droppedCategories,
  translatedAskPatterns,
  shadowedAllowPatterns,
  unenforcedAllToolsDenyPatterns,
  ignoredAllToolsAllowPatterns,
  logger,
}: {
  droppedCategories: string[];
  translatedAskPatterns: string[];
  shadowedAllowPatterns: string[];
  unenforcedAllToolsDenyPatterns: string[];
  ignoredAllToolsAllowPatterns: string[];
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): void {
  if (
    droppedCategories.length === 0 &&
    translatedAskPatterns.length === 0 &&
    shadowedAllowPatterns.length === 0 &&
    unenforcedAllToolsDenyPatterns.length === 0 &&
    ignoredAllToolsAllowPatterns.length === 0
  ) {
    return;
  }
  const parts: string[] = [];
  if (droppedCategories.length > 0) {
    parts.push(
      `non-bash categories [${droppedCategories.join(", ")}] (Cline only enforces shell ` +
        `commands; use the rulesync ignore feature for read/write restrictions)`,
    );
  }
  if (translatedAskPatterns.length > 0) {
    parts.push(
      `'ask' rules for bash patterns [${translatedAskPatterns.join(", ")}] translated to ` +
        `'deny' for fail-closed safety, since Cline lacks 'ask'`,
    );
  }
  if (shadowedAllowPatterns.length > 0) {
    parts.push(
      `'allow' rules for [${shadowedAllowPatterns.join(", ")}] withheld because the ` +
        `all-tools '*' category restricts the same commands, and a pattern written there ` +
        `need not name a command Cline's own lists can act on. Cline's allowlist is a gate — ` +
        `once set, only the commands matching it run without approval — so withholding every ` +
        `entry leaves every command asking`,
    );
  }
  if (unenforcedAllToolsDenyPatterns.length > 0) {
    parts.push(
      `'deny' rules for [${unenforcedAllToolsDenyPatterns.join(", ")}] under the all-tools '*' ` +
        `category written into the denylist as they stand, where they withheld no allow rule — ` +
        `a pattern written there need not name a command, and a denylist entry that names none ` +
        `blocks nothing; write it under 'bash' if it is a command pattern`,
    );
  }
  if (ignoredAllToolsAllowPatterns.length > 0) {
    parts.push(
      `'allow' rules for [${ignoredAllToolsAllowPatterns.join(", ")}] under the all-tools '*' ` +
        `category skipped (only its deny and ask rules are read, since a pattern written ` +
        `there need not be a command); write them under 'bash' to auto-approve them`,
    );
  }
  logger?.warn(`WARNING: Cline command permissions translation notice: ${parts.join("; ")}.`);
}

export class ClinePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
    // Mirror `RulesyncPermissions` so that `fromFile({ validate: true })` actually
    // verifies schema conformance and throws on malformed input. Without this
    // wiring, the `validate()` method exists but is never invoked at construction
    // time, so callers reading `validate: true` would falsely assume validation
    // already ran.
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
    return {
      relativeDirPath: CLINE_DIR,
      relativeFilePath: CLINE_PERMISSIONS_FILE_NAME,
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
    const {
      allow,
      deny,
      droppedCategories,
      translatedAskPatterns,
      shadowedAllowPatterns,
      unenforcedAllToolsDenyPatterns,
      ignoredAllToolsAllowPatterns,
    } = translateClinePermissions(config.permission);

    warnClineTranslationNotices({
      droppedCategories,
      translatedAskPatterns,
      shadowedAllowPatterns,
      unenforcedAllToolsDenyPatterns,
      ignoredAllToolsAllowPatterns,
      logger,
    });

    const dedupedAllow = uniq(allow.toSorted());
    const dedupedDeny = uniq(deny.toSorted());

    // `deny` is additive (fail-closed): preserve any user-added denies in the existing file so a
    // regenerate that drops a pattern from `.rulesync/permissions.jsonc` does not silently weaken
    // the protective surface. `allow` remains wholesale-replaced because rulesync owns the
    // permissive surface and additive merges of `allow` would re-introduce removed permissions.
    const mergedDeny = uniq([...(existing.deny ?? []), ...dedupedDeny]).toSorted();

    const denySet = new Set(mergedDeny);
    const collisions = dedupedAllow.filter((p) => denySet.has(p));
    if (collisions.length > 0) {
      logger?.warn(
        `Cline command permissions: pattern(s) ${collisions
          .map((p) => `'${p}'`)
          .join(", ")} appear in both 'allow' and 'deny'. Cline documents that deny rules ` +
          `always take precedence, so the 'allow' entry has no effect. ` +
          `Consider removing the duplicate rule.`,
      );
    }

    // Precedence for the global `allowRedirects` flag: the rulesync `cline`
    // override wins, else preserve an existing hand-set value, else Cline's
    // default of `false`.
    const next: ClineCommandPermissions = {
      ...existing,
      allow: dedupedAllow,
      deny: mergedDeny,
      allowRedirects: config.cline?.allowRedirects ?? existing.allowRedirects ?? false,
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

    // Round-trip the Cline-only `allowRedirects` flag into the `cline` override
    // when it is enabled (the default `false` needs no override entry).
    if (parsed.allowRedirects === true) {
      config.cline = { allowRedirects: true };
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }

  validate(): ValidationResult {
    // Mirror Kilo's `safeParse`-based pattern: actually verify that the file
    // content is JSON-parseable and conforms to the Cline command-permissions
    // schema. A no-op validate would let malformed files slip past the
    // generate/import boundary and surface as confusing errors deeper in the
    // pipeline.
    try {
      const parsed = JSON.parse(this.fileContent || "{}");
      const result = ClineCommandPermissionsSchema.safeParse(parsed);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Cline permissions JSON: ${formatError(error)}`),
      };
    }
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
