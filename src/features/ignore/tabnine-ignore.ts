import { join } from "node:path";

import { TABNINE_IGNORE_FILE_NAME } from "../../constants/tabnine-paths.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";

/**
 * TabnineIgnore represents the `.tabnineignore` file of Tabnine CLI.
 *
 * - File location: project root only (`.tabnineignore`); no user-scope
 *   variant is documented, so the feature is project-only.
 * - Syntax: the same as `.gitignore`.
 * - Matching files are excluded from the CLI's file searches and directory
 *   listings while `context.fileFiltering.respectGeminiIgnore` (the default)
 *   is enabled.
 *
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/settings/settings-reference
 */
export class TabnineIgnore extends ToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: TABNINE_IGNORE_FILE_NAME,
    };
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): TabnineIgnore {
    const paths = this.getSettablePaths();
    return new TabnineIgnore({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<TabnineIgnore> {
    const paths = this.getSettablePaths();
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );

    return new TabnineIgnore({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolIgnoreForDeletionParams): TabnineIgnore {
    return new TabnineIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
