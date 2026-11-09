import { join } from "node:path";

import { z } from "zod/mini";

import {
  COPILOT_MCP_DIR,
  COPILOT_VSCODE_SETTINGS_FILE_NAME,
} from "../../constants/copilot-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import {
  COPILOT_LOCAL_PERMISSION_LEVELS,
  type CopilotDefaultPermissionMode,
  type CopilotLocalPermissionLevel,
  type CopilotSandbox,
  CopilotSandboxEnabledSchema,
  CopilotSandboxUserConfiguredPathsSchema,
  type PermissionAction,
  type PermissionsConfig,
} from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  collectTrustAffectingSandboxPaths,
  isNonEmptyList,
  isNotFalse,
  isNotTrue,
  readSandboxPath,
  type TrustAffectingSandboxPath,
  UNREADABLE_SANDBOX_PATH,
  warnOnTrustAffectingEntries,
} from "./sandbox-trust.js";
import {
  honorAllToolsRestrictions,
  normalizeUrlPattern,
  restateAllToolsRestrictionsInCategory,
  restatesAsCategoryRule,
} from "./shadowed-allows.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  bashRulesHonoringAllTools,
  CATCH_ALL_PATTERN,
  SHELL_PERMISSION_CATEGORY,
} from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * The flat, dotted VS Code setting keys this adapter manages, one per canonical
 * permission category. VS Code stores settings with dotted keys flat at the
 * document top level, so each is a single literal key — not a nested
 * `chat.tools.terminal` path. All three share the same
 * pattern-to-boolean shape, so one conversion covers them.
 *
 * The canonical `read` and `write` categories stay unmapped: VS Code has no
 * read-approval surface, and folding `write` into the edits map alongside
 * `edit` would make the two indistinguishable on import.
 *
 * @see https://code.visualstudio.com/docs/agents/approvals
 * @see https://code.visualstudio.com/docs/copilot/chat/review-code-edits
 */
const AUTO_APPROVE_KEYS: Readonly<Record<string, string>> = {
  bash: "chat.tools.terminal.autoApprove",
  // Glob-to-boolean map gating agent edits, e.g. `{"**/*": true, "**/.env": false}`.
  // Added in VS Code v1.104.
  edit: "chat.tools.edits.autoApprove",
  // URL-pattern-to-boolean map gating fetch approvals. VS Code also accepts an
  // `{approveRequest, approveResponse}` object per pattern, which the canonical
  // allow/deny/ask model cannot express: such an entry is skipped on import,
  // and — since rulesync owns this key outright — is replaced on generate
  // whenever the canonical config states a `webfetch` category at all.
  webfetch: "chat.tools.urls.autoApprove",
};

/**
 * The workspace setting holding the starting permission level of new Local
 * (`local` harness) chat sessions, authored through the
 * `copilot.defaultPermissionMode` override. VS Code 1.144 narrowed it to Local
 * sessions; the Copilot harness reads {@link DEFAULT_CONFIGURATION_KEY}.
 *
 * @see https://code.visualstudio.com/docs/agents/reference/ai-settings
 */
const DEFAULT_PERMISSION_MODE_KEY = "chat.permissions.default";

/**
 * The workspace setting holding the starting `mode` (`interactive` / `plan` /
 * `autopilot`) and `approvals` (`manual` / `assisted` / `allowAll`) of new
 * agent sessions such as the Copilot harness, the default since VS Code 1.143.
 * It shipped in stable VS Code 1.144 as an object setting with
 * `additionalProperties: false`; older releases ignore it.
 *
 * @see https://github.com/microsoft/vscode/blob/1.144.0/src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts
 * @see https://github.com/microsoft/vscode/blob/1.144.0/src/vs/workbench/contrib/chat/common/constants.ts
 */
const DEFAULT_CONFIGURATION_KEY = "chat.defaultConfiguration";

/** The `approvals` values of `chat.defaultConfiguration`. */
type CopilotDefaultApprovals = "manual" | "assisted" | "allowAll";

/**
 * What each `copilot.defaultPermissionMode` value writes. `local` goes to
 * `chat.permissions.default`; `approvals` and `autopilot` go to
 * `chat.defaultConfiguration`. The Local picker has no Assisted level, so
 * `assisted` starts Local sessions with Default Permissions — the stricter
 * fallback. Autopilot is a permission level in the Local picker but a `mode`
 * in `chat.defaultConfiguration`, where it runs with every tool call approved.
 */
