import { basename, join } from "node:path";

import * as smolToml from "smol-toml";
import { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent, readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Where Vibe reads a custom system prompt from: `.vibe/prompts/<id>.md`
 * (project) and `~/.vibe/prompts/<id>.md` (user), with the custom directories
 * winning over the builtins. The id must be a bare file name with no path
 * separators.
 * @see vibe/core/prompts/__init__.py
 */
const VIBE_PROMPTS_DIR_PATH = join(".vibe", "prompts");

type VibeSubagentsFromRulesyncSubagentsParams = {
  rulesyncSubagents: RulesyncSubagent[];
  outputRoot?: string;
  global?: boolean;
  logger?: Logger;
};

/**
 * The agent name Vibe reserves for `post_agent` hook matching (v3.0.3+).
 * `AgentProfile.from_toml` refuses a file whose stem matches it case-insensitively, so an
 * agent written as `main.toml` would never load.
 * @see https://github.com/mistralai/mistral-vibe/blob/v3.0.3/vibe/core/agents/models.py
 */
const VIBE_RESERVED_AGENT_NAME = "main";

/**
 * The approval policies Vibe ships since v3.1.4. `AgentRegistry._discover`
 * never loads an agents-directory file named after one as an agent, whatever
 * its `agent_type`: from a project's `.vibe/agents/` the file is ignored with
 * an `approval_policy.project_override_ignored` config issue, and from
 * `~/.vibe/agents/` it redefines that approval policy for every session. Vibe
 * compares the file stem exactly (`agent.name in BUILTIN_APPROVAL_POLICIES`).
 * @see https://github.com/mistralai/mistral-vibe/blob/v3.1.5/vibe/core/agents/registry.py
 * @see https://github.com/mistralai/mistral-vibe/blob/v3.1.5/vibe/core/agents/models.py
 */
const VIBE_APPROVAL_POLICY_NAMES: ReadonlySet<string> = new Set([
  "ask",
  "accept-edits",
  "smart-approve",
  "auto-approve",
]);

function vibeAgentFileStem(relativeFilePath: string): string {
  return basename(relativeFilePath).replace(/\.(md|toml)$/, "");
}

function isReservedVibeAgentFileName(relativeFilePath: string): boolean {
  return vibeAgentFileStem(relativeFilePath).toLowerCase() === VIBE_RESERVED_AGENT_NAME;
}

function isVibeApprovalPolicyFileName(relativeFilePath: string): boolean {
  return VIBE_APPROVAL_POLICY_NAMES.has(vibeAgentFileStem(relativeFilePath));
}

/**
 * The keys Vibe ignores on a custom `agent_type = "agent"` profile since
 * v3.1.4, listing each as a config issue: `_agent_settings` drops every
 * `VibeConfigSchema` field outside its `_AGENT_KEYS`, plus `safety` and
 * `approval_policy`, because what runs without asking belongs to the approval
 * policy, not to the agent. A key outside this list is kept, as Vibe keeps it:
 * an agent key passes, and an unknown key (a typo such as `disabled_tool`)
 * stays so Vibe can report it — or refuse it under `strict_config`.
 * Generated from the `VibeConfigSchema` fields of v3.1.5 minus `_AGENT_KEYS`.
 * @see https://github.com/mistralai/mistral-vibe/blob/v3.1.5/vibe/core/agents/models.py
 * @see https://github.com/mistralai/mistral-vibe/blob/v3.1.5/vibe/core/config/vibe_schema.py
 */
const VIBE_AGENT_IGNORED_KEYS: ReadonlySet<string> = new Set([
  "safety",
  "approval_policy",
  "catalog_model_aliases",
  "catalog_recommended_model",
  "catalog_default_model",
  "utility_models",
  "active_transcribe_model",
  "transcribe_providers",
  "transcribe_models",
  "active_tts_model",
  "tts_providers",
  "tts_models",
  "outside_workdir",
  "mcp_servers",
  "enable_connectors",
  "enable_mcp",
  "experimental_enable_document_library_connector",
  "experimental_enable_mistral_mcp_connector",
  "connectors",
  "agent_paths",
  "enabled_agents",
  "disabled_agents",
  "installed_agents",
  "default_agent",
  "default_approval_policy",
  "vibe_bot_max_approval_policy",
  "vibe_bot_local_tools",
  "vibe_bot_local_tool_max_bytes",
  "smart_approve_available",
  "enable_auto_approve",
  "enabled_plugins",
  "disabled_plugins",
  "experimental_enable_remote_plugins",
  "experimental_enable_registry_skills",
  "enable_model_catalog",
  "enable_builtin_models",
  "experimental_enable_storage_usage",
  "enable_pr_monitoring",
  "experimental_local_runtime_session_api",
  "experimental_target_runtime",
  "enable_otel",
  "otel_endpoint",
  "otel_redaction",
  "console_base_url",
  "theme",
  "applied_migrations",
  "disable_welcome_banner_animation",
  "disable_selection_animation",
  "cursor_blink",
  "vim_keybindings",
  "show_dangerous_directory_warning",
  // cspell:ignore autocopy -- a Vibe config field name
  "autocopy_to_clipboard",
  "enable_mouse_capture",
  "enable_sticky_prompt",
  "collapse_turn_details",
  "enable_file_autocomplete",
  "file_watcher_for_autocomplete",
  "ask_confirmation_on_exit",
  "displayed_workdir",
  "context_warnings",
  "voice_mode_enabled",
  "narrator_enabled",
  "show_thinking_nodes",
  "show_subagent_status_list",
  "worktree_limit",
  "auto_worktree",
  "worktree_copy_on_write",
  "bypass_tool_permissions",
  "raise_on_compaction_failure",
  "enable_telemetry",
  "managed_shell_tools_enabled",
  "enable_background_processes",
  "enable_subagents",
  "max_subagents",
  "max_concurrent_subagents",
  "compaction_prompt_id",
  "title_prompt_id",
  "include_commit_signature",
  "include_model_info",
  "include_project_context",
  "include_prompt_detail",
  "strict_config",
  "enable_update_checks",
  "enable_auto_update",
  "enable_notifications",
  "keep_awake",
  "experimental_enable_tab_status",
  "enable_system_trust_store",
  "api_timeout",
  "api_retry_max_elapsed_time",
  "max_goal_token_budget",
  "api_stream_idle_timeout",
  "agent_max_output_tokens",
  "compaction_max_output_tokens",
  "compaction_reasoning_limit_tokens",
  "output_limit_retries",
  "api_connect_timeout",
  "api_write_timeout",
  "api_pool_timeout",
  "vibe_base_url",
  "vibe_code_sessions_base_url",
  "log_level",
  "project_context",
  "session_logging",
  "experiments",
]);

/**
 * The legacy key Vibe folds into `disabled_tools` before it filters an agent
 * profile (`migrate_agent_profile_config`).
 * @see https://github.com/mistralai/mistral-vibe/blob/v3.1.5/vibe/core/agents/_migration.py
 */
const VIBE_LEGACY_BASE_DISABLED_KEY = "base_disabled";

/** Per tool, an agent keeps only the shell timeouts and a narrowing `permission`. */
const VIBE_AGENT_TOOL_KEYS: ReadonlySet<string> = new Set([
  "default_timeout",
  "max_timeout_seconds",
]);
const VIBE_AGENT_NARROWING_PERMISSIONS: ReadonlySet<unknown> = new Set(["ask", "never"]);

/**
 * Fold a legacy `base_disabled` list into `disabled_tools` the way Vibe's
 * `migrate_agent_profile_config` does, so the restriction it carries is kept.
 */
function migrateVibeBaseDisabled(tomlObj: Record<string, unknown>): Record<string, unknown> {
  const legacyDisabled = tomlObj[VIBE_LEGACY_BASE_DISABLED_KEY];
  if (!Array.isArray(legacyDisabled)) {
    return tomlObj;
  }
  const rest = Object.fromEntries(
    Object.entries(tomlObj).filter(([key]) => key !== VIBE_LEGACY_BASE_DISABLED_KEY),
  );
  const disabledTools = rest.disabled_tools;
  return {
    ...rest,
    disabled_tools: Array.isArray(disabledTools)
      ? [...new Set([...disabledTools, ...legacyDisabled])]
      : legacyDisabled,
  };
}

/**
 * Drop the settings Vibe ignores on an `agent_type = "agent"` profile, so the
 * generated file does not pretend to grant what Vibe refuses. Mirrors Vibe's
 * `_agent_settings`; returns the kept TOML object and the dotted keys that
 * were dropped.
 */
function stripVibeAgentIgnoredSettings(tomlObj: Record<string, unknown>): {
  kept: Record<string, unknown>;
  dropped: string[];
} {
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(migrateVibeBaseDisabled(tomlObj))) {
    if (VIBE_AGENT_IGNORED_KEYS.has(key)) {
      dropped.push(key);
      continue;
    }
    if (key !== "tools" || typeof value !== "object" || value === null || Array.isArray(value)) {
      kept[key] = value;
      continue;
    }
    const tools: Record<string, unknown> = {};
    for (const [tool, settings] of Object.entries(value)) {
      if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
        dropped.push(`tools.${tool}`);
        continue;
      }
      const own: Record<string, unknown> = {};
      for (const [setting, settingValue] of Object.entries(settings)) {
        if (
          VIBE_AGENT_TOOL_KEYS.has(setting) ||
          (setting === "permission" && VIBE_AGENT_NARROWING_PERMISSIONS.has(settingValue))
        ) {
          own[setting] = settingValue;
        } else {
          dropped.push(`tools.${tool}.${setting}`);
        }
      }
      if (Object.keys(own).length > 0) {
        tools[tool] = own;
      }
    }
    if (Object.keys(tools).length > 0) {
      kept.tools = tools;
    }
  }
  return { kept, dropped: dropped.toSorted() };
}

