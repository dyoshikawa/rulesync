import { basename, dirname, join, posix, relative, sep } from "node:path";

import { encode } from "@toon-format/toon";
import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { QWENCODE_DIR, QWENCODE_LOCAL_RULE_FILE_NAME } from "../../constants/qwencode-paths.js";
import {
  CURATED_RULES_FEATURE_SUBDIR,
  RULES_FEATURE_SUBDIR,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import {
  caseFoldIdentity,
  FeatureProcessor,
  formatCuratedCaseCollisionWarning,
  groupSpellingsByCaseFoldedIdentity,
  mergeByCaseInsensitiveIdentity,
} from "../../types/feature-processor.js";
import type { FeatureOptions } from "../../types/features.js";
import { Language, appendLanguageBlock, stripLanguageBlock } from "../../types/language.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { rulesProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { stripControlCharacters } from "../../utils/control-characters.js";
import { formatError } from "../../utils/error.js";
import {
  checkPathTraversal,
  directoryExistsStrict,
  filterOutPathsInGitIgnoredDirectories,
  findFilesByGlobs,
  readFileContent,
  toPosixPath,
} from "../../utils/file.js";
import { type Logger, warnOnceWithFallback } from "../../utils/logger.js";
import { AgentsmdCommand } from "../commands/agentsmd-command.js";
import { CommandsProcessor } from "../commands/commands-processor.js";
import { KiloMcp } from "../mcp/kilo-mcp.js";
import { OpencodeMcp } from "../mcp/opencode-mcp.js";
import { AgentsmdSkill } from "../skills/agentsmd-skill.js";
import { RovodevSkill } from "../skills/rovodev-skill.js";
import { RulesyncSkill } from "../skills/rulesync-skill.js";
import { SkillsProcessor } from "../skills/skills-processor.js";
import { AgentsmdSubagent } from "../subagents/agentsmd-subagent.js";
import { QwencodeSubagent } from "../subagents/qwencode-subagent.js";
import { RovodevSubagent } from "../subagents/rovodev-subagent.js";
import { SubagentsProcessor } from "../subagents/subagents-processor.js";
import { AgentsMdRule } from "./agentsmd-rule.js";
import { AiassistantRule } from "./aiassistant-rule.js";
import { AmpRule } from "./amp-rule.js";
import { AntigravityCliRule } from "./antigravity-cli-rule.js";
import { AntigravityIdeRule } from "./antigravity-ide-rule.js";
import { AntigravityPluginRule } from "./antigravity-plugin-rule.js";
import { AugmentcodeLegacyRule } from "./augmentcode-legacy-rule.js";
import { AugmentcodeRule } from "./augmentcode-rule.js";
import { ClaudecodeLanguageSettings } from "./claudecode-language-settings.js";
import { ClaudecodeLegacyRule } from "./claudecode-legacy-rule.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { ClineRule } from "./cline-rule.js";
import { CodexcliRule } from "./codexcli-rule.js";
import { CopilotRule } from "./copilot-rule.js";
import { CopilotcliRule } from "./copilotcli-rule.js";
import { CrushRule } from "./crush-rule.js";
import { CursorRule } from "./cursor-rule.js";
import { DeepagentsRule } from "./deepagents-rule.js";
import { DevinRule } from "./devin-rule.js";
import { FactorydroidRule } from "./factorydroid-rule.js";
import { GooseRule } from "./goose-rule.js";
import { GrokcliRule } from "./grokcli-rule.js";
import { HermesagentRule } from "./hermesagent-rule.js";
import { JunieRule } from "./junie-rule.js";
import { KiloRule } from "./kilo-rule.js";
import { KimiCodeRule } from "./kimi-code-rule.js";
import { KiroCliRule } from "./kiro-cli-rule.js";
import { KiroIdeRule } from "./kiro-ide-rule.js";
import { KiroRule } from "./kiro-rule.js";
import { MusecodeRule } from "./musecode-rule.js";
import { OpenCodeRule } from "./opencode-rule.js";
import { PiRule } from "./pi-rule.js";
import { QwencodeRule } from "./qwencode-rule.js";
import { ReasonixRule } from "./reasonix-rule.js";
import { ReplitRule } from "./replit-rule.js";
import { RooRule } from "./roo-rule.js";
import { RovodevRule } from "./rovodev-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { TaktRule } from "./takt-rule.js";
import {
  ToolRule,
  ToolRuleExtraFixedFile,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleNestedFilePatterns,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
} from "./tool-rule.js";
import { VibeRule } from "./vibe-rule.js";
import { WarpRule } from "./warp-rule.js";
import { ZcodeRule } from "./zcode-rule.js";
import { ZedRule } from "./zed-rule.js";
import { ZoocodeRule } from "./zoocode-rule.js";

export type RulesProcessorToolTarget = (typeof rulesProcessorToolTargetTuple)[number];
export const RulesProcessorToolTargetSchema = z.enum(rulesProcessorToolTargetTuple);

const formatRulePaths = (rules: RulesyncRule[]): string =>
  rules.map((r) => join(r.getRelativeDirPath(), r.getRelativeFilePath())).join(", ");

/**
 * Rule discovery mode for determining how non-root rules are referenced.
 * - `auto`: Tool auto-discovers rules in a directory, no reference section needed
 * - `toon`: Tool requires explicit references using TOON format
 * - `claudecode-legacy`: Uses Claude Code specific reference format (legacy mode only)
 */
type RuleDiscoveryMode = "auto" | "toon" | "claudecode-legacy";
const RulesFeatureOptionsSchema = z.looseObject({
  ruleDiscoveryMode: z.optional(z.enum(["none", "explicit"])),
  includeLocalRoot: z.optional(z.boolean()),
});

const resolveRuleDiscoveryMode = ({
  defaultMode,
  options,
}: {
  defaultMode: RuleDiscoveryMode;
  options?: FeatureOptions;
}): RuleDiscoveryMode => {
  if (defaultMode === "claudecode-legacy") {
    return defaultMode;
  }
  if (!options) return defaultMode;
  const parsed = RulesFeatureOptionsSchema.safeParse(options);
  if (!parsed.success) {
    throw new Error(
      `Invalid options for rules feature: ${parsed.error.message}. ` +
        '`ruleDiscoveryMode` must be either "none" or "explicit".',
    );
  }
  if (!parsed.data.ruleDiscoveryMode) {
    return defaultMode;
  }
  return parsed.data.ruleDiscoveryMode === "none" ? "auto" : "toon";
};

const IncludeLocalRootSchema = z.looseObject({
  includeLocalRoot: z.optional(z.boolean()),
});

const resolveIncludeLocalRoot = (options?: FeatureOptions): boolean => {
  if (!options) return true;
  const parsed = IncludeLocalRootSchema.safeParse(options);
  if (!parsed.success) {
    throw new Error(
      `Invalid options for rules feature: ${parsed.error.message}. ` +
        "`includeLocalRoot` must be a boolean.",
    );
  }
  return parsed.data.includeLocalRoot ?? true;
};

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

/**
 * Whether `candidate` is `base` itself or a class that extends it.
 *
 * Class-identity dispatch (`factory.class === Base`) is subclass-blind: a target
 * whose adapter merely narrows another one — `ZoocodeRule extends RooRule` — fails
 * a strict `===` and silently falls through. That is how `zoocode` ended up
 * declaring `localRootMode: "separate-local-file"` while never emitting
 * `AGENTS.local.md`, in both directions and without a warning.
 */
function isClassOrSubclassOf({ candidate, base }: { candidate: object; base: object }): boolean {
  return candidate === base || Object.prototype.isPrototypeOf.call(base, candidate);
}

type LocalRootMode = "separate-local-file" | "append-to-root";
type RuleCollisionPolicy = "compose" | "fold" | "preserve";
type RuleConversion = {
  toolRule: ToolRule;
  rulesyncRule: RulesyncRule;
};

/**
 * Factory entry for each tool rule class.
 * Stores the class reference and metadata for a tool.
 */
type ToolRuleFactory = {
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
     * Extra fixed-path files this tool manages beyond the root and non-root
     * rules (e.g. Pi's `APPEND_SYSTEM.md` system-prompt file). The RulesProcessor
     * enumerates these on import and deletion so they round-trip and stale files
     * are cleaned up when no rule targets them. See {@link PiRule.getExtraFixedFiles}.
     */
    getExtraFixedFiles?(params: { global?: boolean }): ToolRuleExtraFixedFile[];
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
    /** Whether this tool supports global (user scope) mode */
    supportsGlobal: boolean;
    /** How non-root rules are discovered or referenced */
    ruleDiscoveryMode: RuleDiscoveryMode;
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
        // The Antigravity CLI shares Gemini-CLI-class context files: a root
        // context file (project `AGENTS.md`, global `~/.gemini/GEMINI.md`) that
        // @-references non-root memory files under `.agents/rules/`.
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
      },
    },
  ],
  [
    "antigravity-ide",
    {
      class: AntigravityIdeRule,
      meta: {
        // The Antigravity IDE auto-discovers rule files under `.agents/rules/`,
        // so no reference section is needed in the root rule.
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
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
    "codexcli",
    {
      class: CodexcliRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
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
    "crush",
    {
      class: CrushRule,
      meta: {
        // Crush reads project context from the root CRUSH.md and a global
        // rules file from ~/.config/crush/CRUSH.md. It has no modular
        // non-root instructions directory, so topic rules fold into the root
        // file (mirrors zcode/codexcli).
        // https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
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
        // (imported back via `getNestedFilePatterns`).
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "auto",
        collisionPolicy: "fold",
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
        // sessions). https://docs.warp.dev/terminal/settings/file-locations/
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        collisionPolicy: "fold",
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
]);

const allToolTargetKeys = [...toolRuleFactories.keys()];

const rulesProcessorToolTargets: ToolTarget[] = allToolTargetKeys;

const rulesProcessorToolTargetsGlobal: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolRuleFactories.get(target);
  return factory?.meta.supportsGlobal ?? false;
});

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: RulesProcessorToolTarget) => ToolRuleFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolRuleFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

/**
 * How many skipped import-only paths a single warning names before it
 * summarizes the rest. Keeps one line readable when a rules directory holds
 * dozens of files.
 */
const MAX_LISTED_SKIPPED_IMPORT_ONLY_PATHS = 10;

/**
 * Fall back to a tool's legacy roots when its primary root file is absent.
 *
 * The primary hits are passed in rather than globbed here, so that callers
 * which need "the root file Rulesync generates" — rather than "whatever root
 * the tool will read" — can keep the two apart. A legacy root is a file
 * Rulesync reads but never writes, and the difference matters to them.
 */
const findFilesWithFallback = async (
  primaryFilePaths: string[],
  alternativeRoots: Array<{ relativeDirPath: string; relativeFilePath: string }> | undefined,
  buildAltGlob: (alt: { relativeDirPath: string; relativeFilePath: string }) => string,
  outputRoot: string,
): Promise<string[]> => {
  if (primaryFilePaths.length > 0) {
    return primaryFilePaths;
  }
  if (alternativeRoots) {
    return await findFilesByGlobs(alternativeRoots.map(buildAltGlob), { cwd: outputRoot });
  }
  return [];
};

/**
 * A project-root-relative glob for a file a tool keeps at a fixed path, joined
 * with `/` because a glob is always posix-separated.
 *
 * Relative because the root goes to `findFilesByGlobs` as `cwd` rather than into
 * the pattern: a project directory named `project(a)` or `project{a,b}` would
 * otherwise be read as a glob and match nothing at all — and on a `--delete`
 * sweep an empty result reads as "every source was removed", so rulesync would
 * delete generated files it can no longer regenerate and report success.
 */
const rootRelativeGlob = (...segments: Array<string | undefined>): string =>
  posix.join(...segments.filter((segment) => segment !== undefined).map(toPosixPath));

export class RulesProcessor extends FeatureProcessor {
  private readonly toolTarget: RulesProcessorToolTarget;
  private readonly simulateCommands: boolean;
  private readonly simulateSubagents: boolean;
  private readonly simulateSkills: boolean;
  private readonly language: Language | undefined;
  private readonly deriveSubprojectPathFromGlobs: boolean;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;
  private readonly skills?: RulesyncSkill[];
  private readonly featureOptions?: FeatureOptions;

  constructor({
    outputRoot = process.cwd(),
    inputRoots,
    toolTarget,
    simulateCommands = false,
    simulateSubagents = false,
    simulateSkills = false,
    language,
    deriveSubprojectPathFromGlobs = false,
    global = false,
    getFactory = defaultGetFactory,
    skills,
    featureOptions,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoots?: readonly [string, ...string[]] | readonly string[];
    toolTarget: ToolTarget;
    global?: boolean;
    simulateCommands?: boolean;
    simulateSubagents?: boolean;
    simulateSkills?: boolean;
    /**
     * The root `language` key of `rulesync.jsonc`. Claude Code targets get it
     * as a native setting; every other target gets a prompt block appended to
     * the generated root rule file. Unset leaves both alone.
     */
    language?: Language;
    /**
     * Resolve `agentsmd.subprojectPath` from `globs` for every non-root rule
     * loaded from the source trees (the `deriveSubprojectPathFromGlobs` config
     * option). Applied where the rules are read, so every target sees the same
     * resolved path.
     */
    deriveSubprojectPathFromGlobs?: boolean;
    getFactory?: GetFactory;
    skills?: RulesyncSkill[];
    featureOptions?: FeatureOptions;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({ outputRoot, inputRoots, dryRun, logger });
    const result = RulesProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for RulesProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.simulateCommands = simulateCommands;
    this.simulateSubagents = simulateSubagents;
    this.simulateSkills = simulateSkills;
    this.language = language;
    this.deriveSubprojectPathFromGlobs = deriveSubprojectPathFromGlobs;
    this.getFactory = getFactory;
    this.skills = skills;
    this.featureOptions = featureOptions;
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncRules = rulesyncFiles.filter(
      (file): file is RulesyncRule => file instanceof RulesyncRule,
    );

    const alignedRules = this.alignPiContextFile(rulesyncRules);

    // Separate localRoot rules from normal rules
    const localRootRules = alignedRules.filter((rule) => rule.getFrontmatter().localRoot);
    const nonLocalRootRules = alignedRules.filter((rule) => !rule.getFrontmatter().localRoot);

    const factory = this.getFactory(this.toolTarget);
    const { meta } = factory;
    const convertedRules = nonLocalRootRules
      .map((rulesyncRule) => {
        if (!factory.class.isTargetedByRulesyncRule(rulesyncRule)) {
          return null;
        }
        const toolRule = factory.class.fromRulesyncRule({
          outputRoot: this.outputRoot,
          rulesyncRule,
          validate: true,
          global: this.global,
        });
        return { toolRule, rulesyncRule };
      })
      .filter((rule): rule is RuleConversion => rule !== null);

    this.mergeRulesByOutputPath({
      convertedRules,
      collisionPolicy: meta.collisionPolicy ?? "preserve",
    });
    const toolRules = convertedRules.map(({ toolRule }) => toolRule);

    this.applyLocalRootRules({ toolRules, localRootRules, factory });

    this.appendSeparateConventionsRule({ toolRules, factory });

    const extraFiles = await this.buildMcpInstructionFiles({ toolRules, meta });

    this.applyRootRuleSections({ toolRules, factory, convertedRules });

    extraFiles.push(...(await this.buildLanguageSettingsFiles()));

    const outputFiles = [...toolRules, ...extraFiles];
    this.warnForOutputPathCollisions({ outputFiles, convertedRules });
    await this.warnForDeactivatedImportOnlyRoots({ toolRules, factory });
    return outputFiles;
  }

  /**
   * Handle localRoot rules (only in non-global mode and when enabled). Mutates
   * `toolRules` in place.
   */
  private applyLocalRootRules({
    toolRules,
    localRootRules,
    factory,
  }: {
    toolRules: ToolRule[];
    localRootRules: RulesyncRule[];
    factory: ToolRuleFactory;
  }): void {
    const includeLocalRoot = resolveIncludeLocalRoot(this.featureOptions);
    if (localRootRules.length === 0 || this.global || !includeLocalRoot) {
      return;
    }
    const localRootRule = localRootRules[0];
    if (localRootRule && factory.class.isTargetedByRulesyncRule(localRootRule)) {
      this.handleLocalRootRule(toolRules, localRootRule, factory);
    }
  }

  /**
   * For tools that create a separate conventions rule file (e.g., cursor, roo),
   * push that rule onto `toolRules`. Mutates `toolRules` in place.
   */
  private appendSeparateConventionsRule({
    toolRules,
    factory,
  }: {
    toolRules: ToolRule[];
    factory: ToolRuleFactory;
  }): void {
    const { meta } = factory;
    const isSimulated = this.simulateCommands || this.simulateSubagents || this.simulateSkills;
    if (!isSimulated || !meta.createsSeparateConventionsRule || !meta.additionalConventions) {
      return;
    }

    const conventionsContent = this.generateAdditionalConventionsSectionFromMeta(meta);
    const settablePaths = factory.class.getSettablePaths();
    const nonRootPath = "nonRoot" in settablePaths ? settablePaths.nonRoot : null;
    if (!nonRootPath) {
      return;
    }
    // Use .md extension - CursorRule.fromRulesyncRule will convert to .mdc
    toolRules.push(
      factory.class.fromRulesyncRule({
        outputRoot: this.outputRoot,
        rulesyncRule: new RulesyncRule({
          outputRoot: this.outputRoot,
          relativeDirPath: nonRootPath.relativeDirPath,
          relativeFilePath: "additional-conventions.md",
          frontmatter: {
            root: false,
            targets: [this.toolTarget],
          },
          body: conventionsContent,
        }),
        validate: true,
        global: this.global,
      }),
    );
  }

  /**
   * Non-root rules of some tools are not auto-loaded; the tool's MCP feature
   * registers them in its shared config's `instructions` key. The root rule is
   * auto-loaded and never registered. Global scope opt-in via
   * `mcpInstructionsRegistrarGlobal`.
   */
  private async buildMcpInstructionFiles({
    toolRules,
    meta,
  }: {
    toolRules: ToolRule[];
    meta: ToolRuleFactory["meta"];
  }): Promise<ToolFile[]> {
    if (!meta.mcpInstructionsRegistrar || (this.global && !meta.mcpInstructionsRegistrarGlobal)) {
      return [];
    }
    const instructionPaths = toolRules
      .filter((rule) => !rule.isRoot() && !rule.isExcludedFromRootReferences())
      .map((rule) => toPosixPath(join(rule.getRelativeDirPath(), rule.getRelativeFilePath())));
    // The registrar runs even with an empty list: it owns the managed subset
    // of the `instructions` array, so deleting the LAST non-root rule must
    // still clear its stale registrations (the registrar itself avoids
    // creating a config file just to hold an empty payload).
    const registered = await meta.mcpInstructionsRegistrar.fromInstructions({
      outputRoot: this.outputRoot,
      instructions: instructionPaths,
      validate: true,
      global: this.global,
      logger: this.logger,
    });
    return registered ? [registered] : [];
  }

  /**
   * For tools that don't create a separate conventions rule, prepend the
   * reference and conventions sections to the root rule content. Mutates the
   * root rule in place.
   */
  private applyRootRuleSections({
    toolRules,
    factory,
    convertedRules,
  }: {
    toolRules: ToolRule[];
    factory: ToolRuleFactory;
    convertedRules: RuleConversion[];
  }): void {
    const { meta } = factory;
    // Fixed-root targets were collapsed by mergeRulesByOutputPath. Targets that
    // keep multiple native paths emit those ToolRules as non-root, so at most
    // one root rule can survive here.
    const rootRule = toolRules.find((rule) => rule.isRoot());
    if (!rootRule) {
      this.appendLanguageBlockToRootSourceRules({ convertedRules });
      return;
    }

    const referenceSection = this.generateReferenceSectionFromMeta(meta, toolRules);

    const conventionsSection =
      !meta.createsSeparateConventionsRule && meta.additionalConventions
        ? this.generateAdditionalConventionsSectionFromMeta(meta)
        : "";

    const assembledContent = referenceSection + conventionsSection + rootRule.getFileContent();
    // Appended last so the block closes the file (and its root mirrors) after
    // every section rulesync composes, never between them.
    const promptLanguage = this.getPromptBlockLanguage();
    const newContent =
      promptLanguage === undefined
        ? assembledContent
        : appendLanguageBlock({ content: assembledContent, language: promptLanguage });
    rootRule.setFileContent(newContent);

    const rootMirror = factory.class.getRootMirror?.();
    if (rootMirror && !this.global) {
      toolRules.push(
        ...rootMirror.getMirrorFiles({
          outputRoot: this.outputRoot,
          rootRule,
          content: newContent,
        }),
      );
    }
  }

  /**
   * The language delivered as a prompt block, or `undefined` when none is:
   * `language` is unset, or the target is Claude Code, which has a native
   * `language` setting (see {@link ClaudecodeLanguageSettings}) and so gets
   * no block in its root file.
   */
  private getPromptBlockLanguage(): Language | undefined {
    return this.isClaudecodeTarget() ? undefined : this.language;
  }

  private isClaudecodeTarget(): boolean {
    return this.toolTarget === "claudecode" || this.toolTarget === "claudecode-legacy";
  }

  /**
   * The language block for targets whose adapters never mark a ToolRule as
   * root: Cursor emits every rule as `.cursor/rules/*.mdc`, and the fixed-name
   * targets (Cline, Roo, Kiro, ...) file the `root: true` source beside the
   * others. The file produced from the `root: true` source is still the root
   * rule from the user's point of view, so it is the one that gets the block.
   * Nested rules never do. When several sources are marked `root: true`, only
   * the file built from the first one (in conversion order, which follows the
   * source order) carries the block: one instruction per target is the
   * contract, and a root-marking target gets exactly one as well.
   */
  private appendLanguageBlockToRootSourceRules({
    convertedRules,
  }: {
    convertedRules: RuleConversion[];
  }): void {
    const language = this.getPromptBlockLanguage();
    if (language === undefined) {
      return;
    }
    const firstRootSource = convertedRules.find(
      ({ rulesyncRule }) => rulesyncRule.getFrontmatter().root === true,
    );
    if (firstRootSource === undefined) {
      return;
    }
    const { toolRule } = firstRootSource;
    toolRule.setFileContent(appendLanguageBlock({ content: toolRule.getFileContent(), language }));
  }

  /**
   * Claude Code's native delivery of `language`: a patch to the settings file
   * instead of a prompt block. Empty for every other target and when
   * `language` is unset, so an unset key never touches the settings file.
   */
  private async buildLanguageSettingsFiles(): Promise<ToolFile[]> {
    if (this.language === undefined || !this.isClaudecodeTarget()) {
      return [];
    }
    return [
      await ClaudecodeLanguageSettings.fromLanguage({
        outputRoot: this.outputRoot,
        language: this.language,
        global: this.global,
      }),
    ];
  }

  private buildSkillList(skillClass: {
    isTargetedByRulesyncSkill: (rulesyncSkill: RulesyncSkill) => boolean;
    getSettablePaths: (options?: { global?: boolean }) => {
      relativeDirPath: string;
    };
  }): Array<{
    name: string;
    description: string;
    path: string;
  }> {
    if (!this.skills) return [];

    const toolRelativeDirPath = skillClass.getSettablePaths({
      global: this.global,
    }).relativeDirPath;
    return this.skills
      .filter((skill) => skillClass.isTargetedByRulesyncSkill(skill))
      .map((skill) => {
        const frontmatter = skill.getFrontmatter();
        // Use tool-specific relative path, not rulesync's path
        const relativePath = join(toolRelativeDirPath, skill.getDirName(), SKILL_FILE_NAME);
        return {
          name: frontmatter.name,
          description: frontmatter.description,
          path: relativePath,
        };
      });
  }

  /**
   * Reconcile rules that resolve to the same output path.
   *
   * Multiple root fragments are composed for tools that emit a fixed root file.
   * The `fold` policy is for tools whose rules engine reads only one root file and
   * neither scans a modular rules directory nor follows references. For example,
   * dcode reads `.deepagents/AGENTS.md`, while Warp reads root or subdirectory
   * `AGENTS.md` files but never `.warp/memories/`. Those adapters must fold every
   * body into one instance because last-writer-wins would silently drop content.
   * Plain-Markdown adapters can opt into `compose` for colliding modular outputs.
   *
   * A generated root rule becomes the merge target when present. A `fold` group
   * without one uses its first rule. A group only composes when every rendered
   * fragment is plain Markdown — a fragment carrying its own frontmatter block
   * (e.g. Amp's `globs:` gate) would end up mid-body where the tool ignores it.
   * Root-involved collisions that cannot be composed safely fail; other
   * collisions remain separate and are reported by the final output-path check.
   * Mutates `convertedRules` in place.
   */
  private mergeRulesByOutputPath({
    convertedRules,
    collisionPolicy,
  }: {
    convertedRules: RuleConversion[];
    collisionPolicy: RuleCollisionPolicy;
  }): void {
    if (convertedRules.length <= 1) {
      return;
    }

    // Group rules by their output path and fold each group independently. Today
    // most folding tools emit a single path (all rules share `AGENTS.md`), but
    // Pi additionally routes `pi.systemPrompt: append` rules to a separate
    // `APPEND_SYSTEM.md`, so those must concatenate among themselves rather than
    // into the root file. Insertion order is preserved so source order is kept.
    const groups = new Map<string, RuleConversion[]>();
    for (const conversion of convertedRules) {
      const path = join(
        conversion.toolRule.getRelativeDirPath(),
        conversion.toolRule.getRelativeFilePath(),
      );
      const group = groups.get(path);
      if (group) {
        group.push(conversion);
      } else {
        groups.set(path, [conversion]);
      }
    }

    const survivors = new Set<RuleConversion>();
    for (const [path, group] of groups) {
      if (group.length === 1) {
        const conversion = group[0];
        if (conversion) {
          if (collisionPolicy === "fold") {
            conversion.toolRule.setFileContent(conversion.toolRule.getFileContent().trim());
          }
          survivors.add(conversion);
        }
        continue;
      }

      const rootConversion = group.find(({ toolRule }) => toolRule.isRoot());
      const allGeneratedRulesAreRoots = group.every(({ toolRule }) => toolRule.isRoot());
      const hasSourceRoot = group.some(
        ({ rulesyncRule }) => rulesyncRule.getFrontmatter().root === true,
      );
      // Composition is only structure-preserving when every fragment is plain
      // Markdown. An adapter may prepend a frontmatter block to some outputs
      // (Amp gates non-root files on a leading `globs:` block); concatenating
      // such a fragment would bury its block mid-body where the tool no longer
      // reads it, so those groups fall through to preserve-or-reject instead.
      const allFragmentsArePlain = group.every(
        ({ toolRule }) => !/^---\r?\n/.test(toolRule.getFileContent()),
      );
      const shouldCompose =
        (collisionPolicy === "fold" ||
          collisionPolicy === "compose" ||
          allGeneratedRulesAreRoots) &&
        allFragmentsArePlain;

      if (!shouldCompose && hasSourceRoot) {
        throw new Error(
          `Multiple generated rules resolve to output path '${path}' for target '${this.toolTarget}', but this target cannot safely compose a collision involving a root rule. Source rules: ${formatRulePaths(group.map(({ rulesyncRule }) => rulesyncRule))}`,
        );
      }

      if (!shouldCompose) {
        for (const conversion of group) {
          survivors.add(conversion);
        }
        continue;
      }

      const target = rootConversion ?? group[0];
      if (!target) {
        continue;
      }
      const ordered = [target, ...group.filter((rule) => rule !== target)];
      const mergedContent = ordered
        .map(({ toolRule }) => toolRule.getFileContent().trim())
        .filter((content) => content.length > 0)
        .join("\n\n");
      target.toolRule.setFileContent(mergedContent);
      survivors.add(target);
    }

    // Keep only each group's merge target; the others are now folded in.
    for (let i = convertedRules.length - 1; i >= 0; i--) {
      const conversion = convertedRules[i];
      if (conversion && !survivors.has(conversion)) {
        convertedRules.splice(i, 1);
      }
    }
  }

  private warnForOutputPathCollisions({
    outputFiles,
    convertedRules,
  }: {
    outputFiles: ToolFile[];
    convertedRules: RuleConversion[];
  }): void {
    const seen = new Map<string, ToolFile>();
    const describeSource = (file: ToolFile): string => {
      const source = convertedRules.find(({ toolRule }) => toolRule === file)?.rulesyncRule;
      return source
        ? formatRulePaths([source])
        : join(file.getRelativeDirPath(), file.getRelativeFilePath());
    };

    for (const file of outputFiles) {
      const path = join(file.getRelativeDirPath(), file.getRelativeFilePath());
      const key = path.toLowerCase();
      const previous = seen.get(key);
      if (previous) {
        const previousPath = join(previous.getRelativeDirPath(), previous.getRelativeFilePath());
        const pathDescription =
          previousPath === path
            ? `'${path}'`
            : `'${previousPath}' and '${path}' (compared case-insensitively, as on macOS and Windows)`;
        this.logger.warn(
          `Both ${describeSource(previous)} and ${describeSource(file)} generate to ${pathDescription}; the last one wins wherever they collide.`,
        );
      }
      seen.set(key, file);
    }
  }

  /**
   * Warn when this generate run is about to write a root rule file that will
   * make the tool stop reading paths it currently reads instead — Junie's
   * `.junie/rules/*.md` and `.junie/playbook.md` become unreachable the
   * moment `.junie/AGENTS.md` exists, since Junie reads the root file
   * exclusively once it is present. `importOnlyRoots` with
   * `onlyWhenRootAbsent` already models exactly this shape for import; this
   * reuses the same declaration so the
   * `generate` path — which never calls `loadToolFiles` and so never reached
   * the existing import-side warning — surfaces it too. Without this, a repo
   * that only ever runs `generate` never sees any warning: the deactivated
   * files stay on disk, untouched and not gitignored, silently unread.
   */
  private async warnForDeactivatedImportOnlyRoots({
    toolRules,
    factory,
  }: {
    toolRules: ToolRule[];
    factory: ToolRuleFactory;
  }): Promise<void> {
    const rootRule = toolRules.find((rule) => rule.isRoot());
    if (!rootRule) {
      return;
    }

    const settablePaths = factory.class.getSettablePaths({ global: this.global });
    const importOnlyRoots =
      "importOnlyRoots" in settablePaths ? settablePaths.importOnlyRoots : undefined;
    if (!importOnlyRoots || importOnlyRoots.length === 0) {
      return;
    }

    const existingPaths: string[] = [];
    for (const importOnlyRoot of importOnlyRoots) {
      if (importOnlyRoot.onlyWhenRootAbsent !== true) {
        continue;
      }
      const matchedPaths = await findFilesByGlobs(
        rootRelativeGlob(
          importOnlyRoot.relativeDirPath,
          importOnlyRoot.relativeFilePath ?? `*.${factory.meta.extension}`,
        ),
        { cwd: this.outputRoot, type: "file" },
      );
      existingPaths.push(...matchedPaths);
    }

    if (existingPaths.length === 0) {
      return;
    }

    const rootFileRelativePath = join(
      rootRule.getRelativeDirPath(),
      rootRule.getRelativeFilePath(),
    );
    const names = existingPaths.map((filePath) =>
      stripControlCharacters(relative(this.outputRoot, filePath)),
    );
    const listedNames = names.slice(0, MAX_LISTED_SKIPPED_IMPORT_ONLY_PATHS);
    const remainingCount = names.length - listedNames.length;
    this.logger.warn(
      `Writing ${stripControlCharacters(rootFileRelativePath)} for ${this.toolTarget} means ${listedNames.join(", ")}${remainingCount > 0 ? ` and ${remainingCount} more` : ""} will no longer be read. Run \`rulesync import --targets ${this.toolTarget}\` first to carry that content into ${RULESYNC_RULES_RELATIVE_DIR_PATH}, or delete ${listedNames.length === 1 ? "it" : "them"} once you have checked the content is already in the root file.`,
    );
  }

  /**
   * Handle localRoot rule generation based on tool target.
   * - `separate-local-file`: writes a dedicated `*.local.md` root file
   *   (claudecode/legacy: `./CLAUDE.local.md`, rovodev: `./AGENTS.local.md`)
   * - `append-to-root` (default): appends the body to the root file
   */
  private handleLocalRootRule(
    toolRules: ToolRule[],
    localRootRule: RulesyncRule,
    factory: ToolRuleFactory,
  ): void {
    const localRootBody = localRootRule.getBody();
    const { meta } = factory;

    if (meta.localRootMode === "separate-local-file" && meta.localRootFileName) {
      const localRule = this.buildLocalRootFile({
        factory,
        fileName: meta.localRootFileName,
        body: localRootBody,
      });
      if (localRule) {
        toolRules.push(localRule);
      }
      return;
    }

    const rootRule = toolRules.find((rule) => rule.isRoot());
    if (rootRule) {
      rootRule.setFileContent(rootRule.getFileContent() + "\n\n" + localRootBody);
    }
  }

  private buildLocalRootFile({
    factory,
    fileName,
    body,
    relativeDirPath,
    localRoot = false,
  }: {
    factory: ToolRuleFactory;
    fileName: string;
    body: string;
    /** Where the file was found on import; defaults to the generation path. */
    relativeDirPath?: string;
    /** True when importing an existing local file back to a rulesync rule. */
    localRoot?: boolean;
  }): ToolRule | null {
    if (isClassOrSubclassOf({ candidate: factory.class, base: ClaudecodeRule })) {
      const paths = ClaudecodeRule.getSettablePaths({ global: this.global });
      return new ClaudecodeRule({
        outputRoot: this.outputRoot,
        relativeDirPath: relativeDirPath ?? paths.root.relativeDirPath,
        relativeFilePath: fileName,
        frontmatter: {},
        body,
        validate: true,
        root: true,
        localRoot,
      });
    }
    if (isClassOrSubclassOf({ candidate: factory.class, base: ClaudecodeLegacyRule })) {
      const paths = ClaudecodeLegacyRule.getSettablePaths({ global: this.global });
      return new ClaudecodeLegacyRule({
        outputRoot: this.outputRoot,
        relativeDirPath: relativeDirPath ?? paths.root.relativeDirPath,
        relativeFilePath: fileName,
        fileContent: body,
        validate: true,
        root: true,
        localRoot,
      });
    }
    if (isClassOrSubclassOf({ candidate: factory.class, base: RovodevRule })) {
      return new RovodevRule({
        outputRoot: this.outputRoot,
        relativeDirPath: relativeDirPath ?? ".",
        relativeFilePath: fileName,
        fileContent: body,
        validate: true,
        root: true,
        localRoot,
      });
    }
    if (isClassOrSubclassOf({ candidate: factory.class, base: RooRule })) {
      return new RooRule({
        outputRoot: this.outputRoot,
        relativeDirPath: relativeDirPath ?? ".",
        relativeFilePath: fileName,
        fileContent: body,
        validate: true,
        root: true,
        localRoot,
      });
    }
    if (isClassOrSubclassOf({ candidate: factory.class, base: DevinRule })) {
      // `AGENTS.local.md` sits next to the project-root `AGENTS.md` Devin reads,
      // not under `.devin/`, and is plain markdown with no trigger frontmatter.
      return new DevinRule({
        outputRoot: this.outputRoot,
        relativeDirPath: relativeDirPath ?? ".",
        relativeFilePath: fileName,
        frontmatter: {},
        body,
        validate: true,
        root: true,
        localRoot,
      });
    }
    if (isClassOrSubclassOf({ candidate: factory.class, base: QwencodeRule })) {
      // Qwen Code reads the personal local context file from `.qwen/`, not the
      // project root (project scope only; global handling never reaches here).
      return new QwencodeRule({
        outputRoot: this.outputRoot,
        relativeDirPath: relativeDirPath ?? QWENCODE_DIR,
        relativeFilePath: fileName,
        fileContent: body,
        validate: true,
        root: true,
        localRoot,
      });
    }
    return null;
  }

  /**
   * Generate reference section based on meta configuration.
   */
  private generateReferenceSectionFromMeta(
    meta: ToolRuleFactory["meta"],
    toolRules: ToolRule[],
  ): string {
    const mode = resolveRuleDiscoveryMode({
      defaultMode: meta.ruleDiscoveryMode,
      options: this.featureOptions,
    });
    switch (mode) {
      case "toon":
        return this.generateToonReferencesSection(toolRules);
      case "claudecode-legacy":
        return this.generateReferencesSection(toolRules);
      case "auto":
      default:
        return "";
    }
  }

  /**
   * Build the additional-conventions section by collecting per-feature sections
   * contributed by each feature processor. The rules feature only decides which
   * features contribute (based on meta + simulate flags) and concatenates them;
   * the section wording lives in each feature's `getSimulatedConventionSection`.
   */
  private generateAdditionalConventionsSectionFromMeta(meta: ToolRuleFactory["meta"]): string {
    const { additionalConventions } = meta;
    if (!additionalConventions) {
      return "";
    }

    const overview = `# Additional Conventions Beyond the Built-in Functions

As this project's AI coding tool, you must follow the additional conventions below, in addition to the built-in functions.`;

    const sections: string[] = [overview];

    if (
      additionalConventions.commands &&
      this.simulateCommands &&
      CommandsProcessor.getToolTargetsSimulated().includes(this.toolTarget)
    ) {
      sections.push(CommandsProcessor.getSimulatedConventionSection());
    }

    if (
      additionalConventions.subagents &&
      this.simulateSubagents &&
      SubagentsProcessor.getToolTargetsSimulated().includes(this.toolTarget)
    ) {
      sections.push(SubagentsProcessor.getSimulatedConventionSection());
    }

    const skillsConfig = additionalConventions.skills;
    if (
      skillsConfig &&
      this.simulateSkills &&
      SkillsProcessor.getToolTargetsSimulated().includes(this.toolTarget) &&
      (!skillsConfig.globalOnly || this.global)
    ) {
      sections.push(
        SkillsProcessor.getSimulatedConventionSection({
          skillList: this.buildSkillList(skillsConfig.skillClass),
        }),
      );
    }

    return sections.join("\n\n") + "\n\n";
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolRules = toolFiles.filter((file): file is ToolRule => file instanceof ToolRule);

    const rulesyncRules = toolRules.map((toolRule) => {
      // A tool's separate personal local-root file maps back to a canonical
      // `localRoot: true` rule instead of the tool class's regular mapping,
      // scoped to this tool so the personal content does not spread to other
      // tools' (possibly committed) root files on the next generate.
      if (toolRule.isLocalRoot()) {
        return toolRule.toLocalRootRulesyncRule({ targets: [this.toolTarget] });
      }
      return this.withoutLanguageBlock({ toolRule, rulesyncRule: toolRule.toRulesyncRule() });
    });

    // Several tool files can derive the same rulesync file name — most easily
    // with the AGENTS.md standard's nested files, where every source is named
    // `AGENTS.md` and the rulesync name comes from the directory. The writer
    // overwrites, so without this the earlier rule disappears silently.
    // Keyed case-insensitively, because on a case-insensitive filesystem
    // `Docs.md` and `docs.md` are one file.
    const claimedBy = new Map<string, string>();
    for (const [index, rulesyncRule] of rulesyncRules.entries()) {
      const target = rulesyncRule.getRelativeFilePath();
      const source = join(
        toolRules[index]!.getRelativeDirPath(),
        toolRules[index]!.getRelativeFilePath(),
      );
      const previous = claimedBy.get(target.toLowerCase());
      if (previous === undefined) {
        claimedBy.set(target.toLowerCase(), source);
        continue;
      }
      // All three names come off the filesystem — a non-root rule's rulesync
      // name is the tool file's basename — so each is stripped before reaching
      // a terminal that would act on an embedded escape.
      this.logger.warn(
        `Both ${stripControlCharacters(previous)} and ${stripControlCharacters(source)} import to ${stripControlCharacters(join(RULESYNC_RULES_RELATIVE_DIR_PATH, target))} (compared case-insensitively, as on macOS and Windows); the last one wins wherever they collide.`,
      );
    }

    return rulesyncRules;
  }

  /**
   * Drop the language block a previous `generate` appended, so that importing
   * a generated root file and generating again yields one block, not two.
   * Every imported rule is checked, not just root ones: Cursor and the
   * fixed-name targets import their root file as a non-root rule. The
   * `language` key itself lives in `rulesync.jsonc`, so nothing about the
   * detected language is carried into the rulesync rule — which is why the
   * strip is reported: a user who imports a file carrying the block and has
   * not set `language` would otherwise lose the instruction without a trace.
   * Once per file per run, since an import over several targets reads the
   * same root file for each of them.
   */
  private withoutLanguageBlock({
    toolRule,
    rulesyncRule,
  }: {
    toolRule: ToolRule;
    rulesyncRule: RulesyncRule;
  }): RulesyncRule {
    const body = rulesyncRule.getBody();
    const stripped = stripLanguageBlock(body);
    if (stripped === body) {
      return rulesyncRule;
    }
    // The path comes off the filesystem, so it is stripped before reaching a
    // terminal that would act on an embedded escape.
    const source = stripControlCharacters(
      join(toolRule.getRelativeDirPath(), toolRule.getRelativeFilePath()),
    );
    warnOnceWithFallback(
      this.logger,
      `Removed the answer-language block rulesync appends from ${source} on import; it is not kept in .rulesync/rules/. Set "language" in rulesync.jsonc to keep generating it.`,
    );
    return new RulesyncRule({
      outputRoot: rulesyncRule.getOutputRoot(),
      relativeDirPath: rulesyncRule.getRelativeDirPath(),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      frontmatter: rulesyncRule.getFrontmatter(),
      body: stripped,
      validate: false,
    });
  }

  /**
   * Load rulesync rule files from a single source-tree's `rules/` (and
   * `rules/.curated/`) subtree. `sourceTree` is the source tree itself
   * (e.g. `/repo/.rulesync` or `/repo/.rulesync.local`), NOT its parent.
   *
   * Intra-tree behavior — the local-wins-over-curated rule and the
   * case-insensitive collision handling — is preserved from the previous
   * single-root implementation. See `loadRulesyncFiles` for how the
   * per-root results are combined into the effective set.
   */
  private async loadRulesyncFilesForRoot(sourceTree: string): Promise<RulesyncRule[]> {
    // Anchor `RulesyncRule` instances at the parent of the source tree so
    // that `getRelativePathFromCwd()` still renders paths like
    // `.rulesync/rules/foo.md` (or `.rulesync.local/rules/foo.md` for an
    // overlay tree) — matching the previous behavior exactly.
    const treeParent = dirname(sourceTree);
    const treeName = basename(sourceTree);
    const treeRulesDirPath = join(treeName, RULES_FEATURE_SUBDIR);
    const rulesyncOutputRoot = join(sourceTree, RULES_FEATURE_SUBDIR);
    const curatedOutputRoot = join(sourceTree, CURATED_RULES_FEATURE_SUBDIR);

    // Strict: a source directory symlinked at a tree that no longer resolves
    // would otherwise glob to nothing, which reads as "every rule was deleted"
    // — `--delete` then removes what it could not regenerate and the run still
    // reports success.
    const [rulesDirExists, curatedDirExists] = await Promise.all([
      directoryExistsStrict(rulesyncOutputRoot),
      directoryExistsStrict(curatedOutputRoot),
    ]);

    const [discoveredFiles, discoveredCuratedFiles] = await Promise.all([
      rulesDirExists ? findFilesByGlobs("**/*.md", { cwd: rulesyncOutputRoot }) : [],
      curatedDirExists ? findFilesByGlobs("**/*.md", { cwd: curatedOutputRoot }) : [],
    ]);

    const files = [...new Set([...discoveredFiles, ...discoveredCuratedFiles])];

    const localFiles = files.filter(
      (file) => !relative(rulesyncOutputRoot, file).startsWith(`.curated${sep}`),
    );
    // Keyed by case-folded path because a curated and a local file whose names
    // differ only in case collapse onto one file on macOS/Windows, so the
    // curated one cannot be emitted alongside the local one there.
    const localRelativePathsByIdentity = groupSpellingsByCaseFoldedIdentity(
      localFiles.map((file) => relative(rulesyncOutputRoot, file)),
    );

    const curatedFiles = files
      .filter((file) => relative(rulesyncOutputRoot, file).startsWith(`.curated${sep}`))
      .map((file) => ({ file, relativeFilePath: relative(curatedOutputRoot, file) }))
      .filter(({ relativeFilePath }) => {
        const spellings = localRelativePathsByIdentity.get(caseFoldIdentity(relativeFilePath));

        if (spellings === undefined) {
          return true;
        }

        // An exact match is the documented local-wins-over-curated flow and
        // stays silent; a case-only match is ambiguous enough to surface,
        // mirroring the warning the cross-root merge emits. The exact spelling
        // is preferred so an unrelated case variant sitting next to it does
        // not turn a plain override into a spurious collision warning.
        if (!spellings.includes(relativeFilePath)) {
          this.logger.warn(
            formatCuratedCaseCollisionWarning({
              artifactKind: "rule",
              entryNoun: "file",
              treeDirPath: treeRulesDirPath,
              curatedSpelling: join(".curated", relativeFilePath),
              localSpellings: spellings,
            }),
          );
        }

        return false;
      });

    const selectedFiles = [
      ...localFiles.map((file) => ({
        file,
        sourceRelativeFilePath: relative(rulesyncOutputRoot, file),
        relativeFilePath: relative(rulesyncOutputRoot, file),
      })),
      ...curatedFiles.map(({ file, relativeFilePath }) => ({
        file,
        sourceRelativeFilePath: join(".curated", relativeFilePath),
        relativeFilePath,
      })),
    ];

    this.logger.debug(`Found ${selectedFiles.length} rulesync files under ${rulesyncOutputRoot}`);

    return await Promise.all(
      selectedFiles.map(async ({ sourceRelativeFilePath, relativeFilePath }) => {
        checkPathTraversal({
          relativePath: sourceRelativeFilePath,
          intendedRootDir: rulesyncOutputRoot,
        });

        const rule = await RulesyncRule.fromFile({
          outputRoot: treeParent,
          relativeDirPath: treeRulesDirPath,
          relativeFilePath: sourceRelativeFilePath,
          deriveSubprojectPathFromGlobs: this.deriveSubprojectPathFromGlobs,
        });

        if (sourceRelativeFilePath === relativeFilePath) {
          return rule;
        }

        return new RulesyncRule({
          outputRoot: treeParent,
          relativeDirPath: treeRulesDirPath,
          relativeFilePath,
          frontmatter: rule.getFrontmatter(),
          body: rule.getBody(),
        });
      }),
    );
  }

  /**
   * Load and merge rulesync rule files from every configured input root's
   * `.rulesync/rules/` directory, by relative path, so that a rule with the
   * same target path from a later root replaces the earlier root's copy
   * (case-insensitive, matching the intra-root collision handling).
   *
   * This is the side-effect-free half of `loadRulesyncFiles`: it does not
   * warn about a missing root rule or validate `localRoot` placement, so it
   * is also safe to call from code paths — like
   * `warnForFoldImportDuplicationRisk` — that only need the merged rule set
   * and must not trigger `loadRulesyncFiles`'s generate-time checks.
   */
  private async loadMergedRulesyncRules(): Promise<RulesyncRule[]> {
    const perRoot = await Promise.all(
      this.inputRoots.map((root) => this.loadRulesyncFilesForRoot(root)),
    );

    return mergeByCaseInsensitiveIdentity({
      perRoot,
      identity: (rule) => rule.getRelativeFilePath(),
      artifactName: "rule",
      logger: this.logger,
    });
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync rule files from every configured input root's
   * `.rulesync/rules/` directory, merging by relative path so that a rule
   * with the same target path from a later root replaces the earlier root's
   * copy (case-insensitive, matching the intra-root collision handling).
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const rulesyncRules = await this.loadMergedRulesyncRules();

    const factory = this.getFactory(this.toolTarget);

    const rootRules = rulesyncRules.filter((rule) => rule.getFrontmatter().root);

    // Filter roots to those targeting this tool
    const targetedRootRules = rootRules.filter((rule) =>
      factory.class.isTargetedByRulesyncRule(rule),
    );

    if (targetedRootRules.length === 0 && rulesyncRules.length > 0) {
      this.logger.warn(
        `No root rulesync rule file found for target '${this.toolTarget}'. Consider adding 'root: true' to one of your rule files in ${RULESYNC_RULES_RELATIVE_DIR_PATH}.`,
      );
    }

    // Validation for localRoot — scoped to this tool's target
    const localRootRules = rulesyncRules.filter((rule) => rule.getFrontmatter().localRoot);
    const targetedLocalRootRules = localRootRules.filter((rule) =>
      factory.class.isTargetedByRulesyncRule(rule),
    );

    if (targetedLocalRootRules.length > 1) {
      throw new Error(
        `Multiple localRoot rules found for target '${this.toolTarget}': ${formatRulePaths(targetedLocalRootRules)}. Only one rule can have localRoot: true`,
      );
    }

    if (targetedLocalRootRules.length > 0 && targetedRootRules.length === 0) {
      throw new Error(
        `localRoot: true requires a root: true rule to exist for target '${this.toolTarget}' (found in ${formatRulePaths(targetedLocalRootRules)})`,
      );
    }

    // In global mode, retain non-root rules when the target can emit or fold them globally
    if (this.global) {
      const globalPaths = factory.class.getSettablePaths({ global: true });
      const supportsGlobalNonRoot =
        ("nonRoot" in globalPaths && globalPaths.nonRoot !== null) ||
        (factory.meta.supportsGlobal && factory.meta.collisionPolicy === "fold");

      const nonRootRules = rulesyncRules.filter(
        (rule) =>
          !rule.getFrontmatter().root &&
          !rule.getFrontmatter().localRoot &&
          factory.class.isTargetedByRulesyncRule(rule),
      );

      if (nonRootRules.length > 0 && !supportsGlobalNonRoot) {
        this.logger.warn(
          `${nonRootRules.length} non-root rulesync rules found, but it's in global mode, so ignoring them: ${formatRulePaths(nonRootRules)}`,
        );
      }
      if (targetedLocalRootRules.length > 0) {
        this.logger.warn(
          `${targetedLocalRootRules.length} localRoot rules found, but localRoot is not supported in global mode, ignoring them: ${formatRulePaths(targetedLocalRootRules)}`,
        );
      }
      return supportsGlobalNonRoot ? [...targetedRootRules, ...nonRootRules] : targetedRootRules;
    }

    // In project mode, exclude root rules not targeting this tool and filter non-root by target
    const nonRootRules = rulesyncRules.filter(
      (rule) => !rule.getFrontmatter().root && factory.class.isTargetedByRulesyncRule(rule),
    );
    return [...targetedRootRules, ...nonRootRules];
  }

  /**
   * Pi reads `AGENTS.override.md` *instead of* `AGENTS.md` from a directory, and
   * non-root Pi rules are folded into whichever file the root emits. A mix of
   * opted-in and opted-out rules would therefore split the output across both
   * files and let Pi silently ignore everything in `AGENTS.md`, so the root rule
   * decides for all of them: its `pi.contextFile` is copied onto the non-root
   * rules, and the flag set only on a non-root rule is dropped with a warning.
   */
  private alignPiContextFile(rules: RulesyncRule[]): RulesyncRule[] {
    if (this.toolTarget !== "pi") return rules;

    const factory = this.getFactory(this.toolTarget);
    const targeted = rules.filter((rule) => factory.class.isTargetedByRulesyncRule(rule));
    // Any root rule opting in decides for the whole output: with several root
    // rules, honoring only one of them would leave the others in the file Pi
    // stops reading.
    const rootContextFile = targeted.some(
      (rule) =>
        rule.getFrontmatter().root === true && rule.getFrontmatter().pi?.contextFile === "override",
    )
      ? ("override" as const)
      : undefined;
    const mismatched = targeted.filter(
      (rule) => rule.getFrontmatter().pi?.contextFile !== rootContextFile,
    );
    if (mismatched.length === 0) return rules;

    if (rootContextFile === undefined) {
      this.logger.warn(
        `pi.contextFile is set on ${mismatched.length} non-root rule(s) but not on the root rule, ` +
          `so it is ignored: Pi folds every rule body into the root context file, and emitting ` +
          `AGENTS.override.md for some of them would hide the rest. Set it on the root rule ` +
          `instead: ${formatRulePaths(mismatched)}`,
      );
    }

    const mismatchedSet = new Set(mismatched);
    return rules.map((rule) => {
      if (!mismatchedSet.has(rule)) return rule;
      const frontmatter = rule.getFrontmatter();
      const { contextFile: _dropped, ...pi } = frontmatter.pi ?? {};
      const nextPi = { ...pi, ...(rootContextFile ? { contextFile: rootContextFile } : {}) };
      return new RulesyncRule({
        outputRoot: rule.getOutputRoot(),
        relativeDirPath: rule.getRelativeDirPath(),
        relativeFilePath: rule.getRelativeFilePath(),
        frontmatter: {
          ...frontmatter,
          ...(Object.keys(nextPi).length > 0 ? { pi: nextPi } : { pi: undefined }),
        },
        body: rule.getBody(),
        // The source rule was already parsed under its own validate setting;
        // only the pi block changes here.
        validate: false,
      });
    });
  }

  /**
   * Warn when importing a `collisionPolicy: "fold"` target's root file while
   * `.rulesync/rules/` still holds non-root rules targeting it. A fold target
   * (codexcli, junie, and others) concatenates every targeted non-root rule
   * into its one root output file on `generate`. Importing that root file
   * back therefore re-reads the already-folded content as a single new
   * rulesync rule, while the original non-root rules stay in place
   * untouched — the next `generate` folds both together, duplicating the
   * content once per generate/import cycle with nothing to indicate why.
   *
   * This does not attempt to detect or drop the specific duplicated content
   * (the root file has no marker recording which rule contributed what); it
   * only surfaces that the cycle produces one, per the "at minimum, warn"
   * option recorded on issue #2743.
   *
   * Only the actual `rulesync import` call site invokes this (and only once
   * it has confirmed there is something to import) — `loadToolFiles` is also
   * the entry point for `rulesync convert` and `rulesync fetch`, neither of
   * which writes to `.rulesync/rules/` or carries this duplication risk.
   *
   * Reads via `loadMergedRulesyncRules` rather than `loadRulesyncFiles`
   * deliberately: this runs before the imported root file is written, so
   * `.rulesync/rules/` never yet has a root rule targeting this tool, and
   * `loadRulesyncFiles`'s "no root rule found" warning and `localRoot`
   * validation (which can throw) would fire spuriously on every fold-tool
   * import — including ones where nothing is actually misconfigured.
   *
   * In global mode, a `localRoot: true` rule is excluded from the
   * duplication check the same way `loadRulesyncFiles`'s global-mode branch
   * excludes it from `nonRootRules`: `generate` ignores `localRoot` entirely
   * in global mode, so such a rule is never actually folded into the global
   * root output and warning about it here would be inaccurate.
   */
  async warnForFoldImportDuplicationRisk(): Promise<void> {
    const factory = this.getFactory(this.toolTarget);
    if (factory.meta.collisionPolicy !== "fold") {
      return;
    }

    const mergedRules = await this.loadMergedRulesyncRules();
    const nonRootRules = mergedRules.filter(
      (rule) =>
        !rule.getFrontmatter().root &&
        (!this.global || !rule.getFrontmatter().localRoot) &&
        factory.class.isTargetedByRulesyncRule(rule),
    );
    if (nonRootRules.length === 0) {
      return;
    }

    this.logger.warn(
      `Importing ${this.toolTarget}'s root file will re-add content already folded from ${formatRulePaths(nonRootRules)}: ${this.toolTarget} concatenates every non-root rule into its single root output file, so the imported copy duplicates them the next time you run \`rulesync generate --targets ${this.toolTarget}\`. Review the imported rule and remove the duplicated content, or remove the original non-root rule files, before generating again.`,
    );
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific rule configurations and parse them into ToolRule instances
   */
  async loadToolFiles({
    forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    try {
      const factory = this.getFactory(this.toolTarget);
      const settablePaths = factory.class.getSettablePaths({
        global: this.global,
      });

      const resolveRelativeDirPath = (filePath: string): string => {
        const dirName = dirname(relative(this.outputRoot, filePath));
        return dirName === "" ? "." : dirName;
      };

      /**
       * Build deletion rules from discovered file paths: resolve dir, check traversal, create forDeletion, filter isDeletable.
       *
       * Two modes:
       * - Root mode (no opts): `relativeFilePath` = `basename(filePath)`, traversal checks `relativeDirPath` against `this.outputRoot`.
       * - Non-root mode (with `outputRootOverride` + `relativeDirPathOverride`): `relativeFilePath` = `relative(outputRootOverride, filePath)`,
       *   traversal checks `relativeFilePath` against `outputRootOverride`.
       */
      const buildDeletionRulesFromPaths = (
        filePaths: string[],
        opts?: { outputRootOverride: string; relativeDirPathOverride: string },
      ): ToolRule[] => {
        const isNonRoot = opts !== undefined;
        const effectiveOutputRoot = isNonRoot ? opts.outputRootOverride : this.outputRoot;
        return filePaths
          .map((filePath) => {
            const relativeDirPath = isNonRoot
              ? opts.relativeDirPathOverride
              : resolveRelativeDirPath(filePath);
            const relativeFilePath = isNonRoot
              ? relative(effectiveOutputRoot, filePath)
              : basename(filePath);
            checkPathTraversal({
              relativePath: isNonRoot ? relativeFilePath : relativeDirPath,
              intendedRootDir: effectiveOutputRoot,
            });
            return factory.class.forDeletion({
              outputRoot: this.outputRoot,
              relativeDirPath,
              relativeFilePath,
              global: this.global,
            });
          })
          .filter((rule) => rule.isDeletable());
      };

      /**
       * Import counterpart of {@link buildDeletionRulesFromPaths} for the
       * root-shaped scans (root, legacy roots, and read-only roots), whose
       * paths all sit at a directory Rulesync resolves from the file itself.
       */
      const buildImportRulesFromPaths = (filePaths: string[]): Promise<ToolRule[]> =>
        Promise.all(
          filePaths.map((filePath) => {
            const relativeDirPath = resolveRelativeDirPath(filePath);
            checkPathTraversal({
              relativePath: relativeDirPath,
              intendedRootDir: this.outputRoot,
            });
            return factory.class.fromFile({
              outputRoot: this.outputRoot,
              relativeDirPath,
              relativeFilePath: basename(filePath),
              global: this.global,
            });
          }),
        );

      /**
       * The tool's own root file, as opposed to whichever root
       * `rootToolRules` ends up resolving. A legacy root reached through
       * `alternativeRoots` is deliberately not counted here: it is a
       * hand-authored file Rulesync never writes, so it has folded nothing in,
       * and in Junie's resolution order it ranks *below* the multi-file layout
       * that `importOnlyRoots` describes. Gating those roots on it would drop
       * exactly the files the tool is really reading.
       *
       * Resolved once, up front, so the two blocks that need it do not depend
       * on each other's evaluation order.
       */
      const primaryRootFilePaths = settablePaths.root
        ? await findFilesByGlobs(
            rootRelativeGlob(
              settablePaths.root.relativeDirPath ?? ".",
              settablePaths.root.relativeFilePath,
            ),
            { cwd: this.outputRoot },
          )
        : [];

      const rootToolRules = await (async () => {
        if (!settablePaths.root) {
          return [];
        }

        const uniqueRootFilePaths = await findFilesWithFallback(
          primaryRootFilePaths,
          settablePaths.alternativeRoots,
          (alt) => rootRelativeGlob(alt.relativeDirPath, alt.relativeFilePath),
          this.outputRoot,
        );

        if (forDeletion) {
          return buildDeletionRulesFromPaths(uniqueRootFilePaths);
        }

        return await buildImportRulesFromPaths(uniqueRootFilePaths);
      })();
      this.logger.debug(`Found ${rootToolRules.length} root tool rule files`);

      // Load the separate `*.local.md` file (import and deletion) when the
      // tool uses one, so a personal local-root file round-trips back to a
      // canonical `localRoot: true` rulesync rule instead of being emit-only.
      const localRootToolRules = await (async () => {
        if (
          this.global ||
          factory.meta.localRootMode !== "separate-local-file" ||
          !factory.meta.localRootFileName
        ) {
          return [];
        }
        const fileName = factory.meta.localRootFileName;

        const filePaths = await (async () => {
          if (factory.class.getLocalRootFileGlob) {
            return await findFilesByGlobs(factory.class.getLocalRootFileGlob({ fileName }), {
              cwd: this.outputRoot,
            });
          }
          if (!settablePaths.root) {
            return [];
          }
          return await findFilesWithFallback(
            await findFilesByGlobs(
              rootRelativeGlob(settablePaths.root.relativeDirPath ?? ".", fileName),
              { cwd: this.outputRoot },
            ),
            settablePaths.alternativeRoots,
            (alt) => rootRelativeGlob(alt.relativeDirPath, fileName),
            this.outputRoot,
          );
        })();

        if (forDeletion) {
          return buildDeletionRulesFromPaths(filePaths);
        }

        const importedRules = await Promise.all(
          filePaths.map(async (filePath) => {
            const relativeDirPath = resolveRelativeDirPath(filePath);
            checkPathTraversal({
              relativePath: relativeDirPath,
              intendedRootDir: this.outputRoot,
            });
            const body = await readFileContent(filePath);
            return this.buildLocalRootFile({
              factory,
              fileName: basename(filePath),
              body,
              relativeDirPath,
              localRoot: true,
            });
          }),
        );
        return importedRules.filter((rule): rule is ToolRule => rule !== null);
      })();
      this.logger.debug(`Found ${localRootToolRules.length} local root tool rule files`);

      const rootMirrorDeletionRules = await (async () => {
        const rootMirror = factory.class.getRootMirror?.();
        if (!forDeletion || this.global || !rootMirror) {
          return [];
        }
        const { primaryGlob, mirrorGlob } = rootMirror.getMirrorDeletionGlobs();
        const primaryPaths = await findFilesByGlobs(primaryGlob, { cwd: this.outputRoot });
        if (primaryPaths.length === 0) {
          return [];
        }
        const mirrorPaths = await findFilesByGlobs(mirrorGlob, { cwd: this.outputRoot });
        return buildDeletionRulesFromPaths(mirrorPaths);
      })();

      // Extra fixed-path files (e.g. Pi's APPEND_SYSTEM.md) enumerated for both
      // import and deletion so they round-trip and stale files are cleaned up.
      const extraFixedToolRules = await (async () => {
        const extraFiles = factory.class.getExtraFixedFiles?.({ global: this.global });
        if (!extraFiles || extraFiles.length === 0) {
          return [];
        }

        const filePaths = await findFilesByGlobs(
          extraFiles.map((file) => rootRelativeGlob(file.relativeDirPath, file.relativeFilePath)),
          { cwd: this.outputRoot },
        );
        if (filePaths.length === 0) {
          return [];
        }

        if (forDeletion) {
          return buildDeletionRulesFromPaths(filePaths);
        }

        return await Promise.all(
          filePaths.map((filePath) => {
            const relativeDirPath = resolveRelativeDirPath(filePath);
            checkPathTraversal({
              relativePath: relativeDirPath,
              intendedRootDir: this.outputRoot,
            });
            return factory.class.fromFile({
              outputRoot: this.outputRoot,
              relativeDirPath,
              relativeFilePath: basename(filePath),
              global: this.global,
            });
          }),
        );
      })();
      this.logger.debug(`Found ${extraFixedToolRules.length} extra fixed tool rule files`);

      // Pattern-discovered rule files (the AGENTS.md standard's nested
      // subproject files). Import only — see `getNestedFileGlobs`.
      const nestedToolRules = await (async () => {
        // Never in global mode: the output root is the home directory there, and
        // walking all of it looking for subprojects is both wrong and expensive.
        const patterns = this.global ? undefined : factory.class.getNestedFilePatterns?.();
        if (forDeletion || !patterns || patterns.include.length === 0) {
          return [];
        }

        // Symlinks are not followed. Unlike the fixed-path scans, this one walks
        // the whole project tree, so a symlink committed to a repository could
        // otherwise pull a file from outside the project (a key, a dotfile) into
        // version-controlled `.rulesync/rules/`. Not following them also keeps a
        // pair of directory symlinks from exploding the traversal.
        const matchedPaths = await findFilesByGlobs(patterns.include, {
          cwd: this.outputRoot,
          type: "file",
          followSymbolicLinks: false,
          ignore: patterns.ignore,
        });

        // The project's own statement of what is not its source. Without it a
        // vendored dependency's rule file — third-party content the user
        // deliberately kept untracked — would be copied into version-controlled
        // `.rulesync/rules/`, and targets that concatenate non-root rules into
        // one file would then load it unconditionally.
        const filePaths = filterOutPathsInGitIgnoredDirectories({
          rootDir: this.outputRoot,
          filePaths: matchedPaths,
        });

        return await Promise.all(
          filePaths.map((filePath) => {
            const relativeDirPath = resolveRelativeDirPath(filePath);
            checkPathTraversal({
              relativePath: relativeDirPath,
              intendedRootDir: this.outputRoot,
            });
            return factory.class.fromFile({
              outputRoot: this.outputRoot,
              relativeDirPath,
              relativeFilePath: basename(filePath),
              global: this.global,
            });
          }),
        );
      })();
      this.logger.debug(`Found ${nestedToolRules.length} nested tool rule files`);

      // Read-only rule roots a tool documents but Rulesync never writes to
      // (Junie's `.junie/rules/*.md` and `.junie/playbook.md`). Import only:
      // since generation never produces them, treating them as deletion
      // candidates would delete hand-authored files rulesync does not own.
      //
      // These are fixed, tool-owned directories, so this scan mirrors the
      // `nonRoot` one below rather than the nested one above: symlinks are
      // followed, because a shared rules tree linked into `.junie/rules` is a
      // supported layout (see `docs/guide/separate-input-root.md` on symlinks
      // and trust). It runs in project scope only — see `importOnlyRoots`.
      const importOnlyToolRules = await (async () => {
        // Project scope only — `ToolRuleSettablePathsGlobal` has no
        // `importOnlyRoots`, so in global mode this narrows away rather than
        // globbing relative directories under the user's home.
        const importOnlyRoots =
          "importOnlyRoots" in settablePaths ? settablePaths.importOnlyRoots : undefined;
        if (forDeletion || !importOnlyRoots || importOnlyRoots.length === 0) {
          return [];
        }

        // A root file that exists has already absorbed these rules on a previous
        // generate (Junie folds non-root rules into `.junie/AGENTS.md`), so
        // re-importing them beside it would duplicate the same content once per
        // import/generate cycle. See `onlyWhenRootAbsent`. Only the tool's own
        // root counts — see `primaryRootFilePaths`.
        const rootFilePath = primaryRootFilePaths[0];

        const scannedPaths: string[] = [];
        const skippedPaths: string[] = [];
        for (const importOnlyRoot of importOnlyRoots) {
          const matchedPaths = await findFilesByGlobs(
            rootRelativeGlob(
              importOnlyRoot.relativeDirPath,
              importOnlyRoot.relativeFilePath ?? `*.${factory.meta.extension}`,
            ),
            { cwd: this.outputRoot, type: "file" },
          );
          if (importOnlyRoot.onlyWhenRootAbsent === true && rootFilePath !== undefined) {
            skippedPaths.push(...matchedPaths);
            continue;
          }
          scannedPaths.push(...matchedPaths);
        }

        // Left unreported these look imported but silently are not, and the
        // tool no longer reads them either — a state worth acting on. The
        // names come off the filesystem, so they are stripped of control
        // characters before reaching a terminal, and the list is capped so a
        // large rules directory cannot turn one warning into a wall of text.
        if (skippedPaths.length > 0 && rootFilePath !== undefined) {
          const skippedNames = skippedPaths.map((filePath) =>
            stripControlCharacters(relative(this.outputRoot, filePath)),
          );
          const listedNames = skippedNames.slice(0, MAX_LISTED_SKIPPED_IMPORT_ONLY_PATHS);
          const remainingCount = skippedNames.length - listedNames.length;
          this.logger.warn(
            `Not importing ${listedNames.join(", ")}${remainingCount > 0 ? ` and ${remainingCount} more` : ""} for ${this.toolTarget}: ${stripControlCharacters(relative(this.outputRoot, rootFilePath))} exists, and the tool reads that file exclusively. Delete them once you have checked that content is in the root file, or move it into ${RULESYNC_RULES_RELATIVE_DIR_PATH} if it is not.`,
          );
        }

        return await buildImportRulesFromPaths(scannedPaths);
      })();
      this.logger.debug(`Found ${importOnlyToolRules.length} import-only tool rule files`);

      const nonRootToolRules = await (async () => {
        if (!settablePaths.nonRoot) {
          return [];
        }

        const nonRootOutputRoot = join(this.outputRoot, settablePaths.nonRoot.relativeDirPath);
        const nonRootFilePaths = await findFilesByGlobs(`**/*.${factory.meta.extension}`, {
          cwd: nonRootOutputRoot,
        });

        if (forDeletion) {
          return buildDeletionRulesFromPaths(nonRootFilePaths, {
            outputRootOverride: nonRootOutputRoot,
            relativeDirPathOverride: settablePaths.nonRoot.relativeDirPath,
          });
        }

        const modularRootRelative = settablePaths.nonRoot.relativeDirPath;

        // When the root file lives in the same directory as the non-root files
        // (e.g. Kiro's global steering, where the root is `~/.kiro/steering/
        // product.md` alongside the non-root `~/.kiro/steering/*.md`), the
        // non-root glob also matches the root file. Exclude it here so the root
        // rule is not imported a second time as a non-root rule.
        const rootFileNameInSameDir =
          settablePaths.root?.relativeDirPath === settablePaths.nonRoot.relativeDirPath
            ? settablePaths.root?.relativeFilePath
            : undefined;

        const nonRootPathsForImport = (
          factory.class === RovodevRule
            ? nonRootFilePaths.filter((filePath) => {
                const relativeFilePath = relative(nonRootOutputRoot, filePath);
                const ok = RovodevRule.isAllowedModularRulesRelativePath(relativeFilePath);
                if (!ok) {
                  this.logger.warn(
                    `Skipping reserved Rovodev path under modular-rules (import): ${join(modularRootRelative, relativeFilePath)}`,
                  );
                }
                return ok;
              })
            : nonRootFilePaths
        ).filter(
          (filePath) =>
            rootFileNameInSameDir === undefined ||
            relative(nonRootOutputRoot, filePath) !== rootFileNameInSameDir,
        );

        return await Promise.all(
          nonRootPathsForImport.map((filePath) => {
            const relativeFilePath = relative(nonRootOutputRoot, filePath);
            checkPathTraversal({
              relativePath: relativeFilePath,
              intendedRootDir: nonRootOutputRoot,
            });
            return factory.class.fromFile({
              outputRoot: this.outputRoot,
              relativeDirPath: modularRootRelative,
              relativeFilePath,
              global: this.global,
            });
          }),
        );
      })();
      this.logger.debug(`Found ${nonRootToolRules.length} non-root tool rule files`);

      return [
        // Ahead of the root rules on purpose: an import that maps two tool files
        // onto one `.rulesync/rules/` name keeps the last of them, so a root
        // file outranks a read-only root that happens to hold, say, an
        // `overview.md`. `onlyWhenRootAbsent` already keeps the two apart
        // whenever the tool's own root file exists; this is what settles the
        // remaining case, a legacy root beside a read-only one. Either way the
        // loser is named in a collision warning rather than dropped silently.
        // (A statement about these two blocks only: `nonRoot` rules come last
        // and have always outranked the root file.)
        ...importOnlyToolRules,
        ...rootToolRules,
        ...localRootToolRules,
        ...rootMirrorDeletionRules,
        ...extraFixedToolRules,
        ...nestedToolRules,
        ...nonRootToolRules,
      ];
    } catch (error) {
      this.logger.error(`Failed to load tool files for ${this.toolTarget}: ${formatError(error)}`);
      return [];
    }
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({ global = false }: { global?: boolean } = {}): ToolTarget[] {
    if (global) {
      return rulesProcessorToolTargetsGlobal;
    }
    return rulesProcessorToolTargets;
  }

  /**
   * Get the factory for a specific tool target.
   * This is a static version of the internal getFactory for external use.
   * @param target - The tool target. Must be a valid RulesProcessorToolTarget.
   * @returns The factory for the target, or undefined if not found.
   */
  static getFactory(target: ToolTarget): ToolRuleFactory | undefined {
    // Validate that target is supported
    const result = RulesProcessorToolTargetSchema.safeParse(target);
    if (!result.success) {
      return undefined;
    }
    return toolRuleFactories.get(result.data);
  }

  private generateToonReferencesSection(toolRules: ToolRule[]): string {
    const toolRulesWithoutRoot = toolRules.filter(
      (rule) => !rule.isRoot() && !rule.isExcludedFromRootReferences(),
    );

    if (toolRulesWithoutRoot.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push(
      "Please also reference the following rules as needed. The list below is provided in TOON format, and `@` stands for the project root directory.",
    );
    lines.push("");

    const rules = toolRulesWithoutRoot.map((toolRule) => {
      const rulesyncRule = toolRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      const rule: {
        path: string;
        description?: string;
        applyTo?: string[];
      } = {
        path: `@${toolRule.getRelativePathFromCwd()}`,
      };

      if (frontmatter.description) {
        rule.description = frontmatter.description;
      }

      if (frontmatter.globs && frontmatter.globs.length > 0) {
        rule.applyTo = frontmatter.globs;
      }

      return rule;
    });

    const toonContent = encode({
      rules,
    });
    lines.push(toonContent);

    return lines.join("\n") + "\n\n";
  }

  private generateReferencesSection(toolRules: ToolRule[]): string {
    const toolRulesWithoutRoot = toolRules.filter(
      (rule) => !rule.isRoot() && !rule.isExcludedFromRootReferences(),
    );

    if (toolRulesWithoutRoot.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push("Please also reference the following rules as needed:");
    lines.push("");

    for (const toolRule of toolRulesWithoutRoot) {
      // Escape double quotes in description
      const escapedDescription = toolRule.getDescription()?.replace(/"/g, '\\"');
      const globsText = toolRule.getGlobs()?.join(",");

      lines.push(
        `@${toolRule.getRelativePathFromCwd()} description: "${escapedDescription}" applyTo: "${globsText}"`,
      );
    }

    return lines.join("\n") + "\n\n";
  }
}
