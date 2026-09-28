import { join } from "node:path";

import { CODEBUFF_IGNORE_FILE_NAME } from "../../constants/codebuff-paths.js";
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
 * Codebuff (Freebuff) ignore file implementation.
 *
 * Codebuff reads `.codebuffignore` beside `.gitignore` in the project, with
 * gitignore syntax (`!` negation included), to keep files out of the agent's
 * file tree. There is no user-level ignore file, so only project scope is
 * supported.
 *
 * @see https://github.com/CodebuffAI/freebuff/blob/main/common/src/util/project-ignore.ts
 */
export class CodebuffIgnore extends ToolIgnore {
  static getSettablePaths(_params: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    // Project scope only; the processor never asks for global paths.
    return {
      relativeDirPath: ".",
      relativeFilePath: CODEBUFF_IGNORE_FILE_NAME,
    };
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
    global = false,
  }: ToolIgnoreFromRulesyncIgnoreParams): CodebuffIgnore {
    const paths = this.getSettablePaths({ global });
    return new CodebuffIgnore({
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
  }: ToolIgnoreFromFileParams): Promise<CodebuffIgnore> {
    const { relativeDirPath, relativeFilePath } = this.getSettablePaths({ global });
    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));

    return new CodebuffIgnore({
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
  }: ToolIgnoreForDeletionParams): CodebuffIgnore {
    return new CodebuffIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
