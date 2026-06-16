import { z } from "zod/mini";

import { RULESYNC_MCP_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import type { Logger } from "../../utils/logger.js";
import { AmpMcp } from "./amp-mcp.js";
import { AntigravityCliMcp } from "./antigravity-cli-mcp.js";
import { AntigravityIdeMcp } from "./antigravity-ide-mcp.js";
import { AugmentcodeMcp } from "./augmentcode-mcp.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { ClineMcp } from "./cline-mcp.js";
import { CodexcliMcp } from "./codexcli-mcp.js";
import { CopilotMcp } from "./copilot-mcp.js";
import { CopilotcliMcp } from "./copilotcli-mcp.js";
import { CursorMcp } from "./cursor-mcp.js";
import { DeepagentsMcp } from "./deepagents-mcp.js";
import { DevinMcp } from "./devin-mcp.js";
import { FactorydroidMcp } from "./factorydroid-mcp.js";
import { GeminiCliMcp } from "./geminicli-mcp.js";
import { GooseMcp } from "./goose-mcp.js";
import { JunieMcp } from "./junie-mcp.js";
import { KiloMcp } from "./kilo-mcp.js";
import { KiroMcp } from "./kiro-mcp.js";
import { OpencodeMcp } from "./opencode-mcp.js";
import { RooMcp } from "./roo-mcp.js";
import { RovodevMcp } from "./rovodev-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";
import { VibeMcp } from "./vibe-mcp.js";
import { WarpMcp } from "./warp-mcp.js";
import { ZedMcp } from "./zed-mcp.js";

/**
 * Supported tool targets for McpProcessor.
 * Using a tuple to preserve order for consistent iteration.
 */
const mcpProcessorToolTargetTuple = [
  "amp",
  "antigravity-cli",
  "antigravity-ide",
  "augmentcode",
  "claudecode",
  "claudecode-legacy",
  "cline",
  "codexcli",
  "copilot",
  "copilotcli",
  "cursor",
  "deepagents",
  "factorydroid",
  "geminicli",
  "goose",
  "kilo",
  "kiro",
  "kiro-cli",
  "kiro-ide",
  "junie",
  "opencode",
  "roo",
  "rovodev",
  "vibe",
  "warp",
  "devin",
  "zed",
] as const;

export type McpProcessorToolTarget = (typeof mcpProcessorToolTargetTuple)[number];

// Schema for runtime validation
export const McpProcessorToolTargetSchema = z.enum(mcpProcessorToolTargetTuple);

/**
 * Factory entry for each tool MCP class.
 * Stores the class reference and metadata for a tool.
 */
type ToolMcpFactory = {
  class: {
    fromRulesyncMcp(
      params: ToolMcpFromRulesyncMcpParams & { global?: boolean },
    ): ToolMcp | Promise<ToolMcp>;
    fromFile(params: ToolMcpFromFileParams): Promise<ToolMcp>;
    forDeletion(params: ToolMcpForDeletionParams): ToolMcp;
    getSettablePaths(options?: { global?: boolean }): ToolMcpSettablePaths;
  };
  meta: {
    /** Whether the tool supports project-level MCP configuration */
    supportsProject: boolean;
    /** Whether the tool supports global (user-level) MCP configuration */
    supportsGlobal: boolean;
    /** Whether the tool supports enabledTools per MCP server */
    supportsEnabledTools: boolean;
    /** Whether the tool supports disabledTools per MCP server */
    supportsDisabledTools: boolean;
  };
};

/**
 * Factory Map mapping tool targets to their MCP factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
export const toolMcpFactories = new Map<McpProcessorToolTarget, ToolMcpFactory>([
  [
    "amp",
    {
      class: AmpMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "antigravity-cli",
    {
      class: AntigravityCliMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: true,
      },
    },
  ],
  [
    "antigravity-ide",
    {
      class: AntigravityIdeMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: true,
      },
    },
  ],
  [
    "augmentcode",
    {
      // AugmentCode (Auggie CLI) persists MCP servers in the shared user
      // settings file `~/.augment/settings.json`. The docs only document a
      // global location, so MCP is global-only here.
      // https://docs.augmentcode.com/cli/integrations
      class: AugmentcodeMcp,
      meta: {
        supportsProject: false,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "cline",
    {
      // Cline reads MCP servers only from a single GLOBAL settings file
      // (`~/.cline/data/settings/cline_mcp_settings.json` via
      // `resolveMcpSettingsPath()`); it has no project-scoped MCP location.
      // https://github.com/cline/cline/blob/main/sdk/packages/shared/src/storage/paths.ts
      class: ClineMcp,
      meta: {
        supportsProject: false,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "codexcli",
    {
      class: CodexcliMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: true,
        supportsDisabledTools: true,
      },
    },
  ],
  [
    "copilot",
    {
      class: CopilotMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "copilotcli",
    {
      class: CopilotcliMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "cursor",
    {
      class: CursorMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "deepagents",
    {
      class: DeepagentsMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "factorydroid",
    {
      class: FactorydroidMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "geminicli",
    {
      class: GeminiCliMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "goose",
    {
      // Goose reads MCP servers as "extensions" only from the global user config
      // `~/.config/goose/config.yaml`; it has no project-scoped MCP location.
      // https://block.github.io/goose/docs/getting-started/using-extensions/
      class: GooseMcp,
      meta: {
        supportsProject: false,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "kilo",
    {
      class: KiloMcp,
      meta: {
        supportsProject: true,
        // Kilo CLI reads global MCP from `~/.config/kilo/kilo.json` (or
        // `kilo.jsonc`). The path machinery in `KiloMcp.getSettablePaths`
        // already routes global mode to that location; only this flag
        // was gating it off. Kilo is an OpenCode fork and uses an
        // identical native MCP schema, so global parity with opencode
        // is the natural state.
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "kiro",
    {
      class: KiroMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    // Kiro IDE and CLI share the same `.kiro/settings/mcp.json` MCP config.
    "kiro-cli",
    {
      class: KiroMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "kiro-ide",
    {
      class: KiroMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "junie",
    {
      class: JunieMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "opencode",
    {
      class: OpencodeMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: true,
        supportsDisabledTools: true,
      },
    },
  ],
  [
    "roo",
    {
      class: RooMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "rovodev",
    {
      class: RovodevMcp,
      meta: {
        supportsProject: false,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "vibe",
    {
      class: VibeMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "warp",
    {
      class: WarpMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
  [
    "devin",
    {
      class: DevinMcp,
      meta: {
        // Devin reads `mcp_config.json` from `.devin/` (project) and
        // `~/.codeium/windsurf/` (global). Each server may carry a
        // `disabledTools` array, but Devin has no `enabledTools` concept.
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: true,
      },
    },
  ],
  [
    "zed",
    {
      class: ZedMcp,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsEnabledTools: false,
        supportsDisabledTools: false,
      },
    },
  ],
]);

// Derive tool target arrays from factory metadata
const allToolTargetKeys = [...toolMcpFactories.keys()];

export const mcpProcessorToolTargets: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolMcpFactories.get(target);
  return factory?.meta.supportsProject ?? false;
});

export const mcpProcessorToolTargetsGlobal: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolMcpFactories.get(target);
  return factory?.meta.supportsGlobal ?? false;
});

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: McpProcessorToolTarget) => ToolMcpFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolMcpFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

export class McpProcessor extends FeatureProcessor {
  private readonly toolTarget: McpProcessorToolTarget;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;

  constructor({
    outputRoot = process.cwd(),
    inputRoot = process.cwd(),
    toolTarget,
    global = false,
    getFactory = defaultGetFactory,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoot?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({ outputRoot, inputRoot, dryRun, logger });
    const result = McpProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for McpProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.getFactory = getFactory;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync MCP files from .rulesync/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    try {
      return [await RulesyncMcp.fromFile({ outputRoot: this.inputRoot })];
    } catch (error) {
      this.logger.error(
        `Failed to load a Rulesync MCP file (${RULESYNC_MCP_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      );
      return [];
    }
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific MCP configurations and parse them into ToolMcp instances
   */
  async loadToolFiles({
    forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    try {
      const factory = this.getFactory(this.toolTarget);
      const paths = factory.class.getSettablePaths({ global: this.global });

      if (forDeletion) {
        const toolMcp = factory.class.forDeletion({
          outputRoot: this.outputRoot,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath,
          global: this.global,
        });

        const toolMcps = toolMcp.isDeletable() ? [toolMcp] : [];
        this.logger.debug(`Successfully loaded ${toolMcps.length} ${this.toolTarget} MCP files`);
        return toolMcps;
      }

      const toolMcps = [
        await factory.class.fromFile({
          outputRoot: this.outputRoot,
          validate: true,
          global: this.global,
          logger: this.logger,
        }),
      ];
      this.logger.debug(`Successfully loaded ${toolMcps.length} ${this.toolTarget} MCP files`);
      return toolMcps;
    } catch (error) {
      const errorMessage = `Failed to load MCP files for tool target: ${this.toolTarget}: ${formatError(error)}`;
      if (error instanceof Error && error.message.includes("no such file or directory")) {
        this.logger.debug(errorMessage);
      } else {
        this.logger.error(errorMessage);
      }
      return [];
    }
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert RulesyncFile[] to ToolFile[]
   */
  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncMcp = rulesyncFiles.find(
      (file): file is RulesyncMcp => file instanceof RulesyncMcp,
    );

    if (!rulesyncMcp) {
      throw new Error(`No ${RULESYNC_MCP_RELATIVE_FILE_PATH} found.`);
    }

    const factory = this.getFactory(this.toolTarget);
    const toolMcps = await Promise.all(
      [rulesyncMcp].map(async (mcp) => {
        // Strip MCP server fields unsupported by the target tool
        const fieldsToStrip: string[] = [];
        if (!factory.meta.supportsEnabledTools) fieldsToStrip.push("enabledTools");
        if (!factory.meta.supportsDisabledTools) fieldsToStrip.push("disabledTools");
        const filteredRulesyncMcp = mcp.stripMcpServerFields(fieldsToStrip);

        return await factory.class.fromRulesyncMcp({
          outputRoot: this.outputRoot,
          rulesyncMcp: filteredRulesyncMcp,
          global: this.global,
        });
      }),
    );

    return toolMcps;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert ToolFile[] to RulesyncFile[]
   */
  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolMcps = toolFiles.filter((file): file is ToolMcp => file instanceof ToolMcp);

    const rulesyncMcps = toolMcps.map((toolMcp) => {
      return toolMcp.toRulesyncMcp();
    });

    return rulesyncMcps;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({ global = false }: { global?: boolean } = {}): ToolTarget[] {
    if (global) {
      return mcpProcessorToolTargetsGlobal;
    }
    return mcpProcessorToolTargets;
  }
}
