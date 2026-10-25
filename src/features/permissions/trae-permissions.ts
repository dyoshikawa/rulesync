import { join } from "node:path";

import { TRAE_PERMISSION_DIR_PATH, TRAE_PERMISSION_FILE_NAME } from "../../constants/trae-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
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
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const CUSTOM_PROFILES_KEY = "customProfiles";
const DEFAULT_CUSTOM_PROFILE_KEY = "defaultCustomProfile";
const APPROVAL_KEY = "approval";
const COMMAND_RULES_KEY = "commandRules";
const MCP_RULES_KEY = "mcpRules";
const RESOURCE_AUTHORIZATION_KEY = "resourceAuthorization";
const NETWORK_KEY = "network";

const BASH_CATEGORY = "bash";
const WEBFETCH_CATEGORY = "webfetch";
const MCP_TOOL_PREFIX = "mcp__";
const MCP_SEPARATOR = "__";
const CATCH_ALL_PATTERN = "*";
const REGEX_PREFIX = "r/";
const REGEX_SUFFIX = "/";

const ACTION_RANK: Record<PermissionAction, number> = { allow: 0, ask: 1, deny: 2 };

type NetworkAction = "allow" | "deny";
const NETWORK_ACTIONS: readonly NetworkAction[] = ["allow", "deny"];

