import { z } from "zod/mini";

import { CODEBUDDY_LOCAL_RULE_FILE_NAME } from "../../constants/codebuddy-paths.js";
import { CODEXCLI_PROJECT_DOC_MAX_BYTES } from "../../constants/codexcli-paths.js";
import { CRUSH_LOCAL_RULE_FILE_NAME } from "../../constants/crush-paths.js";
import { KIMI_CODE_PLUGIN_SYSTEM_PROMPT_MAX_BYTES } from "../../constants/plugin-paths.js";
import { QODER_LOCAL_RULE_FILE_NAME } from "../../constants/qoder-paths.js";
import { QWENCODE_LOCAL_RULE_FILE_NAME } from "../../constants/qwencode-paths.js";
import { REASONIX_LOCAL_RULE_FILE_NAME } from "../../constants/reasonix-paths.js";
import { XUM_LOCAL_RULE_FILE_NAME } from "../../constants/xum-paths.js";
import { ToolFile } from "../../types/tool-file.js";
import { rulesProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import { type Logger } from "../../utils/logger.js";
import { AgentsmdCommand } from "../commands/agentsmd-command.js";
import { KiloMcp } from "../mcp/kilo-mcp.js";
import { MimocodeMcp } from "../mcp/mimocode-mcp.js";
import { OpencodeMcp } from "../mcp/opencode-mcp.js";
import { Opencodev1Mcp } from "../mcp/opencodev1-mcp.js";
import { AgentsmdSkill } from "../skills/agentsmd-skill.js";
import { RovodevSkill } from "../skills/rovodev-skill.js";
import { RulesyncSkill } from "../skills/rulesync-skill.js";
import { AgentsmdSubagent } from "../subagents/agentsmd-subagent.js";
import { QwencodeSubagent } from "../subagents/qwencode-subagent.js";
import { RovodevSubagent } from "../subagents/rovodev-subagent.js";
import { AgentsMdRule } from "./agentsmd-rule.js";
import { AiassistantRule } from "./aiassistant-rule.js";
import { AmpRule } from "./amp-rule.js";
import { AntigravityCliRule } from "./antigravity-cli-rule.js";
import { AntigravityIdeRule } from "./antigravity-ide-rule.js";
import { AntigravityPluginRule } from "./antigravity-plugin-rule.js";
import { AugmentcodeLegacyRule } from "./augmentcode-legacy-rule.js";
import { AugmentcodePluginRule } from "./augmentcode-plugin-rule.js";
import { AugmentcodeRule } from "./augmentcode-rule.js";
import { BobRule } from "./bob-rule.js";
import { ClaudecodeLegacyRule } from "./claudecode-legacy-rule.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { ClineRule } from "./cline-rule.js";
import { CodebuddyRule } from "./codebuddy-rule.js";
import { CodebuffRule } from "./codebuff-rule.js";
import { CodewhaleRule } from "./codewhale-rule.js";
import { CodexcliRule, readCodexcliProjectDocMaxBytes } from "./codexcli-rule.js";
import { CommandcodeRule } from "./commandcode-rule.js";
import { ContinueRule } from "./continue-rule.js";
import { CopilotRule } from "./copilot-rule.js";
import { CopilotcliRule } from "./copilotcli-rule.js";
import { CortexcodeRule } from "./cortexcode-rule.js";
import { CrushRule } from "./crush-rule.js";
import { CursorRule } from "./cursor-rule.js";
import { DeepagentsRule } from "./deepagents-rule.js";
import { DevinPluginRule } from "./devin-plugin-rule.js";
import { DevinRule } from "./devin-rule.js";
import { DshRule } from "./dsh-rule.js";
import { FactorydroidRule } from "./factorydroid-rule.js";
import { FirebenderRule } from "./firebender-rule.js";
import { GitlabduoRule } from "./gitlabduo-rule.js";
import { GooseRule } from "./goose-rule.js";
import { GrokcliRule } from "./grokcli-rule.js";
import { HermesagentRule } from "./hermesagent-rule.js";
import { ProjectInstructionBudget } from "./instruction-budget.js";
import { JunieRule } from "./junie-rule.js";
import { KiloRule } from "./kilo-rule.js";
import { KimiCodePluginRule } from "./kimi-code-plugin-rule.js";
import { KimiCodeRule } from "./kimi-code-rule.js";
import { KiroCliRule } from "./kiro-cli-rule.js";
import { KiroIdeRule } from "./kiro-ide-rule.js";
import { KiroRule } from "./kiro-rule.js";
import { MimocodeRule } from "./mimocode-rule.js";
import { MusecodeRule } from "./musecode-rule.js";
import { OmpRule } from "./omp-rule.js";
import { OpenclawRule } from "./openclaw-rule.js";
import { OpenCodeRule } from "./opencode-rule.js";
import { Opencodev1Rule } from "./opencodev1-rule.js";
import { PiRule } from "./pi-rule.js";
import { PoolRule } from "./pool-rule.js";
import { QoderRule } from "./qoder-rule.js";
import { QwencodeRule } from "./qwencode-rule.js";
import { ReasonixRule } from "./reasonix-rule.js";
import { ReplitRule } from "./replit-rule.js";
import { RooRule } from "./roo-rule.js";
import { RovodevRule } from "./rovodev-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { TabnineRule } from "./tabnine-rule.js";
import { TaktRule } from "./takt-rule.js";
import {
  ToolRule,
  ToolRuleBuildLocalRootFileParams,
  ToolRuleExtraFixedFile,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleNestedFilePatterns,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
} from "./tool-rule.js";
import { TraeRule } from "./trae-rule.js";
import { VibeRule } from "./vibe-rule.js";
import { WarpRule } from "./warp-rule.js";
import { XumRule } from "./xum-rule.js";
import { ZcodeRule } from "./zcode-rule.js";
import { ZedRule } from "./zed-rule.js";
import { ZoocodeRule } from "./zoocode-rule.js";

export type RulesProcessorToolTarget = (typeof rulesProcessorToolTargetTuple)[number];
export const RulesProcessorToolTargetSchema = z.enum(rulesProcessorToolTargetTuple);

/**
 * Rule discovery mode for determining how non-root rules are referenced.
 * - `auto`: Tool auto-discovers rules in a directory, no reference section needed
 * - `toon`: Tool requires explicit references using TOON format
 * - `claudecode-legacy`: Uses Claude Code specific reference format (legacy mode only)
 */
export type RuleDiscoveryMode = "auto" | "toon" | "claudecode-legacy";

/**
 * Type for command class that provides settable paths.
 */
type CommandClassType = {
  getSettablePaths: (options?: { global?: boolean }) => {
    relativeDirPath: string;
  };
};

/**
 * Type for subagent class that provides settable paths.
 */
type SubagentClassType = {
  getSettablePaths: (options?: { global?: boolean }) => {
    relativeDirPath: string;
  };
};

/**
 * Type for skill class that can be used to build skill list.
 */
type SkillClassType = {
  isTargetedByRulesyncSkill: (rulesyncSkill: RulesyncSkill) => boolean;
  getSettablePaths: (options?: { global?: boolean }) => {
    relativeDirPath: string;
  };
};

/**
 * Configuration for additional convention paths embedded in the root rule (e.g. AGENTS.md).
 * Used for simulated features and for native subagents/skills when `ruleDiscoveryMode` is `toon`.
 */
type AdditionalConventionsConfig = {
  /** Command feature configuration */
  commands?: {
    commandClass: CommandClassType;
  };
  /** Subagent feature configuration */
  subagents?: {
    subagentClass: SubagentClassType;
  };
  /** Skill feature configuration */
  skills?: {
    skillClass: SkillClassType;
    /** Whether skills are only supported in global mode */
    globalOnly?: boolean;
  };
};

/**
 * Integration contract that lets the rules feature register non-root rule paths
 * into an MCP-owned shared config without knowing its file format. The MCP feature
 * (kilo.jsonc, opencode.json) implements `fromInstructions`.
 */
type McpInstructionsRegistrar = {
  fromInstructions(params: {
    outputRoot?: string;
    instructions: string[];
    validate?: boolean;
    global?: boolean;
    logger?: Logger;
  }): Promise<ToolFile | null>;
};

type LocalRootMode = "separate-local-file" | "append-to-root";
export type RuleCollisionPolicy = "compose" | "fold" | "preserve";
/**
 * Factory entry for each tool rule class.
 * Stores the class reference and metadata for a tool.
 */
export type ToolRuleFactory = {
  class: {
    isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean;
    fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): ToolRule;
    fromFile(params: ToolRuleFromFileParams): Promise<ToolRule>;
    forDeletion(params: ToolRuleForDeletionParams): ToolRule;
    getSettablePaths(options?: {
      global?: boolean;
    }): ToolRuleSettablePaths | ToolRuleSettablePathsGlobal;
    /**
     * When present, this tool mirrors its generated root rule to a project-root
     * `AGENTS.md` (project scope only). Presence of this single method — not a
     * separate `meta` flag — is the source of truth for "this tool mirrors": it
     * returns one contract that bundles the mirror's generation and deletion so
     * the two cannot drift out of symmetry (a tool cannot define one without the
     * other). See {@link RovodevRule.getRootMirror}.
     */
    getRootMirror?(): {
      getMirrorFiles(params: {
        outputRoot: string;
        rootRule: ToolRule;
        content: string;
      }): ToolRule[];
      /** Both globs relative to the project root, which the processor passes as `cwd`. */
      getMirrorDeletionGlobs(): {
        primaryGlob: string;
        mirrorGlob: string;
      };
    };
    /**
     * Override where the `separate-local-file` glob points when the tool writes
     * its local file outside its root dir. Used for both import and deletion.
     * Relative to the project root, which the processor passes as `cwd`.
     * See {@link RovodevRule.getLocalRootFileGlob}.
     */
    getLocalRootFileGlob?(params: { fileName: string }): string;
    /**
     * Build the tool's separate personal local-root file. Required for a tool
     * whose `meta.localRootMode` is `separate-local-file`; a tool without it
     * emits and imports no local file. See {@link ClaudecodeRule.buildLocalRootFile}.
     */
    buildLocalRootFile?(params: ToolRuleBuildLocalRootFileParams): ToolRule;
    /**
     * Extra fixed-path files this tool manages beyond the root and non-root
     * rules (e.g. Pi's `APPEND_SYSTEM.md` system-prompt file). The RulesProcessor
     * enumerates these on import and deletion so they round-trip and stale files
     * are cleaned up when no rule targets them. See {@link PiRule.getExtraFixedFiles}.
     */
    getExtraFixedFiles?(params: { global?: boolean }): ToolRuleExtraFixedFile[];
    /**
     * Non-root rules a tool emits in global mode even though it has no global
     * non-root path, because the rule opts into a surface of its own that has
     * a home-directory scope. See {@link FactorydroidRule.isEmittedAsGlobalNonRootRule}.
     */
    isEmittedAsGlobalNonRootRule?(rulesyncRule: RulesyncRule): boolean;
    /**
     * Patterns for rule files this tool discovers by glob rather than at a fixed
     * path, used when the tool's scoping mechanism is the same file name repeated
     * in subdirectories (the AGENTS.md standard's nested files). Import-only:
     * the matches are hand-authored files outside any rulesync-owned directory,
     * so enumerating them for `--delete` would sweep away work rulesync never
     * wrote. See {@link AgentsMdRule.getNestedFilePatterns}.
     */
    getNestedFilePatterns?(): ToolRuleNestedFilePatterns;
  };
  meta: {
    /** File extension for the rule file */
    extension: "md" | "mdc";
    /**
     * Whether this tool supports project mode. Defaults to `true`; set it to
     * `false` for a global-only target whose project files another target
     * already writes (e.g. Codebuff reads the `agentsmd` target's `AGENTS.md`).
     */
    supportsProject?: boolean;
    /** Whether this tool supports global (user scope) mode */
    supportsGlobal: boolean;
    /** How non-root rules are discovered or referenced */
    ruleDiscoveryMode: RuleDiscoveryMode;
    /**
     * Default discovery mode in global mode, when it differs from
     * `ruleDiscoveryMode` (e.g. the global non-root directory is auto-loaded
     * while the project one is referenced from the root file).
     */
    ruleDiscoveryModeGlobal?: RuleDiscoveryMode;
    /**
     * The global non-root directory is shared with files rulesync did not
     * write and is read only at its top level by the tool (e.g. Antigravity's
     * `~/.gemini/config/rules/`). Global import then scans only top-level
     * files and skips an unreadable one with a warning instead of failing.
     */
    sharedGlobalNonRootDir?: boolean;
    /**
     * Glob (relative to the non-root directory) that import scans instead of
     * `**\/*.<extension>`, for a tool that reads its rules directory only at
     * the top level or also accepts another extension (e.g. oh-my-pi's
     * `.omp/rules/*.{md,mdc}`). Deletion keeps the default glob, so files
     * rulesync never writes (another extension) are left alone and nested
     * files from earlier generations are still cleaned up.
     */
    nonRootImportGlob?: string;
    /** Configuration for additional convention paths in the root rule */
    additionalConventions?: AdditionalConventionsConfig;
    /** Whether to create a separate rule file for additional conventions instead of prepending to root */
    createsSeparateConventionsRule?: boolean;
    /** How rules that resolve to the same output path are handled. */
    collisionPolicy?: RuleCollisionPolicy;
    /**
     * MCP feature that registers non-root rule paths into its shared config's
     * `instructions` key (project scope only); set when the tool does not
     * auto-load non-root rules. The root rule is auto-loaded and never registered.
     */
    mcpInstructionsRegistrar?: McpInstructionsRegistrar;
    /**
     * Whether the registrar also runs in global mode (the tool reads
     * `instructions` from its global config too, e.g. OpenCode's
     * `~/.config/opencode/opencode.json`). Off by default: some tools
     * auto-discover their global non-root directory (Kilo) and registering
     * there would be wrong.
     */
    mcpInstructionsRegistrarGlobal?: boolean;
    /** How a `localRoot: true` rule is materialized. Defaults to `append-to-root`. */
    localRootMode?: LocalRootMode;
    /** File name for the `separate-local-file` local-root file. */
    localRootFileName?: string;
    /**
     * Default byte budget the tool reads across the project instruction files
     * on one root-to-cwd chain before silently dropping the rest (Codex CLI's
     * `project_doc_max_bytes`, or the size past which Kimi Code ignores a
     * plugin's `SYSTEM.md`). Project scope only; generation warns when a
     * generated chain exceeds `bytes`, appending the tool-specific `remedy`.
     * When the tool lets a project raise the budget in its own config,
     * `readConfiguredBytes` returns that value (or `undefined` when unset), and
     * it replaces `bytes`; `configuredSource` names where it came from. A
     * configured value of `0` means the tool loads no project instruction
     * files at all (Codex's "project docs disabled"), and generation says so
     * instead of reporting the size. `defaultLimitHint` is appended only when
     * the default budget was used, e.g. to point out a budget set somewhere
     * rulesync does not read.
     */
    projectInstructionBudget?: ProjectInstructionBudget;
  };
};