const DEFAULT_PERMISSION_MODE_MAPPINGS: Readonly<
  Record<
    CopilotDefaultPermissionMode,
    {
      local: CopilotLocalPermissionLevel;
      approvals: CopilotDefaultApprovals;
      autopilot: boolean;
    }
  >
> = {
  default: { local: "default", approvals: "manual", autopilot: false },
  autoApprove: { local: "autoApprove", approvals: "allowAll", autopilot: false },
  autopilot: { local: "autopilot", approvals: "allowAll", autopilot: true },
  assisted: { local: "default", approvals: "assisted", autopilot: false },
};

/**
 * The `chat.defaultConfiguration` value for `mode`. Rulesync owns only whether
 * the mode is Autopilot: authoring Autopilot sets it, and any other value
 * removes any Autopilot mode in the file (whether an earlier run or a person
 * wrote it, since the two cannot be told apart), while an `interactive` or
 * `plan` mode is kept.
 */
function buildDefaultConfigurationValue({
  defaultPermissionMode,
  existingSettings,
}: {
  defaultPermissionMode: CopilotDefaultPermissionMode;
  existingSettings: Record<string, unknown>;
}): Record<string, unknown> {
  const { approvals, autopilot } = DEFAULT_PERMISSION_MODE_MAPPINGS[defaultPermissionMode];
  const existing = existingSettings[DEFAULT_CONFIGURATION_KEY];
  const value: Record<string, unknown> = { ...(isPlainObject(existing) ? existing : {}) };
  if (autopilot) {
    value.mode = "autopilot";
  } else if (value.mode === "autopilot") {
    delete value.mode;
  }
  value.approvals = approvals;
  return value;
}

/**
 * The `copilot.defaultPermissionMode` values from least to most permissive,
 * used to settle a file whose two keys disagree.
 */
const DEFAULT_PERMISSION_MODE_RANK: Readonly<Record<CopilotDefaultPermissionMode, number>> = {
  default: 0,
  assisted: 1,
  autoApprove: 2,
  autopilot: 3,
};

/**
 * The `copilot.defaultPermissionMode` a `chat.defaultConfiguration` value
 * stands for. Autopilot is recognized only together with `allowAll`, the pair
 * Rulesync writes for it: an Autopilot mode with stricter approvals is read
 * from `approvals` alone, so that regenerating never escalates it to Allow
 * All. An object without `approvals` is read as `default`, since VS Code then
 * starts sessions with Manual permissions.
 */
function readDefaultConfigurationMode(
  configuration: unknown,
): CopilotDefaultPermissionMode | undefined {
  if (!isPlainObject(configuration)) {
    return undefined;
  }
  switch (configuration.approvals) {
    case undefined:
    case "manual":
      return "default";
    case "assisted":
      return "assisted";
    case "allowAll":
      return configuration.mode === "autopilot" ? "autopilot" : "autoApprove";
    default:
      return undefined;
  }
}

/**
 * Read `copilot.defaultPermissionMode` back from the settings. When the two
 * keys agree — `chat.permissions.default` holds the Local level Rulesync
 * writes for the `chat.defaultConfiguration` value — the latter is returned,
 * since only it can say `assisted`. When they disagree, the less permissive of
 * the two is returned, so regenerating never raises either harness's starting
 * permissions. Either key alone is read as it stands.
 */
function readDefaultPermissionMode(
  settings: Record<string, unknown>,
): CopilotDefaultPermissionMode | undefined {
  const fromConfiguration = readDefaultConfigurationMode(settings[DEFAULT_CONFIGURATION_KEY]);
  const localValue = settings[DEFAULT_PERMISSION_MODE_KEY];
  const fromLocal = COPILOT_LOCAL_PERMISSION_LEVELS.find((level) => level === localValue);
  if (fromConfiguration === undefined || fromLocal === undefined) {
    return fromConfiguration ?? fromLocal;
  }
  if (DEFAULT_PERMISSION_MODE_MAPPINGS[fromConfiguration].local === fromLocal) {
    return fromConfiguration;
  }
  return DEFAULT_PERMISSION_MODE_RANK[fromLocal] < DEFAULT_PERMISSION_MODE_RANK[fromConfiguration]
    ? fromLocal
    : fromConfiguration;
}

