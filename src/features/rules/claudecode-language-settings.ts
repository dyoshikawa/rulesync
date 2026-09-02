import { join } from "node:path";

import {
  CLAUDECODE_DIR,
  CLAUDECODE_SETTINGS_FILE_NAME,
  CLAUDECODE_SETTINGS_LOCAL_FILE_NAME,
} from "../../constants/claudecode-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { getClaudecodeLanguageValue, Language } from "../../types/language.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";

export type ClaudecodeLanguageSettingsPaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

/**
 * Claude Code's native home for the root `language` key of `rulesync.jsonc`.
 *
 * Claude Code reads a top-level `language` setting, so for this target the
 * rules feature writes the preference there instead of appending a prompt
 * block to CLAUDE.md. The key is patched into the existing settings file
 * through the shared config gateway (the `rules` feature owns `language`
 * there and nothing else), so hooks, permissions, and deny lists written by
 * sibling features — and everything the user authored — are left alone.
 */
export class ClaudecodeLanguageSettings extends ToolFile {
  /**
   * Project scope goes to `.claude/settings.local.json`: a response language
   * is a per-developer preference, and the local file is the one Claude Code
   * keeps out of version control. Global scope goes to `~/.claude/settings.json`
   * because Claude Code reads no `~/.claude/settings.local.json`.
   */
  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ClaudecodeLanguageSettingsPaths {
    return {
      relativeDirPath: CLAUDECODE_DIR,
      relativeFilePath: global
        ? CLAUDECODE_SETTINGS_FILE_NAME
        : CLAUDECODE_SETTINGS_LOCAL_FILE_NAME,
    };
  }

  static async fromLanguage({
    outputRoot = process.cwd(),
    language,
    global = false,
    validate = true,
  }: {
    outputRoot?: string;
    language: Language;
    global?: boolean;
    validate?: boolean;
  }): Promise<ClaudecodeLanguageSettings> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    return new ClaudecodeLanguageSettings({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "rules",
        existingContent,
        patch: { language: getClaudecodeLanguageValue(language) },
        filePath,
      }),
      validate,
      global,
    });
  }

  /**
   * A settings file the user (and other features) share: never swept as an
   * orphan, even though the rules feature stops writing it when `language`
   * is unset again.
   */
  override isDeletable(): boolean {
    return false;
  }

  validate(): ValidationResult {
    try {
      JSON.parse(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(
          `Invalid JSON in ${this.getRelativePathFromCwd()}: ${formatError(error)}`,
          { cause: error },
        ),
      };
    }
  }
}
