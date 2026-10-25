import { join } from "node:path";

import {
  ROO_ALLOWED_COMMANDS_KEY,
  ROO_DENIED_COMMANDS_KEY,
  ROO_VSCODE_SETTINGS_DIR,
  ROO_VSCODE_SETTINGS_FILE_NAME,
} from "../../constants/roo-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  collectShellCommandRules,
  partitionCommandRules,
  warnAboutUnwrittenCommandRules,
  widenToPrefixGlob,
} from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";
import { buildVscodeCommandLists } from "./vscode-command-lists.js";

/**
 * The canonical category Roo Code's command lists correspond to. Roo Code gates
 * terminal command execution and nothing else through these settings, so only
 * `bash` maps; `read`/`write`/`edit`/`webfetch` have no workspace-settable
 * counterpart in the extension's contributions.
 */
const COMMAND_CATEGORY = "bash";

/**
 * Split the canonical `bash` rules — plus the restricting rules of the
 * all-tools `*` category, which cover shell commands too — into the two prefix
 * lists. `ask` has no list of its own: the extension prompts for whatever it
 * does not auto-approve, so an `ask` is honored by withholding every allow it
 * overlaps, compared at prefix width so a bare `git` allow is withheld by a
 * `git push` ask instead of auto-approving `git push`.
 */
function buildRooCommandLists({
  permission,
  toolLabel,
  surfaceLabel,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  toolLabel: string;
  surfaceLabel: string;
  logger?: Logger | undefined;
}): { allowed: string[]; denied: string[] | undefined } {
  const { rules, foreignRestrictingCategories, ignoredAllToolsAllowPatterns } =
    collectShellCommandRules(permission);
  const partition = partitionCommandRules({
    rules,
    writesAllToolsDeny: true,
    normalizePattern: widenToPrefixGlob,
  });
  warnAboutUnwrittenCommandRules({
    toolLabel,
    surfaceLabel,
    foreignRestrictingCategories,
    shadowedAllowPatterns: partition.shadowedAllowPatterns,
    unenforcedAllToolsDenyPatterns: partition.unenforcedAllToolsDenyPatterns,
    unenforcedAllToolsAskPatterns: partition.unenforcedAllToolsAskPatterns,
    ignoredAllToolsAllowPatterns,
    intersectionBudgetExhausted: partition.intersectionBudgetExhausted,
    logger,
  });

  const lists: Record<string, PermissionAction> = {};
  for (const pattern of partition.allow) {
    lists[pattern] = "allow";
  }
  for (const pattern of partition.deny) {
    lists[pattern] = "deny";
  }
  const { allowed, denied } = buildVscodeCommandLists({ rules: lists, toolLabel, logger });
  return {
    allowed: withholdAllowsOutrankingDenies({ allowed, denied, toolLabel, logger }),
    denied,
  };
}

/**
 * The extension resolves a command matching both lists by the longer match, so
 * an allow entry that extends a denied prefix (`git push` allowed, `git`
 * denied) auto-approves the commands it covers despite the deny — and so does
 * any allow beside a bare `*` deny, the extension's wildcard. Canonically the
 * deny wins whatever its width, so such an allow is withheld: the command then
 * hits the deny. A bare `*` allow never outranks a literal deny, so it is kept.
 */
