import { join } from "node:path";

import { LETTACODE_DIR, LETTACODE_IGNORE_FILE_NAME } from "../../constants/lettacode-paths.js";
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
 * Letta Code ignore file implementation.
 *
 * Letta Code reads `.letta/.lettaignore` at the project root to exclude files
 * and directories from its indexed `@` file search: one glob per line, `#`
 * comments, and no `!` negation (such lines are skipped by Letta Code). There
 * is no user-level ignore file, so only project scope is supported.
 *
 * @see https://docs.letta.com/reference/settings/index.md
 */
export class LettacodeIgnore extends ToolIgnore {
  static getSettablePaths(_params: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    // Project scope only; the processor never asks for global paths.
    return {
      relativeDirPath: LETTACODE_DIR,
      relativeFilePath: LETTACODE_IGNORE_FILE_NAME,
    };
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
    global = false,
  }: ToolIgnoreFromRulesyncIgnoreParams): LettacodeIgnore {
    const paths = this.getSettablePaths({ global });
    return new LettacodeIgnore({
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
  }: ToolIgnoreFromFileParams): Promise<LettacodeIgnore> {
    const { relativeDirPath, relativeFilePath } = this.getSettablePaths({ global });
    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));

    return new LettacodeIgnore({
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
  }: ToolIgnoreForDeletionParams): LettacodeIgnore {
    return new LettacodeIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
