import { join } from "node:path";

import {
  RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  type PermissionsConfig,
  PermissionsExternalConfigSchema,
  buildRulesyncPermissionsFileContent,
  entriesToPermissionsMap,
  permissionsMapToEntries,
} from "../../types/permissions.js";
import type { RulesyncFileFromFileParams, RulesyncFileParams } from "../../types/rulesync-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { fileExists, readFileContent } from "../../utils/file.js";

export type RulesyncPermissionsParams = RulesyncFileParams;

export type RulesyncPermissionsFromFileParams = Pick<
  RulesyncFileFromFileParams,
  "baseDir" | "validate"
>;

export type RulesyncPermissionsSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

// Re-export for JSON schema generation
export { PermissionsExternalConfigSchema as RulesyncPermissionsFileSchema };

export class RulesyncPermissions extends RulesyncFile {
  private readonly json: PermissionsConfig;

  constructor(params: RulesyncPermissionsParams) {
    super({ ...params });

    const parsed = JSON.parse(this.fileContent);
    const entries = permissionsMapToEntries(parsed.permissions ?? {});
    this.json = {
      ...(parsed.$schema ? { $schema: parsed.$schema } : {}),
      permissions: entries,
    };
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): RulesyncPermissionsSettablePaths {
    return {
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "permissions.json",
    };
  }

  validate(): ValidationResult {
    const result = PermissionsExternalConfigSchema.safeParse(JSON.parse(this.fileContent));
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: RulesyncPermissionsFromFileParams): Promise<RulesyncPermissions> {
    const paths = RulesyncPermissions.getSettablePaths();
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);

    if (!(await fileExists(filePath))) {
      throw new Error(`No ${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH} found.`);
    }

    const fileContent = await readFileContent(filePath);
    return new RulesyncPermissions({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  getJson(): PermissionsConfig {
    return this.json;
  }

  toFileContent(): string {
    return buildRulesyncPermissionsFileContent({
      entries: this.json.permissions,
      schema: this.json.$schema,
    });
  }

  toExternalJson(): {
    $schema?: string;
    permissions: Record<string, Record<string, "allow" | "ask" | "deny">>;
  } {
    return {
      ...(this.json.$schema ? { $schema: this.json.$schema } : {}),
      permissions: entriesToPermissionsMap(this.json.permissions),
    };
  }

  override getFileContent(): string {
    return this.toFileContent();
  }
}
