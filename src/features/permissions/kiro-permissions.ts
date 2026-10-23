import { join } from "node:path";

import { z } from "zod/mini";

import { KIRO_AGENTS_DIR_PATH, KIRO_HOOKS_FILE_NAME } from "../../constants/kiro-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  createShadowingRestrictionsTest,
  honorAllToolsOnBash,
} from "./shell-command-categories.js";
import { failSafeCatchAllAction } from "./single-action-collapse.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const KiroAgentSchema = z.looseObject({
  allowedTools: z.optional(z.array(z.string())),
  toolsSettings: z.optional(z.record(z.string(), z.unknown())),
});

type KiroAgent = z.infer<typeof KiroAgentSchema>;
const UnknownRecordSchema = z.record(z.string(), z.unknown());

// Shell settings driven by the canonical `bash` category (allow/deny command
// lists). Every OTHER `toolsSettings.shell` key (e.g. the auto-trust flags
// `autoAllowReadonly` / `denyByDefault`) has no canonical home and is authored /
// round-tripped through the `kiro` override instead.
const CANONICAL_SHELL_KEYS = new Set(["allowedCommands", "deniedCommands"]);

// `toolsSettings` keys fully driven by the canonical `permission` block (path
// allow/deny tables). The `kiro` override must NOT be able to author these, or
// it could silently clobber a canonical-generated `deniedPaths` and weaken a
// reviewed deny. `shell` is deliberately NOT here: it is partly canonical
// (command lists) and partly override (auto-trust flags), so it is allowed
// through with only its canonical leaves stripped.
const CANONICAL_TOOL_SETTINGS_KEYS = new Set(["read", "write", "grep", "glob"]);

