import { join } from "node:path";

import { type ValidationResult } from "../../types/ai-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { readFileContentOrNull } from "../../utils/file.js";
import {
  hasHandWrittenPreamble,
  isOnlyGeneratedSections,
  renderCheckFile,
  splitCheckFile,
} from "./aggregated-check-file.js";
import { RulesyncCheck } from "./rulesync-check.js";
import {
  ToolCheck,
  type ToolCheckForDeletionParams,
  type ToolCheckFromFileParams,
  type ToolCheckFromRulesyncCheckParams,
  type ToolCheckFromRulesyncChecksParams,
} from "./tool-check.js";

/**
 * What generating does to a file that holds instructions rulesync did not
 * write, which is the one place the three aggregated adapters genuinely differ.
 *
 * `replace` warns and writes anyway: the path is one only the tool's reviewer
 * reads, so rewriting it replaces review instructions with review instructions.
 * `skip` warns and writes nothing: the path is shared with something else — an
 * ordinary skill directory, say — so a file there may have nothing to do with
 * reviews and rulesync cannot rebuild what it would overwrite.
 */
export type AggregatedCheckHandWrittenPolicy = "replace" | "skip";

export type AggregatedToolCheckConfig = {
  /**
   * The tool's name as it appears in messages this base builds — "Rovo Dev"
   * rather than the `rovodev` target the same messages put in a command line.
   */
  displayName: string;
  toolTarget: ToolTarget;
  /** Name given to a check recovered from a file with no marked section. */
  fallbackCheckName: string;
  /**
   * Applied to the file before it is split into checks. Set only where the
   * output path can also hold something that is not just check sections.
   */
  transformImportedContent?: (fileContent: string) => string;
} & (
  | { handWrittenPreamble: "replace" }
  | {
      handWrittenPreamble: "skip";
      /**
       * Required for `skip` because the message has to say what to do about a
       * file that keeps blocking generation, which is tool-specific. The
       * `replace` wording is uniform and this base writes it.
       */
      handWrittenWarning: (params: { filePath: string }) => string;
    }
);

/**
 * Shared skeleton for the checks adapters whose output is a single aggregated
 * instruction file — one file whose sections are the marked blocks
 * `aggregated-check-file.ts` renders and splits, rather than a directory with a
 * file per check.
 *
 * That module already held the rendering and the splitting; what is here is the
 * adapter around it, which was near-verbatim in Cursor Bugbot, Rovo Dev and
 * Factory Droid. A subclass supplies {@link ToolCheck.getSettablePaths} and
 * {@link getAggregatedCheckConfig}, and inherits the rest — so a fix to how
 * these files are read or written lands once instead of three times.
 *
 * `fromRulesyncCheck` is refused here rather than implemented: sections share
 * one file, so an output cannot be produced from one check in isolation and the
 * processor calls {@link fromRulesyncChecks} instead.
 *
 * Not declared `abstract`, even though nothing instantiates it directly: the
 * statics below build the subclass with `new this(...)`, which an abstract
 * constructor type forbids. What a subclass owes is enforced the way the rest
 * of this codebase enforces it on a static — {@link getAggregatedCheckConfig}
 * throws until it is overridden.
 */