function isPermissionAction(value: unknown): value is PermissionAction {
  return value === "allow" || value === "ask" || value === "deny";
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function escapeRegex(text: string): string {
  return text.replace(/[\\^$.|?*+()[\]{}/]/g, "\\$&");
}

/** Build the anchored TRAE regex rule (`r/^...$/`) a canonical glob stands for. */
function globToTraeRegex(pattern: string): string {
  const body = pattern.split(CATCH_ALL_PATTERN).map(escapeRegex).join(".*");
  return `${REGEX_PREFIX}^${body}$${REGEX_SUFFIX}`;
}

/**
 * Translate a canonical `bash` glob into a TRAE `commandRules` key. TRAE
 * matches a key exactly (`git status`), as a prefix when it ends in `*`
 * (`git add *`), or as a regex when it is written `r/.../`. A glob whose only
 * `*` is the trailing one is already a TRAE prefix rule and a glob without
 * `*` an exact one; every other glob (a bare `*`, an inner `*`, or a literal
 * that would read as `r/.../`) becomes an anchored regex.
 */
function toTraeCommandKey(pattern: string): string {
  const starCount = pattern.split(CATCH_ALL_PATTERN).length - 1;
  const looksLikeRegex = pattern.startsWith(REGEX_PREFIX) && pattern.endsWith(REGEX_SUFFIX);
  if (!looksLikeRegex && starCount === 0) {
    return pattern;
  }
  if (!looksLikeRegex && starCount === 1 && pattern.length > 1 && pattern.endsWith("*")) {
    return pattern;
  }
  return globToTraeRegex(pattern);
}

/**
 * Read a `commandRules` key back into a canonical `bash` glob, or `null` for a
 * key with no glob spelling: a regex rulesync did not write, or an exact key
 * with an inner `*` (TRAE matches that `*` literally).
 */
function fromTraeCommandKey(key: string): string | null {
  if (!(key.startsWith(REGEX_PREFIX) && key.endsWith(REGEX_SUFFIX) && key.length > 2)) {
    return toTraeCommandKey(key) === key ? key : null;
  }
  const body = key.slice(REGEX_PREFIX.length, -REGEX_SUFFIX.length);
  const anchored = body.match(/^\^([\s\S]*)\$$/);
  if (!anchored) {
    return null;
  }
  const glob = (anchored[1] ?? "")
    .split(".*")
    .map((part) => part.replace(/\\(.)/g, "$1"))
    .join(CATCH_ALL_PATTERN);
  return globToTraeRegex(glob) === key ? glob : null;
}

/**
 * Translate a canonical MCP category (`mcp__<server>__<tool>`,
 * `mcp__<server>__*` or `mcp__<server>`) into a TRAE `mcpRules` key
 * (`<server>__<tool>`, `<server>__*`, `<server>`). `null` when TRAE has no
 * spelling for it (`mcp__*`, which names no server).
 */
function toTraeMcpKey(category: string): string | null {
  const rest = category.slice(MCP_TOOL_PREFIX.length);
  const server = rest.split(MCP_SEPARATOR)[0] ?? "";
  if (server === "" || server.includes(CATCH_ALL_PATTERN)) {
    return null;
  }
  return rest;
}

/** Read a TRAE `mcpRules` key back into its canonical MCP category. */
function fromTraeMcpKey(key: string): string | null {
  if (key === "" || key.startsWith(MCP_SEPARATOR)) {
    return null;
  }
  return key.includes(MCP_SEPARATOR)
    ? `${MCP_TOOL_PREFIX}${key}`
    : `${MCP_TOOL_PREFIX}${key}${MCP_SEPARATOR}${CATCH_ALL_PATTERN}`;
}

function readRecord(
  source: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> {
  let current: unknown = source;
  for (const key of path) {
    if (!isRecord(current)) {
      return {};
    }
    current = current[key];
  }
  return isRecord(current) ? current : {};
}

/**
 * Return a copy of `root` with `value` at `path` (or the leaf removed when
 * `value` is `undefined`), creating the parent objects only when setting.
 */
function withPath(
  root: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) {
    return root;
  }
  const next = { ...root };
  if (rest.length === 0) {
    if (value === undefined) {
      delete next[head];
    } else {
      next[head] = value;
    }
    return next;
  }
  const child = next[head];
  if (!isRecord(child)) {
    if (value === undefined) {
      return next;
    }
    next[head] = withPath({}, rest, value);
    return next;
  }
  next[head] = withPath(child, rest, value);
  return next;
}

const COMMAND_RULES_PATH = [DEFAULT_CUSTOM_PROFILE_KEY, APPROVAL_KEY, COMMAND_RULES_KEY] as const;
const MCP_RULES_PATH = [DEFAULT_CUSTOM_PROFILE_KEY, APPROVAL_KEY, MCP_RULES_KEY] as const;

function setRanked(
  ranked: Map<string, PermissionAction>,
  key: string,
  action: PermissionAction,
): void {
  const existing = ranked.get(key);
  if (existing === undefined || ACTION_RANK[action] > ACTION_RANK[existing]) {
    ranked.set(key, action);
  }
}

/**
 * Rebuild `commandRules` from the canonical `bash` category. An existing
 * entry rulesync cannot read back (a hand-written regex) is kept, and the
 * `execEnv` of an entry this run rewrites is carried over.
 */
function buildCommandRules({
  bashRules,
  existing,
}: {
  bashRules: Record<string, PermissionAction>;
  existing: Record<string, unknown>;
}): Record<string, unknown> {
  const ranked = new Map<string, PermissionAction>();
  for (const [pattern, action] of Object.entries(bashRules)) {
    if (isPrototypePollutionKey(pattern)) {
      continue;
    }
    setRanked(ranked, toTraeCommandKey(pattern), action);
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (!ranked.has(key) && fromTraeCommandKey(key) === null) {
      result[key] = value;
    }
  }
  for (const [key, action] of ranked) {
    const previous = existing[key];
    const execEnv = isRecord(previous) ? previous.execEnv : undefined;
    result[key] = { approval: action, ...(typeof execEnv === "string" && { execEnv }) };
  }
  return result;
}

/**
 * Rebuild `mcpRules`: every MCP category of the canonical config is written,
 * and an existing entry whose category the config does not name is kept.
 */
function buildMcpRules({
  permission,
  existing,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  existing: Record<string, unknown>;
  logger?: Logger;
}): Record<string, unknown> {
  const ranked = new Map<string, PermissionAction>();
  const managedCategories = new Set<string>();
  for (const [category, rules] of Object.entries(permission)) {
    if (!category.startsWith(MCP_TOOL_PREFIX)) {
      continue;
    }
    const key = toTraeMcpKey(category);
    if (key === null) {
      logger?.warn(
        `TRAE permissions: skipping the '${category}' category — TRAE's mcpRules name an MCP server ('server', 'server__*' or 'server__tool').`,
      );
      continue;
    }
    managedCategories.add(category);
    for (const [pattern, action] of Object.entries(rules)) {
      if (pattern !== CATCH_ALL_PATTERN) {
        logger?.warn(
          `TRAE permissions: skipping the '${category}' rule '${pattern}' — TRAE matches MCP tools by name only.`,
        );
        continue;
      }
      setRanked(ranked, key, action);
    }
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existing)) {
    const category = fromTraeMcpKey(key);
    if (!ranked.has(key) && (category === null || !managedCategories.has(category))) {
      result[key] = value;
    }
  }
  for (const [key, action] of ranked) {
    result[key] = { approval: action };
  }
  return result;
}