export class KiroPermissions extends ToolPermissions {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: KIRO_AGENTS_DIR_PATH,
      relativeFilePath: KIRO_HOOKS_FILE_NAME,
    };
  }

  override isDeletable(): boolean {
    return false;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<KiroPermissions> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);
    return new KiroPermissions({
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
    validate = true,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<KiroPermissions> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    const parsedResult = KiroAgentSchema.safeParse(JSON.parse(existingContent));
    if (!parsedResult.success) {
      throw new Error(
        `Failed to parse existing Kiro agent config at ${filePath}: ${formatError(parsedResult.error)}`,
      );
    }

    const config = rulesyncPermissions.getJson();
    const next = buildKiroPermissionsFromRulesync({ config, logger, existing: parsedResult.data });

    return new KiroPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch: { allowedTools: next.allowedTools, toolsSettings: next.toolsSettings },
        filePath,
      }),
      validate,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let parsed: KiroAgent;
    try {
      parsed = KiroAgentSchema.parse(JSON.parse(this.getFileContent()));
    } catch (error) {
      throw new Error(
        `Failed to parse Kiro permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permission: PermissionsConfig["permission"] = {};
    const toolsSettings = parsed.toolsSettings ?? {};

    const shellRules = rulesFromArrays(
      asRecord(toolsSettings.shell),
      "allowedCommands",
      "deniedCommands",
    );
    if (Object.keys(shellRules).length > 0) permission.bash = shellRules;

    // read/write/grep/glob all use `{ allowedPaths, deniedPaths }` under their
    // own toolsSettings key, mapping 1:1 to the canonical category name.
    for (const category of ["read", "write", "grep", "glob"] as const) {
      const rules = rulesFromArrays(
        asRecord(toolsSettings[category]),
        "allowedPaths",
        "deniedPaths",
      );
      if (Object.keys(rules).length > 0) permission[category] = rules;
    }

    const allowedTools = new Set(parsed.allowedTools ?? []);
    if (allowedTools.has("web_fetch")) {
      permission.webfetch = { "*": "allow" };
    }
    if (allowedTools.has("web_search")) {
      permission.websearch = { "*": "allow" };
    }

    // Extract the Kiro-specific `toolsSettings` knobs with no canonical category
    // (shell auto-trust flags, the `aws` service lists, the `web_fetch` domain
    // trust arrays) into the `kiro` override so they round-trip and are authorable.
    const kiroOverride = extractKiroOverride(toolsSettings);

    const result: Record<string, unknown> = { permission };
    if (kiroOverride !== undefined) {
      result.kiro = kiroOverride;
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(result, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): KiroPermissions {
    return new KiroPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({}, null, 2),
      validate: false,
    });
  }
}

function buildKiroPermissionsFromRulesync({
  config,
  logger,
  existing,
}: {
  config: PermissionsConfig;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
  existing: KiroAgent;
}): KiroAgent {
  const nextAllowedTools = new Set(existing.allowedTools ?? []);
  const nextToolsSettings = { ...asRecord(existing.toolsSettings) };

  // Path/command categories map to a `{ <allowKey>: [], <denyKey>: [] }` table
  // under a `toolsSettings` key. `edit` and `write` both fold into `write`.
  // Kiro has no ask list: whatever its allow lists do not cover prompts, so an
  // `ask` is honored by withholding the allow entries it overlaps (collected in
  // `ask` and applied after the loop).
  const pathBuckets: Record<string, { allow: string[]; deny: string[]; ask: string[] }> = {};
  const pushPath = (key: string, action: PermissionAction, pattern: string): void => {
    const bucket = (pathBuckets[key] ??= { allow: [], deny: [], ask: [] });
    bucket[action].push(pattern);
  };
  const shell = { allowedCommands: [] as string[], deniedCommands: [] as string[] };
  const shellAsks: string[] = [];

  for (const [category, rules] of Object.entries(honorAllToolsOnBash(config.permission))) {
    if (category === "webfetch" || category === "websearch") {
      applyKiroWebPermission({
        category,
        rules,
        allToolsRules: config.permission["*"],
        nextAllowedTools,
        logger,
      });
      continue;
    }
    for (const [pattern, action] of Object.entries(rules)) {
      if (category === "bash") {
        if (action === "ask") {
          shellAsks.push(pattern);
        } else {
          (action === "allow" ? shell.allowedCommands : shell.deniedCommands).push(pattern);
        }
      } else if (category === "read" || category === "grep" || category === "glob") {
        pushPath(category, action, pattern);
      } else if (category === "edit" || category === "write") {
        pushPath("write", action, pattern);
      } else {
        logger?.warn(`Kiro permissions do not support category: ${category}. Skipping.`);
      }
    }
  }

  shell.allowedCommands = withholdAllowsCoveredByAsks({
    surface: "toolsSettings.shell.allowedCommands",
    allows: shell.allowedCommands,
    asks: shellAsks,
    logger,
  });
  withholdPathAllowsCoveredByRestrictions({ pathBuckets, config, logger });
  untrustToolsWithRestrictions({ nextAllowedTools, shellAsks, pathBuckets, config, logger });

  // `shell`/`read`/`write` are always emitted (even empty) to match the prior
  // behavior; `grep`/`glob` are only emitted when they carry a rule so existing
  // configs do not gain empty tables. For `shell`, preserve any non-canonical
  // flags already in the file (e.g. `autoAllowReadonly` / `denyByDefault`) rather
  // than clobbering the whole object with just the command lists — the `kiro`
  // override below then wins over them when it authors those flags.
  nextToolsSettings.shell = { ...preservedShellFlags(existing), ...shell };
  nextToolsSettings.read = pathTable(pathBuckets.read);
  nextToolsSettings.write = pathTable(pathBuckets.write);
  for (const key of ["grep", "glob"] as const) {
    const bucket = pathBuckets[key];
    if (bucket && (bucket.allow.length > 0 || bucket.deny.length > 0)) {
      nextToolsSettings[key] = pathTable(bucket);
    }
  }

  // Apply the `kiro` override: Kiro-specific `toolsSettings` knobs with no
  // canonical category (shell auto-trust flags, the `aws` service lists, the
  // `web_fetch` domain trust arrays). Deep-merge per `toolsSettings` key so the
  // override's leaf values win without discarding the canonical-generated
  // siblings (e.g. authoring `shell.autoAllowReadonly` keeps the generated
  // `shell.allowedCommands`).
  applyKiroOverride({ override: config.kiro, nextToolsSettings, logger });

  return {
    ...existing,
    allowedTools: [...nextAllowedTools].toSorted(),
    toolsSettings: nextToolsSettings,
  };
}

/**
 * Non-canonical `toolsSettings.shell` keys already present in the existing agent
 * config (everything except the canonical `allowed`/`deniedCommands`), so a
 * regenerate does not silently drop a hand-set `autoAllowReadonly` /
 * `denyByDefault` when no `kiro` override re-authors it.
 */
function preservedShellFlags(existing: KiroAgent): Record<string, unknown> {
  const existingShell = asRecord(asRecord(existing.toolsSettings).shell);
  const flags: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existingShell)) {
    if (!CANONICAL_SHELL_KEYS.has(key)) flags[key] = value;
  }
  return flags;
}

/**
 * Deep-merge the `kiro` override's `toolsSettings` block into the generated
 * settings, one `toolsSettings` key at a time so the override's leaf fields win
 * without clobbering canonical-generated siblings.
 *
 * Guards, so the override can only author the non-canonical surfaces it is meant
 * for and can never weaken a canonical-generated deny:
 * - prototype-pollution keys are skipped before being used as object keys;
 * - fully-canonical `toolsSettings` keys (`read`/`write`/`grep`/`glob`) are
 *   rejected outright with a warning (their paths are owned by the canonical
 *   `permission` block);
 * - for `shell` (partly canonical), the canonical command-list leaves
 *   (`allowed`/`deniedCommands`) are stripped from the override value so only the
 *   auto-trust flags merge.
 */
function applyKiroOverride({
  override,
  nextToolsSettings,
  logger,
}: {
  override: PermissionsConfig["kiro"];
  nextToolsSettings: Record<string, unknown>;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): void {
  const overrideToolsSettings = override?.toolsSettings;
  if (!isPlainObject(overrideToolsSettings)) return;
  for (const [key, value] of Object.entries(overrideToolsSettings)) {
    if (isPrototypePollutionKey(key)) continue;
    if (!isPlainObject(value)) continue;
    if (CANONICAL_TOOL_SETTINGS_KEYS.has(key)) {
      logger?.warn(
        `Kiro permissions: ignoring 'kiro.toolsSettings.${key}' override; '${key}' paths are driven by the canonical permission block.`,
      );
      continue;
    }
    const mergeValue =
      key === "shell"
        ? Object.fromEntries(
            Object.entries(value).filter(([leaf]) => !CANONICAL_SHELL_KEYS.has(leaf)),
          )
        : value;
    nextToolsSettings[key] = { ...asRecord(nextToolsSettings[key]), ...mergeValue };
  }
}

function pathTable(bucket: { allow: string[]; deny: string[] } | undefined): {
  allowedPaths: string[];
  deniedPaths: string[];
} {
  return { allowedPaths: bucket?.allow ?? [], deniedPaths: bucket?.deny ?? [] };
}

/**
 * The `allowedTools` entries that trust a whole built-in tool, per canonical
 * surface: the current names and the legacy aliases Kiro still accepts.
 */
const KIRO_TRUSTED_TOOL_NAMES: Readonly<Record<string, readonly string[]>> = {
  shell: ["shell", "execute_bash"],
  read: ["read", "fs_read"],
  write: ["write", "fs_write"],
  grep: ["grep"],
  glob: ["glob"],
  web: ["web_fetch", "web_search"],
};
const KIRO_TRUST_ALL_TOOL_NAMES = ["*", "@builtin"];

/**
 * An `allowedTools` entry carried over from the existing file trusts a whole
 * tool, so the tool runs without prompting even for the inputs an `ask` (or an
 * all-tools `*` restriction) was meant to stop at the prompt. Remove the
 * entries that trust a surface carrying such a rule, and say so.
 */
function untrustToolsWithRestrictions({
  nextAllowedTools,
  shellAsks,
  pathBuckets,
  config,
  logger,
}: {
  nextAllowedTools: Set<string>;
  shellAsks: readonly string[];
  pathBuckets: Record<string, { ask: string[] }>;
  config: PermissionsConfig;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): void {
  const allToolsRestricted = Object.entries(config.permission["*"] ?? {}).some(
    ([, action]) => action !== "allow",
  );
  const restrictedSurfaces = new Set<string>();
  if (shellAsks.length > 0 || allToolsRestricted) restrictedSurfaces.add("shell");
  for (const surface of ["read", "write", "grep", "glob"]) {
    if ((pathBuckets[surface]?.ask.length ?? 0) > 0 || allToolsRestricted) {
      restrictedSurfaces.add(surface);
    }
  }
  // `applyKiroWebPermission` already handles the `web_fetch`/`web_search`
  // entries of a stated web category, but a trust-all entry covers them too;
  // an all-tools restriction reaches them even when no web category is stated.
  const webRestricted = ["webfetch", "websearch"].some((category) =>
    Object.values(config.permission[category] ?? {}).some((action) => action !== "allow"),
  );
  if (allToolsRestricted) restrictedSurfaces.add("web");
  // A web restriction alone still has to drop the trust-all entries.
  if (restrictedSurfaces.size === 0 && !webRestricted) return;
  const untrusted = [
    ...KIRO_TRUST_ALL_TOOL_NAMES,
    ...[...restrictedSurfaces].flatMap((surface) => KIRO_TRUSTED_TOOL_NAMES[surface] ?? []),
  ].filter((toolName) => nextAllowedTools.delete(toolName));
  if (untrusted.length > 0) {
    logger?.warn(
      `Kiro permissions: removed ${untrusted.join(", ")} from allowedTools, because trusting ` +
        `the whole tool would auto-approve inputs that an ask rule (or a '*' category deny/ask) restricts.`,
    );
  }
}

/**
 * Apply `withholdAllowsCoveredByAsks` to every path bucket. A narrower deny/ask
 * under the all-tools `*` category covers paths too but has no path list here,
 * so it withholds the path allows it overlaps the same way an ask does
 * (`bash` already receives it through `honorAllToolsOnBash`).
 */
function withholdPathAllowsCoveredByRestrictions({
  pathBuckets,
  config,
  logger,
}: {
  pathBuckets: Record<string, { allow: string[]; deny: string[]; ask: string[] }>;
  config: PermissionsConfig;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): void {
  // The all-tools catch-all is included: a `"*": "deny"` or `"ask"` there
  // overlaps every path allow.
  const allToolsRestrictions = Object.entries(config.permission["*"] ?? {})
    .filter(([, action]) => action !== "allow")
    .map(([pattern]) => pattern);
  for (const [key, bucket] of Object.entries(pathBuckets)) {
    bucket.allow = withholdAllowsCoveredByAsks({
      surface: `toolsSettings.${key}.allowedPaths`,
      allows: bucket.allow,
      asks: bucket.ask,
      allToolsRestrictions,
      logger,
    });
  }
}

/**
 * Kiro has no ask tier: an entry left out of an allow list prompts. An `ask`
 * is therefore honored by withholding every allow entry it overlaps — the
 * canonical order is `deny > ask > allow`, so an allow kept beside it (a `*`
 * allow beside an ask on `git push *`) would auto-approve the very input the
 * author wanted to be asked about.
 */
function withholdAllowsCoveredByAsks({
  surface,
  allows,
  asks,
  allToolsRestrictions = [],
  logger,
}: {
  surface: string;
  allows: string[];
  asks: string[];
  allToolsRestrictions?: string[];
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): string[] {
  if (asks.length === 0 && allToolsRestrictions.length === 0) {
    return allows;
  }
  const shadowingRestrictions = createShadowingRestrictionsTest([
    ...asks.map((pattern) => ({ pattern, fromAllToolsCategory: false })),
    ...allToolsRestrictions.map((pattern) => ({ pattern, fromAllToolsCategory: true })),
  ]);
  const kept: string[] = [];
  const withheld: string[] = [];
  for (const allow of allows) {
    (shadowingRestrictions(allow).length > 0 ? withheld : kept).push(allow);
  }
  if (asks.length > 0) {
    logger?.warn(
      `Kiro permissions do not support "ask", so ${asks.join(", ")} ${asks.length === 1 ? "is" : "are"} ` +
        `not written to ${surface}; Kiro prompts for anything its allow list does not cover.`,
    );
  }
  if (withheld.length > 0) {
    logger?.warn(
      `Kiro permissions: the allow rule(s) for ${withheld.join(", ")} were not written to ` +
        `${surface} because an ask rule, or a deny/ask under the all-tools '*' category, ` +
        `restricts the same inputs and the stricter rule wins.`,
    );
  }
  return kept;
}

/**
 * Kiro's web tools are switched on as a whole through `allowedTools`, so only
 * a category's `*` catch-all is representable. A catch-all `allow` beside a
 * narrower `deny`/`ask` would auto-approve the very URL or query that rule
 * restricts, so the tool is then left out of `allowedTools` (Kiro prompts for
 * it) — see `failSafeCatchAllAction`.
 */
function applyKiroWebPermission({
  category,
  rules,
  allToolsRules,
  nextAllowedTools,
  logger,
}: {
  category: "webfetch" | "websearch";
  rules: Record<string, PermissionAction>;
  allToolsRules: Record<string, PermissionAction> | undefined;
  nextAllowedTools: Set<string>;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): void {
  for (const [pattern, action] of Object.entries(rules)) {
    if (pattern !== "*") {
      logger?.warn(
        `Kiro ${category} supports only wildcard (*) via allowedTools. Skipping ${action} rule: ${pattern}`,
      );
    }
  }
  const { action, downgraded } = failSafeCatchAllAction({ rules, allToolsRules });
  const toolName = category === "webfetch" ? "web_fetch" : "web_search";
  if (action === undefined) {
    // No catch-all, but a narrower deny/ask still restricts this tool: an
    // `allowedTools` entry carried over from the existing file would
    // auto-approve it, so it is removed.
    if (Object.values(rules).some((ruleAction) => ruleAction !== "allow")) {
      nextAllowedTools.delete(toolName);
    }
    return;
  }
  if (downgraded) {
    logger?.warn(
      `Kiro ${category} allows "*", but a narrower deny or ask (in it or in the "*" category) ` +
        `cannot be expressed in allowedTools, so ${toolName} is left out of allowedTools and will not be auto-approved.`,
    );
  }
  if (action === "allow") {
    nextAllowedTools.add(toolName);
  } else {
    nextAllowedTools.delete(toolName);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  const result = UnknownRecordSchema.safeParse(value);
  return result.success ? result.data : {};
}

/**
 * Build the `kiro` permissions override from a parsed agent config's
 * `toolsSettings`, lifting the Kiro-specific knobs with no canonical category:
 * - `shell.*` flags other than the canonical `allowed`/`deniedCommands`
 *   (e.g. `autoAllowReadonly`, `denyByDefault`), verbatim.
 * - the whole `aws` object (`allowedServices` / `deniedServices` / …), verbatim.
 * - the whole `web_fetch` object (`trusted` / `blocked`), verbatim.
 *
 * Returns `undefined` when none are present so the override key is omitted.
 */
function extractKiroOverride(
  toolsSettings: Record<string, unknown>,
): { toolsSettings: Record<string, unknown> } | undefined {
  const overrideToolsSettings: Record<string, unknown> = {};

  const shellFlags: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(asRecord(toolsSettings.shell))) {
    if (isPrototypePollutionKey(key)) continue;
    if (!CANONICAL_SHELL_KEYS.has(key)) shellFlags[key] = value;
  }
  if (Object.keys(shellFlags).length > 0) overrideToolsSettings.shell = shellFlags;

  const aws = asRecord(toolsSettings.aws);
  if (Object.keys(aws).length > 0) overrideToolsSettings.aws = aws;

  const webFetch = asRecord(toolsSettings.web_fetch);
  if (Object.keys(webFetch).length > 0) overrideToolsSettings.web_fetch = webFetch;

  if (Object.keys(overrideToolsSettings).length === 0) return undefined;
  return { toolsSettings: overrideToolsSettings };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Build a canonical `{ pattern: action }` map from a Kiro tool settings record's
 * allow/deny string arrays (e.g. `allowedPaths`/`deniedPaths` or
 * `allowedCommands`/`deniedCommands`).
 */
function rulesFromArrays(
  settings: Record<string, unknown>,
  allowKey: string,
  denyKey: string,
): Record<string, PermissionAction> {
  const rules: Record<string, PermissionAction> = {};
  for (const pattern of asStringArray(settings[allowKey])) rules[pattern] = "allow";
  for (const pattern of asStringArray(settings[denyKey])) rules[pattern] = "deny";
  return rules;
}