function withholdAllowsOutrankingDenies({
  allowed,
  denied,
  toolLabel,
  logger,
}: {
  allowed: string[];
  denied: string[] | undefined;
  toolLabel: string;
  logger?: Logger | undefined;
}): string[] {
  if (denied === undefined) {
    return allowed;
  }
  const withheld: string[] = [];
  const kept = allowed.filter((allow) => {
    // Compared lowercased, as the extension does. A bare `*` deny is the
    // wildcard too, and any literal allow is a longer match than it.
    const loweredAllow = allow.toLowerCase();
    const outranks =
      allow !== "*" &&
      denied.some((deny) => {
        const loweredDeny = deny.toLowerCase();
        return (
          loweredDeny !== loweredAllow && (deny === "*" || loweredAllow.startsWith(loweredDeny))
        );
      });
    if (outranks) {
      withheld.push(allow);
    }
    return !outranks;
  });
  if (withheld.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel}: the allow rule(s) for ${withheld.join(", ")} extend a denied command ` +
        `prefix, and a longer allowed match wins over a shorter denied one, so they were ` +
        `withheld rather than auto-approve commands the deny covers.`,
    );
  }
  return kept;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

export type RooPermissionsParams = AiFileParams & {
  /** See {@link RooPermissions.shouldSkipCreationWhenPayloadEmpty}. */
  ownsCommandKeys?: boolean | undefined;
};

/**
 * Permissions generator for Roo Code, and the shared implementation for its
 * continuation fork (see {@link file://./zoocode-permissions.ts}).
 *
 * Roo Code has no policy file in its `.roo/` tree: the committable command
 * allow/deny lists are VS Code workspace settings
 * (`roo-cline.allowedCommands` / `roo-cline.deniedCommands` in
 * `.vscode/settings.json`), which `ClineProvider.mergeCommandLists()` unions
 * into the lists the auto-approval decision reads. That file is a
 * general-purpose workspace settings file with many unrelated keys, so reads
 * and writes merge into the existing JSONC (touching only the two managed keys)
 * and the file is never deleted.
 *
 * Only project scope is modeled: VS Code's user-scope `settings.json` lives at
 * a platform-dependent path outside rulesync's home-relative global model.
 *
 * The two lineages spell the same settings differently — the `roo-cline.*`
 * namespace here is what the archived Roo Code releases read, while the
 * continuation project renamed it to `zoo-code.*` in v3.74.0 — so the subclass
 * overrides nothing but the three name hooks below. Emitting the other
 * lineage's keys would write settings the targeted extension never reads, and
 * a project that enables both targets gets all four keys in one file.
 *
 * @see https://github.com/RooCodeInc/Roo-Code/blob/v3.54.0/src/package.json
 * @see https://github.com/RooCodeInc/Roo-Code/blob/v3.54.0/src/core/auto-approval/commands.ts
 * @see https://github.com/RooCodeInc/Roo-Code/blob/v3.54.0/src/core/webview/ClineProvider.ts
 */
export class RooPermissions extends ToolPermissions {
  /**
   * The settings key holding the auto-approval allowlist. Overridden by the
   * fork, whose namespace differs.
   */
  protected static getAllowedCommandsKey(): string {
    return ROO_ALLOWED_COMMANDS_KEY;
  }

  /** The settings key holding the auto-denial list. */
  protected static getDeniedCommandsKey(): string {
    return ROO_DENIED_COMMANDS_KEY;
  }

  /** Tool name used in parse errors and generate-time warnings. */
  protected static getToolLabel(): string {
    return "Roo Code";
  }

  /**
   * Whether this instance was produced from a canonical config that states the
   * `bash` category, i.e. one where rulesync owns the two command keys. Only
   * such an instance may create the settings file out of nothing; see
   * {@link shouldSkipCreationWhenPayloadEmpty}.
   */
  private readonly ownsCommandKeys: boolean;

  constructor({ ownsCommandKeys = false, ...params }: RooPermissionsParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
    this.ownsCommandKeys = ownsCommandKeys;
  }

  /**
   * An empty allow list is not an empty payload here — `[]` is precisely what
   * overrides the contributed `["git log", "git diff", "git show"]` default, so
   * a canonical config whose `bash` category grants nothing has to materialize
   * the file even when it did not exist. Skipping creation would leave those
   * three commands auto-approved and make the outcome depend on whether the
   * workspace happened to have a `.vscode/settings.json` already.
   *
   * When the category is not stated rulesync owns neither key, the patch is
   * `{}`, and the shared default applies again: no `.vscode/settings.json` is
   * conjured for a user who never asked for one.
   */
  override shouldSkipCreationWhenPayloadEmpty(): boolean {
    return this.ownsCommandKeys ? false : super.shouldSkipCreationWhenPayloadEmpty();
  }

  /**
   * `.vscode/settings.json` is a user-managed workspace file with unrelated
   * settings, so it must not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    // Project scope only. VS Code's user settings.json is at a platform-specific
    // path outside rulesync's home-relative global model.
    return {
      relativeDirPath: ROO_VSCODE_SETTINGS_DIR,
      relativeFilePath: ROO_VSCODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<RooPermissions> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new this({
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
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<RooPermissions> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    const permission = rulesyncPermissions.getJson().permission;
    // A canonical config that states no `bash` category leaves both keys
    // exactly as the user left them — adopting rulesync for other tools must
    // not wipe hand-authored command lists. Once the category IS stated,
    // rulesync owns both keys: the allow list is always written, `[]` included,
    // while an empty deny list retracts its key (a `undefined` patch value).
    // See `buildVscodeCommandLists` for why the two differ.
    //
    // The all-tools `*` category is still read once `bash` is stated: a `deny`
    // written there covers shell commands too, so it withholds (and is
    // written as) the overlapping bash allows, and categories this surface
    // cannot express are reported rather than dropped in silence. When `bash`
    // is unstated, Roo isn't managing these keys at all this generation (see
    // above), so resolving and warning about `*` restrictions would blame a
    // denylist that was never touched in the first place.
    const bashStated = permission[COMMAND_CATEGORY] !== undefined;
    const patch: Record<string, unknown> = {};
    if (bashStated) {
      const { allowed, denied } = buildRooCommandLists({
        permission,
        toolLabel: this.getToolLabel(),
        surfaceLabel: `${this.getAllowedCommandsKey()}/${this.getDeniedCommandsKey()}`,
        logger,
      });
      patch[this.getAllowedCommandsKey()] = allowed;
      patch[this.getDeniedCommandsKey()] = denied;
    }

    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      ownsCommandKeys: bashStated,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch,
        filePath,
      }),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const constructor = this.constructor as typeof RooPermissions;
    let settings: Record<string, unknown>;
    try {
      // VS Code settings.json is JSONC (comments / trailing commas allowed).
      // Fail-closed on a syntax error / non-mapping root, matching the write
      // path's shared-config declaration, so a broken file is surfaced rather
      // than partially imported.
      settings = parseSharedConfig({
        format: "jsonc",
        fileContent: this.getFileContent() || "{}",
        filePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
        invalidRootPolicy: "error",
        jsoncParseErrors: "error",
      });
    } catch (error) {
      throw new Error(
        `Failed to parse ${constructor.getToolLabel()} VS Code settings in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const rules: Record<string, PermissionAction> = {};
    for (const pattern of asStringArray(settings[constructor.getAllowedCommandsKey()])) {
      rules[pattern] = "allow";
    }
    // Applied second so a pattern listed in both lists imports as `deny`,
    // matching the extension's own precedence: with identical prefixes the
    // denied match is not shorter than the allowed one, and auto-approval
    // requires a strictly longer allowed match.
    for (const pattern of asStringArray(settings[constructor.getDeniedCommandsKey()])) {
      rules[pattern] = "deny";
    }

    const permission: Record<string, Record<string, PermissionAction>> = {};
    if (Object.keys(rules).length > 0) {
      permission[COMMAND_CATEGORY] = rules;
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permission }, null, 2),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): RooPermissions {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
