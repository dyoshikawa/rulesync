import { join } from "node:path";

import { OMP_CONFIG_FILE_NAME, OMP_DIR, OMP_GLOBAL_DIR } from "../../constants/omp-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { honorAllToolsOnBash } from "./shell-command-categories.js";
import {
  collapseRulesToSingleAction,
  hasPatternSpecificRules,
  PERMISSION_ACTION_PRIORITY,
} from "./single-action-collapse.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

type OmpApproval = "allow" | "prompt" | "deny";

type OmpBashPattern = { match: string; approval: OmpApproval };

const CATCH_ALL_PATTERN = "*";
const ALL_TOOLS_CATEGORY = "*";
const BASH_CATEGORY = "bash";

const ACTION_TO_OMP_APPROVAL: Record<PermissionAction, OmpApproval> = {
  allow: "allow",
  ask: "prompt",
  deny: "deny",
};

const OMP_APPROVAL_TO_ACTION: Record<OmpApproval, PermissionAction> = {
  allow: "allow",
  prompt: "ask",
  deny: "deny",
};

// Canonical categories whose oh-my-pi tool has a different name. Every other
// canonical category with a built-in tool (`bash`, `read`, `edit`, `write`,
// `grep`, `glob`) keeps its name, and an unknown category (an MCP tool, or an
// omp-only tool such as `eval`) is written verbatim as the `tools.approval` key.
// https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/tools/builtin-names.ts
const CATEGORY_TO_OMP_TOOL: Record<string, string> = {
  websearch: "web_search",
  agent: "task",
};

const OMP_TOOL_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_TO_OMP_TOOL).map(([category, tool]) => [tool, category]),
);

// Canonical categories with no oh-my-pi tool to key a policy on: web pages are
// fetched through `read` (or a mounted device), and there is no notebook tool.
const UNSUPPORTED_CATEGORIES: ReadonlySet<string> = new Set(["webfetch", "notebookedit"]);

// The `tools.approval` keys rulesync manages. They are rewritten on every
// generate (so a rule removed from the source disappears), while any other key
// — an `eval` or `computer` policy written by hand — is kept.
const MANAGED_OMP_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "read",
  "edit",
  "write",
  "grep",
  "glob",
  "web_search",
  "task",
]);

/**
 * Permissions adapter for oh-my-pi (`omp`).
 *
 * oh-my-pi reads approval policy from `config.yml`: `<cwd>/.omp/config.yml` in
 * project scope and `~/.omp/agent/config.yml` (default profile) globally.
 *
 * - `tools.approval.<tool>: allow | prompt | deny` is a per-tool policy honored
 *   in every approval mode. A category's catch-all `*` rule maps here
 *   (`ask` → `prompt`). oh-my-pi has no per-path matcher, so a non-bash category
 *   with pattern-specific rules collapses to one action (deny > ask > allow, with
 *   an implicit `ask` when there is no catch-all) and a warning.
 * - `bash.patterns: [{ match, approval }]` is an ordered, first-match-wins list
 *   of command globs (only `*` is a wildcard). Every `bash` rule except a
 *   catch-all `allow` is written there, ordered deny → prompt → allow so that
 *   the first match agrees with rulesync's deny > ask > allow precedence. A
 *   catch-all `allow` goes to `tools.approval.bash` instead, because an `allow`
 *   pattern never approves a compound command line while the tool policy does.
 *
 * `config.yml` carries every other oh-my-pi setting, so only `tools.approval`
 * (the keys rulesync manages) and `bash.patterns` are rewritten; sibling keys
 * such as `tools.approvalMode` and `bash.enabled` are kept, and the file is
 * never deleted.
 *
 * @see https://github.com/can1357/oh-my-pi/blob/main/docs/settings.md
 * @see https://github.com/can1357/oh-my-pi/blob/main/docs/approval-mode.md
 */