/**
 * Vibe resolves a `system_prompt_id` by file name, and
 * `VibeConfigSchema._check_system_prompt` evaluates it during validation — an
 * unresolvable id raises and the agent is dropped at discovery. The id must
 * therefore stay a bare slug with no path separators.
 */
function promptSlug(relativeFilePath: string): string {
  return basename(relativeFilePath)
    .replace(/\.(md|toml)$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

export const VibeSubagentTomlSchema = z.looseObject({
  agent_type: z.enum(["agent", "subagent"]),
  display_name: z.optional(z.string()),
  description: z.optional(z.string()),
  safety: z.optional(z.string()),
  active_model: z.optional(z.string()),
  system_prompt: z.optional(z.string()),
  system_prompt_id: z.optional(z.string()),
  compaction_prompt: z.optional(z.string()),
  compaction_prompt_id: z.optional(z.string()),
  enabled_tools: z.optional(z.array(z.string())),
  disabled_tools: z.optional(z.array(z.string())),
  tools: z.optional(z.record(z.string(), z.looseObject({}))),
});

type VibeSubagentToml = z.infer<typeof VibeSubagentTomlSchema>;

export type VibeSubagentParams = {
  body: string;
  /**
   * True for the companion `.vibe/prompts/<id>.md` file, whose body is Markdown
   * rather than agent TOML and therefore must not be schema-validated.
   */
  promptFile?: boolean;
  /** The system prompt resolved from `system_prompt_id` during import. */
  resolvedSystemPrompt?: string;
} & AiFileParams;

export class VibeSubagent extends ToolSubagent {
  private readonly body: string;
  private readonly promptFile: boolean;
  private readonly resolvedSystemPrompt: string | undefined;

  constructor({ body, promptFile = false, resolvedSystemPrompt, ...rest }: VibeSubagentParams) {
    if (rest.validate !== false && !promptFile) {
      try {
        VibeSubagentTomlSchema.parse(smolToml.parse(body));
      } catch (error) {
        throw new Error(
          `Invalid TOML in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(error)}`,
          { cause: error },
        );
      }
    }

    super({ ...rest });
    this.body = body;
    this.promptFile = promptFile;
    this.resolvedSystemPrompt = resolvedSystemPrompt;
  }

  /** True for the companion `.vibe/prompts/<id>.md` file. */
  isPromptFile(): boolean {
    return this.promptFile;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".vibe", "agents"),
    };
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    let parsed: VibeSubagentToml;
    try {
      parsed = VibeSubagentTomlSchema.parse(smolToml.parse(this.body));
    } catch (error) {
      throw new Error(
        `Failed to parse TOML in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const { system_prompt, system_prompt_id, description, display_name, ...vibeSection } = parsed;
    // A `system_prompt_id` resolved to a prompt file becomes the canonical body,
    // so the id is not carried into the `vibe:` section — regenerating derives
    // it from the file stem. An id we could NOT resolve is kept so the agent
    // still points at whatever prompt the user maintains by hand.
    const resolvedBody = this.resolvedSystemPrompt ?? system_prompt;
    const unresolvedPromptId =
      this.resolvedSystemPrompt === undefined ? system_prompt_id : undefined;
    const fileStem = basename(this.getRelativeFilePath(), ".toml");
    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["vibe"],
      name: display_name ?? fileStem,
      ...(description !== undefined && { description }),
      vibe: {
        ...(display_name !== undefined && { display_name }),
        ...(description !== undefined && { description }),
        ...(unresolvedPromptId !== undefined && { system_prompt_id: unresolvedPromptId }),
        ...vibeSection,
      },
    };

    return new RulesyncSubagent({
      outputRoot: ".", // RulesyncSubagent outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: resolvedBody ?? "",
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath().replace(/\.toml$/, ".md"),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
    logger,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const frontmatter = rulesyncSubagent.getFrontmatter();
    const rawSection: Record<string, unknown> = frontmatter.vibe ?? {};
    const vibeSection = this.filterToolSpecificSection(rawSection, [
      "agent_type",
      "display_name",
      "description",
      "system_prompt",
    ]);

    const promptBody = rulesyncSubagent.getBody();
    // Vibe's settable field is `system_prompt_id`; `system_prompt` is a
    // read-only property on `VibeSchema` and pydantic's `extra="ignore"` drops
    // the key silently, so an agent written with it loads with the DEFAULT
    // system prompt. The body therefore goes to `.vibe/prompts/<slug>.md` and
    // the agent references it by id — the mechanism upstream's own builtin
    // profiles use (`EXPLORE` sets `"system_prompt_id": "explore"`).
    const slug = promptSlug(rulesyncSubagent.getRelativeFilePath());

    const tomlObj: VibeSubagentToml = {
      agent_type: rawSection.agent_type === "agent" ? "agent" : "subagent",
      display_name:
        typeof rawSection.display_name === "string" ? rawSection.display_name : frontmatter.name,
      ...(frontmatter.description ? { description: frontmatter.description } : {}),
      ...vibeSection,
      // A generated prompt file always wins over an authored `system_prompt_id`:
      // the two would otherwise disagree about which prompt the body lives in.
      ...(promptBody ? { system_prompt_id: slug } : {}),
    };

    let finalToml: Record<string, unknown> = tomlObj;
    if (tomlObj.agent_type === "agent") {
      const { kept, dropped } = stripVibeAgentIgnoredSettings(tomlObj);
      if (dropped.length > 0) {
        logger?.warn(
          `Vibe subagent ${rulesyncSubagent.getRelativeFilePath()}: dropped ` +
            `${dropped.map((key) => `'${key}'`).join(", ")}, which Vibe v3.1.4+ ignores on an ` +
            'agent_type = "agent" profile and reports as a config issue. What runs without asking ' +
            "belongs to the approval policy: set default_approval_policy and [tools.*] in " +
            'config.toml, or use agent_type = "subagent".',
        );
      }
      finalToml = kept;
    }

    const body = smolToml.stringify(finalToml);
    const paths = this.getSettablePaths({ global });
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath().replace(/\.md$/, ".toml");

    return new VibeSubagent({
      outputRoot,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent: body,
      validate,
      global,
    });
  }

  /**
   * Emits the agent TOML plus its companion prompt file. The prompt file MUST
   * be written together with the id: `VibeConfigSchema._check_system_prompt`
   * evaluates the property during validation, so an unresolvable
   * `system_prompt_id` raises and `AgentRegistry._try_load` drops the agent
   * with a warning.
   *
   * A subagent named `main` is skipped with a warning: Vibe reserves that name
   * for hook matching and does not load an agent file called `main.toml`. So is
   * one named after an approval policy (`ask`, `accept-edits`, `smart-approve`,
   * `auto-approve`): Vibe ignores such a file in a project and treats it as a
   * redefinition of that policy in `~/.vibe/agents/`, never as an agent.
   */
  static fromRulesyncSubagents({
    rulesyncSubagents,
    outputRoot = process.cwd(),
    global = false,
    logger,
  }: VibeSubagentsFromRulesyncSubagentsParams): VibeSubagent[] {
    return rulesyncSubagents.flatMap((rulesyncSubagent) => {
      const sourcePath = rulesyncSubagent.getRelativeFilePath();
      if (isReservedVibeAgentFileName(sourcePath)) {
        logger?.warn(
          `Skipping Vibe subagent ${sourcePath}: Vibe reserves the agent name ` +
            `'${VIBE_RESERVED_AGENT_NAME}' for hook matching and does not load an agent file ` +
            `named '${VIBE_RESERVED_AGENT_NAME}'. Rename the subagent file.`,
        );
        return [];
      }
      if (isVibeApprovalPolicyFileName(sourcePath)) {
        const policy = vibeAgentFileStem(sourcePath);
        logger?.warn(
          `Skipping Vibe subagent ${sourcePath}: '${policy}' is a Vibe approval policy name ` +
            "(v3.1.4+), so Vibe never loads an agent file of that name — a project's " +
            ".vibe/agents/ file is ignored and a ~/.vibe/agents/ file redefines the approval " +
            "policy instead. Rename the subagent file.",
        );
        return [];
      }
      const agentFile = VibeSubagent.fromRulesyncSubagent({
        outputRoot,
        relativeDirPath: VibeSubagent.getSettablePaths({ global }).relativeDirPath,
        rulesyncSubagent,
        global,
        logger,
      }) as VibeSubagent;

      const promptBody = rulesyncSubagent.getBody();
      if (!promptBody) {
        return [agentFile];
      }

      const slug = promptSlug(rulesyncSubagent.getRelativeFilePath());
      return [
        agentFile,
        new VibeSubagent({
          outputRoot,
          body: promptBody,
          relativeDirPath: VIBE_PROMPTS_DIR_PATH,
          relativeFilePath: `${slug}.md`,
          fileContent: promptBody,
          promptFile: true,
          validate: false,
          global,
        }),
      ];
    });
  }

  validate(): ValidationResult {
    try {
      VibeSubagentTomlSchema.parse(smolToml.parse(this.body));
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "vibe",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<VibeSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);

    // Recover the body a `system_prompt_id` points at, so a hand-written Vibe
    // agent using the real mechanism does not import with an empty body.
    // `system_prompt` stays accepted as a legacy read.
    const resolvedSystemPrompt = await VibeSubagent.readSystemPrompt({
      outputRoot,
      fileContent,
    });

    const subagent = new VibeSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      body: fileContent.trim(),
      fileContent,
      validate,
      global,
      ...(resolvedSystemPrompt !== undefined && { resolvedSystemPrompt }),
    });

    if (validate) {
      const result = subagent.validate();
      if (!result.success) {
        throw new Error(`Invalid TOML in ${filePath}: ${formatError(result.error)}`);
      }
    }

    return subagent;
  }

  /**
   * Read `.vibe/prompts/<id>.md` for an agent that names a `system_prompt_id`.
   * Returns `undefined` when there is no id or the file is missing, in which
   * case import falls back to the legacy `system_prompt` key.
   */
  private static async readSystemPrompt({
    outputRoot,
    fileContent,
  }: {
    outputRoot: string;
    fileContent: string;
  }): Promise<string | undefined> {
    let promptId: unknown;
    try {
      promptId = VibeSubagentTomlSchema.parse(smolToml.parse(fileContent)).system_prompt_id;
    } catch {
      return undefined;
    }
    // A bare slug only: upstream refuses ids containing a path separator, and
    // honoring one here would read outside the prompts directory.
    if (typeof promptId !== "string" || promptId === "" || /[\\/]/.test(promptId)) {
      return undefined;
    }
    return (
      (await readFileContentOrNull(join(outputRoot, VIBE_PROMPTS_DIR_PATH, `${promptId}.md`))) ??
      undefined
    );
  }

  /**
   * A file in `.vibe/agents/` named after an approval policy is not an agent:
   * in `~/.vibe/agents/` it is the user's override of that policy (often a
   * narrower one), and in a project Vibe ignores it. It is therefore neither
   * imported as a subagent (with a warning) nor swept as an orphan, since
   * deleting a narrowing override would fall back to the broader builtin.
   */
  static async isFileOwned({
    relativeFilePath,
    forDeletion = false,
    logger,
  }: {
    outputRoot: string;
    relativeDirPath: string;
    relativeFilePath: string;
    forDeletion?: boolean;
    logger?: Logger;
  }): Promise<boolean> {
    if (!isVibeApprovalPolicyFileName(relativeFilePath)) {
      return true;
    }
    if (!forDeletion) {
      logger?.warn(
        `Skipping Vibe agent file ${relativeFilePath}: '${vibeAgentFileStem(relativeFilePath)}' ` +
          "is a Vibe approval policy name (v3.1.4+), so the file overrides that approval policy " +
          "rather than defining an agent, and it is not imported as a subagent.",
      );
    }
    return false;
  }

  /** Never delete an approval-policy override; see {@link VibeSubagent.isFileOwned}. */
  override isDeletable(): boolean {
    return this.promptFile || !isVibeApprovalPolicyFileName(this.getRelativeFilePath());
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolSubagentForDeletionParams): VibeSubagent {
    return new VibeSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      body: "",
      fileContent: "",
      validate: false,
      global,
    });
  }
}
