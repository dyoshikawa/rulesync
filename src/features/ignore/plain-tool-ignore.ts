import { join } from "node:path";

import { readFileContent } from "../../utils/file.js";
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

/**
 * The static side a `PlainToolIgnore` subclass offers to the shared factory
 * methods below: a concrete constructor and its own settable paths.
 */
type PlainToolIgnoreClass<T extends PlainToolIgnore> = {
  new (params: ToolIgnoreParams): T;
  getSettablePaths(params?: ToolIgnoreSettablePathsParams): ToolIgnoreSettablePaths;
};

/**
 * A tool ignore file that is the rulesync ignore content verbatim, written to
 * the subclass's settable path (a gitignore-syntax file such as
 * `.clineignore`). Subclasses only declare `getSettablePaths`.
 */
export abstract class PlainToolIgnore extends ToolIgnore {
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore<T extends PlainToolIgnore>(
    this: PlainToolIgnoreClass<T>,
    {
      outputRoot = process.cwd(),
      rulesyncIgnore,
      global = false,
    }: ToolIgnoreFromRulesyncIgnoreParams,
  ): T {
    const paths = this.getSettablePaths({ global });
    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent(),
      global,
    });
  }

  static async fromFile<T extends PlainToolIgnore>(
    this: PlainToolIgnoreClass<T>,
    { outputRoot = process.cwd(), validate = true, global = false }: ToolIgnoreFromFileParams,
  ): Promise<T> {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );

    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion<T extends PlainToolIgnore>(
    this: PlainToolIgnoreClass<T>,
    {
      outputRoot = process.cwd(),
      relativeDirPath,
      relativeFilePath,
      global = false,
    }: ToolIgnoreForDeletionParams,
  ): T {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