/** Split the canonical `webfetch` rules into TRAE's network allow/deny lists. */
function buildNetworkLists({
  webfetchRules,
  logger,
}: {
  webfetchRules: Record<string, PermissionAction>;
  logger?: Logger;
}): Record<NetworkAction, string[]> {
  const ranked = new Map<string, PermissionAction>();
  for (const [pattern, action] of Object.entries(webfetchRules)) {
    if (isPrototypePollutionKey(pattern)) {
      continue;
    }
    if (pattern === CATCH_ALL_PATTERN) {
      logger?.warn(
        `TRAE permissions: skipping the 'webfetch' rule '*' — TRAE sets the default network policy in the custom permission mode ('customProfiles.defaultCustomProfile.network.default'), not in resourceAuthorization.`,
      );
      continue;
    }
    if (action === "ask") {
      logger?.warn(
        `TRAE permissions: skipping the 'webfetch' ask rule '${pattern}' — resourceAuthorization.network has only allow and deny lists.`,
      );
      continue;
    }
    setRanked(ranked, pattern, action);
  }
  const lists: Record<NetworkAction, string[]> = { allow: [], deny: [] };
  for (const [pattern, action] of ranked) {
    if (action === "allow" || action === "deny") {
      lists[action].push(pattern);
    }
  }
  return lists;
}

function warnUnmappedCategories({
  permission,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  logger?: Logger;
}): void {
  for (const category of Object.keys(permission)) {
    if (
      category !== BASH_CATEGORY &&
      category !== WEBFETCH_CATEGORY &&
      !category.startsWith(MCP_TOOL_PREFIX)
    ) {
      logger?.warn(
        `TRAE permissions: skipping the '${category}' category — TRAE's global permission file has no rule for it (only 'bash', 'webfetch' and 'mcp__*' are mapped).`,
      );
    }
  }
}

/** A rebuilt map, or `undefined` (remove the key) when it ended up empty. */
function nonEmpty<T extends object>(value: T): T | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

/**
 * The new `customProfiles` value: the existing one with `commandRules` and
 * `mcpRules` rebuilt for the categories the config names. The existing value
 * is returned untouched when the config names none of them.
 */
function buildCustomProfiles({
  existing,
  permission,
  logger,
}: {
  existing: unknown;
  permission: PermissionsConfig["permission"];
  logger?: Logger;
}): unknown {
  const bashRules = permission[BASH_CATEGORY];
  const managesMcp = Object.keys(permission).some((category) =>
    category.startsWith(MCP_TOOL_PREFIX),
  );
  if (bashRules === undefined && !managesMcp) {
    return existing;
  }
  let result: Record<string, unknown> = isRecord(existing) ? existing : {};
  if (bashRules !== undefined) {
    const commandRules = buildCommandRules({
      bashRules,
      existing: readRecord(result, COMMAND_RULES_PATH),
    });
    result = withPath(result, COMMAND_RULES_PATH, nonEmpty(commandRules));
  }
  if (managesMcp) {
    const mcpRules = buildMcpRules({
      permission,
      existing: readRecord(result, MCP_RULES_PATH),
      logger,
    });
    result = withPath(result, MCP_RULES_PATH, nonEmpty(mcpRules));
  }
  return existing === undefined ? nonEmpty(result) : result;
}

/**
 * The new `resourceAuthorization` value: the existing one with
 * `network.allow` / `deny` rebuilt from the `webfetch` category, or the
 * existing value untouched when the config has no `webfetch` category.
 */
function buildResourceAuthorization({
  existing,
  permission,
  logger,
}: {
  existing: unknown;
  permission: PermissionsConfig["permission"];
  logger?: Logger;
}): unknown {
  const webfetchRules = permission[WEBFETCH_CATEGORY];
  if (webfetchRules === undefined) {
    return existing;
  }
  const lists = buildNetworkLists({ webfetchRules, logger });
  let result: Record<string, unknown> = isRecord(existing) ? existing : {};
  for (const action of NETWORK_ACTIONS) {
    result = withPath(result, [NETWORK_KEY, action], nonEmpty(lists[action]));
  }
  return existing === undefined ? nonEmpty(result) : result;
}