export class OmpPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  /** `config.yml` holds unrelated user settings, so it must not be deleted. */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: global ? OMP_GLOBAL_DIR : OMP_DIR,
      relativeFilePath: OMP_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<OmpPermissions> {
    const paths = OmpPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new OmpPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<OmpPermissions> {
    const paths = OmpPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so generation stays side-effect-free under
    // `--dry-run`/`--check`; the write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parseSharedConfig({ format: "yaml", fileContent: existingContent, filePath });

    const { approval, patterns } = convertRulesyncToOmp({
      config: rulesyncPermissions.getJson(),
      logger,
    });

    const existingTools = isRecord(existing.tools) ? existing.tools : {};
    const keptApproval = isRecord(existingTools.approval)
      ? Object.fromEntries(
          Object.entries(existingTools.approval).filter(
            ([tool]) => !MANAGED_OMP_TOOLS.has(tool) && !Object.hasOwn(approval, tool),
          ),
        )
      : {};
    const nextApproval = { ...keptApproval, ...approval };
    const toolsSiblings = withoutKey(existingTools, "approval");
    const nextTools =
      Object.keys(nextApproval).length > 0
        ? { ...toolsSiblings, approval: nextApproval }
        : toolsSiblings;

    const existingBash = isRecord(existing.bash) ? existing.bash : {};
    const bashSiblings = withoutKey(existingBash, "patterns");
    const nextBash = patterns.length > 0 ? { ...bashSiblings, patterns } : bashSiblings;

    return new OmpPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        // An emptied block is removed rather than left as `tools: {}`.
        patch: {
          tools: Object.keys(nextTools).length > 0 ? nextTools : undefined,
          bash: Object.keys(nextBash).length > 0 ? nextBash : undefined,
        },
        filePath,
        logger,
      }),
      validate: true,
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let config: Record<string, unknown>;
    try {
      config = parseSharedConfig({ format: "yaml", fileContent: this.getFileContent() });
    } catch (error) {
      throw new Error(
        `Failed to parse oh-my-pi config in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(convertOmpToRulesync(config), null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolPermissionsForDeletionParams): OmpPermissions {
    return new OmpPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}

function withoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

// `Object.hasOwn` keeps an inherited name such as `toString` from resolving to
// a function instead of falling through to the name itself.
function renamed(map: Record<string, string>, name: string): string {
  return Object.hasOwn(map, name) ? (map[name] ?? name) : name;
}

function convertRulesyncToOmp({ config, logger }: { config: PermissionsConfig; logger?: Logger }): {
  approval: Record<string, OmpApproval>;
  patterns: OmpBashPattern[];
} {
  const approval: Record<string, OmpApproval> = {};
  const patterns: OmpBashPattern[] = [];

  for (const [category, rules] of Object.entries(honorAllToolsOnBash(config.permission))) {
    if (isPrototypePollutionKey(category) || Object.keys(rules).length === 0) {
      continue;
    }
    if (category === ALL_TOOLS_CATEGORY) {
      logger?.warn(
        'oh-my-pi has no all-tools approval key, so the "*" category is not written ' +
          "(its deny and ask rules still restrict bash commands).",
      );
      continue;
    }
    if (UNSUPPORTED_CATEGORIES.has(category)) {
      logger?.warn(
        `oh-my-pi has no "${category}" tool to set an approval policy on, so its rules were skipped.`,
      );
      continue;
    }

    if (category === BASH_CATEGORY) {
      for (const [pattern, action] of Object.entries(rules)) {
        if (isPrototypePollutionKey(pattern)) {
          continue;
        }
        if (pattern === CATCH_ALL_PATTERN && action === "allow") {
          approval.bash = "allow";
          continue;
        }
        if (/[?[]/.test(pattern)) {
          logger?.warn(
            `oh-my-pi matches only "*" as a wildcard, so "?" and "[" in the bash ${action} ` +
              `pattern "${pattern}" are matched literally.`,
          );
        }
        patterns.push({ match: pattern, approval: ACTION_TO_OMP_APPROVAL[action] });
      }
      continue;
    }

    const action = collapseRulesToSingleAction({ rules });
    if (action === undefined) {
      continue;
    }
    if (hasPatternSpecificRules(rules)) {
      logger?.warn(
        `oh-my-pi sets one approval policy per tool, so the pattern-specific "${category}" ` +
          `rules were collapsed to "${ACTION_TO_OMP_APPROVAL[action]}" (deny > ask > allow).`,
      );
    }
    approval[renamed(CATEGORY_TO_OMP_TOOL, category)] = ACTION_TO_OMP_APPROVAL[action];
  }

  // First match wins, so the strictest rules lead; the sort is stable, keeping
  // source order within an action.
  const order = (pattern: OmpBashPattern): number =>
    -PERMISSION_ACTION_PRIORITY[OMP_APPROVAL_TO_ACTION[pattern.approval]];
  patterns.sort((a, b) => order(a) - order(b));

  return { approval, patterns };
}

function toOmpApproval(value: unknown): OmpApproval | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  // oh-my-pi trims and case-normalizes policy strings and ignores invalid ones.
  const normalized = value.trim().toLowerCase();
  return Object.hasOwn(OMP_APPROVAL_TO_ACTION, normalized)
    ? (normalized as OmpApproval)
    : undefined;
}

function convertOmpToRulesync(config: Record<string, unknown>): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};
  const tools = isRecord(config.tools) ? config.tools : {};
  const bash = isRecord(config.bash) ? config.bash : {};

  const bashRules: Record<string, PermissionAction> = {};
  if (Array.isArray(bash.patterns)) {
    for (const entry of bash.patterns) {
      if (!isRecord(entry) || typeof entry.match !== "string") {
        continue;
      }
      // oh-my-pi collapses whitespace runs before matching, so `git  status`
      // and `git status` are one pattern.
      const match = entry.match.trim().replace(/\s+/gu, " ");
      const approval = toOmpApproval(entry.approval);
      // First match wins, so a later duplicate of a pattern is never consulted.
      if (match === "" || approval === undefined || Object.hasOwn(bashRules, match)) {
        continue;
      }
      if (isPrototypePollutionKey(match)) {
        continue;
      }
      bashRules[match] = OMP_APPROVAL_TO_ACTION[approval];
    }
  }

  if (isRecord(tools.approval)) {
    for (const [tool, value] of Object.entries(tools.approval)) {
      const approval = toOmpApproval(value);
      if (approval === undefined || tool.trim() === "" || isPrototypePollutionKey(tool)) {
        continue;
      }
      const action = OMP_APPROVAL_TO_ACTION[approval];
      if (tool === BASH_CATEGORY) {
        const current = bashRules[CATCH_ALL_PATTERN];
        if (
          current === undefined ||
          PERMISSION_ACTION_PRIORITY[action] > PERMISSION_ACTION_PRIORITY[current]
        ) {
          bashRules[CATCH_ALL_PATTERN] = action;
        }
        continue;
      }
      const category = renamed(OMP_TOOL_TO_CATEGORY, tool);
      permission[category] = { [CATCH_ALL_PATTERN]: action };
    }
  }

  if (Object.keys(bashRules).length > 0) {
    permission.bash = bashRules;
  }

  return { permission };
}
