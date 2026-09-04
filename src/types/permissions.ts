import { z } from "zod/mini";

/**
 * Permission action values.
 * - allow: Automatically permitted without confirmation
 * - ask: Requires user confirmation before execution
 * - deny: Blocked from execution
 */
export const PermissionActionSchema = z.enum(["allow", "ask", "deny"]);
export type PermissionAction = z.infer<typeof PermissionActionSchema>;

/**
 * Whether a key in a permission block — a category name or a pattern — is
 * blank, that is empty or only whitespace. Shared with the import-side filter
 * so the key the schema rejects and the key that filter removes can never
 * drift apart.
 */
export function isBlankPermissionKey(key: string): boolean {
  return key.trim().length === 0;
}

/**
 * A single permission pattern key.
 *
 * A blank pattern has no defensible meaning: it is a prefix of every command
 * and a substring of every path, so a target that honors it grants or denies
 * everything, while a target that filters it — Roo Code drops entries failing
 * `cmd.trim().length > 0` before the auto-approval decision reads the list —
 * silently ignores it. Rather than let each target decide, reject it here so
 * the mistake surfaces once, on the source file.
 */
const PermissionPatternSchema = z.string().check(
  z.refine((pattern) => !isBlankPermissionKey(pattern), {
    message: "Permission pattern must not be blank",
  }),
);

/**
 * A permission category key: the name of the tool surface a rules map applies
 * to (`bash`, `edit`, `webfetch`, ...).
 *
 * Blank is rejected for the same reason a blank pattern is, one step up. Every
 * translator reads categories by name, so `{"": {"git *": "allow"}}` reaches no
 * tool at all and the rules under it are silently dead — the mistake is only
 * visible as an entry missing from a generated config. Rejecting it here
 * surfaces it on the source file instead.
 */
const PermissionCategorySchema = z.string().check(
  z.refine((category) => !isBlankPermissionKey(category), {
    message: "Permission category must not be blank",
  }),
);

/**
 * Permission rules for a single tool category.
 * Keys are glob patterns matching tool input (commands, file paths, etc.).
 * Values are the permission action to apply when the pattern matches.
 *
 * @example
 * { "*": "ask", "git *": "allow", "rm *": "deny" }
 */
const PermissionRulesSchema = z.record(PermissionPatternSchema, PermissionActionSchema);

/**
 * Tool-scoped canonical `permission` block: the same shape as the shared
 * top-level `permission` record, but applied only to the tool whose override
 * key it appears under. During generation the categories placed here are
 * merged over the shared `permission` block per category (the tool-scoped
 * category replaces the shared one wholesale), mirroring how
 * `.rulesync/hooks.jsonc` merges `{toolname}.hooks` per event.
 *
 * @example
 * { "claudecode": { "permission": { "bash": { "git push *": "deny" } } } }
 */
const ToolScopedPermissionSchema = z.record(PermissionCategorySchema, PermissionRulesSchema);

/**
 * Generic tool-scoped override block for tools that have no tool-specific
 * override keys of their own; it carries only the canonical tool-scoped
 * `permission` block. Kept `looseObject` so future tool-specific keys can be
 * added without a schema break.
 */
const CanonicalPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
});
export type CanonicalPermissionsOverride = z.infer<typeof CanonicalPermissionsOverrideSchema>;

const KimiCodePermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  defaultPermissionMode: z.optional(z.enum(["manual", "yolo", "auto"])),
  rules: z.optional(
    z.array(
      z.looseObject({
        decision: PermissionActionSchema,
        pattern: z.string(),
        scope: z.optional(z.enum(["turn-override", "session-runtime", "project", "user"])),
        reason: z.optional(z.string()),
      }),
    ),
  ),
  /**
   * Kimi's `[tools]` section: a separate enforcement layer from
   * `[[permission.rules]]`. A rule prompts; this removes the tool from every
   * agent in every session, so the model never sees it. Entries use the same
   * syntax as an agent file's `tools`/`disallowedTools` — exact built-in names
   * and `mcp__server__*` globs — which is not the canonical
   * `category`/`pattern` shape, hence a native passthrough block.
   *
   * @see https://moonshotai.github.io/kimi-code/en/configuration/config-files.html#tools
   */
  tools: z.optional(
    z.looseObject({
      enabled: z.optional(z.array(z.string())),
      disabled: z.optional(z.array(z.string())),
    }),
  ),
});
export type KimiCodePermissionsOverride = z.infer<typeof KimiCodePermissionsOverrideSchema>;

/**
 * OpenCode-specific permission value. Unlike the shared canonical block, which
 * only accepts a pattern-to-action map, OpenCode also allows a bare action
 * string that applies to the whole category (e.g. `"external_directory": "deny"`).
 * This mirrors OpenCode's own permission schema in `opencode-permissions.ts`.
 */
const OpencodeOverridePermissionValueSchema = z.union([
  PermissionActionSchema,
  PermissionRulesSchema,
]);

/**
 * Tool-scoped override block for OpenCode. Permission categories placed here
 * (e.g. OpenCode-only categories such as `external_directory`) are emitted only
 * into OpenCode's config and never leak into other tools' permission files. It
 * also lets a shared category be overridden with an OpenCode-specific value.
 * Kept `looseObject` so future OpenCode categories are accepted.
 *
 * @example
 * { "permission": { "external_directory": "deny", "webfetch": "allow" } }
 */
const OpencodePermissionsOverrideSchema = z.looseObject({
  permission: z.optional(z.record(PermissionCategorySchema, OpencodeOverridePermissionValueSchema)),
});
export type OpencodePermissionsOverride = z.infer<typeof OpencodePermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Hermes Agent. Keys placed here are deep-merged
 * into Hermes's `~/.hermes/config.yaml` and never leak into other tools' configs.
 * It carries Hermes-specific approval/security controls that have no canonical
 * permission category — e.g. `approvals` (`mode`, `cron_mode`, ...),
 * `security` (`allow_private_urls`, ...), `skills.write_approval`,
 * `memory.write_approval`. Kept `looseObject` (a verbatim passthrough) so any
 * current or future Hermes config key can be authored without modeling each one.
 *
 * @example
 * { "approvals": { "mode": "smart" }, "security": { "allow_private_urls": false } }
 */
const HermesPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
});
export type HermesPermissionsOverride = z.infer<typeof HermesPermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Cline. Cline's `command-permissions.json`
 * carries a single global `allowRedirects` boolean (gates shell redirection
 * operators `>`/`>>`/`<`) that has no per-command dimension and therefore no
 * canonical permission category. Placing it here lets users author it
 * declaratively; it is emitted only into Cline's config. Kept `looseObject` so
 * future Cline-only knobs can be added.
 *
 * @example
 * { "allowRedirects": true }
 */
const ClinePermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  allowRedirects: z.optional(z.boolean()),
});
export type ClinePermissionsOverride = z.infer<typeof ClinePermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Kilo Code (an OpenCode fork). Kilo's permission
 * object is a free-form record with tool-specific keys that have no canonical
 * category — OpenCode-inherited ones (`external_directory`, `doom_loop`, `lsp`,
 * `question`, `todowrite`, `skill`, `task`, `list`) and Kilo-unique ones
 * (`agent_manager`, `notebook_read`, `notebook_edit`, `notebook_execute`,
 * `repo_clone`, `repo_overview`). Placing them here makes them authorable and
 * portable and keeps them out of other tools' configs. Mirrors the OpenCode
 * override; each value may be a bare action string or a pattern map.
 *
 * `sandbox` is the sibling top-level block that governs the sandbox Kilo runs
 * commands in: `enabled` (boolean), `network` (`"deny"` and friends),
 * `allowed_hosts` (a list of `host` / `host:port` destination exceptions) and
 * `writable_paths`. It has no canonical permission category, so it is authored
 * here and emitted only for Kilo.
 *
 * Upstream restricts what a *project* config may say: `allowed_hosts` and
 * `writable_paths` are honored from the global config only, and a project
 * config may merely tighten (`enabled: true`, `network: "deny"`) — a
 * project-level network denial even clears the global destination exceptions.
 * rulesync mirrors that: at project scope only `enabled` and `network` are
 * written, and the rest are dropped with a warning rather than emitted into a
 * file Kilo would ignore.
 *
 * @example
 * { "permission": { "external_directory": "deny", "doom_loop": "ask" } }
 * @example
 * { "sandbox": { "enabled": true, "network": "deny" } }
 * @see https://kilo.ai/docs/getting-started/settings/sandboxing
 */
const KiloPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(z.record(PermissionCategorySchema, OpencodeOverridePermissionValueSchema)),
  sandbox: z.optional(z.looseObject({})),
});
export type KiloPermissionsOverride = z.infer<typeof KiloPermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Claude Code. Claude Code's `permissions` object
 * (in `.claude/settings.json`) carries non-list fields that have no canonical
 * permission category — `defaultMode` (the session-start permission mode) and
 * `additionalDirectories` (extra working directories) being the primary ones.
 * Fields placed under `claudecode.permissions` are merged into the settings
 * `permissions` object and emitted only for Claude Code, while the shared
 * `permission` block continues to drive the `allow`/`ask`/`deny` arrays. Kept a
 * `looseObject` passthrough so any current or future `permissions` field can be
 * authored without modeling each one; the managed `allow`/`ask`/`deny` arrays are
 * ignored here (rulesync owns them).
 *
 * `sandbox` is the sibling top-level settings subtree that governs the sandbox
 * Claude Code runs commands in (`sandbox.network.*`, `sandbox.filesystem.*`,
 * `sandbox.credentials`, `sandbox.allowAppleEvents`, ...). It has no canonical
 * permission category either — it constrains how a permitted command runs
 * rather than which commands are permitted — so it is a loose passthrough on
 * the same terms, merged into the top level of `.claude/settings.json`.
 *
 * Any other key is a plain top-level `settings.json` key (`editorMode`, `env`,
 * `model`, ...), deep-merged into the generated file verbatim so settings
 * Claude Code adds faster than an allowlist can track stay authorable.
 * The exceptions are the keys another feature owns (`hooks`) and `$schema`.
 * Keys the target file cannot honor — `Managed`-only and `~/.claude.json`-only
 * keys in either scope, plus user-scope keys at project scope — are dropped
 * with a warning rather than written where they would never apply. So are the
 * keys whose value is a command Claude Code executes (`apiKeyHelper`,
 * `statusLine`, ...): this file is shareable via `rulesync fetch`, and a file
 * named for restricting things is not where a command belongs — author those
 * in `.rulesync/hooks.jsonc` instead.
 *
 * @example
 * { "permissions": { "defaultMode": "acceptEdits", "additionalDirectories": ["../shared"] } }
 * @example
 * { "sandbox": { "network": { "allowedDomains": ["example.com"], "strictAllowlist": true } } }
 * @example
 * { "editorMode": "vim", "env": { "MY_VAR": "1" } }
 * @see https://code.claude.com/docs/en/sandboxing
 * @see https://code.claude.com/docs/en/settings-reference
 */
const ClaudecodePermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  permissions: z.optional(z.looseObject({})),
  sandbox: z.optional(z.looseObject({})),
});
export type ClaudecodePermissionsOverride = z.infer<typeof ClaudecodePermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Mistral Vibe. Vibe's per-tool `BaseToolConfig`
 * carries a `sensitive_patterns` list — patterns that escalate to ASK even when
 * the tool's base permission is ALWAYS (allow). The canonical model can only set
 * a pattern to a single `allow`/`ask`/`deny`, so an "allow by default but ask on
 * these patterns" escalation cannot be expressed. Entries under
 * `vibe.permission.<category>.sensitive_patterns` carry that list per canonical
 * category; the shared `permission` block still drives the base permission and
 * allow/deny lists. Keyed by canonical category (e.g. `bash`, `edit`).
 *
 * Vibe's top-level `enabled_tools` is an **exclusive** allowlist — when set,
 * only the listed tools (name or pattern) are active and every other builtin
 * and MCP tool is off. That narrowing cannot be derived from canonical `allow`
 * rules (an allow grants one tool without revoking the rest), so the list is
 * only ever authored explicitly here, verbatim in Vibe's tool-name vocabulary,
 * and round-trips through this override on import.
 *
 * @example
 * { "permission": { "bash": { "sensitive_patterns": ["rm *", "sudo *"] } } }
 * @example
 * { "enabled_tools": ["bash", "read_file", "grep"] }
 */
const VibePermissionsOverrideSchema = z.looseObject({
  permission: z.optional(
    z.record(
      PermissionCategorySchema,
      z.looseObject({ sensitive_patterns: z.optional(z.array(z.string())) }),
    ),
  ),
  enabled_tools: z.optional(z.array(z.string())),
});
export type VibePermissionsOverride = z.infer<typeof VibePermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Cursor CLI. Cursor's `cli.json` carries scalar
 * autonomy settings with no canonical permission category — `approvalMode`
 * (`allowlist` | `auto-review` | `unrestricted`) and a `sandbox` object
 * (`mode`/`networkAccess`). Fields placed here are merged into the top level of
 * `~/.cursor/cli-config.json` and emitted only for Cursor, while the shared
 * `permission` block continues to drive the `permissions.allow`/`permissions.deny`
 * arrays. Kept a `looseObject` so extra config keys can be authored (they are
 * merged verbatim on generate); `sandbox`'s accepted values are not documented
 * so it passes through verbatim.
 *
 * These are **global-only** settings: Cursor documents that "Only permissions
 * can be configured at the project level. All other CLI settings must be set
 * globally", so a project generate skips them with a warning instead of writing
 * keys `.cursor/cli.json` would ignore. Author them with `--global`.
 *
 * Note: only `approvalMode` and `sandbox` round-trip back on import — other keys
 * authored here reach the global config on generate but are not re-extracted.
 *
 * @example
 * { "approvalMode": "auto-review" }
 */
const CursorPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  // @see https://cursor.com/docs/cli/reference/configuration
  approvalMode: z.optional(z.enum(["allowlist", "auto-review", "unrestricted"])),
  // Deliberately NOT an enum: the CLI config reference documents `mode` and
  // `networkAccess` as plain strings without enumerating their accepted values.
  sandbox: z.optional(z.looseObject({})),
});
export type CursorPermissionsOverride = z.infer<typeof CursorPermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Qwen Code. Qwen's `settings.json` exposes
 * autonomy/sandbox controls with no canonical permission category — under
 * `tools` (`approvalMode` = plan/default/auto-edit/auto/yolo, `autoAccept`,
 * `sandbox`, `sandboxImage`, `disabled`) and `security` (`folderTrust`,
 * `allowedHttpHookUrls`, `allowPrivateNetworkHooks` — the latter is honored by
 * Qwen Code only in user/system settings, so generate skips it in project scope).
 * It also
 * exposes `permissions.autoMode` (the Auto Mode classifier config:
 * `hints.{allow,softDeny,hardDeny}`, `environment`, `classifyAllShell` — see
 * https://qwenlm.github.io/qwen-code-docs/en/users/features/auto-mode/), which
 * likewise has no canonical category. Fields placed here are merged into the
 * matching `settings.json` group and emitted only for Qwen, while the shared
 * `permission` block continues to drive the `permissions.allow`/`ask`/`deny`
 * arrays. Kept `looseObject` (verbatim passthrough) so any current or future
 * `tools`/`security`/`autoMode` key can be authored.
 *
 * @example
 * {
 *   "tools": { "approvalMode": "auto-edit" },
 *   "security": { "folderTrust": { "enabled": true } },
 *   "autoMode": { "hints": { "allow": ["Running tests"] }, "classifyAllShell": true }
 * }
 */
const QwencodePermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  tools: z.optional(z.looseObject({})),
  security: z.optional(z.looseObject({})),
  autoMode: z.optional(z.looseObject({})),
});
export type QwencodePermissionsOverride = z.infer<typeof QwencodePermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Reasonix. Reasonix has security axes orthogonal
 * to per-tool allow/ask/deny with no canonical category — the `[sandbox]`
 * enforcement table (`workspace_root`, `allow_write`, `forbid_read`, `bash`,
 * `network`) and plan-mode read-only trust lists under `[agent]`
 * (`plan_mode_read_only_commands`; its sibling `plan_mode_allowed_tools` left the config surface in v1.17.18, so it is lifted on import but stripped from `[agent]` whenever this override writes that table). Fields placed here
 * are merged into the matching `reasonix.toml` table and emitted only for
 * Reasonix, while the shared `permission` block continues to drive
 * `[permissions].allow`/`ask`/`deny`. Kept `looseObject` (verbatim passthrough).
 * Note: the whole `[sandbox]` table round-trips, but only the plan-mode keys are
 * re-extracted from `[agent]` on import — other `agent` keys authored here reach
 * `reasonix.toml` on generate but are not re-extracted back into the override.
 *
 * @example
 * { "sandbox": { "bash": "enforce", "network": false }, "agent": { "plan_mode_read_only_commands": ["gh pr diff"] } }
 * @example
 * { "allowDynamicBash": true, "rawAllow": ["Bash=pnpm test"] }
 */
const ReasonixPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  sandbox: z.optional(z.looseObject({})),
  agent: z.optional(z.looseObject({})),
  // Verbatim `[permissions]` entries merged into allow/ask/deny on generate.
  // Exists for the first-class `Bash=<literal>` exact-command form (SPEC §3.7,
  // v1.18.0), which the canonical tool→pattern→action shape cannot express
  // (glob-style `Bash(...)` matches differently by design). It is the
  // pattern-level way to pre-authorize nested or indirect Bash — command and
  // process substitution, `eval`, `source`, `sh -c` and friends, which SPEC
  // §3.7 gates harder than a merely dynamic command line — in a headless
  // `reasonix run`. Entries are passed through untranslated, so any Reasonix
  // entry syntax is valid. The blanket alternative is `allowDynamicBash` below;
  // YOLO cannot be authored at all, being a run-time posture rather than config.
  rawAllow: z.optional(z.array(z.string())),
  rawAsk: z.optional(z.array(z.string())),
  rawDeny: z.optional(z.array(z.string())),
  // `[permissions] allow_dynamic_bash` (v1.19.0): the blanket opt-in that lets
  // an Allow fallback — Auto included — cover the nested and indirect Bash the
  // `rawAllow` entries above can only pre-authorize one exact literal at a
  // time. Explicit `ask` and `deny` rules keep precedence over it. Written into
  // the `[permissions]` table beside allow/ask/deny rather than into a table of
  // its own, so it is named here instead of riding along in a passthrough
  // object; enabling it is announced, as with the other keys that widen what a
  // shareable permissions file lets run without a human.
  // @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SPEC.md
  allowDynamicBash: z.optional(z.boolean()),
});
export type ReasonixPermissionsOverride = z.infer<typeof ReasonixPermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Factory Droid. Factory Droid's `settings.json`
 * exposes security controls with no canonical per-command allow/ask/deny slot —
 * `commandBlocklist` (a hard-block tier that can never be approved, distinct from
 * an approvable `deny`), `networkPolicy` (`allowedIps`), `sandbox`
 * (`enabled`/`mode`/`filesystem`/`network`), `mcpPolicy`,
 * `mcpAutonomyOverrides` (per-MCP-tool autonomy levels), `enableDroidShield`,
 * and autonomy settings (`sessionDefaultSettings`, `maxAutonomyLevel`,
 * `subagentAutonomyLevel`, `interactionMode`). Fields placed here are merged
 * into `settings.json` and
 * emitted only for Factory Droid, while the shared `permission` block continues
 * to drive `commandAllowlist`/`commandDenylist`. Kept `looseObject` passthrough.
 *
 * @example
 * { "commandBlocklist": ["rm -rf /*"], "sandbox": { "enabled": true } }
 */
const FactorydroidPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  commandBlocklist: z.optional(z.array(z.string())),
  // Skill names Droid must not load. https://docs.factory.ai/cli/configuration/settings
  disabledSkills: z.optional(z.array(z.string())),
});
export type FactorydroidPermissionsOverride = z.infer<typeof FactorydroidPermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Warp. Warp's `[agents.profiles]` table exposes
 * file-read/read-only autonomy keys with no canonical per-command allow/ask/deny
 * slot — `agent_mode_coding_permissions`
 * (`always_ask_before_reading` | `always_allow_reading` | `allow_reading_specific_files`),
 * `agent_mode_coding_file_read_allowlist` (a path array), and
 * `agent_mode_execute_readonly_commands` (a read-only auto-execution boolean).
 * Fields placed here are merged into `[agents.profiles]` of Warp's global
 * `settings.toml`, while the shared `permission` block continues to drive the
 * command regex arrays (legacy `agent_mode_command_execution_allowlist`/
 * `_denylist` plus the `default` execution profile's `command_allowlist`/
 * `command_denylist`). On migrated installs the `[agents.profiles]` keys are
 * inert; their execution-profile counterparts are authored via the nested
 * `execution_profile` block instead, which is merged into the `default` record
 * of `[agents.execution_profiles.<id>]`. Warp permissions are global-only.
 *
 * @example
 * {
 *   "agent_mode_coding_permissions": "always_allow_reading",
 *   "agent_mode_execute_readonly_commands": true,
 *   "execution_profile": { "read_files": "always_allow", "mcp_denylist": ["untrusted-server"] }
 * }
 */
/**
 * Per-action autonomy value of Warp's execution profiles
 * (`FileActionPermission` in the Warp repository's
 * `app/src/ai/execution_profiles/config.rs`, serialized snake_case).
 */
const WarpFileActionPermissionSchema = z.enum(["agent_decides", "always_allow", "always_ask"]);

