import { uniq } from "es-toolkit";
import { join } from "node:path";

import { fileExists, readFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";

export type ZedIgnoreParams = ToolIgnoreParams;

type SettingsJsonValue = {
  private_files?: string[] | null;
};

export class ZedIgnore extends ToolIgnore {
  constructor(params: ZedIgnoreParams) {
    super(params);

    const jsonValue: SettingsJsonValue = JSON.parse(this.fileContent);
    this.patterns = jsonValue.private_files ?? [];
  }

  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".zed",
      relativeFilePath: "settings.json",
    };
  }

  /**
   * ZedIgnore uses settings.json which is a user-managed config file.
   * It should not be deleted by rulesync.
   */
  override isDeletable(): boolean {
    return false;
  }

  toRulesyncIgnore(): RulesyncIgnore {
    // Convert ZedIgnore patterns to RulesyncIgnore format
    // ZedIgnore stores patterns directly in private_files array
    const rulesyncPatterns = this.patterns.filter((pattern) => pattern.length > 0);

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
  }: ToolIgnoreFromRulesyncIgnoreParams): Promise<ZedIgnore> {
    const fileContent = rulesyncIgnore.getFileContent();

    const patterns = fileContent
      .split(/\r?\n|\r/)
      .map((line: string) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    const filePath = join(
      baseDir,
      this.getSettablePaths().relativeDirPath,
      this.getSettablePaths().relativeFilePath,
    );
    const exists = await fileExists(filePath);
    const existingFileContent = exists ? await readFileContent(filePath) : "{}";
    const existingJsonValue: SettingsJsonValue = JSON.parse(existingFileContent);
    const existingPrivateFiles = existingJsonValue.private_files ?? [];

    // Merge existing patterns with new ones, removing duplicates and sorting
    const mergedPatterns = uniq([...existingPrivateFiles, ...patterns].toSorted());

    const jsonValue: SettingsJsonValue = {
      ...existingJsonValue,
      private_files: mergedPatterns,
    };

    return new ZedIgnore({
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
  }: ToolIgnoreFromFileParams): Promise<ZedIgnore> {
    const fileContent = await readFileContent(
      join(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new ZedIgnore({
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
  }: ToolIgnoreForDeletionParams): ZedIgnore {
    return new ZedIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
