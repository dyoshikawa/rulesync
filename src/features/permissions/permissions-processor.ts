import { z } from "zod/mini";

import { RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import type { RulesyncFile } from "../../types/rulesync-file.js";
import type { ToolFile } from "../../types/tool-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import type { Logger } from "../../utils/logger.js";
import { ClaudecodePermissions } from "./claudecode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import type {
  ToolPermissionsForDeletionParams,
  ToolPermissionsFromFileParams,
  ToolPermissionsFromRulesyncPermissionsParams,
  ToolPermissionsSettablePaths,
} from "./tool-permissions.js";
import { ToolPermissions } from "./tool-permissions.js";

const permissionsProcessorToolTargetTuple = ["claudecode"] as const;

export type PermissionsProcessorToolTarget = (typeof permissionsProcessorToolTargetTuple)[number];

export const PermissionsProcessorToolTargetSchema = z.enum(permissionsProcessorToolTargetTuple);

type ToolPermissionsFactory = {
  class: {
    fromRulesyncPermissions(
      params: ToolPermissionsFromRulesyncPermissionsParams,
    ): ToolPermissions | Promise<ToolPermissions>;
    fromFile(params: ToolPermissionsFromFileParams): Promise<ToolPermissions>;
    forDeletion(params: ToolPermissionsForDeletionParams): ToolPermissions;
    getSettablePaths(): ToolPermissionsSettablePaths;
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
        supportsGlobal: false,
        supportsImport: true,
      },
    },
  ],
]);

const permissionsProcessorToolTargets: ToolTarget[] = [...toolPermissionsFactories.entries()]
  .filter(([, f]) => f.meta.supportsProject)
  .map(([t]) => t);

const permissionsProcessorToolTargetsImportable: ToolTarget[] = [
  ...toolPermissionsFactories.entries(),
]
  .filter(([, f]) => f.meta.supportsProject && f.meta.supportsImport)
  .map(([t]) => t);

export class PermissionsProcessor extends FeatureProcessor {
  private readonly toolTarget: PermissionsProcessorToolTarget;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
    dryRun = false,
    logger,
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({ baseDir, dryRun, logger });
    const result = PermissionsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for PermissionsProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
  }

  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    try {
      return [
        await RulesyncPermissions.fromFile({
          baseDir: process.cwd(),
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
      const paths = factory.class.getSettablePaths();

      if (forDeletion) {
        const toolPermissions = factory.class.forDeletion({
          baseDir: this.baseDir,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath,
        });
        const list = toolPermissions.isDeletable?.() !== false ? [toolPermissions] : [];
        return list;
      }

      const toolPermissions = await factory.class.fromFile({
        baseDir: this.baseDir,
        validate: true,
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
      baseDir: this.baseDir,
      rulesyncPermissions,
      logger: this.logger,
    });

    return [toolPermissions];
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const permissions = toolFiles.filter((f): f is ToolPermissions => f instanceof ToolPermissions);
    return permissions.map((p) => p.toRulesyncPermissions());
  }

  static getToolTargets({
    global = false,
    importOnly = false,
  }: { global?: boolean; importOnly?: boolean } = {}): ToolTarget[] {
    if (global) {
      return [];
    }
    return importOnly ? permissionsProcessorToolTargetsImportable : permissionsProcessorToolTargets;
  }
}
