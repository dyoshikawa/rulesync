import { z } from "zod/mini";
import { RULESYNC_MCP_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { logger } from "../../utils/logger.js";
import { ClaudecodeMcp } from "./claudecode-mcp.js";
import { ClineMcp } from "./cline-mcp.js";
import { CodexcliMcp } from "./codexcli-mcp.js";
import { CopilotMcp } from "./copilot-mcp.js";
import { CursorMcp } from "./cursor-mcp.js";
import { GeminiCliMcp } from "./geminicli-mcp.js";
import { JunieMcp } from "./junie-mcp.js";
import { KiloMcp } from "./kilo-mcp.js";
import { ModularMcp } from "./modular-mcp.js";
import { OpencodeMcp } from "./opencode-mcp.js";
import { RooMcp } from "./roo-mcp.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

/**
 * Supported tool targets for McpProcessor.
 * Using a tuple to preserve order for consistent iteration.
 */
const mcpProcessorToolTargetTuple = [
  "claudecode",
  "claudecode-legacy",
  "cline",
  "codexcli",
  "copilot",
  "cursor",
  "geminicli",
  "kilo",
  "junie",
  "opencode",
  "roo",
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
      params: ToolMcpFromRulesyncMcpParams & { global?: boolean; modularMcp?: boolean },
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
    /** Whether the tool supports modular-mcp for context compression */
    supportsModular: boolean;
  };
};

/**
 * Factory Map mapping tool targets to their MCP factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
const toolMcpFactories = new Map<McpProcessorToolTarget, ToolMcpFactory>([
  [
    "claudecode",
    {
      class: ClaudecodeMcp,
      meta: { supportsProject: true, supportsGlobal: true, supportsModular: true },
    },
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeMcp,
      meta: { supportsProject: true, supportsGlobal: true, supportsModular: true },
    },
  ],
  [
    "cline",
    {
      class: ClineMcp,
      meta: { supportsProject: true, supportsGlobal: false, supportsModular: false },
    },
  ],
  [
    "codexcli",
    {
      class: CodexcliMcp,
      meta: { supportsProject: false, supportsGlobal: true, supportsModular: false },
    },
  ],
  [
    "copilot",
    {
      class: CopilotMcp,
      meta: { supportsProject: true, supportsGlobal: false, supportsModular: false },
    },
  ],
  [
    "cursor",
    {
      class: CursorMcp,
      meta: { supportsProject: true, supportsGlobal: false, supportsModular: false },
    },
  ],
  [
    "geminicli",
    {
      class: GeminiCliMcp,
      meta: { supportsProject: true, supportsGlobal: true, supportsModular: false },
    },
  ],
  [
    "kilo",
    {
      class: KiloMcp,
      meta: { supportsProject: true, supportsGlobal: false, supportsModular: false },
    },
  ],
  [
    "junie",
    {
      class: JunieMcp,
      meta: { supportsProject: true, supportsGlobal: false, supportsModular: false },
    },
  ],
  [
    "opencode",
    {
      class: OpencodeMcp,
      meta: { supportsProject: true, supportsGlobal: true, supportsModular: false },
    },
  ],
  [
    "roo",
    {
      class: RooMcp,
      meta: { supportsProject: true, supportsGlobal: false, supportsModular: false },
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

export const mcpProcessorToolTargetsModular: ToolTarget[] = allToolTargetKeys.filter((target) => {
  const factory = toolMcpFactories.get(target);
  return factory?.meta.supportsModular ?? false;
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
  private readonly modularMcp: boolean;
  private readonly getFactory: GetFactory;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
    modularMcp = false,
    getFactory = defaultGetFactory,
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    modularMcp?: boolean;
    getFactory?: GetFactory;
  }) {
    super({ baseDir });
    const result = McpProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for McpProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.modularMcp = modularMcp;
    this.getFactory = getFactory;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync MCP files from .rulesync/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    try {
      return [await RulesyncMcp.fromFile({ modularMcp: this.modularMcp })];
    } catch (error) {
      logger.error(`Failed to load a Rulesync MCP file: ${formatError(error)}`);
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
          baseDir: this.baseDir,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath,
          global: this.global,
        });

        const toolMcps = toolMcp.isDeletable() ? [toolMcp] : [];
        logger.info(`Successfully loaded ${toolMcps.length} ${this.toolTarget} MCP files`);
        return toolMcps;
      }

      const toolMcps = [
        await factory.class.fromFile({
          baseDir: this.baseDir,
          validate: true,
          global: this.global,
        }),
      ];
      logger.info(`Successfully loaded ${toolMcps.length} ${this.toolTarget} MCP files`);
      return toolMcps;
    } catch (error) {
      const errorMessage = `Failed to load MCP files for tool target: ${this.toolTarget}: ${formatError(error)}`;
      if (error instanceof Error && error.message.includes("no such file or directory")) {
        logger.debug(errorMessage);
      } else {
        logger.error(errorMessage);
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
      [rulesyncMcp].map(async (rulesyncMcp) => {
        return await factory.class.fromRulesyncMcp({
          baseDir: this.baseDir,
          rulesyncMcp,
          global: this.global,
          modularMcp: this.modularMcp,
        });
      }),
    );

    const toolFiles: ToolFile[] = toolMcps;

    // Add modular-mcp.json if modularMcp is enabled and target supports modular-mcp
    if (this.modularMcp && mcpProcessorToolTargetsModular.includes(this.toolTarget)) {
      // Map tool target to relative directory path
      const relativeDirPath = factory.class.getSettablePaths({
        global: this.global,
      }).relativeDirPath;

      toolFiles.push(
        ModularMcp.fromRulesyncMcp({
          baseDir: this.baseDir,
          rulesyncMcp,
          ...(this.global && relativeDirPath
            ? { global: true, relativeDirPath }
            : { global: false }),
        }),
      );
    }

    return toolFiles;
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
