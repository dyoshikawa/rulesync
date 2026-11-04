import { join } from "node:path";

import { type AiFileParams, type ValidationResult } from "../../types/ai-file.js";
import { readFileContentOrNull } from "../../utils/file.js";
import {
  ToolCheck,
  type ToolCheckForDeletionParams,
  type ToolCheckFromFileParams,
  type ToolCheckFromRulesyncCheckParams,
} from "./tool-check.js";

/**
 * Shared skeleton for the checks adapters that write every check into one
 * file — the aggregated Markdown adapters as well as the YAML ones (AugmentCode,
 * GitLab Duo, Takt). What they have in common is how that one file is located,
 * read and stood in for on deletion, and that a check cannot be built on its
 * own: the processor calls `fromRulesyncChecks` instead of
 * {@link ToolCheck.fromRulesyncCheck}.
 *
 * Deliberately free of `canDeleteAuxiliaryFiles`: the processor treats the
 * presence of that static as an ownership guard, and not every single-file
 * adapter has one.
 */
export abstract class SingleFileToolCheck extends ToolCheck {
  /**
   * How the tool is named in the message {@link fromRulesyncCheck} throws.
   * Thrown rather than abstract because TypeScript has no abstract statics.
   */
  protected static getDisplayName(): string {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * The settable paths with the file name required. A single-file adapter
   * names the one file it writes — that is what keeps consumers which would
   * otherwise claim the whole tool directory, the gitignore derivation among
   * them, narrowed to it — so a missing name is a mistake in the subclass rather
   * than a case to fall back for.
   */
  protected static getSingleFilePaths({ global = false }: { global?: boolean } = {}): {
    relativeDirPath: string;
    relativeFilePath: string;
  } {
    const paths = this.getSettablePaths({ global });
    if (!paths.relativeFilePath) {
      throw new Error(`${this.name} writes one aggregated file, so getSettablePaths must name it.`);
    }
    return { relativeDirPath: paths.relativeDirPath, relativeFilePath: paths.relativeFilePath };
  }

  /** {@link getSingleFilePaths} plus the absolute path under `outputRoot`. */
  protected static getSingleFilePath({
    outputRoot,
    global = false,
  }: {
    outputRoot: string;
    global?: boolean;
  }): { relativeDirPath: string; relativeFilePath: string; filePath: string } {
    const paths = this.getSingleFilePaths({ global });
    return {
      ...paths,
      filePath: join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    };
  }

  /**
   * `new this(params)` for the concrete adapter the static method was called
   * on; the cast is what an abstract class needs to be constructed through
   * `this`, and lives in one place.
   */
  protected static instantiate(params: AiFileParams): SingleFileToolCheck {
    const ctor = this as unknown as new (p: AiFileParams) => SingleFileToolCheck;
    return new ctor(params);
  }

  static override fromRulesyncCheck(_params: ToolCheckFromRulesyncCheckParams): ToolCheck {
    // Checks share one file, so they are only ever built as a set.
    throw new Error(
      `${this.getDisplayName()} checks are built from all checks at once; use fromRulesyncChecks.`,
    );
  }

  static override async fromFile({
    outputRoot = process.cwd(),
    global = false,
  }: ToolCheckFromFileParams): Promise<SingleFileToolCheck> {
    const { relativeDirPath, relativeFilePath, filePath } = this.getSingleFilePath({
      outputRoot,
      global,
    });
    return this.instantiate({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: (await readFileContentOrNull(filePath)) ?? "",
      global,
    });
  }

  static override forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolCheckForDeletionParams): SingleFileToolCheck {
    return this.instantiate({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