/**
 * The prefix every Agent Host sandbox setting shares. A `copilot.sandbox` leaf
 * at path `a.b` is written to `chat.agent.sandbox.a.b`.
 */
const SANDBOX_KEY_PREFIX = "chat.agent.sandbox.";

/**
 * The `copilot.sandbox` leaves rulesync manages, each a flat VS Code setting
 * (`SANDBOX_KEY_PREFIX` + the dotted path) with the value shape VS Code
 * registers for it. The shape is re-checked on import, so a hand-written value
 * VS Code would not accept is skipped instead of failing the whole import.
 *
 * @see https://code.visualstudio.com/docs/agents/run/agent-sandboxing
 * @see https://code.visualstudio.com/docs/agents/reference/ai-settings
 */
const SANDBOX_LEAVES: readonly {
  path: readonly string[];
  schema: z.ZodMiniType;
  /** Maps a legacy value VS Code still accepts to the current shape on import. */
  normalize?: (value: unknown) => unknown;
}[] = [
  {
    path: ["enabled"],
    schema: CopilotSandboxEnabledSchema,
    // VS Code still accepts the pre-1.141 boolean and reads `true` as "on" and
    // `false` as "off" (`normalizeAgentSandboxEnabledValue`).
    normalize: (value) => (value === true ? "on" : value === false ? "off" : value),
  },
  { path: ["network", "allowNetwork"], schema: z.boolean() },
  { path: ["network", "allowLocalNetwork"], schema: z.boolean() },
  { path: ["allowUnsandboxedCommands"], schema: z.boolean() },
  { path: ["mcpServers"], schema: z.boolean() },
  { path: ["lspServers"], schema: z.boolean() },
  { path: ["credentials", "authenticategit"], schema: z.boolean() },
  { path: ["credentials", "authenticategh"], schema: z.boolean() },
  { path: ["fileSystem", "allowDevToolAccess"], schema: z.boolean() },
  {
    path: ["fileSystem", "userConfiguredPaths"],
    schema: CopilotSandboxUserConfiguredPathsSchema,
  },
];

const USER_CONFIGURED_PATHS_KEY = `${SANDBOX_KEY_PREFIX}fileSystem.userConfiguredPaths`;

/**
 * `copilot.sandbox` values that loosen the Agent Host sandbox. They are still
 * written — a sandbox policy is the user's call — but never silently. Each
 * `widens` names the value that does *not* loosen anything and reports the
 * rest, so an unexpected value is reported rather than ignored.
 *
 * @see https://code.visualstudio.com/docs/agents/run/agent-sandboxing
 */
const COPILOT_TRUST_AFFECTING_SANDBOX_PATHS: readonly TrustAffectingSandboxPath[] = [
  {
    path: ["enabled"],
    reason: "turns the sandbox off, so agent terminal commands run unconfined",
    widens: (value) => value !== "on",
  },
  {
    path: ["network", "allowNetwork"],
    reason: "lets sandboxed commands reach the external network",
    widens: isNotFalse,
  },
  {
    path: ["network", "allowLocalNetwork"],
    reason: "lets sandboxed commands reach local network resources",
    widens: isNotFalse,
  },
  {
    path: ["allowUnsandboxedCommands"],
    reason: "lets the agent ask to run a blocked command outside the sandbox",
    widens: isNotFalse,
  },
  {
    path: ["mcpServers"],
    reason: "runs locally launched MCP servers outside the sandbox",
    widens: isNotTrue,
  },
  {
    path: ["lspServers"],
    reason: "runs language servers outside the sandbox",
    widens: isNotTrue,
  },
  {
    path: ["credentials", "authenticategit"],
    reason: "hands your Git credentials to sandboxed commands",
    widens: isNotFalse,
  },
  {
    path: ["credentials", "authenticategh"],
    reason: "hands your GitHub CLI authentication to sandboxed commands",
    widens: isNotFalse,
  },
  {
    path: ["fileSystem", "allowDevToolAccess"],
    reason:
      "grants sandboxed commands developer-tool directories, which can hold credentials such as registry tokens",
    widens: isNotFalse,
  },
  {
    path: ["fileSystem", "userConfiguredPaths", "readwritePaths"],
    reason: "adds paths sandboxed commands may write to, outside the working directory",
    widens: isNonEmptyList,
  },
  {
    path: ["fileSystem", "userConfiguredPaths", "readonlyPaths"],
    reason: "adds paths sandboxed commands may read, outside the working directory",
    widens: isNonEmptyList,
  },
];

