import { join } from "node:path";

import {
  getZedGlobalDir,
  getZedOtherPlatformGlobalDir,
  ZED_DIR,
  ZED_SETTINGS_FILE_NAME,
} from "../../constants/zed-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreParams,
  ToolIgnoreSettablePaths,
  ToolIgnoreSettablePathsParams,
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

  static getSettablePaths({
    global = false,
  }: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: global ? getZedGlobalDir() : ZED_DIR,
      relativeFilePath: ZED_SETTINGS_FILE_NAME,
    };
  }

  /** @see getZedOtherPlatformGlobalDir */
  static getExtraSharedWritePaths({
    global = false,
  }: ToolIgnoreSettablePathsParams = {}): SharedWritePath[] {
    if (!global) {
      return [];
    }
    return [
      {
        relativeDirPath: getZedOtherPlatformGlobalDir(),
        relativeFilePath: ZED_SETTINGS_FILE_NAME,
      },
    ];
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
      // The rulesync source always belongs to the project, even when the
      // settings.json it was imported from lives in the user config dir.
      outputRoot: ".",
      relativeDirPath: RulesyncIgnore.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: RulesyncIgnore.getSettablePaths().recommended.relativeFilePath,
      fileContent,
    });
  }

  static async fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
    global = false,
  }: ToolIgnoreFromRulesyncIgnoreParams): Promise<ZedIgnore> {
    const fileContent = rulesyncIgnore.getFileContent();

    const patterns = fileContent
      .split(/\r?\n|\r/)
      .map((line: string) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const exists = await fileExists(filePath);
    const existingFileContent = exists ? await readFileContent(filePath) : "{}";

    // `private_files` is owned wholesale by the ignore feature (declared as
    // `replace-owned-keys` in the shared-config gateway), so the generated list
    // is authoritative: a pattern deleted from `.rulesync/.aiignore` is
    // retracted from settings.json instead of surviving forever. Every other
    // key in the file is preserved by the gateway.
    //
    // With no patterns at all the key is REMOVED rather than written as `[]`:
    // Zed's default `private_files` (`**/.env*`, `**/*.pem`, …) is replaced
    // wholesale by any value the user or project sets, so an empty array would
    // switch its secret redaction off entirely.
    const managedPatterns = patterns.length > 0 ? [...new Set(patterns)].toSorted() : undefined;

    return new ZedIgnore({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "ignore",
        existingContent: existingFileContent,
        patch: { private_files: managedPatterns },
        filePath,
      }),
      validate: true,
      global,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolIgnoreFromFileParams): Promise<ZedIgnore> {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );

    return new ZedIgnore({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolIgnoreForDeletionParams): ZedIgnore {
    return new ZedIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
