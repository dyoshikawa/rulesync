import { join } from "node:path";

import { TRAE_DIR, TRAE_IGNORE_FILE_NAME } from "../../constants/trae-paths.js";
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
 * Trae ignore file implementation.
 *
 * Trae reads `.trae/.ignore` (gitignore syntax) as a supplement to
 * `.gitignore` when it indexes the codebase; ignored files are also left out
 * of `#Workspace` / `#Folder` context. There is no user-level ignore file, so
 * only project scope is supported.
 *
 * @see https://docs.trae.ai/ide/ignore-files?_lang=en
 */
export class TraeIgnore extends ToolIgnore {
  static getSettablePaths(_params: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    // Project scope only; the processor never asks for global paths.
    return {
      relativeDirPath: TRAE_DIR,
      relativeFilePath: TRAE_IGNORE_FILE_NAME,
    };
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
    global = false,
  }: ToolIgnoreFromRulesyncIgnoreParams): TraeIgnore {
    const paths = this.getSettablePaths({ global });
    return new TraeIgnore({
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
  }: ToolIgnoreFromFileParams): Promise<TraeIgnore> {
    const { relativeDirPath, relativeFilePath } = this.getSettablePaths({ global });
    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));

    return new TraeIgnore({
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
  }: ToolIgnoreForDeletionParams): TraeIgnore {
    return new TraeIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