const COPILOT_TOOL_LABEL = "GitHub Copilot";

function sandboxKey(path: readonly string[]): string {
  return `${SANDBOX_KEY_PREFIX}${path.join(".")}`;
}

/**
 * Patch entries for every `copilot.sandbox` leaf the canonical config states.
 * Leaves it does not state are left as the file has them, so authoring only
 * `network.allowNetwork` never disturbs a hand-written `enabled`. The
 * `userConfiguredPaths` object merges per list for the same reason: authoring
 * `readwritePaths` keeps a hand-written `deniedPaths`, which would otherwise be
 * a restriction lost without a word.
 */
function buildSandboxPatch({
  sandbox,
  existingSettings,
}: {
  sandbox: CopilotSandbox;
  existingSettings: Record<string, unknown>;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const { path } of SANDBOX_LEAVES) {
    const value = readSandboxPath({ sandbox, path });
    if (value === undefined || value === UNREADABLE_SANDBOX_PATH) {
      continue;
    }
    const key = sandboxKey(path);
    if (key === USER_CONFIGURED_PATHS_KEY && isPlainObject(value)) {
      const existing = existingSettings[key];
      patch[key] = { ...(isPlainObject(existing) ? existing : {}), ...value };
      continue;
    }
    patch[key] = value;
  }
  return patch;
}

/**
 * Lift every managed `chat.agent.sandbox.*` key the file holds back into a
 * nested `copilot.sandbox` object. A value whose shape VS Code would reject is
 * skipped; the write path leaves it in place.
 */
function readSandboxFromSettings(settings: Record<string, unknown>): CopilotSandbox | undefined {
  const sandbox: Record<string, unknown> = {};
  for (const { path, schema, normalize } of SANDBOX_LEAVES) {
    const value = settings[sandboxKey(path)];
    const parsed = schema.safeParse(normalize === undefined ? value : normalize(value));
    if (!parsed.success) {
      continue;
    }
    let cursor = sandbox;
    for (const segment of path.slice(0, -1)) {
      const next = cursor[segment];
      const child = isPlainObject(next) ? next : {};
      cursor[segment] = child;
      cursor = child;
    }
    const leaf = path[path.length - 1];
    if (leaf !== undefined) {
      cursor[leaf] = parsed.data;
    }
  }
  return Object.keys(sandbox).length > 0 ? sandbox : undefined;
}

function asAutoApproveMap(value: unknown): Record<string, boolean> {
  if (!isPlainObject(value)) {
    return {};
  }
  const result: Record<string, boolean> = {};
  for (const [pattern, flag] of Object.entries(value)) {
    if (typeof flag === "boolean") {
      result[pattern] = flag;
    }
  }
  return result;
}

/**
 * The edits or urls map's rules with the all-tools `*` restrictions honored.
 * A restriction that reads as a path (edits) or URL (urls), and the catch-all
 * `*`, is written as a `false` entry of its own, which `buildAutoApproveValue`
 * places where it wins; a URL is written lowercased and without its scheme.
 * Every other restriction (a command, an odd URL pattern) cannot be written
 * there, so each `true` entry it overlaps is withheld instead.
 */