export class AggregatedToolCheck extends ToolCheck {
  /**
   * The per-tool values the shared skeleton reads. Thrown rather than abstract
   * because TypeScript has no abstract statics; a subclass that forgets it
   * fails on its first use rather than silently taking a default.
   */
  protected static getAggregatedCheckConfig(): AggregatedToolCheckConfig {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * The settable paths with the file name required. An aggregated adapter names
   * the one file it writes — that is what keeps consumers which would otherwise
   * claim the whole tool directory, the gitignore derivation among them,
   * narrowed to it — so a missing name is a mistake in the subclass rather than
   * a case to fall back for.
   */
  protected static getAggregatedPaths({ global = false }: { global?: boolean } = {}): {
    relativeDirPath: string;
    relativeFilePath: string;
  } {
    const paths = this.getSettablePaths({ global });
    if (!paths.relativeFilePath) {
      throw new Error(`${this.name} writes one aggregated file, so getSettablePaths must name it.`);
    }
    return { relativeDirPath: paths.relativeDirPath, relativeFilePath: paths.relativeFilePath };
  }

  private static getAggregatedFilePath({
    outputRoot,
    global = false,
  }: {
    outputRoot: string;
    global?: boolean;
  }): { relativeDirPath: string; relativeFilePath: string; filePath: string } {
    const paths = this.getAggregatedPaths({ global });
    return {
      ...paths,
      filePath: join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    };
  }

  static override isTargetedByRulesyncCheck(rulesyncCheck: RulesyncCheck): boolean {
    return this.isTargetedByRulesyncCheckDefault({
      rulesyncCheck,
      toolTarget: this.getAggregatedCheckConfig().toolTarget,
    });
  }

  /**
   * Ownership guard the processor consults before it deletes anything for this
   * tool. Every one of these paths is a file the tool's own documentation tells
   * users to hand-write, so anything in it that rulesync did not write is not
   * rulesync's to remove — dropping the last check targeting the tool must not
   * take somebody's review instructions with it. Deletion is therefore allowed
   * only for a file that is nothing but generated sections: one that carries no
   * marker at all, or that carries hand-written text ahead of the first marker,
   * stays.
   */
  static async canDeleteAuxiliaryFiles({ outputRoot }: { outputRoot: string }): Promise<boolean> {
    const { filePath } = this.getAggregatedFilePath({ outputRoot });
    const fileContent = await readFileContentOrNull(filePath);
    if (fileContent === null) {
      return true;
    }
    return isOnlyGeneratedSections(fileContent);
  }

  static override fromRulesyncCheck(_params: ToolCheckFromRulesyncCheckParams): ToolCheck {
    // Sections share one file, so they are only ever built as a set.
    const { displayName } = this.getAggregatedCheckConfig();
    throw new Error(
      `${displayName} checks are built from all checks at once; use fromRulesyncChecks.`,
    );
  }

  static async fromRulesyncChecks({
    outputRoot = process.cwd(),
    rulesyncChecks,
    global = false,
    logger,
  }: ToolCheckFromRulesyncChecksParams): Promise<AggregatedToolCheck[]> {
    if (rulesyncChecks.length === 0) {
      // No section to write. A stale file from an earlier generate is removed by
      // the processor's deletion pass rather than by an empty file written here.
      return [];
    }

    const config = this.getAggregatedCheckConfig();
    const { relativeDirPath, relativeFilePath, filePath } = this.getAggregatedFilePath({
      outputRoot,
      global,
    });

    // The file is written from `.rulesync/checks/` rather than merged into, so
    // instructions rulesync did not write are either replaced with a warning or
    // left alone — the deletion guard protects them from a sweep, but generating
    // is the direction it cannot speak for.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    if (hasHandWrittenPreamble(existingContent)) {
      if (config.handWrittenPreamble === "skip") {
        logger?.warn(config.handWrittenWarning({ filePath }));
        return [];
      }
      logger?.warn(
        `${config.displayName} checks: ${filePath} holds instructions rulesync did not write, ` +
          `and generating replaces the whole file. Run \`rulesync import --targets ` +
          `${config.toolTarget} --features checks\` first to keep them.`,
      );
    }

    return [
      new this({
        outputRoot,
        relativeDirPath,
        relativeFilePath,
        fileContent: renderCheckFile(rulesyncChecks),
        global,
      }),
    ];
  }

  static override async fromFile({
    outputRoot = process.cwd(),
    global = false,
  }: ToolCheckFromFileParams): Promise<AggregatedToolCheck> {
    const { relativeDirPath, relativeFilePath, filePath } = this.getAggregatedFilePath({
      outputRoot,
      global,
    });
    return new this({
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
  }: ToolCheckForDeletionParams): AggregatedToolCheck {
    return new this({
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

  toRulesyncCheck(): RulesyncCheck {
    const checks = this.toRulesyncChecks();
    const first = checks[0];
    if (!first) {
      throw new Error(
        `No check instructions found in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}.`,
      );
    }
    return first;
  }

  override toRulesyncChecks(): RulesyncCheck[] {
    const config = (this.constructor as typeof AggregatedToolCheck).getAggregatedCheckConfig();
    const fileContent = this.getFileContent();
    return splitCheckFile({
      fileContent: config.transformImportedContent?.(fileContent) ?? fileContent,
      fallbackName: config.fallbackCheckName,
    });
  }
}