/**
 * TRAE permissions (global scope only).
 *
 * TRAE keeps its global permission policy and its custom permission mode in
 * one user file, `~/.trae/permission/global.json`. Rulesync writes three parts
 * of it and leaves the rest (`shellSandbox`, `approval.reviewer`,
 * `sceneRules`, the default `filesystem` / `network` policy,
 * `resourceAuthorization.filesystem`) as it is:
 *
 * - `bash` → `customProfiles.defaultCustomProfile.approval.commandRules`,
 *   `{ "<pattern>": { "approval": "allow" | "ask" | "deny" } }`. A pattern is
 *   matched exactly, as a prefix when it ends in `*`, or as a regex written
 *   `r/.../`; other globs become anchored regexes.
 * - `mcp__<server>__<tool>` / `mcp__<server>__*` →
 *   `customProfiles.defaultCustomProfile.approval.mcpRules`
 *   (`<server>__<tool>` / `<server>__*`).
 * - `webfetch` domains → `resourceAuthorization.network.allow` / `deny`.
 *
 * The file is never deleted, and an unparseable file is an error rather than
 * being replaced.
 *
 * @see https://docs.trae.ai/ide/permission-and-approval?_lang=en
 * @see https://docs.trae.ai/ide/custom-global-permission-configuration-reference?_lang=en
 * @see https://docs.trae.ai/ide/custom-permission-mode-configuration-reference?_lang=en
 */
export class TraePermissions extends ToolPermissions {
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
      relativeDirPath: TRAE_PERMISSION_DIR_PATH,
      relativeFilePath: TRAE_PERMISSION_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = true,
  }: ToolPermissionsFromFileParams): Promise<TraePermissions> {
    const paths = TraePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new TraePermissions({
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
    global = true,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<TraePermissions> {
    const paths = TraePermissions.getSettablePaths({ global });
    const relativePath = join(paths.relativeDirPath, paths.relativeFilePath);
    const filePath = join(outputRoot, relativePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";
    const existing = parseTraePermissionConfig({ fileContent: existingContent, relativePath });

    const permission = honorAllToolsOnBash(rulesyncPermissions.getJson().permission);
    warnUnmappedCategories({ permission, logger });

    return new TraePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch: {
          [CUSTOM_PROFILES_KEY]: buildCustomProfiles({
            existing: existing[CUSTOM_PROFILES_KEY],
            permission,
            logger,
          }),
          [RESOURCE_AUTHORIZATION_KEY]: buildResourceAuthorization({
            existing: existing[RESOURCE_AUTHORIZATION_KEY],
            permission,
            logger,
          }),
        },
        filePath,
      }),
      validate: true,
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const config = parseTraePermissionConfig({
      fileContent: this.getFileContent() || "{}",
      relativePath: join(this.getRelativeDirPath(), this.getRelativeFilePath()),
    });
    const customProfiles = readRecord(config, [CUSTOM_PROFILES_KEY]);
    const permission: Record<string, Record<string, PermissionAction>> = {};
    const put = (category: string, pattern: string, action: PermissionAction) => {
      if (isPrototypePollutionKey(category) || isPrototypePollutionKey(pattern)) {
        return;
      }
      const rules = (permission[category] ??= {});
      const existing = rules[pattern];
      if (existing === undefined || ACTION_RANK[action] > ACTION_RANK[existing]) {
        rules[pattern] = action;
      }
    };

    for (const [key, value] of Object.entries(readRecord(customProfiles, COMMAND_RULES_PATH))) {
      const pattern = fromTraeCommandKey(key);
      const approval = isRecord(value) ? value.approval : undefined;
      if (pattern !== null && pattern.trim() !== "" && isPermissionAction(approval)) {
        put(BASH_CATEGORY, pattern, approval);
      }
    }
    for (const [key, value] of Object.entries(readRecord(customProfiles, MCP_RULES_PATH))) {
      const category = fromTraeMcpKey(key);
      const approval = isRecord(value) ? value.approval : undefined;
      if (category !== null && isPermissionAction(approval)) {
        put(category, CATCH_ALL_PATTERN, approval);
      }
    }
    const network = readRecord(config, [RESOURCE_AUTHORIZATION_KEY, NETWORK_KEY]);
    for (const action of NETWORK_ACTIONS) {
      for (const pattern of toStringList(network[action])) {
        if (pattern.trim() !== "") {
          put(WEBFETCH_CATEGORY, pattern, action);
        }
      }
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permission }, null, 2),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = true,
  }: ToolPermissionsForDeletionParams): TraePermissions {
    return new TraePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}

/**
 * Fail closed on a syntax error or non-object root, so a broken file is
 * surfaced rather than partially imported or overwritten.
 */
function parseTraePermissionConfig({
  fileContent,
  relativePath,
}: {
  fileContent: string;
  relativePath: string;
}): Record<string, unknown> {
  try {
    return parseSharedConfig({
      format: "json",
      fileContent,
      filePath: relativePath,
      invalidRootPolicy: "error",
    });
  } catch (error) {
    throw new Error(
      `Failed to parse TRAE permission config in ${relativePath}: ${formatError(error)}`,
      { cause: error },
    );
  }
}