/**
 * Factory Map mapping tool targets to their rule factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
export const toolRuleFactories = new Map<RulesProcessorToolTarget, ToolRuleFactory>([
  [
    "agentsmd",
    {
      class: AgentsMdRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "toon",
        collisionPolicy: "compose",
        additionalConventions: {
          commands: { commandClass: AgentsmdCommand },
          subagents: { subagentClass: AgentsmdSubagent },
          skills: { skillClass: AgentsmdSkill },
        },
      },
    },
  ],
  [
    "aiassistant",
    {
      class: AiassistantRule,
      meta: {
        extension: "md",
        // JetBrains AI Assistant auto-discovers every `.md` in `.aiassistant/rules/`,
        // so no reference section is injected into a root file (there is no root).
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "amp",
    {
      class: AmpRule,
      meta: {
        // Amp reads a root `AGENTS.md` (project root or `~/.config/amp/AGENTS.md`
        // global) and `.agents/memories/*.md` non-root files referenced via TOON.
        // Subtree AGENTS.md files support `globs:` frontmatter and `@`-imports.
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        collisionPolicy: "compose",
      },
    },
  ],
  [
    "antigravity-cli",
    {
      class: AntigravityCliRule,
      meta: {
        // The Antigravity CLI loads non-root rules by itself — trigger-tagged
        // files under `.agents/rules/` (project) and `~/.gemini/config/rules/`
        // (global) — so the root context file (project `AGENTS.md`, global
        // `~/.gemini/GEMINI.md`) carries no reference block, matching
        // `antigravity-ide`, which writes the same project files. A
        // directory-scoped rule (`agentsmd.subprojectPath`) goes to
        // `<dir>/.agents/rules/` (imported back via `getNestedFilePatterns`).
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        sharedGlobalNonRootDir: true,
      },
    },
  ],
  [
    "antigravity-ide",
    {
      class: AntigravityIdeRule,
      meta: {
        // The Antigravity IDE auto-discovers rule files under `.agents/rules/`
        // (project) and `~/.gemini/config/rules/` (global, shared with
        // `antigravity-cli`), so no reference section is needed in the root rule.
        // A directory-scoped rule (`agentsmd.subprojectPath`) goes to
        // `<dir>/.agents/rules/` (imported back via `getNestedFilePatterns`).
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        sharedGlobalNonRootDir: true,
      },
    },
  ],
  [
    "antigravity-plugin",
    {
      class: AntigravityPluginRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "augmentcode",
    {
      class: AugmentcodeRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "augmentcode-legacy",
    {
      class: AugmentcodeLegacyRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "toon",
      },
    },
  ],
  [
    "augmentcode-plugin",
    {
      // Auggie plugin bundles ship rules in `<plugin>/rules/`, read with the
      // same parser as `.augment/rules/`. https://docs.augmentcode.com/cli/plugins
      class: AugmentcodePluginRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "bob",
    {
      class: BobRule,
      meta: {
        // IBM Bob reads a root `AGENTS.md` (project) / `~/.bob/AGENTS.md`
        // (global) plus non-root `.bob/rules/*.md` files that are loaded
        // automatically (recursively, in alphabetical order) as plain
        // Markdown without frontmatter, so no reference section is needed.
        // https://bob.ibm.com/docs/ide/configuration/rules
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        localRootMode: "separate-local-file",
        localRootFileName: "CLAUDE.local.md",
      },
    },
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeLegacyRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "claudecode-legacy",
        localRootMode: "separate-local-file",
        localRootFileName: "CLAUDE.local.md",
      },
    },
  ],
  [
    "cline",
    {
      class: ClineRule,
      meta: {
        // Project scope writes `.clinerules/*.md`; global scope writes the
        // cross-tool `~/.agents/AGENTS.md` root (Cline CLI v3.0.15+) plus
        // non-root modular rules under `~/Documents/Cline/Rules/`.
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "codebuddy",
    {
      class: CodebuddyRule,
      meta: {
        // CodeBuddy Code's configuration surface mirrors Claude Code closely:
        // a root `CODEBUDDY.md` (project) / `~/.codebuddy/CODEBUDDY.md`
        // (global) plus non-root `.codebuddy/rules/*.md` files auto-loaded
        // without needing a reference section. Non-root frontmatter also
        // supports `description` and `alwaysApply`, closer to the Cursor rule
        // model than Claude Code's `paths`-only schema.
        // https://www.codebuddy.ai/docs/cli/memory
        // https://www.codebuddy.ai/docs/cli/codebuddy-dir
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        localRootMode: "separate-local-file",
        localRootFileName: CODEBUDDY_LOCAL_RULE_FILE_NAME,
      },
    },
  ],
  [
    "codebuff",
    {
      class: CodebuffRule,
      meta: {
        // Codebuff (Freebuff) reads the project-root AGENTS.md, which the
        // `agentsmd` target already writes, so this target is global-only: it
        // writes the home-directory `~/.AGENTS.md`, the highest-priority name
        // the SDK's `loadUserKnowledgeFiles` looks for. There is no user-level
        // rules directory, so non-root rules fold into that single file.
        // https://github.com/CodebuffAI/freebuff/blob/main/sdk/src/run-state.ts
        extension: "md",
        supportsProject: false,
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "codewhale",
    {
      class: CodewhaleRule,
      meta: {
        // Codewhale auto-loads the workspace-root AGENTS.md followed by every
        // `.codewhale/rules/*.md` file. The user-scoped `~/.codewhale/AGENTS.md`
        // has no companion rules directory, so global non-root rules fold into
        // that single file.
        // https://github.com/Hmbown/Codewhale/blob/main/docs/CONFIGURATION.md
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "codexcli",
    {
      class: CodexcliRule,
      meta: {
        // Codex CLI reads the global `~/.codex/AGENTS.md` plus one `AGENTS.md`
        // per directory from the project root down to the cwd, so a
        // directory-scoped rule is emitted as a nested `<subprojectPath>/AGENTS.md`
        // while plain topic rules fold into the root file (mirrors pool/vibe).
        // The project files on one chain share `project_doc_max_bytes`
        // (32 KiB by default, `codex-rs/config/defaults.toml`); Codex truncates
        // the file that crosses it and skips the later ones without telling
        // the user, so generation warns instead. A budget of 0 disables
        // project docs entirely (`codex-rs/core/src/agents_md.rs`).
        // https://learn.chatgpt.com/docs/agent-configuration/agents-md
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
        projectInstructionBudget: {
          bytes: CODEXCLI_PROJECT_DOC_MAX_BYTES,
          remedy:
            "Codex CLI stops reading project `AGENTS.md` files once their combined size on the root-to-working-directory chain reaches `project_doc_max_bytes` (32 KiB by default): it silently truncates the file that crosses the limit and skips the files after it. " +
            "Move directory-scoped rules into nested `AGENTS.md` files with `agentsmd.subprojectPath` (or `deriveSubprojectPathFromGlobs: true` in rulesync.jsonc), trim the rules, or raise `project_doc_max_bytes` in `.codex/config.toml` (Codex reads that file only if the project is trusted).",
          readConfiguredBytes: readCodexcliProjectDocMaxBytes,
          configuredSource:
            "`project_doc_max_bytes` in `.codex/config.toml` (honored only if the project is trusted)",
          defaultLimitHint:
            "Rulesync does not read `~/.codex/config.toml`; ignore this warning if you already raised `project_doc_max_bytes` there.",
        },
      },
    },
  ],
  [
    "commandcode",
    {
      class: CommandcodeRule,
      meta: {
        // Command Code reads the project-root AGENTS.md and the user
        // ~/.commandcode/AGENTS.md; nested AGENTS.md files are only pulled in
        // lazily, so topic rules fold into the root file (mirrors codexcli).
        // https://commandcode.ai/docs/memory
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "continue",
    {
      class: ContinueRule,
      meta: {
        // Continue reads the workspace-root `AGENTS.md` plus `.continue/rules/*.md`
        // files (frontmatter `globs` / `regex` / `alwaysApply`), and the same
        // rules directory under `~/.continue/` in global scope. It has no
        // user-level `AGENTS.md`, so the global root rule is written to
        // `~/.continue/rules/AGENTS.md` (mirrors the roo entry below).
        // https://docs.continue.dev/customize/deep-dives/rules
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "copilot",
    {
      class: CopilotRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "copilotcli",
    {
      class: CopilotcliRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "cortexcode",
    {
      class: CortexcodeRule,
      meta: {
        // Cortex Code CLI documents only the project-root AGENTS.md; it has
        // no modular rules directory and no user-scoped rule file, so topic
        // rules fold into the root file (mirrors codexcli) and the target is
        // project-only.
        // https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "crush",
    {
      class: CrushRule,
      meta: {
        // Crush reads project context from the root CRUSH.md and a global
        // rules file from ~/.config/crush/CRUSH.md. It has no modular
        // non-root instructions directory, so topic rules fold into the root
        // file (mirrors zcode/codexcli).
        //
        // `defaultContextPaths` also lists `CRUSH.local.md` (and its lower- and
        // title-cased spellings) next to the shared file, so a localRoot rule
        // gets its own file instead of being folded in — folding a personal
        // rule into the committed `CRUSH.md` is what the separate file exists
        // to avoid.
        // https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
        localRootMode: "separate-local-file",
        localRootFileName: CRUSH_LOCAL_RULE_FILE_NAME,
      },
    },
  ],
  [
    "cursor",
    {
      class: CursorRule,
      meta: {
        extension: "mdc",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "deepagents",
    {
      class: DeepagentsRule,
      meta: {
        extension: "md",
        // dcode reads user-level context from `~/.deepagents/<agent_name>/AGENTS.md`.
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "factorydroid",
    {
      class: FactorydroidRule,
      meta: {
        // Factory Droid commands, subagents (custom droids), and skills are all
        // native now, so no simulated additionalConventions are needed (mirrors
        // how native tools like claudecode are wired). Non-root rules are still
        // referenced via TOON.
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        collisionPolicy: "compose",
      },
    },
  ],
  [
    "firebender",
    {
      // Firebender reads `.firebender/AGENTS.md` first (before the
      // project-root `AGENTS.md`, falling back to `~/.firebender/AGENTS.md`)
      // and auto-loads every `.firebender/rules/*.mdc` /
      // `~/.firebender/rules/*.mdc` file by its Cursor-style frontmatter.
      // Commands, subagents and skills are native, so nothing is simulated.
      // https://docs.firebender.com/api-reference/rules
      // https://docs.firebender.com/api-reference/agents-md
      class: FirebenderRule,
      meta: {
        extension: "mdc",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "goose",
    {
      // Goose reads the `.goosehints` / `AGENTS.md` instruction-file family
      // natively (working dir up to the repo root plus nested directories it
      // touches) but never the `.goose/memories/` tree, which belongs to the
      // separate Memory extension and is not auto-loaded as session context.
      // Non-root rules are therefore folded into the single root `.goosehints`
      // below (same handling as warp / deepagents).
      class: GooseRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "hermesagent",
    {
      class: HermesagentRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "gitlabduo",
    {
      // GitLab Duo CLI reads one custom rules file, `.gitlab/duo/chat-rules.md`
      // in the project and `~/.gitlab/duo/chat-rules.md` for the user, with no
      // rules directory, so topic rules fold into it.
      // https://docs.gitlab.com/user/duo_agent_platform/customize/custom_rules/
      class: GitlabduoRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "grokcli",
    {
      // Grok Build reads the AGENTS.md instruction-file family natively
      // (root/subdir AGENTS.md + global ~/.grok/AGENTS.md) and scans a rules
      // directory beside it — `.grok/rules/` per project directory and
      // `~/.grok/rules/` in the home scope — so a topic rule keeps its own file
      // rather than being folded into the root one.
      class: GrokcliRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "junie",
    {
      // Junie CLI resolves project guidelines first-match-wins:
      // `.junie/AGENTS.md` → root `AGENTS.md` combined with `.junie/playbook.md`
      // and every `.junie/rules/*.md` → legacy guidelines. The multi-file
      // branch is unreachable while `.junie/AGENTS.md` exists, because that
      // file is used exclusively and nothing is combined with it. Junie also
      // reads no `.junie/memories/` directory and documents no `@`-reference
      // mechanism, so non-root rules are folded into the single root
      // `.junie/AGENTS.md` (same handling as warp / deepagents). See the
      // JunieRule class doc for the full rationale.
      class: JunieRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "kilo",
    {
      class: KiloRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        mcpInstructionsRegistrar: KiloMcp,
        collisionPolicy: "compose",
      },
    },
  ],
  [
    "kimi-code",
    {
      class: KimiCodeRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "kimi-code-plugin",
    {
      // A Kimi Code plugin contributes one instructions file, `<plugin>/SYSTEM.md`
      // (referenced by `systemPromptPath`), so topic rules fold into it. Kimi
      // ignores the whole file once it exceeds 32 KiB, so generation warns.
      // https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.1.1/docs/en/customization/plugins.md
      class: KimiCodePluginRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
        projectInstructionBudget: {
          bytes: KIMI_CODE_PLUGIN_SYSTEM_PROMPT_MAX_BYTES,
          remedy:
            "Kimi Code ignores a plugin's `systemPromptPath` file larger than 32 KiB entirely, reporting it only in the plugin diagnostics, so none of these rules would reach the model. " +
            "Trim the rules or exclude some from the `kimi-code-plugin` target.",
        },
      },
    },
  ],
  [
    "kiro",
    {
      class: KiroRule,
      meta: {
        extension: "md",
        // Global steering lives under `~/.kiro/steering/` (root rule as
        // `product.md`), per the `KIRO_HOME` layout.
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
      },
    },
  ],
  [
    "kiro-cli",
    {
      class: KiroCliRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
      },
    },
  ],
  [
    "kiro-ide",
    {
      class: KiroIdeRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
      },
    },
  ],
  [
    "mimocode",
    {
      class: MimocodeRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        mcpInstructionsRegistrar: MimocodeMcp,
        // MiMo Code (an OpenCode fork) reads `instructions` from the global
        // `~/.config/mimocode/mimocode.jsonc` too, so global non-root rules
        // are registered there (as `~/`-rooted paths).
        mcpInstructionsRegistrarGlobal: true,
        collisionPolicy: "compose",
      },
    },
  ],
  [
    "musecode",
    {
      class: MusecodeRule,
      meta: {
        // Muse Code reads the shared project-root `AGENTS.md` (preferred over
        // `CLAUDE.md`) and has no modular non-root instruction directory, so
        // topic rules fold into the root file (mirrors codexcli). The global
        // rules path is undocumented, so global scope is not supported.
        // https://dev.meta.ai/docs/muse-code/configuration.md
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "omp",
    {
      class: OmpRule,
      meta: {
        // oh-my-pi loads `.omp/AGENTS.md` plus `.omp/rules/*.{md,mdc}`
        // natively, and `~/.omp/agent/AGENTS.md` plus
        // `~/.omp/agent/rules/*.{md,mdc}` globally.
        // https://github.com/can1357/oh-my-pi/blob/main/docs/context-files.md
        extension: "md",
        // The rules directory is read non-recursively, as `*.md` and `*.mdc`
        // (`loadRules` in `packages/coding-agent/src/discovery/builtin.ts`).
        nonRootImportGlob: "*.{md,mdc}",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "opencode",
    {
      class: OpenCodeRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        mcpInstructionsRegistrar: OpencodeMcp,
        // OpenCode reads `instructions` from the global
        // `~/.config/opencode/opencode.json` too, so global non-root rules are
        // generated and registered instead of being dropped.
        mcpInstructionsRegistrarGlobal: true,
        collisionPolicy: "compose",
      },
    },
  ],
  [
    "opencodev1",
    {
      class: Opencodev1Rule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        mcpInstructionsRegistrar: Opencodev1Mcp,
        // OpenCode reads `instructions` from the global
        // `~/.config/opencode/opencode.json` too, so global non-root rules are
        // generated and registered instead of being dropped.
        mcpInstructionsRegistrarGlobal: true,
        collisionPolicy: "compose",
      },
    },
  ],
  [
    "openclaw",
    {
      class: OpenclawRule,
      meta: {
        // OpenClaw injects the agent workspace's `AGENTS.md`
        // (`~/.openclaw/workspace/AGENTS.md`) into every session and appends
        // the execution folder's `AGENTS.md` as project context. It documents
        // no per-directory walk, so topic rules fold into the root file
        // (mirrors zcode). Over-long files are truncated with a notice in the
        // prompt (`bootstrapMaxChars`, 20,000 characters per file by default;
        // `bootstrapTotalMaxChars`, 60,000 in total) rather than dropped
        // silently, so no instruction budget warning is emitted.
        // https://docs.openclaw.ai/concepts/system-prompt
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "pi",
    {
      class: PiRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "pool",
    {
      class: PoolRule,
      meta: {
        // Pool (Poolside's coding agent) reads personal, project, and nested
        // per-directory `AGENTS.md` files — the project root plus every
        // `AGENTS.md` from the repository root down through the working
        // directory — so a directory-scoped rule is emitted as a nested
        // `<subprojectPath>/AGENTS.md` while plain topic rules fold into the
        // root file (mirrors vibe).
        // https://docs.poolside.ai/agent-instructions
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "qoder",
    {
      class: QoderRule,
      meta: {
        // Qoder reads the project-root `AGENTS.md` (plus the per-machine
        // `AGENTS.local.md` overlay) and auto-loads `.qoder/rules/**/*.md` by
        // their `trigger` frontmatter; the user scope mirrors it under
        // `~/.qoder/`. Commands, subagents and skills are native, so no
        // simulated additionalConventions are needed.
        // https://docs.qoder.com/en/cli/04-extending-qoder-cli/memory
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        localRootMode: "separate-local-file",
        localRootFileName: QODER_LOCAL_RULE_FILE_NAME,
      },
    },
  ],
  [
    "qwencode",
    {
      class: QwencodeRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        // Qwen Code natively auto-discovers Markdown rule files under
        // `.qwen/rules/` (project) and `~/.qwen/rules/` (global) and injects
        // them by path, so the root `QWEN.md` must not carry a reference block
        // to the non-root rules (mirrors how cursor/antigravity are wired).
        ruleDiscoveryMode: "auto",
        // Qwen Code v0.16.2 loads the personal `.qwen/QWEN.local.md` after the
        // shared QWEN.md, so a localRoot rule gets its own file there.
        localRootMode: "separate-local-file",
        localRootFileName: QWENCODE_LOCAL_RULE_FILE_NAME,
        // Qwen Code subagents are native (Markdown + YAML frontmatter under
        // `.qwen/agents/`), so this mirrors how claudecode is wired.
        additionalConventions: {
          subagents: { subagentClass: QwencodeSubagent },
        },
      },
    },
  ],
  [
    "reasonix",
    {
      class: ReasonixRule,
      meta: {
        // Reasonix reads the root `REASONIX.md` (project root or
        // `~/.reasonix/REASONIX.md` global) and has no modular non-root
        // instruction directory, so topic rules fold into the root file
        // (mirrors codexcli) — except directory-scoped rules
        // (`agentsmd.subprojectPath`), which Context Engine v2 (v1.18.0) loads
        // per-directory and are emitted as nested `<dir>/REASONIX.md` files
        // (imported back via `getNestedFilePatterns`). A `localRoot` rule goes
        // to the uncommitted `REASONIX.local.md` Reasonix loads beside it.
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
        localRootMode: "separate-local-file",
        localRootFileName: REASONIX_LOCAL_RULE_FILE_NAME,
      },
    },
  ],
  [
    "replit",
    {
      class: ReplitRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "roo",
    {
      // Roo subagents are native now (aggregated into `.roomodes`), so no
      // simulated `additionalConventions.subagents` block is needed — mirrors
      // how native subagent tools like claudecode are wired.
      //
      // Roo also reads user-scope rules from `~/.roo/rules/` (loaded before
      // workspace `.roo/rules/`), so global mode emits the same non-root
      // directory under the home directory.
      // @see https://roocodeinc.github.io/Roo-Code/features/custom-instructions
      class: RooRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        // Roo loads `AGENTS.local.md` from the workspace root for personal,
        // gitignored overrides (v3.47.0; verified at the final v3.54.0 tag),
        // so a localRoot rule gets its own file instead of being folded into
        // the checked-in AGENTS.md — mirrors the rovodev entry below.
        localRootMode: "separate-local-file",
        localRootFileName: "AGENTS.local.md",
      },
    },
  ],
  [
    "rovodev",
    {
      class: RovodevRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        additionalConventions: {
          subagents: { subagentClass: RovodevSubagent },
          skills: { skillClass: RovodevSkill },
        },
        localRootMode: "separate-local-file",
        localRootFileName: "AGENTS.local.md",
      },
    },
  ],
  [
    "zoocode",
    {
      // Zoo Code (community continuation of Roo Code) keeps Roo's `.roo/`
      // layout and rule semantics, including the AGENTS.local.md local-root
      // file — see the roo entry above.
      class: ZoocodeRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        localRootMode: "separate-local-file",
        localRootFileName: "AGENTS.local.md",
      },
    },
  ],
  [
    "tabnine",
    {
      class: TabnineRule,
      meta: {
        // Tabnine CLI loads a root `TABNINE.md` (project) and, for the user
        // scope, `~/.tabnine/agent/TABNINE.md`. Non-root rules become
        // guideline files under `.tabnine/guidelines/` (read by the Tabnine
        // IDE agent, not auto-loaded by the CLI), so the root file lists them
        // in a TOON reference table.
        // https://docs.tabnine.com/main/getting-started/tabnine-cli/features/settings
        // https://docs.tabnine.com/main/getting-started/tabnine-agent/guidelines
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
      },
    },
  ],
  [
    "takt",
    {
      class: TaktRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        // No `additionalConventions` here: TAKT does not synthesize a root
        // overview rule (TaktRule.fromRulesyncRule always emits non-root files),
        // so the conventions block would never be rendered anywhere.
      },
    },
  ],
  [
    "trae",
    {
      // Trae auto-loads every `.trae/rules/*.md` file by its Cursor-style
      // `alwaysApply` / `description` / `globs` frontmatter and has no root
      // rule file, so every rule lands there (mirrors cursor) — except
      // directory-scoped rules (`agentsmd.subprojectPath`), which go to
      // `<dir>/.trae/rules/` (imported back via `getNestedFilePatterns`). Commands,
      // subagents and skills need no simulation: Trae has native skills and
      // no file-based commands or subagents. Global rules (`~/.trae/user_rules`)
      // are not written because their on-disk format is undocumented.
      // https://docs.trae.ai/ide/rules?_lang=en
      class: TraeRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "vibe",
    {
      class: VibeRule,
      meta: {
        // Vibe loads project AGENTS.md from the trusted working tree and
        // user-level AGENTS.md from ~/.vibe/AGENTS.md. It has no modular
        // non-root instruction directory, so topic rules fold into the root
        // file (mirrors reasonix/codexcli) — except directory-scoped rules
        // (`agentsmd.subprojectPath`), which Vibe's harness manager loads by
        // walking the directories above the file being read, and which are
        // emitted as nested `<dir>/AGENTS.md` files (imported back via
        // `getNestedFilePatterns`).
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "warp",
    {
      class: WarpRule,
      meta: {
        // Warp reads project rules from the root AGENTS.md and a global rules
        // file from ~/.agents/AGENTS.md (also used from remote hosts in SSH
        // sessions). It has no modular non-root instruction directory, so topic
        // rules fold into the root file — except directory-scoped rules
        // (`agentsmd.subprojectPath`), which Warp applies while working in that
        // subdirectory and which are emitted as nested `<dir>/AGENTS.md` files
        // (imported back via `getNestedFilePatterns`; mirrors pool/vibe).
        // https://docs.warp.dev/agents/capabilities/rules/
        // https://docs.warp.dev/terminal/settings/file-locations/
        // `auto`: the nested files are loaded by Warp itself, so the root file
        // carries no reference list pointing at them.
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "xum",
    {
      class: XumRule,
      meta: {
        // Xum (formerly Mux) reads the Xum-dedicated `.xum/AGENTS.md` (project)
        // and `~/.xum/AGENTS.md` (user) on top of the shared root `AGENTS.md`,
        // which the `agentsmd` target writes. There is no rules directory, so
        // topic rules fold into that single file. The personal
        // `.xum/AGENTS.local.md` overlay beside it takes a localRoot rule.
        // https://xum.cdr.dev/agents/instruction-files
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
        localRootMode: "separate-local-file",
        localRootFileName: XUM_LOCAL_RULE_FILE_NAME,
      },
    },
  ],
  [
    "devin",
    {
      class: DevinRule,
      meta: {
        extension: "md",
        // The root rule goes to the project-root `AGENTS.md` (the file Devin
        // CLI/Local reads); non-root rules live under `.devin/rules/*.md`
        // (Devin Desktop Cascade). Global scope mirrors that: a plain
        // `~/.config/devin/AGENTS.md` root plus per-rule `~/.devin/rules/*.md`.
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        // No additionalConventions.skills needed: Devin auto-discovers skills
        // from .devin/skills/ (project) and ~/.config/devin/skills/ (global).
        //
        // Personal instructions go to `AGENTS.local.md` beside the root
        // `AGENTS.md`, which Devin loads "alongside AGENTS.md with the same
        // always-on behavior" and documents as gitignored. Without this they
        // were concatenated into the committed `AGENTS.md` by the
        // `append-to-root` default, i.e. shared with collaborators — the
        // opposite of what upstream documents.
        // @see https://docs.devin.ai/cli/extensibility/rules
        localRootMode: "separate-local-file",
        localRootFileName: "AGENTS.local.md",
      },
    },
  ],
  [
    "devin-plugin",
    {
      // Devin plugin bundles ship the root rule as an always-on
      // `<plugin>/AGENTS.md` and triggered rules in `<plugin>/rules/`, read
      // with the same `trigger` frontmatter as `.devin/rules/`.
      // https://docs.devin.ai/cli/extensibility/plugins/overview
      class: DevinPluginRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "zcode",
    {
      class: ZcodeRule,
      meta: {
        // ZCode reads exactly two instruction files, the workspace `AGENTS.md`
        // at the project root and the user `~/.zcode/AGENTS.md`. It documents
        // that it does not merge `AGENTS.md` across directory levels and does
        // not scan child directories, so there is no modular non-root surface
        // and topic rules fold into the root file (mirrors musecode).
        // https://zcode.z.ai/en/docs/agents
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
      },
    },
  ],
  [
    "zed",
    {
      class: ZedRule,
      meta: {
        // Zed reads a single project rules file (`.rules`) and a single global
        // file (`~/.config/zed/AGENTS.md`). It is root-only with auto discovery,
        // so there is no non-root location to render a conventions block into.
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
      },
    },
  ],
  [
    "dsh",
    {
      class: DshRule,
      meta: {
        // DeepSeek Harness loads the user-global `~/.dsh/AGENTS.md` and the
        // project chain of `AGENTS.md` files from the `.git` root down through
        // the session cwd, so a directory-scoped rule is emitted as a nested
        // `<subprojectPath>/AGENTS.md` while plain topic rules fold into the
        // root file (mirrors pool).
        // https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
        // The project chain also loads `AGENTS.local.md` as an additive local
        // overlay at each level (default `localInstructionFileCandidates`), so
        // a localRoot rule gets its own file beside the root `AGENTS.md`
        // instead of being appended to the committed one. Project scope only:
        // neither user-global root has a local overlay.
        localRootMode: "separate-local-file",
        localRootFileName: "AGENTS.local.md",
      },
    },
  ],
]);