/**
 * Permission keys of the `default` record in Warp's
 * `[agents.execution_profiles.<id>]` collection (the surface runtime
 * enforcement reads on migrated installs). Loose so forward-compat keys pass
 * through verbatim. The rulesync-owned `command_allowlist`/`command_denylist`
 * are driven by the shared `permission.bash` block and always win over values
 * placed here.
 *
 * @see https://github.com/warpdotdev/warp/blob/main/app/src/ai/execution_profiles/config.rs (`ExecutionProfileFile`)
 */
const WarpExecutionProfileOverrideSchema = z.looseObject({
  read_files: z.optional(WarpFileActionPermissionSchema),
  apply_code_diffs: z.optional(WarpFileActionPermissionSchema),
  execute_commands: z.optional(WarpFileActionPermissionSchema),
  mcp_permissions: z.optional(WarpFileActionPermissionSchema),
  write_to_pty: z.optional(z.enum(["always_allow", "always_ask", "ask_on_first_write"])),
  ask_user_question: z.optional(z.enum(["never", "ask_except_in_auto_approve", "always_ask"])),
  run_agents: z.optional(z.enum(["never_allow", "always_allow", "always_ask"])),
  computer_use: z.optional(z.enum(["never", "always_ask", "always_allow"])),
  directory_allowlist: z.optional(z.array(z.string())),
  mcp_allowlist: z.optional(z.array(z.string())),
  mcp_denylist: z.optional(z.array(z.string())),
});

const WarpPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  // @see https://docs.warp.dev/terminal/settings/all-settings/
  agent_mode_coding_permissions: z.optional(
    z.enum(["always_ask_before_reading", "always_allow_reading", "allow_reading_specific_files"]),
  ),
  agent_mode_coding_file_read_allowlist: z.optional(z.array(z.string())),
  agent_mode_execute_readonly_commands: z.optional(z.boolean()),
  // Merged into the `default` execution profile, not `[agents.profiles]` —
  // see the adapter for the collection-exists guard.
  execution_profile: z.optional(WarpExecutionProfileOverrideSchema),
});
export type WarpPermissionsOverride = z.infer<typeof WarpPermissionsOverrideSchema>;

/**
 * deepagents-cli's approval-mode knobs under `[startup]` in
 * `~/.deepagents/config.toml`. They gate what dcode does without asking, but
 * none of them is a per-command rule, so they are authored here rather than in
 * the canonical `permission` block. Loose so a key added upstream passes
 * through verbatim.
 *
 * `startup.recent` is deliberately absent: dcode rewrites it as the user
 * cycles approval modes, so committing it would publish one session's state.
 *
 * @see https://docs.langchain.com/oss/deepagents/code/configuration
 */
const DeepagentsStartupOverrideSchema = z.looseObject({
  mode: z.optional(z.enum(["manual", "auto", "yolo"])),
  yolo_switcher: z.optional(z.boolean()),
  read_project_dotenv: z.optional(z.boolean()),
});

/**
 * The `[shell].allow_list` array itself is rulesync-owned, driven by the
 * shared `permission.bash` block, so it has no key here.
 */
const DeepagentsPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  startup: z.optional(DeepagentsStartupOverrideSchema),
});
export type DeepagentsPermissionsOverride = z.infer<typeof DeepagentsPermissionsOverrideSchema>;

/**
 * The actions Junie's allowlist accepts. Verified against the shipped Junie
 * CLI release `2383.10` (26.7.20): `AllowListDecision` contains exactly
 * `allow` and `ask`, and a `deny` value fails the whole-file parse — which
 * makes Junie discard and overwrite `allowlist.json` — so the schema rejects
 * it up front instead of emitting a file Junie destroys.
 */
const JunieAllowlistActionSchema = z.enum(["allow", "ask"]);

/**
 * One Junie allowlist rule: a literal `prefix` or glob `pattern` plus the
 * action taken on match.
 */
const JunieAllowlistRuleSchema = z.looseObject({
  prefix: z.optional(z.string()),
  pattern: z.optional(z.string()),
  action: JunieAllowlistActionSchema,
});

/**
 * One Junie rule group (`AllowListRuleSet`): an optional per-group fallback
 * `default` plus its ordered `rules`.
 */
const JunieAllowlistRuleSetSchema = z.looseObject({
  default: z.optional(JunieAllowlistActionSchema),
  rules: z.optional(z.array(JunieAllowlistRuleSchema)),
});

/**
 * Tool-scoped override block for JetBrains Junie. Junie's `allowlist.json` has
 * top-level autonomy knobs and per-group settings with no canonical per-glob
 * slot: `allowReadonlyCommands` (a boolean auto-allowing read-only commands),
 * `defaultBehavior` (the fallback action applied when no rule matches),
 * `readSecretFile` (the secret-file rule group — canonical `read` is already
 * taken by `readOutsideProject`, so this group is authored whole), and
 * `ruleDefaults` (each canonical-mapped group's own fallback action). Fields
 * placed here are merged into `allowlist.json`, while the shared `permission`
 * block continues to drive the rule lists of the four canonical-mapped groups.
 *
 * @example
 * {
 *   "allowReadonlyCommands": true,
 *   "defaultBehavior": "ask",
 *   "readSecretFile": { "rules": [{ "pattern": "**\/.env", "action": "ask" }] },
 *   "ruleDefaults": { "executables": "ask" }
 * }
 */
const JuniePermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  allowReadonlyCommands: z.optional(z.boolean()),
  defaultBehavior: z.optional(JunieAllowlistActionSchema),
  readSecretFile: z.optional(JunieAllowlistRuleSetSchema),
  ruleDefaults: z.optional(
    z.looseObject({
      executables: z.optional(JunieAllowlistActionSchema),
      fileEditing: z.optional(JunieAllowlistActionSchema),
      mcpTools: z.optional(JunieAllowlistActionSchema),
      readOutsideProject: z.optional(JunieAllowlistActionSchema),
    }),
  ),
});
export type JuniePermissionsOverride = z.infer<typeof JuniePermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Takt. Takt's `config.yaml` carries two
 * permission surfaces the canonical coarse-mode mapping can't express:
 * `step_permission_overrides` — a per-workflow-step map (`<step>` →
 * `readonly`/`edit`/`full`) that lives inside the active provider profile
 * alongside `default_permission_mode` and layers on top of it at that step; and
 * `provider_options` — a top-level, per-provider table of sandbox/network knobs
 * orthogonal to the permission mode (e.g. `codex.network_access`,
 * `claude.sandbox.allow_unsandboxed_commands`, `opencode.allowed_tools`). Fields
 * placed here are merged into `config.yaml` and emitted only for Takt, while the
 * shared `permission` block continues to drive `default_permission_mode`. Kept
 * `looseObject` (verbatim passthrough); Takt validates its own value sets (e.g.
 * `provider_options.<p>.base_url` must be loopback). Both project and global
 * scope are supported.
 *
 * Note: Takt's config loader hard-rejects unknown top-level keys, so only keys
 * Takt actually recognizes belong here. `required_permission_mode` is NOT one —
 * it is a per-step field of the workflow YAML (not `config.yaml`), so it is out
 * of scope for this override.
 *
 * @example
 * { "step_permission_overrides": { "ai_review": "readonly" }, "provider_options": { "codex": { "network_access": true } }, "allow_git_hooks": true }
 */
const TaktPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  // @see https://github.com/nrslib/takt/blob/main/docs/configuration.md
  step_permission_overrides: z.optional(z.record(z.string(), z.enum(["readonly", "edit", "full"]))),
  provider_options: z.optional(z.looseObject({})),
  // Takt's default-deny "workflow security policies". Each admits one class of
  // user-supplied code a workflow may otherwise not run, so they are modelled
  // key by key rather than left to passthrough: a typo in one of these silently
  // leaves the capability denied.
  workflow_arpeggio: z.optional(
    z.object({
      custom_data_source_modules: z.optional(z.boolean()),
      custom_merge_inline_js: z.optional(z.boolean()),
      custom_merge_files: z.optional(z.boolean()),
    }),
  ),
  workflow_runtime_prepare: z.optional(z.object({ custom_scripts: z.optional(z.boolean()) })),
  workflow_command_gates: z.optional(z.object({ custom_scripts: z.optional(z.boolean()) })),
  sync_conflict_resolver: z.optional(z.object({ auto_approve_tools: z.optional(z.boolean()) })),
  allow_git_hooks: z.optional(z.boolean()),
  allow_git_filters: z.optional(z.boolean()),
});
export type TaktPermissionsOverride = z.infer<typeof TaktPermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Amp. Amp's `amp.permissions` array and sibling
 * settings carry shapes the canonical per-command allow/ask/deny model can't
 * express, so they are authored here and merged into the shared Amp settings
 * file, while the shared `permission` block continues to drive the canonical
 * `amp.permissions` (allow/ask/reject) + `amp.tools.disable` entries:
 * - `permissions` — extra `amp.permissions` entries with non-`cmd` matchers
 *   (`path`/`url`/`query`/…), regex/array match values, `context`
 *   (`thread`/`subagent`), `delegate` (+`to`), or `reject` (+`message`). These
 *   are appended AFTER the canonical-generated entries (Amp is first-match-wins,
 *   so generated allow/ask/reject rules take precedence; authored entries act as
 *   later fallbacks), preserving author order.
 * - `mcpPermissions` — Amp's `amp.mcpPermissions` array (`{ matches, action }`).
 * - `guardedFiles` — `amp.guardedFiles.allowlist` (globs allowed without
 *   confirmation).
 * - `dangerouslyAllowAll` — `amp.dangerouslyAllowAll` (disable all confirmation).
 * Kept `looseObject` (verbatim passthrough). Both project and global scope are
 * supported.
 *
 * @example
 * { "dangerouslyAllowAll": false, "guardedFiles": { "allowlist": ["docs/**"] },
 *   "permissions": [{ "tool": "Bash", "action": "delegate", "to": "approve.sh" }] }
 */
const AmpPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  // @see https://ampcode.com/manual/appendix/legacy-permissions-rules.txt
  permissions: z.optional(
    z.array(
      z.looseObject({
        tool: z.string(),
        action: z.enum(["allow", "ask", "reject", "delegate"]),
        context: z.optional(z.enum(["thread", "subagent"])),
      }),
    ),
  ),
  // @see https://ampcode.com/manual (amp.mcpPermissions)
  mcpPermissions: z.optional(z.array(z.looseObject({ action: z.enum(["allow", "reject"]) }))),
  guardedFiles: z.optional(z.looseObject({ allowlist: z.optional(z.array(z.string())) })),
  dangerouslyAllowAll: z.optional(z.boolean()),
});
export type AmpPermissionsOverride = z.infer<typeof AmpPermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Pi Coding Agent. Pi has no allow/ask/deny rule
 * surface: the only repository-syncable tool gate is `defaultTools`, the list of
 * built-in tools enabled at startup (added in v0.84.2). It is an enable-list
 * rather than a canonical allow/deny rule set, so it is authored here rather
 * than mapped onto `permission`, mirroring `KimiCodePermissionsOverrideSchema`'s
 * `tools.enabled` and `VibePermissionsOverrideSchema`'s `enabled_tools`.
 *
 * An empty array is meaningful upstream — it starts Pi with no built-in tools
 * while keeping extension and SDK custom tools — so it is emitted as written.
 * CLI flags (`--tools`, `--no-tools`, `--no-builtin-tools`, `--exclude-tools`)
 * outrank the setting, and a project array **replaces** the global one rather
 * than merging with it.
 *
 * @example
 * { "defaultTools": ["bash", "edit", "write"] }
 * @see https://pi.dev/docs/latest/settings
 */
const PiPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  defaultTools: z.optional(z.array(z.string())),
});
export type PiPermissionsOverride = z.infer<typeof PiPermissionsOverrideSchema>;

/**
 * The Antigravity CLI's four documented `toolPermission` autonomy presets.
 * Exported so the import side of `antigravity-cli-permissions.ts` filters
 * against exactly the values the enum below accepts — an unrecognized value
 * carried in verbatim would fail validation of the *whole*
 * `.rulesync/permissions.jsonc`, not just that key.
 * @see https://antigravity.google/docs/cli/reference
 */
export const ANTIGRAVITY_CLI_TOOL_PERMISSIONS = [
  "request-review",
  "proceed-in-sandbox",
  "always-proceed",
  "strict",
] as const;

/**
 * The Antigravity CLI's three documented `artifactReviewPolicy` values. Shared
 * with the import filter for the same reason as
 * {@link ANTIGRAVITY_CLI_TOOL_PERMISSIONS}.
 * @see https://antigravity.google/docs/cli/settings
 */
export const ANTIGRAVITY_CLI_ARTIFACT_REVIEW_POLICIES = [
  "asks-for-review",
  "agent-decides",
  "always-proceed",
] as const;

/**
 * The baseline execution modes the CLI persists as `agentMode`. Shared with the
 * import filter for the same reason as {@link ANTIGRAVITY_CLI_TOOL_PERMISSIONS}.
 * @see https://antigravity.google/docs/cli/modes
 */
export const ANTIGRAVITY_CLI_AGENT_MODES = ["default", "accept-edits", "plan"] as const;

/**
 * Tool-scoped override block for the Google Antigravity CLI. Antigravity's CLI
 * `settings.json` carries five global autonomy/sandbox knobs outside the
 * `permissions.allow/ask/deny` arrays rulesync manages: `toolPermission` (the
 * global autonomy preset — `request-review` (default) / `proceed-in-sandbox` /
 * `always-proceed` / `strict`), `enableTerminalSandbox` (a boolean confining
 * agent-run commands to OS containment), `artifactReviewPolicy` (whether the
 * agent's artifact changes are gated on a review prompt — `asks-for-review`
 * (default) / `agent-decides` / `always-proceed`) and `allowNonWorkspaceAccess`
 * (a boolean, off by default, letting the agent read or write files outside the
 * active workspace roots), and `agentMode` (the baseline execution mode a session
 * starts in — `default` / `accept-edits` / `plan`). Antigravity applies the allow/deny
 * lists as per-rule exceptions to the preset at runtime, so rulesync only
 * authors these keys verbatim — no precedence modeling is needed on our side.
 * Fields placed here are merged onto the top level of
 * `~/.gemini/antigravity-cli/settings.json` (global-only) and emitted only for
 * the CLI. The Antigravity IDE exposes the same concepts through a GUI (no
 * documented JSON schema), so this override does NOT apply to `antigravity-ide`.
 * Verified against https://antigravity.google/docs/cli/reference,
 * https://antigravity.google/docs/cli/sandbox,
 * https://antigravity.google/docs/cli/settings and
 * https://antigravity.google/docs/cli/modes.
 *
 * @example
 * { "toolPermission": "strict", "enableTerminalSandbox": true }
 */
const AntigravityCliPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  // @see https://antigravity.google/docs/cli/reference
  toolPermission: z.optional(z.enum(ANTIGRAVITY_CLI_TOOL_PERMISSIONS)),
  enableTerminalSandbox: z.optional(z.boolean()),
  // @see https://antigravity.google/docs/cli/settings
  artifactReviewPolicy: z.optional(z.enum(ANTIGRAVITY_CLI_ARTIFACT_REVIEW_POLICIES)),
  allowNonWorkspaceAccess: z.optional(z.boolean()),
  /**
   * The baseline execution mode the CLI starts a session in (Agent Mode), the
   * persisted form of the `/settings` panel's Agent Mode row. Only
   * `~/.gemini/antigravity-cli/settings.json` is read for it, which is why this
   * override stays global-only.
   * @see https://antigravity.google/docs/cli/modes
   */
  agentMode: z.optional(z.enum(ANTIGRAVITY_CLI_AGENT_MODES)),
});
export type AntigravityCliPermissionsOverride = z.infer<
  typeof AntigravityCliPermissionsOverrideSchema
>;

/**
 * Tool-scoped override block for AugmentCode. AugmentCode's `toolPermissions[]`
 * array supports "custom policy" entries the canonical allow/ask/deny model
 * cannot express: `permission.type` of `webhook-policy` / `script-policy`
 * (delegating the decision to a `webhookUrl` / `script`) and an `eventType` of
 * `tool-response` (a post-execution check rather than the default pre-execution
 * `tool-call`). These are authored here as verbatim `toolPermissions` entries
 * and prepended — ahead of the canonical-generated basic rules — into the shared
 * `.augment/settings.json`, so a webhook/script gate or tool-response check is
 * never shadowed by a regenerated allow/deny/ask entry under AugmentCode's
 * first-match-wins evaluation. The shared `permission` block continues to drive
 * the basic `allow` / `deny` / `ask-user` entries. Kept `looseObject` (verbatim
 * passthrough) so `shellInputRegex`, `eventType`, `webhookUrl`, `script`, and
 * any future policy field survive untouched. Both project and global scope are
 * supported.
 *
 * @example
 * { "toolPermissions": [
 *     { "toolName": "github-api",
 *       "permission": { "type": "webhook-policy", "webhookUrl": "https://api.example.com/validate" } },
 *     { "toolName": "view", "eventType": "tool-response", "permission": { "type": "allow" } } ] }
 */
const AugmentcodePermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  // @see https://docs.augmentcode.com/cli/permissions
  toolPermissions: z.optional(
    z.array(
      z.looseObject({
        toolName: z.string(),
        eventType: z.optional(z.enum(["tool-call", "tool-response"])),
        permission: z.looseObject({
          type: z.enum(["allow", "deny", "ask-user", "webhook-policy", "script-policy"]),
        }),
      }),
    ),
  ),
});
export type AugmentcodePermissionsOverride = z.infer<typeof AugmentcodePermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Kiro. Kiro's agent config (`.kiro/agents/<name>.json`)
 * exposes per-tool `toolsSettings` knobs with no canonical allow/ask/deny
 * category: the shell auto-trust flags `shell.autoAllowReadonly` /
 * `shell.denyByDefault`, the `aws` built-in tool's `allowedServices` /
 * `deniedServices` (+ `autoAllowReadonly`), and the `web_fetch` domain trust
 * arrays `trusted` / `blocked` (regex host patterns; documented for `web_fetch`
 * only — `web_search` has no such surface). Fields placed here are deep-merged
 * (per `toolsSettings` key, override wins at the leaf) into the shared agent
 * config, while the canonical `permission` block continues to drive
 * `shell.{allowed,denied}Commands`, `read`/`write`/`grep`/`glob` paths, and the
 * `web_fetch`/`web_search` `allowedTools` toggles. Kept `looseObject` at every
 * level (verbatim passthrough) so future Kiro `toolsSettings` fields survive.
 *
 * Kiro's MCP `autoApprove` / `disabledTools` lists are intentionally NOT modeled
 * here: they live in a SEPARATE file (`.kiro/settings/mcp.json`, under
 * `mcpServers.<name>`), not the agent config this permissions translator writes,
 * and reconciling them with the canonical `mcp__*` model is a distinct design
 * question left out of scope.
 *
 * @example
 * { "toolsSettings": { "shell": { "autoAllowReadonly": true },
 *     "aws": { "allowedServices": ["s3"], "deniedServices": ["eks"] },
 *     "web_fetch": { "trusted": [".*github\\.com.*"] } } }
 */
const KiroPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  toolsSettings: z.optional(
    z.looseObject({
      shell: z.optional(
        z.looseObject({
          autoAllowReadonly: z.optional(z.boolean()),
          denyByDefault: z.optional(z.boolean()),
        }),
      ),
      aws: z.optional(
        z.looseObject({
          allowedServices: z.optional(z.array(z.string())),
          deniedServices: z.optional(z.array(z.string())),
          autoAllowReadonly: z.optional(z.boolean()),
        }),
      ),
      web_fetch: z.optional(
        z.looseObject({
          trusted: z.optional(z.array(z.string())),
          blocked: z.optional(z.array(z.string())),
        }),
      ),
    }),
  ),
});
export type KiroPermissionsOverride = z.infer<typeof KiroPermissionsOverrideSchema>;

/**
 * Codex CLI's approval-workflow policy. Serialized as a kebab-case string in
 * `.codex/config.toml`. `on-failure` is a legacy alias for `on-request` that
 * Codex still accepts, so it is included so existing configs round-trip. The
 * granular table form (`{ granular = { … } }`) is modeled separately in the
 * override union.
 * @see https://learn.chatgpt.com/docs/config-file/config-reference
 */
const CodexApprovalPolicySchema = z.enum(["untrusted", "on-request", "on-failure", "never"]);

/**
 * Codex CLI's classic sandbox mode. Serialized as a kebab-case string in
 * `.codex/config.toml`. Deprecated in favor of permission profiles
 * (`base_permission_profile`): Codex prioritizes these legacy sandbox keys
 * over permission profiles when both are present, so authoring one disables
 * the managed `[permissions.rulesync]` profile. Kept so existing configs
 * round-trip.
 * @see https://learn.chatgpt.com/docs/config-file/config-reference
 */
const CodexSandboxModeSchema = z.enum(["read-only", "workspace-write", "danger-full-access"]);

/**
 * Codex CLI's reviewer for approval requests. `guardian_subagent` is a legacy
 * value Codex still accepts for backward compatibility, so it is included so
 * existing configs round-trip through the rulesync model.
 * @see https://learn.chatgpt.com/docs/config-file/config-reference
 */
const CodexApprovalsReviewerSchema = z.enum(["user", "auto_review", "guardian_subagent"]);

/**
 * Codex CLI's built-in permission profiles that the managed
 * `[permissions.rulesync]` profile may extend. Codex ships three built-in
 * profiles (`:read-only`, `:workspace`, `:danger-full-access`; the leading
 * colon is reserved for built-ins), but `extends` rejects
 * `:danger-full-access` at config load time, so only these two are valid
 * `extends` parents. The value list is exported so the Codex CLI translator
 * derives its import-side baseline check from the same source.
 * @see https://learn.chatgpt.com/docs/permissions
 */
