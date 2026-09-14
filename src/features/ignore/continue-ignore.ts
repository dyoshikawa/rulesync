import { join } from "node:path";

import { CONTINUE_DIR, CONTINUE_IGNORE_FILE_NAME } from "../../constants/continue-paths.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import type {
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreSettablePaths,
  ToolIgnoreSettablePathsParams,
} from "./tool-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

/**
 * Continue ignore file implementation.
 *
 * - Project scope: the workspace-root `.continueignore`, which follows the
 *   exact same rules as `.gitignore` and is layered on top of it.
 * - Global scope: `~/.continue/.continueignore`, respected for all workspaces.
 *
 * @see https://docs.continue.dev/reference/deprecated-codebase
 */
export class ContinueIgnore extends ToolIgnore {
  static getSettablePaths({
    global = false,
  }: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: global ? CONTINUE_DIR : ".",
      relativeFilePath: CONTINUE_IGNORE_FILE_NAME,
    };
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
    global = false,
  }: ToolIgnoreFromRulesyncIgnoreParams): ContinueIgnore {
    const paths = this.getSettablePaths({ global });
    return new ContinueIgnore({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent(),
      global,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolIgnoreFromFileParams): Promise<ContinueIgnore> {
    const { relativeDirPath, relativeFilePath } = this.getSettablePaths({ global });
    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));

    return new ContinueIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolIgnoreForDeletionParams): ContinueIgnore {
    return new ContinueIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
