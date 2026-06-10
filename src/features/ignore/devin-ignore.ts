import { join } from "node:path";

import { fileExists, readFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import type {
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

/**
 * Brand-aligned Devin Desktop ignore filename, added in Devin Desktop v3.1.7
 * (2026-06-10). This matches how rules/commands/skills already prefer `.devin/`
 * since the Windsurf/Cascade rebrand.
 */
const DEVIN_IGNORE_FILE_NAME = ".devinignore";

/**
 * Legacy Codeium-era ignore filename. Devin Desktop still honors it (alongside
 * `.windsurfignore`), so it is read on import for round-trip compatibility with
 * projects generated before the rebrand.
 */
const DEVIN_LEGACY_IGNORE_FILE_NAME = ".codeiumignore";

/**
 * Devin Desktop (the Windsurf/Cascade rebrand) ignore file implementation.
 *
 * Generates the brand-aligned `.devinignore` file with gitignore-compatible
 * syntax. Devin automatically respects `.gitignore` patterns and has built-in
 * defaults for node_modules/ and hidden files. On import, the legacy
 * `.codeiumignore` filename is read as a fallback so existing projects still
 * round-trip.
 *
 * @see https://docs.devin.ai/desktop/changelog — v3.1.7 added `.devinignore`
 *   alongside `.windsurfignore` and `.codeiumignore`.
 */
export class DevinIgnore extends ToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: DEVIN_IGNORE_FILE_NAME,
    };
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): DevinIgnore {
    return new DevinIgnore({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<DevinIgnore> {
    const { relativeDirPath, relativeFilePath } = this.getSettablePaths();
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
  }: ToolIgnoreForDeletionParams): DevinIgnore {
    return new DevinIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
