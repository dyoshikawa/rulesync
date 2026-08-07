import { join } from "node:path";

import {
  DEVIN_GLOBAL_IGNORE_DIR_PATH,
  DEVIN_GLOBAL_IGNORE_FILE_NAME,
  DEVIN_IGNORE_FILE_NAME,
  DEVIN_LEGACY_IGNORE_FILE_NAME,
} from "../../constants/devin-paths.js";
import { fileExists, readFileContent } from "../../utils/file.js";
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
 * Devin Desktop (the Windsurf/Cascade rebrand) ignore file implementation.
 *
 * Generates the brand-aligned `.devinignore` file with gitignore-compatible
 * syntax. Devin automatically respects `.gitignore` patterns and has built-in
 * defaults for node_modules/ and hidden files. On import, the legacy
 * `.codeiumignore` filename is read as a fallback so existing projects still
 * round-trip.
 *
 * In global mode the enterprise-wide `~/.codeium/.codeiumignore` is written
 * instead; see `DEVIN_GLOBAL_IGNORE_DIR_PATH` for why that path keeps the
 * legacy brand spelling and sits outside `~/.config/devin`.
 *
 * @see https://docs.devin.ai/desktop/changelog — v3.1.7 added `.devinignore`
 *   alongside `.windsurfignore` and `.codeiumignore`.
 */
export class DevinIgnore extends ToolIgnore {
  static getSettablePaths({
    global = false,
  }: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: global ? DEVIN_GLOBAL_IGNORE_DIR_PATH : ".",
      relativeFilePath: global ? DEVIN_GLOBAL_IGNORE_FILE_NAME : DEVIN_IGNORE_FILE_NAME,
    };
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
    global = false,
  }: ToolIgnoreFromRulesyncIgnoreParams): DevinIgnore {
    const paths = this.getSettablePaths({ global });
    return new DevinIgnore({
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
  }: ToolIgnoreFromFileParams): Promise<DevinIgnore> {
    const { relativeDirPath, relativeFilePath } = this.getSettablePaths({ global });

    // The global file has only ever been documented under the legacy name, so
    // there is no second filename to fall back to.
    if (global) {
      return new DevinIgnore({
        outputRoot,
        relativeDirPath,
        relativeFilePath,
        fileContent: await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath)),
        validate,
        global,
      });
    }

    const primaryPath = join(outputRoot, relativeDirPath, relativeFilePath);
    const legacyPath = join(outputRoot, relativeDirPath, DEVIN_LEGACY_IGNORE_FILE_NAME);

    // Prefer the brand-aligned `.devinignore`; fall back to the legacy
    // `.codeiumignore` only when `.devinignore` is absent so projects generated
    // before the rebrand still round-trip on import.
    const useLegacy = !(await fileExists(primaryPath)) && (await fileExists(legacyPath));
    const resolvedFilePath = useLegacy ? DEVIN_LEGACY_IGNORE_FILE_NAME : relativeFilePath;
    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, resolvedFilePath));

    return new DevinIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath: resolvedFilePath,
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolIgnoreForDeletionParams): DevinIgnore {
    return new DevinIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
