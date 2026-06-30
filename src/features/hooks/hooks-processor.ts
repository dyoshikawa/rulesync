import { z } from "zod/mini";

import { RULESYNC_HOOKS_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import {
  ANTIGRAVITY_HOOK_EVENTS,
  AUGMENTCODE_HOOK_EVENTS,
  CLAUDE_HOOK_EVENTS,
  CODEXCLI_HOOK_EVENTS,
  COPILOT_HOOK_EVENTS,
  COPILOTCLI_HOOK_EVENTS,
  CURSOR_HOOK_EVENTS,
  DEEPAGENTS_HOOK_EVENTS,
  DEVIN_HOOK_EVENTS,
  FACTORYDROID_HOOK_EVENTS,
  GOOSE_HOOK_EVENTS,
  JUNIE_HOOK_EVENTS,
  KILO_HOOK_EVENTS,
  KIRO_HOOK_EVENTS,
  KIRO_IDE_HOOK_EVENTS,
  OPENCODE_HOOK_EVENTS,
  QWENCODE_HOOK_EVENTS,
  VIBE_HOOK_EVENTS,
  type HookEvent,
  type HookType,
} from "../../types/hooks.js";
import type { RulesyncFile } from "../../types/rulesync-file.js";
import type { ToolFile } from "../../types/tool-file.js";
import { hooksProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import type { Logger } from "../../utils/logger.js";
import { AntigravityCliHooks, AntigravityIdeHooks } from "./antigravity-hooks.js";
import { AugmentcodeHooks } from "./augmentcode-hooks.js";
import { ClaudecodeHooks } from "./claudecode-hooks.js";
import { CodexcliHooks } from "./codexcli-hooks.js";
import { CopilotHooks } from "./copilot-hooks.js";
import { CopilotcliHooks } from "./copilotcli-hooks.js";
import { CursorHooks } from "./cursor-hooks.js";
import { DeepagentsHooks } from "./deepagents-hooks.js";
import { DevinHooks } from "./devin-hooks.js";
import { FactorydroidHooks } from "./factorydroid-hooks.js";
import { GooseHooks } from "./goose-hooks.js";
import { HermesagentHooks } from "./hermesagent-hooks.js";
import { JunieHooks } from "./junie-hooks.js";
import { KiloHooks } from "./kilo-hooks.js";
import { KiroCliHooks } from "./kiro-cli-hooks.js";
import { KiroHooks } from "./kiro-hooks.js";
import { KiroIdeHooks } from "./kiro-ide-hooks.js";
import { OpencodeHooks } from "./opencode-hooks.js";
import { QwencodeHooks } from "./qwencode-hooks.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import type {
  ToolHooksForDeletionParams,
  ToolHooksFromFileParams,
  ToolHooksFromRulesyncHooksParams,
} from "./tool-hooks.js";
import { ToolHooks } from "./tool-hooks.js";
import { VibeHooks } from "./vibe-hooks.js";

export type HooksProcessorToolTarget = (typeof hooksProcessorToolTargetTuple)[number];

export const HooksProcessorToolTargetSchema = z.enum(hooksProcessorToolTargetTuple);

type ToolHooksFactory = {
  class: {
    fromRulesyncHooks(
      params: ToolHooksFromRulesyncHooksParams & { global?: boolean },
    ): ToolHooks | Promise<ToolHooks>;
    fromFile(params: ToolHooksFromFileParams): Promise<ToolHooks>;
    forDeletion(params: ToolHooksForDeletionParams): ToolHooks;
    getSettablePaths(options?: { global?: boolean }): {
      relativeDirPath: string;
      relativeFilePath: string;
    };
    isDeletable?: (instance: ToolHooks) => boolean;
    getAuxiliaryFiles?: (params: {
      outputRoot?: string;
      global?: boolean;
    }) => ToolFile[] | Promise<ToolFile[]>;
  };
  meta: {
    supportsProject: boolean;
    supportsGlobal: boolean;
    supportsImport: boolean;
  };
  supportedEvents: readonly HookEvent[];
  supportedHookTypes: readonly HookType[];
  supportsMatcher: boolean;
  /**
   * When true, keys in the tool-specific override block (`config[target].hooks`)
   * are passed through verbatim by the adapter even if they are not in
   * `supportedEvents` (e.g. Kiro IDE's `PostFileSave`/`PreTaskExec` triggers),
   * so they must not be reported as skipped/unsupported.
   */
  passthroughOverrideEvents?: boolean;
};

/**
 * Event names present in the config that the target's adapter cannot emit.
 *
 * When the factory passes override-block keys through verbatim
 * (`passthroughOverrideEvents`), those keys are excluded from the check so
 * documented passthrough triggers aren't falsely reported as skipped.
 */
function unsupportedEventNames(params: {
  factory: ToolHooksFactory;
  sharedHooks: Record<string, unknown>;
  effectiveHooks: Record<string, unknown>;
}): string[] {
  const { factory, sharedHooks, effectiveHooks } = params;
  const supportedEvents: Set<string> = new Set(factory.supportedEvents);
  const eventNames = factory.passthroughOverrideEvents
    ? Object.keys(sharedHooks)
    : Object.keys(effectiveHooks);
  return [...new Set(eventNames)].filter((e) => !supportedEvents.has(e));
}

export const toolHooksFactories = new Map<HooksProcessorToolTarget, ToolHooksFactory>([
  [
    "antigravity-cli",
    {
      class: AntigravityCliHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: ANTIGRAVITY_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],
  [
    "antigravity-ide",
    {
      class: AntigravityIdeHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: ANTIGRAVITY_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],
  [
    "cursor",
    {
      class: CursorHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: CURSOR_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt"],
      supportsMatcher: true,
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: CLAUDE_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt"],
      supportsMatcher: true,
    },
  ],
  [
    "codexcli",
    {
      class: CodexcliHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: CODEXCLI_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],
  [
    "copilot",
    {
      class: CopilotHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
      supportedEvents: COPILOT_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: false,
    },
  ],
  [
    "copilotcli",
    {
      class: CopilotcliHooks,
      meta: {
        // Copilot CLI hooks support both project and global scope.
        // Project: <project>/.github/hooks/copilotcli-hooks.json
        // Global:  ~/.copilot/hooks/copilot-hooks.json
        // Reference: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: COPILOTCLI_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt", "http"],
      supportsMatcher: false,
    },
  ],
  [
    "kilo",
    {
      class: KiloHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: false,
      },
      supportedEvents: KILO_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],
  [
    "opencode",
    {
      class: OpencodeHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: false,
      },
      supportedEvents: OPENCODE_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],
  [
    "factorydroid",
    {
      class: FactorydroidHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: FACTORYDROID_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt"],
      supportsMatcher: true,
    },
  ],
  [
    "goose",
    {
      class: GooseHooks,
      meta: {
        // Goose auto-discovers plugins from both `.agents/plugins/` (project)
        // and `~/.agents/plugins/` (global). rulesync writes
        // `.agents/plugins/rulesync/hooks/hooks.json` in both modes.
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: GOOSE_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],
  [
    "hermesagent",
    {
      class: HermesagentHooks,
      meta: { supportsProject: false, supportsGlobal: true, supportsImport: true },
      supportedEvents: CLAUDE_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt", "http"],
      supportsMatcher: true,
    },
  ],
  [
    "deepagents",
    {
      class: DeepagentsHooks,
      meta: { supportsProject: false, supportsGlobal: true, supportsImport: true },
      supportedEvents: DEEPAGENTS_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: false,
    },
  ],
  [
    "kiro",
    {
      class: KiroHooks,
      meta: {
        // Kiro hooks are project-level only (consistent with existing Kiro features).
        // Hooks are written to .kiro/agents/default.json alongside subagent configs.
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
      supportedEvents: KIRO_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],
  [
    // The Kiro CLI uses the same `.kiro/agents/default.json` agent-hook format
    // as the legacy `kiro` alias. (Kiro IDE hooks use the structured
    // `.kiro/hooks/*.json` v1 format — see the `kiro-ide` entry below.)
    "kiro-cli",
    {
      class: KiroCliHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
      supportedEvents: KIRO_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],
  [
    // Kiro IDE 1.0 reads structured JSON hooks from `.kiro/hooks/` (workspace)
    // and `~/.kiro/hooks/` (user). A single file may declare multiple hooks in
    // its `hooks` array, so rulesync emits all hooks into one `rulesync.json`
    // file ({ "version": "v1", "hooks": [ ... ] }). The IDE supports both
    // `agent` (prompt) and `command` actions.
    // Reference: https://kiro.dev/docs/hooks/
    "kiro-ide",
    {
      class: KiroIdeHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: KIRO_IDE_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt"],
      supportsMatcher: true,
      // IDE-only triggers (PostFileSave, PreTaskExec, …) supplied via the
      // `kiro-ide` override block are emitted verbatim, so don't warn on them.
      passthroughOverrideEvents: true,
    },
  ],
  [
    "devin",
    {
      class: DevinHooks,
      meta: {
        // Devin Local hooks live in the standalone `.devin/hooks.v1.json`
        // (project) and under the `hooks` key of `~/.config/devin/config.json`
        // (global). Each event maps to Claude-style
        // `{ matcher?, hooks: [{ type, command|prompt, timeout? }] }` groups.
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: DEVIN_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt"],
      supportsMatcher: true,
    },
  ],
  [
    "augmentcode",
    {
      class: AugmentcodeHooks,
      meta: {
        // Auggie CLI hooks live under the `hooks` key of the shared settings file
        // `.augment/settings.json` (project) / `~/.augment/settings.json` (global),
        // mirroring Claude Code's per-event matcher arrays.
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: AUGMENTCODE_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],
  [
    "junie",
    {
      class: JunieHooks,
      meta: {
        // Junie CLI only runs user-scope hooks (~/.junie/config.json); project
        // hooks in .junie/config.json are ignored by default for safety, so
        // rulesync treats Junie hooks as global-only.
        supportsProject: false,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: JUNIE_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],
  [
    "vibe",
    {
      class: VibeHooks,
      meta: {
        // Mistral Vibe experimental hooks live in `.vibe/hooks.toml` (project) /
        // `~/.vibe/hooks.toml` (global) and are gated behind
        // `enable_experimental_hooks = true` in `.vibe/config.toml`, which
        // rulesync merges via VibeHooks.getAuxiliaryFiles.
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: VIBE_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      // All three Vibe events (before_tool/after_tool/post_agent_turn) accept a
      // `match` tool-name matcher (fnmatch glob or `re:` regex).
      supportsMatcher: true,
    },
  ],
  [
    "qwencode",
    {
      // Qwen Code hooks live under the `hooks` key of `.qwen/settings.json`
      // (project) / `~/.qwen/settings.json` (global), using Claude-style
      // PascalCase per-matcher arrays. Qwen's event set differs from Gemini CLI.
      class: QwencodeHooks,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
      supportedEvents: QWENCODE_HOOK_EVENTS,
      supportedHookTypes: ["command"],
      supportsMatcher: true,
    },
  ],
]);

// Project-mode generation/import should only expose tools that actually write
// hooks into the workspace. This keeps global-only targets like deepagents out
// of project target lists while still allowing them in global mode.
const hooksProcessorToolTargets: ToolTarget[] = [...toolHooksFactories.entries()]
  .filter(([, f]) => f.meta.supportsProject)
  .map(([t]) => t);
const hooksProcessorToolTargetsGlobal: ToolTarget[] = [...toolHooksFactories.entries()]
  .filter(([, f]) => f.meta.supportsGlobal)
  .map(([t]) => t);
const hooksProcessorToolTargetsImportable: ToolTarget[] = [...toolHooksFactories.entries()]
  .filter(([, f]) => f.meta.supportsProject && f.meta.supportsImport)
  .map(([t]) => t);
const hooksProcessorToolTargetsGlobalImportable: ToolTarget[] = [...toolHooksFactories.entries()]
  .filter(([, f]) => f.meta.supportsGlobal && f.meta.supportsImport)
  .map(([t]) => t);

export class HooksProcessor extends FeatureProcessor {
  private readonly toolTarget: HooksProcessorToolTarget;
  private readonly global: boolean;

  constructor({
    outputRoot = process.cwd(),
    inputRoot = process.cwd(),
    toolTarget,
    global = false,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoot?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({ outputRoot, inputRoot, dryRun, logger });
    const result = HooksProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for HooksProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
  }

  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    try {
      return [
        await RulesyncHooks.fromFile({
          outputRoot: this.inputRoot,
          validate: true,
        }),
      ];
    } catch (error) {
      this.logger.error(
        `Failed to load Rulesync hooks file (${RULESYNC_HOOKS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      );
      return [];
    }
  }

  async loadToolFiles({
    forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    try {
      const factory = toolHooksFactories.get(this.toolTarget);
      if (!factory) throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      const paths = factory.class.getSettablePaths({ global: this.global });

      if (forDeletion) {
        const toolHooks = factory.class.forDeletion({
          outputRoot: this.outputRoot,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath,
          global: this.global,
        });
        const list = toolHooks.isDeletable?.() !== false ? [toolHooks] : [];
        this.logger.debug(
          `Successfully loaded ${list.length} ${this.toolTarget} hooks files for deletion`,
        );
        return list;
      }

      const toolHooks = await factory.class.fromFile({
        outputRoot: this.outputRoot,
        validate: true,
        global: this.global,
      });
      this.logger.debug(`Successfully loaded 1 ${this.toolTarget} hooks file`);
      return [toolHooks];
    } catch (error) {
      const msg = `Failed to load hooks files for tool target: ${this.toolTarget}: ${formatError(error)}`;
      if (error instanceof Error && error.message.includes("no such file or directory")) {
        this.logger.debug(msg);
      } else {
        this.logger.error(msg);
      }
      return [];
    }
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncHooks = rulesyncFiles.find((f): f is RulesyncHooks => f instanceof RulesyncHooks);
    if (!rulesyncHooks) {
      throw new Error(`No ${RULESYNC_HOOKS_RELATIVE_FILE_PATH} found.`);
    }

    const factory = toolHooksFactories.get(this.toolTarget);
    if (!factory) throw new Error(`Unsupported tool target: ${this.toolTarget}`);

    const config = rulesyncHooks.getJson();
    const sharedHooks = config.hooks;
    const overrideHooks = (config[this.toolTarget] as { hooks?: unknown } | undefined)?.hooks ?? {};
    const effectiveHooks = { ...sharedHooks, ...overrideHooks };

    // Warn about unsupported events
    {
      const skipped = unsupportedEventNames({ factory, sharedHooks, effectiveHooks });
      if (skipped.length > 0) {
        this.logger.warn(
          `Skipped hook event(s) for ${this.toolTarget} (not supported): ${skipped.join(", ")}`,
        );
      }
    }

    // Warn about unsupported hook types
    {
      const supportedHookTypes: Set<string> = new Set(factory.supportedHookTypes);
      const unsupportedTypeToEvents = new Map<string, Set<string>>();
      for (const [event, defs] of Object.entries(effectiveHooks)) {
        for (const def of defs as unknown[]) {
          const hookDef = def as { type?: string };
          const hookType = hookDef.type ?? "command";
          if (!supportedHookTypes.has(hookType)) {
            const events = unsupportedTypeToEvents.get(hookType) ?? new Set<string>();
            events.add(event);
            unsupportedTypeToEvents.set(hookType, events);
          }
        }
      }

      for (const [hookType, events] of unsupportedTypeToEvents) {
        this.logger.warn(
          `Skipped ${hookType}-type hook(s) for ${this.toolTarget} (not supported): ${Array.from(events).join(", ")}`,
        );
      }
    }

    // Warn about unsupported matcher
    if (!factory.supportsMatcher) {
      const eventsWithMatcher = new Set<string>();
      for (const [event, defs] of Object.entries(effectiveHooks)) {
        for (const def of defs as unknown[]) {
          const hookDef = def as { matcher?: unknown };
          if (hookDef.matcher) {
            eventsWithMatcher.add(event);
          }
        }
      }

      if (eventsWithMatcher.size > 0) {
        this.logger.warn(
          `Skipped matcher hook(s) for ${this.toolTarget} (not supported): ${Array.from(eventsWithMatcher).join(", ")}`,
        );
      }
    }

    const toolHooks = await factory.class.fromRulesyncHooks({
      outputRoot: this.outputRoot,
      rulesyncHooks,
      validate: true,
      global: this.global,
    });

    const result: ToolFile[] = [toolHooks];
    const auxiliaryFiles = await factory.class.getAuxiliaryFiles?.({
      outputRoot: this.outputRoot,
      global: this.global,
    });
    if (auxiliaryFiles && auxiliaryFiles.length > 0) {
      result.push(...auxiliaryFiles);
    }

    return result;
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const hooks = toolFiles.filter((f): f is ToolHooks => f instanceof ToolHooks);
    return hooks.map((h) => h.toRulesyncHooks());
  }

  static getToolTargets({
    global = false,
    importOnly = false,
  }: { global?: boolean; importOnly?: boolean } = {}): ToolTarget[] {
    if (global) {
      return importOnly
        ? hooksProcessorToolTargetsGlobalImportable
        : hooksProcessorToolTargetsGlobal;
    }
    return importOnly ? hooksProcessorToolTargetsImportable : hooksProcessorToolTargets;
  }
}