function honorCopilotAllToolsRestrictions({
  permission,
  category,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  category: string;
  logger?: Logger;
}): Record<string, PermissionAction> {
  const allToolsRules = lookupOwn({ record: permission, key: ALL_TOOLS_PERMISSION_CATEGORY }) ?? {};
  const isWritable = restatesAsCategoryRule();
  const restateAs = (params: { category: string; pattern: string; action: PermissionAction }) =>
    params.pattern === CATCH_ALL_PATTERN || isWritable(params);
  const writable: Record<string, PermissionAction> = {};
  const notWritable: Record<string, PermissionAction> = {};
  for (const [pattern, action] of Object.entries(allToolsRules)) {
    if (action === "allow") continue;
    if (restateAs({ category, pattern, action })) {
      const key =
        category === "webfetch" && pattern !== CATCH_ALL_PATTERN
          ? normalizeUrlPattern(pattern)
          : pattern;
      writable[key] = action;
    } else {
      notWritable[pattern] = action;
    }
  }
  const restated = restateAllToolsRestrictionsInCategory({
    permission: {
      [ALL_TOOLS_PERMISSION_CATEGORY]: writable,
      [category]: lookupOwn({ record: permission, key: category }) ?? {},
    },
    category,
    restateAs: () => true,
  });
  const honored = honorAllToolsRestrictions({
    permission: { [ALL_TOOLS_PERMISSION_CATEGORY]: notWritable, [category]: restated },
    toolLabel: COPILOT_TOOL_LABEL,
    logger,
  });
  return lookupOwn({ record: honored, key: category }) ?? {};
}

/**
 * Render one canonical category's rules as a VS Code auto-approve map. Returns
 * `undefined` when the category contributes nothing, so the key is retracted
 * rather than written as an empty object.
 *
 * The resulting map replaces the file's existing value wholesale — rulesync
 * owns these keys, so a rule dropped from the canonical config disappears from
 * the settings file too.
 */
function buildAutoApproveValue({
  category,
  rules,
}: {
  category: string;
  rules: Record<string, PermissionAction>;
}): Record<string, boolean> | undefined {
  // `false` means "never auto-approve": VS Code prompts. It is written for
  // `ask` as well as `deny`, because omitting an `ask` would leave a broader
  // `true` entry (`"**/*": true` beside an ask on `src/**`) to auto-approve
  // the very input the author wanted to be asked about.
  const entries = Object.entries(rules).map(([pattern, action]): [string, boolean] => [
    pattern,
    action === "allow",
  ]);
  if (entries.length === 0) {
    return undefined;
  }
  // VS Code does not resolve overlapping entries by strictness: the edits map
  // lets the *last* matching glob win and the urls map the *first* matching
  // pattern, so the `false` entries are placed where they win — last for
  // edits, first for urls. (The terminal map checks denials first, so its
  // order does not matter and is kept as written.)
  const falseEntries = entries.filter(([, approved]) => !approved);
  const trueEntries = entries.filter(([, approved]) => approved);
  const ordered =
    category === "edit"
      ? [...trueEntries, ...falseEntries]
      : category === "webfetch"
        ? [...falseEntries, ...trueEntries]
        : entries;
  return Object.fromEntries(ordered);
}

/**
 * Permissions generator for GitHub Copilot Chat in VS Code.
 *
 * VS Code has no standalone, environment-agnostic Copilot policy file (like
 * `.claude/settings.json`); project-level terminal auto-approvals are managed
 * through the workspace `chat.tools.terminal.autoApprove` map inside
 * `.vscode/settings.json`. That file is a general workspace settings file with
 * many unrelated keys, so reads and writes merge into the existing JSON
 * (touching only the managed keys) and the file is never deleted.
 *
 * Three canonical categories have a clean, non-lossy representation and are
 * mapped (see {@link AUTO_APPROVE_KEYS}): `bash`, `edit` and `webfetch`. In
 * every one, per-pattern rules map as: `allow` → `true` (auto-approve), `deny`
 * → `false` (VS Code then always prompts — note this is "never auto-approve",
 * not a hard block), and `ask` → `false` as well. Omitting an `ask` entry would
 * let a broader `true` entry that also matches auto-approve it, so the `ask`
 * is written explicitly; it imports back as `deny`, the stricter reading of
 * `false`. A key whose canonical category is absent entirely
 * is left untouched, so authoring only `bash` rules never disturbs a
 * hand-written edits or urls map.
 * The `copilot.defaultPermissionMode` override writes both
 * `chat.permissions.default` (Local sessions) and `chat.defaultConfiguration`
 * (Copilot-harness sessions, VS Code 1.144+; see
 * {@link DEFAULT_PERMISSION_MODE_MAPPINGS}); without it both keys are left
 * untouched. The `copilot.sandbox` override writes the Agent Host sandbox
 * settings (`chat.agent.sandbox.*`, see {@link SANDBOX_LEAVES}) per key, and
 * warns about every value it writes that loosens the sandbox.
 * Only project scope is modeled: VS Code's user-scope settings.json lives at a
 * platform-dependent path outside rulesync's home-relative global model.
 */