export const CODEX_EXTENDABLE_BASELINE_PROFILES = [":read-only", ":workspace"] as const;

/**
 * All accepted `codexcli.base_permission_profile` values. `:danger-full-access`
 * cannot be an `extends` parent, so selecting it makes rulesync emit
 * `default_permissions = ":danger-full-access"` directly and skip the managed
 * `[permissions.rulesync]` profile entirely (there is no sandbox for
 * filesystem/network rules to refine in that mode).
 */
export const CODEX_BASE_PERMISSION_PROFILES = [
  ...CODEX_EXTENDABLE_BASELINE_PROFILES,
  ":danger-full-access",
] as const;
const CodexBasePermissionProfileSchema = z.enum(CODEX_BASE_PERMISSION_PROFILES);

/**
 * Codex CLI-scoped permission override.
 *
 * Codex CLI's permission surface is richer than the canonical allow/ask/deny
 * model: its approval workflow, classic sandbox system, and per-app tool gating
 * have no canonical category. Author them through a tool-scoped `codexcli`
 * override whose fields are written verbatim as top-level `.codex/config.toml`
 * keys (the override wins per key; existing sibling keys the user set directly
 * are preserved):
 * - `base_permission_profile` — the built-in baseline profile (`:read-only` |
 *   `:workspace` | `:danger-full-access`). Unlike the other keys it is not a
 *   top-level config key: the extendable baselines are emitted as the managed
 *   `[permissions.rulesync]` profile's `extends` value, while
 *   `:danger-full-access` (which Codex rejects as an `extends` parent) is
 *   selected directly via `default_permissions` and skips the managed profile
 *   entirely — canonical filesystem/network rules are ignored in that mode.
 *   Defaults to `:workspace` when unspecified.
 * - `approval_policy` — `untrusted` | `on-request` (legacy alias `on-failure`) |
 *   `never`, or a `{ granular = { … } }` table (kept verbatim; the granular
 *   schema has required fields that are brittle to model as typed keys).
 *   Defaults to `on-request` when neither the override nor the existing
 *   config sets it.
 * - `sandbox_mode` — **deprecated.** `read-only` | `workspace-write` |
 *   `danger-full-access`, with the sibling `sandbox_workspace_write` table
 *   (`network_access`, `writable_roots`, …). Codex has superseded the classic
 *   sandbox system with permission profiles and prioritizes these legacy keys
 *   over profiles when both are present, so setting them disables the managed
 *   `[permissions.rulesync]` profile. Use `base_permission_profile` and the
 *   shared `permission` block instead. Still accepted so existing configs
 *   round-trip.
 * - `apps` — per-app tool gating (`apps.<id>.tools.<tool>.approval_mode` /
 *   `.enabled`, `apps.<id>.default_tools_approval_mode`).
 * - `approvals_reviewer` — the reviewer-approval surface (`user` | `auto_review`
 *   | `guardian_subagent`), or a table for the richer reviewer config.
 *   Defaults to `auto_review` when neither the override nor the existing
 *   config sets it.
 * - `git_write_rules` — whether the managed profile's `:workspace_roots` table
 *   emits the default `.git` carve-out (`".git/**" = "write"`). Codex's
 *   `:workspace` baseline makes `.git` read-only, which denies basic git
 *   workflows (commit/stage writes to `.git/index`, `.git/objects`, refs,
 *   logs; everyday commands like `git remote add` or `git push -u` write to
 *   `.git/config`), so the carve-out is emitted by default. Defaults to
 *   `true`; only an explicit `false` suppresses it. Like
 *   `base_permission_profile` it is consumed by the profile builder, not
 *   written as a top-level config key.
 *
 * The keys written to `config.toml` are an **allowlist**, not verbatim
 * passthrough: only `CODEXCLI_OVERRIDE_KEYS`
 * (`src/constants/codexcli-paths.ts` — `approval_policy`, `sandbox_mode`,
 * `sandbox_workspace_write`, `apps`, `approvals_reviewer`) are emitted, and
 * `computeCodexcliOverridePatch` skips anything else with a warning.
 * `base_permission_profile` and `git_write_rules` are consumed by the profile
 * builder rather than written, as described above, and `permission` is the
 * tool-scoped canonical block, which `RulesyncPermissions.forTarget` strips out
 * of the override before it ever reaches the patch. The allowlist is what keeps
 * the override from clobbering a feature-owned key: `mcp_servers.*` per-MCP
 * gating is owned by the MCP feature (`codexcli-mcp.ts` already writes the
 * `mcp_servers` tables in the same `config.toml`), and `permissions` /
 * `default_permissions` are owned by the canonical model. The schema itself is
 * `looseObject` so an unmodeled key parses (and is then reported rather than
 * rejected outright); supporting a new top-level Codex config key means adding
 * it to `CODEXCLI_OVERRIDE_KEYS`.
 *
 * @see https://developers.openai.com/codex/config-reference
 * @see https://developers.openai.com/codex/permissions
 *
 * @example
 * { "approval_policy": "on-request", "sandbox_mode": "workspace-write",
 *   "sandbox_workspace_write": { "network_access": true } }
 */
const CodexcliPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  base_permission_profile: z.optional(CodexBasePermissionProfileSchema),
  approval_policy: z.optional(z.union([CodexApprovalPolicySchema, z.looseObject({})])),
  /** @deprecated Superseded by `base_permission_profile` (permission profiles). */
  sandbox_mode: z.optional(CodexSandboxModeSchema),
  /** @deprecated Superseded by `base_permission_profile` (permission profiles). */
  sandbox_workspace_write: z.optional(z.looseObject({})),
  apps: z.optional(z.looseObject({})),
  approvals_reviewer: z.optional(z.union([CodexApprovalsReviewerSchema, z.looseObject({})])),
  /**
   * The `[tui]` table of `config.toml` (e.g. `vim_mode_default`, `keymap.*`).
   * Not a permission surface, but like `apps` it is a top-level table with no
   * canonical category, and Codex adds keys to it faster than an explicit model
   * could track — so it is a loose passthrough written verbatim.
   *
   * @see https://developers.openai.com/codex/config-reference
   */
  tui: z.optional(z.looseObject({})),
  git_write_rules: z.optional(z.boolean()),
});
export type CodexcliPermissionsOverride = z.infer<typeof CodexcliPermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Zed. Two Zed surfaces sit outside the canonical
 * allow/ask/deny model that `agent.tool_permissions` implements, and both are
 * authored here verbatim:
 *
 * - `sandbox_permissions` — the OS-level agent sandbox, on by default since Zed
 *   1.14.2 for the `terminal` and `fetch` tools. Its defaults forbid network
 *   access, writing outside the project directories, and writing to `.git`, so a
 *   real setup usually needs to relax one of them (`network_hosts` with exact
 *   hostnames or leading `*.` wildcards, `allow_all_hosts`, `write_paths`,
 *   `allow_fs_write_all`, `allow_unsandboxed`). This is containment, not tool
 *   gating: no canonical category expresses it, so the block is written straight
 *   into `agent.sandbox_permissions`, mirroring the Kilo / Claude Code / Codex
 *   CLI `sandbox` passthrough precedent. Kept a bare `looseObject` rather than
 *   enumerating the keys, since upstream adds to them release over release.
 * - `profiles` — the tool-availability layer, a separate enforcement stage from
 *   `tool_permissions`: a tool absent from the active profile cannot be used no
 *   matter what the permission rules say. Per-profile keys are `name`, `tools`
 *   (per-tool booleans), `enable_all_context_servers`, `context_servers` and
 *   `default_model`. Like Kimi Code's `tools.enabled`/`disabled` block this is a
 *   verbatim passthrough — no canonicalization is attempted.
 *
 * Neither surface can weaken a canonical deny, because `agent.tool_permissions`
 * is off-limits to this override: the translator consumes only the two keys
 * above by name and rejects a `tool_permissions` key with a warning.
 *
 * @see https://zed.dev/docs/ai/sandboxing
 * @see https://zed.dev/docs/ai/agent-profiles
 *
 * @example
 * { "sandbox_permissions": { "network_hosts": ["*.github.com"], "write_paths": ["/tmp"] },
 *   "profiles": { "review": { "name": "Review", "tools": { "terminal": false } } } }
 */
const ZedPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  // @see https://zed.dev/docs/ai/sandboxing
  sandbox_permissions: z.optional(z.looseObject({})),
  // @see https://zed.dev/docs/ai/agent-profiles
  profiles: z.optional(
    z.record(
      z.string(),
      z.looseObject({
        name: z.optional(z.string()),
        tools: z.optional(z.record(z.string(), z.boolean())),
        enable_all_context_servers: z.optional(z.boolean()),
        context_servers: z.optional(z.looseObject({})),
        default_model: z.optional(z.looseObject({})),
      }),
    ),
  ),
});
export type ZedPermissionsOverride = z.infer<typeof ZedPermissionsOverrideSchema>;

/**
 * Tool-scoped override block for Devin Local. `sandbox` is the sibling
 * top-level `config.json` block that governs the sandbox Devin runs commands
 * in: `allowed_domains` / `denied_domains` (proxy domain patterns, deny beating
 * allow), `network_mode` (`full`, the upstream default, allows every HTTP
 * method; `limited` only GET/HEAD/OPTIONS) and `excluded` (`allow` / `ask` /
 * `deny` lists of `Exec(...)` matchers deciding which commands run *outside* the
 * sandbox — `deny` pins them inside it). It constrains how
 * a permitted command runs rather than which commands are permitted, so it has
 * no canonical category and is authored here.
 *
 * Upstream lists `sandbox` as a **User Config Only** key, so it is emitted at
 * global scope only; at project scope it is dropped with a warning rather than
 * written into a file Devin would ignore.
 *
 * @example
 * { "sandbox": { "allowed_domains": ["github.com"], "network_mode": "limited" } }
 * @example
 * { "sandbox": { "excluded": { "allow": ["Exec(git status *)"], "deny": ["Exec(git tag *)"] } } }
 * @see https://docs.devin.ai/cli/sandbox
 * @see https://docs.devin.ai/cli/reference/configuration/config-file
 */
const DevinPermissionsOverrideSchema = z.looseObject({
  permission: z.optional(ToolScopedPermissionSchema),
  sandbox: z.optional(z.looseObject({})),
});
export type DevinPermissionsOverride = z.infer<typeof DevinPermissionsOverrideSchema>;

/**
 * Permissions configuration.
 * Keys are tool category names (e.g., "bash", "edit", "read", "webfetch").
 * Values are pattern-to-action mappings for that tool category.
 *
 * The optional tool keys below are tool-scoped overrides consumed only by their
 * respective translator (see the matching `*PermissionsOverrideSchema`); every
 * other tool reads the shared `permission` block and ignores them. The set of
 * keys is exactly `permissionsProcessorToolTargetTuple` mapped through
 * `PERMISSION_OVERRIDE_KEY_ALIASES` — a test asserts that, so this comment does
 * not enumerate them and go stale.
 *
 * Additionally, every permissions-capable tool accepts a canonical tool-scoped
 * `permission` block under its override key (`{toolname}.permission`, same
 * shape as the shared `permission` record). Its categories apply only to that
 * tool, merged over the shared block per category — see
 * `RulesyncPermissions.forTarget`. `kiro-cli`/`kiro-ide` alias to the `kiro`
 * key and `hermesagent` to `hermes` (matching the shared output file each
 * writes). OpenCode/Kilo/Vibe keep their existing tool-native `permission`
 * override semantics (handled by their translators, not the central merge).
 *
 * @example
 * {
 *   "bash": { "*": "ask", "git *": "allow", "rm *": "deny" },
 *   "edit": { "*": "deny", "src/**": "allow" }
 * }
 */
export const PermissionsConfigSchema = z.looseObject({
  permission: z.record(PermissionCategorySchema, PermissionRulesSchema),
  opencode: z.optional(OpencodePermissionsOverrideSchema),
  hermes: z.optional(HermesPermissionsOverrideSchema),
  cline: z.optional(ClinePermissionsOverrideSchema),
  kilo: z.optional(KiloPermissionsOverrideSchema),
  claudecode: z.optional(ClaudecodePermissionsOverrideSchema),
  vibe: z.optional(VibePermissionsOverrideSchema),
  cursor: z.optional(CursorPermissionsOverrideSchema),
  deepagents: z.optional(DeepagentsPermissionsOverrideSchema),
  qwencode: z.optional(QwencodePermissionsOverrideSchema),
  reasonix: z.optional(ReasonixPermissionsOverrideSchema),
  factorydroid: z.optional(FactorydroidPermissionsOverrideSchema),
  warp: z.optional(WarpPermissionsOverrideSchema),
  junie: z.optional(JuniePermissionsOverrideSchema),
  takt: z.optional(TaktPermissionsOverrideSchema),
  amp: z.optional(AmpPermissionsOverrideSchema),
  "antigravity-cli": z.optional(AntigravityCliPermissionsOverrideSchema),
  pi: z.optional(PiPermissionsOverrideSchema),
  augmentcode: z.optional(AugmentcodePermissionsOverrideSchema),
  kiro: z.optional(KiroPermissionsOverrideSchema),
  codexcli: z.optional(CodexcliPermissionsOverrideSchema),
  zed: z.optional(ZedPermissionsOverrideSchema),
  devin: z.optional(DevinPermissionsOverrideSchema),
  // Tools without tool-specific override keys still accept the canonical
  // tool-scoped `permission` block (see ToolScopedPermissionSchema).
  "antigravity-ide": z.optional(CanonicalPermissionsOverrideSchema),
  copilot: z.optional(CanonicalPermissionsOverrideSchema),
  copilotcli: z.optional(CanonicalPermissionsOverrideSchema),
  goose: z.optional(CanonicalPermissionsOverrideSchema),
  grokcli: z.optional(CanonicalPermissionsOverrideSchema),
  "kimi-code": z.optional(KimiCodePermissionsOverrideSchema),
  roo: z.optional(CanonicalPermissionsOverrideSchema),
  rovodev: z.optional(CanonicalPermissionsOverrideSchema),
  zoocode: z.optional(CanonicalPermissionsOverrideSchema),
});
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;

/**
 * Full permissions file schema including optional $schema field.
 */
export const RulesyncPermissionsFileSchema = z.looseObject({
  $schema: z.optional(z.string()),
  ...PermissionsConfigSchema.shape,
});
