import { z } from "zod/mini";

import { RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import type { RulesyncFile } from "../../types/rulesync-file.js";
import type { ToolFile } from "../../types/tool-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import type { Logger } from "../../utils/logger.js";
import { ClaudecodePermissions } from "./claudecode-permissions.js";
import { CodexcliPermissions, createCodexcliBashRulesFile } from "./codexcli-permissions.js";
import { CursorPermissions } from "./cursor-permissions.js";
import { GeminicliPermissions } from "./geminicli-permissions.js";
import { KiroPermissions } from "./kiro-permissions.js";
import { OpencodePermissions } from "./opencode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import type {
  ToolPermissionsForDeletionParams,
  ToolPermissionsFromFileParams,
  ToolPermissionsFromRulesyncPermissionsParams,
  ToolPermissionsSettablePaths,
} from "./tool-permissions.js";
import { ToolPermissions } from "./tool-permissions.js";

const permissionsProcessorToolTargetTuple = [
  "claudecode",
  "codexcli",
  "cursor",
  "geminicli",
  "kiro",
  "opencode",
] as const;

export type PermissionsProcessorToolTarget = (typeof permissionsProcessorToolTargetTuple)[number];

export const PermissionsProcessorToolTargetSchema = z.enum(permissionsProcessorToolTargetTuple);

type ToolPermissionsFactory = {
  class: {
    fromRulesyncPermissions(
      params: ToolPermissionsFromRulesyncPermissionsParams,
    ): ToolPermissions | Promise<ToolPermissions>;
    fromFile(params: ToolPermissionsFromFileParams): Promise<ToolPermissions>;
    forDeletion(params: ToolPermissionsForDeletionParams): ToolPermissions;
    getSettablePaths(options?: { global?: boolean }): ToolPermissionsSettablePaths;
  };
  meta: {
    supportsProject: boolean;
    supportsGlobal: boolean;
    supportsImport: boolean;
  };
};

const toolPermissionsFactories = new Map<PermissionsProcessorToolTarget, ToolPermissionsFactory>([
  [
    "claudecode",
    {
      class: ClaudecodePermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "codexcli",
    {
      class: CodexcliPermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "cursor",
    {
      class: CursorPermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "geminicli",
    {
      class: GeminicliPermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "kiro",
    {
      class: KiroPermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
    },
  ],
  [
    "opencode",
    {
      class: OpencodePermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
]);

export class PermissionsProcessor extends FeatureProcessor {
  private readonly toolTarget: PermissionsProcessorToolTarget;
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
    const result = PermissionsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for PermissionsProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
  }

  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    try {
      return [
        await RulesyncPermissions.fromFile({
          outputRoot: this.inputRoot,
          validate: true,
        }),
      ];
    } catch (error) {
      this.logger.error(
        `Failed to load Rulesync permissions file (${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
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
      const factory = toolPermissionsFactories.get(this.toolTarget);
      if (!factory) throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      const paths = factory.class.getSettablePaths({ global: this.global });

      if (forDeletion) {
        const toolPermissions = factory.class.forDeletion({
          outputRoot: this.outputRoot,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath,
          global: this.global,
        });
        const list = toolPermissions.isDeletable?.() !== false ? [toolPermissions] : [];
        return list;
      }

      const toolPermissions = await factory.class.fromFile({
        outputRoot: this.outputRoot,
        validate: true,
        global: this.global,
      });
      return [toolPermissions];
    } catch (error) {
      const msg = `Failed to load permissions files for tool target: ${this.toolTarget}: ${formatError(error)}`;
      if (error instanceof Error && error.message.includes("no such file or directory")) {
        this.logger.debug(msg);
      } else {
        this.logger.error(msg);
      }
      return [];
    }
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncPermissions = rulesyncFiles.find(
      (f): f is RulesyncPermissions => f instanceof RulesyncPermissions,
    );
    if (!rulesyncPermissions) {
      throw new Error(`No ${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH} found.`);
    }

    const factory = toolPermissionsFactories.get(this.toolTarget);
    if (!factory) throw new Error(`Unsupported tool target: ${this.toolTarget}`);

    const toolPermissions = await factory.class.fromRulesyncPermissions({
      outputRoot: this.outputRoot,
      rulesyncPermissions,
      logger: this.logger,
      global: this.global,
    });
    if (this.toolTarget !== "codexcli") {
      return [toolPermissions];
    }

    const bashRulesFile = createCodexcliBashRulesFile({
      outputRoot: this.outputRoot,
      config: rulesyncPermissions.getJson(),
    });
    return [toolPermissions, bashRulesFile];
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const permissions = toolFiles.filter((f): f is ToolPermissions => f instanceof ToolPermissions);
    return permissions.map((p) => p.toRulesyncPermissions());
  }

  static getToolTargets({
    global = false,
    importOnly = false,
  }: { global?: boolean; importOnly?: boolean } = {}): ToolTarget[] {
    return [...toolPermissionsFactories.entries()]
      .filter(([, f]) => (global ? f.meta.supportsGlobal : f.meta.supportsProject))
      .filter(([, f]) => (importOnly ? f.meta.supportsImport : true))
      .map(([target]) => target);
  }
}