export class CopilotPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    // Project scope only. VS Code's user settings.json is at a platform-specific
    // path outside rulesync's home-relative global model.
    return {
      relativeDirPath: COPILOT_MCP_DIR,
      relativeFilePath: COPILOT_VSCODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<CopilotPermissions> {
    const paths = CopilotPermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new CopilotPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<CopilotPermissions> {
    const paths = CopilotPermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    const config = rulesyncPermissions.getJson();

    // Only categories the canonical config actually states are touched. A key
    // whose category is absent stays exactly as the user left it — otherwise
    // adopting rulesync for `bash` alone would wipe a hand-authored
    // `chat.tools.edits.autoApprove`. A category that IS stated but yields
    // nothing (an empty map) still retracts its key, since rulesync owns it.
    const patch: Record<string, unknown> = {};
    for (const [category, settingKey] of Object.entries(AUTO_APPROVE_KEYS)) {
      if (!Object.hasOwn(config.permission, category)) {
        continue;
      }
      // A `*` deny/ask covers this surface too: shell commands take every one
      // (as `honorAllToolsOnBash` does), and the edits/urls maps take the ones
      // that read as a path or URL as `false` entries, which are placed where
      // they win over a broader `true`.
      const rules =
        category === SHELL_PERMISSION_CATEGORY
          ? bashRulesHonoringAllTools(config.permission)
          : honorCopilotAllToolsRestrictions({ permission: config.permission, category, logger });
      patch[settingKey] = buildAutoApproveValue({ category, rules });
    }
    const existingSettings = (): Record<string, unknown> =>
      parseSharedConfig({ format: "jsonc", fileContent: existingContent, filePath });
    const defaultPermissionMode = config.copilot?.defaultPermissionMode;
    if (defaultPermissionMode !== undefined) {
      patch[DEFAULT_PERMISSION_MODE_KEY] =
        DEFAULT_PERMISSION_MODE_MAPPINGS[defaultPermissionMode].local;
      patch[DEFAULT_CONFIGURATION_KEY] = buildDefaultConfigurationValue({
        defaultPermissionMode,
        existingSettings: existingSettings(),
      });
    }
    const sandbox = config.copilot?.sandbox;
    if (sandbox !== undefined) {
      Object.assign(
        patch,
        buildSandboxPatch({
          sandbox,
          existingSettings: existingSettings(),
        }),
      );
      warnOnTrustAffectingEntries({
        toolLabel: COPILOT_TOOL_LABEL,
        entries: collectTrustAffectingSandboxPaths({
          sandbox,
          paths: COPILOT_TRUST_AFFECTING_SANDBOX_PATHS,
        }),
        relativeFilePath: join(paths.relativeDirPath, paths.relativeFilePath),
        logger,
      });
    }

    return new CopilotPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch,
        filePath,
        logger,
      }),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
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
        `Failed to parse Copilot VS Code settings in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permission: Record<string, Record<string, PermissionAction>> = {};
    for (const [category, settingKey] of Object.entries(AUTO_APPROVE_KEYS)) {
      // Non-boolean values (e.g. a urls entry in the `{approveRequest,
      // approveResponse}` object form) have no canonical action and are skipped
      // by `asAutoApproveMap`; the write path leaves them in place.
      const autoApprove = asAutoApproveMap(settings[settingKey]);
      const rules: Record<string, PermissionAction> = {};
      for (const [pattern, flag] of Object.entries(autoApprove)) {
        rules[pattern] = flag ? "allow" : "deny";
      }
      if (Object.keys(rules).length > 0) {
        permission[category] = rules;
      }
    }

    const defaultPermissionMode = readDefaultPermissionMode(settings);
    const sandbox = readSandboxFromSettings(settings);
    const copilot = {
      ...(defaultPermissionMode !== undefined && { defaultPermissionMode }),
      ...(sandbox !== undefined && { sandbox }),
    };
    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(
        {
          permission,
          ...(Object.keys(copilot).length > 0 && { copilot }),
        },
        null,
        2,
      ),
    });
  }
}
