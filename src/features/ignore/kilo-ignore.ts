import { join } from "node:path";

import { KILO_IGNORE_FILE_NAME, KILO_LEGACY_GLOBAL_DIR } from "../../constants/kilo-paths.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreSettablePaths,
  ToolIgnoreSettablePathsParams,
} from "./tool-ignore.js";

/**
 * KiloIgnore represents ignore patterns for the Kilo Code VSCode extension.
 *
 * Based on the Kilo Code specification:
 * - File location: workspace root (.kilocodeignore) for project scope, and
 *   `~/.kilocode/.kilocodeignore` for global scope. Kilo merges the global
 *   patterns first and the project ones after, so the project file wins.
 * - Syntax: Same as .gitignore
 * - Immediate reflection when saved
 * - Complete blocking of file access for ignored patterns
 * - Shows lock icon for ignored files in listings
 *
 * Kilo reads `.kilocodeignore` (not `.kiloignore`), so emitting `.kiloignore`
 * left the file inert. https://kilo.ai/docs/customize/context/kilocodeignore
 * @see https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/kilocode/ignore-migrator.ts
 */
export class KiloIgnore extends ToolIgnore {
  static getSettablePaths({
    global = false,
  }: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: global ? KILO_LEGACY_GLOBAL_DIR : ".",
      relativeFilePath: KILO_IGNORE_FILE_NAME,
    };
  }

  /**
   * Convert KiloIgnore to RulesyncIgnore format
   */
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  /**
   * Create KiloIgnore from RulesyncIgnore
   */
  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
    global = false,
  }: ToolIgnoreFromRulesyncIgnoreParams): KiloIgnore {
    const body = rulesyncIgnore.getFileContent();
    const paths = this.getSettablePaths({ global });

    return new KiloIgnore({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: body,
      global,
    });
  }

  /**
   * Load KiloIgnore from .kilocodeignore file
   */
  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolIgnoreFromFileParams): Promise<KiloIgnore> {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );

    return new KiloIgnore({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
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
  }: ToolIgnoreForDeletionParams): KiloIgnore {
    return new KiloIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
