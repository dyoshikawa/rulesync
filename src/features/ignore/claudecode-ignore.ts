import { uniq } from "es-toolkit";
import { join } from "node:path";

import { fileExists, readFileContent } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";

export type ClaudecodeIgnoreParams = ToolIgnoreParams;

type SettingsJsonValue = {
  permissions?: {
    deny?: string[] | null;
  } | null;
};

const supportedPermissionActions = new Set(["read", "write", "edit"]);
const permissionWrapperPattern = /^([A-Za-z][A-Za-z0-9]*)\((.*)\)$/;

export class ClaudecodeIgnore extends ToolIgnore {
  constructor(params: ClaudecodeIgnoreParams) {
    super(params);

    const jsonValue: SettingsJsonValue = JSON.parse(this.fileContent);
    this.patterns = jsonValue.permissions?.deny ?? [];
  }

  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".claude",
      relativeFilePath: "settings.local.json",
    };
  }

  /**
   * ClaudecodeIgnore uses settings.local.json which is a user-managed config file.
   * It should not be deleted by rulesync.
   */
  override isDeletable(): boolean {
    return false;
  }

  toRulesyncIgnore(): RulesyncIgnore {
    // Convert ClaudecodeIgnore patterns to RulesyncIgnore format
    // ClaudecodeIgnore stores patterns as "Read(pattern)" in JSON
    // RulesyncIgnore expects plain patterns in text format
    const rulesyncPatterns = this.patterns
      .map((pattern) => {
        // Remove "Read(" prefix and ")" suffix if present
        if (pattern.startsWith("Read(") && pattern.endsWith(")")) {
          return pattern.slice(5, -1);
        }
        return pattern;
      })
      .filter((pattern) => pattern.length > 0);

    // Create the content in .rulesync/.aiignore format (one pattern per line)
    const fileContent = rulesyncPatterns.join("\n");

    return new RulesyncIgnore({
      baseDir: this.baseDir,
      relativeDirPath: RulesyncIgnore.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: RulesyncIgnore.getSettablePaths().recommended.relativeFilePath,
      fileContent,
    });
  }

  static async fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): Promise<ClaudecodeIgnore> {
    const fileContent = rulesyncIgnore.getFileContent();

    const patterns = fileContent
      .split(/\r?\n|\r/)
      .map((line: string) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    const deniedValues = patterns
      .map((pattern) => {
        const wrapperMatch = pattern.match(permissionWrapperPattern);
        if (!wrapperMatch) {
          return `Read(${pattern})`;
        }

        const action = wrapperMatch[1]?.trim() ?? "";
        const normalizedAction = action.toLowerCase();
        if (!supportedPermissionActions.has(normalizedAction)) {
          logger.warn(
            `Unsupported ignore action wrapper "${action}" in line "${pattern}". Supported actions: Read, Write, Edit.`,
          );
          return null;
        }

        const path = wrapperMatch[2]?.trim() ?? "";
        if (path.length === 0) {
          logger.warn(`Ignore rule "${pattern}" has an empty path and was skipped.`);
          return null;
        }

        const actionName =
          normalizedAction === "read" ? "Read" : normalizedAction === "write" ? "Write" : "Edit";
        return `${actionName}(${path})`;
      })
      .filter((value): value is string => value !== null);

    const filePath = join(
      baseDir,
      this.getSettablePaths().relativeDirPath,
      this.getSettablePaths().relativeFilePath,
    );
    const exists = await fileExists(filePath);
    const existingFileContent = exists ? await readFileContent(filePath) : "{}";
    const existingJsonValue: SettingsJsonValue = JSON.parse(existingFileContent);
    const existingDenies = existingJsonValue.permissions?.deny ?? [];
    const preservedDenies = existingDenies.filter((deny) => {
      const isManagedPattern =
        (deny.startsWith("Read(") || deny.startsWith("Write(") || deny.startsWith("Edit(")) &&
        deny.endsWith(")");
      if (isManagedPattern) {
        return deniedValues.includes(deny);
      }

      return true;
    });

    const jsonValue: SettingsJsonValue = {
      ...existingJsonValue,
      permissions: {
        ...existingJsonValue.permissions,
        deny: uniq([...preservedDenies, ...deniedValues].toSorted()),
      },
    };

    return new ClaudecodeIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: JSON.stringify(jsonValue, null, 2),
      validate: true,
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<ClaudecodeIgnore> {
    const fileContent = await readFileContent(
      join(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new ClaudecodeIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: fileContent,
      validate,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolIgnoreForDeletionParams): ClaudecodeIgnore {
    return new ClaudecodeIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
