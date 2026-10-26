import { join } from "node:path";

import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import type { DeletedPath } from "../lib/orphan-sweep.js";
import { ErrorCodes } from "../types/json-output.js";
import { formatError } from "../utils/error.js";
import type { Logger } from "../utils/logger.js";
import { isRulesyncSourceMissing } from "../utils/rulesync-source-path.js";

/**
 * The bookkeeping shared by everything that loads a `.rulesync/` source tree.
 *
 * Both `FeatureProcessor` and `DirFeatureProcessor` need to record that a
 * source was there and could not be read, and `generate` reads the flag back
 * off either of them without caring which it holds. Keeping the state in one
 * place means the two hierarchies cannot drift apart on what "failed to load"
 * means. The roots, the dry-run flag, the logger and the orphan sweep's record
 * of removed paths are held here for the same reason.
 */
export abstract class RulesyncSourceConsumer {
  protected readonly outputRoot: string;
  /**
   * Ordered, non-empty list of rulesync source-tree directories. Each entry
   * is a source tree itself — the directory that directly contains feature
   * subdirectories (`rules/`, `commands/`, `skills/`, …) and single-file
   * features (`mcp.jsonc`, `hooks.jsonc`, …). Later entries take precedence
   * in per-feature merges and when two trees supply the same relative path.
   * Defaults to `[join(process.cwd(), ".rulesync")]`.
   *
   * The singular user-facing alias (`inputRoot` in `rulesync.jsonc` / the
   * `--input-root` CLI flag / `GenerateOptions.inputRoot`) is deprecated
   * and collapsed into `[join(inputRoot, ".rulesync")]` before it ever
   * reaches a processor — every internal consumer only ever sees the
   * plural form, with the source tree already resolved.
   */
  protected readonly inputRoots: readonly [string, ...string[]];
  protected readonly dryRun: boolean;
  /**
   * Held here so {@link reportRulesyncSourceLoadError} cannot be handed a
   * different logger than the one the processor reports everything else on.
   */
  protected readonly logger: Logger;
  /**
   * Paths the orphan sweeps deleted (or, under `--dry-run`, would delete),
   * relative to the output root like the paths the processor's writes report.
   */
  protected readonly removedPaths: DeletedPath[] = [];

  /**
   * Set when a `.rulesync/` source could not be read at all. The processor
   * still returns no files so the rest of the run continues, but generate must
   * not report success afterwards: "nothing was written" and "nothing needed
   * writing" are indistinguishable to a scripted caller otherwise, and the
   * orphan sweep would read the missing output as no longer wanted.
   */
  private rulesyncSourceLoadFailed = false;

  constructor({
    outputRoot = process.cwd(),
    inputRoots,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoots?: readonly [string, ...string[]] | readonly string[];
    dryRun?: boolean;
    logger: Logger;
  }) {
    this.outputRoot = outputRoot;

    this.inputRoots =
      inputRoots !== undefined && inputRoots.length > 0
        ? [inputRoots[0]!, ...inputRoots.slice(1)]
        : [join(process.cwd(), RULESYNC_RELATIVE_DIR_PATH)];

    this.dryRun = dryRun;
    this.logger = logger;
  }

  protected recordRulesyncSourceLoadFailure(): void {
    this.rulesyncSourceLoadFailed = true;
  }

  /**
   * Report a `.rulesync/` source that would not load, and record it unless it
   * was simply not there.
   *
   * The two outcomes have to stay together: a source that is absent is an
   * ordinary state that belongs at `debug`, while one that exists and cannot be
   * read is an error that must also fail the run. Splitting the decision across
   * every loader is how they drift — this way a project with no `mcp.jsonc` does
   * not get an error line on every run, and a project with a broken one cannot
   * get a clean exit.
   */
  protected reportRulesyncSourceLoadError({
    message,
    error,
  }: {
    message: string;
    error: unknown;
  }): void {
    const detail = `${message}: ${formatError(error)}`;

    if (isRulesyncSourceMissing(error)) {
      this.logger.debug(detail);
      return;
    }

    // Tagged so a caller that has to relay the reason — the MCP server builds
    // its failure response out of these — can pick them out of the run's other
    // error lines instead of forwarding everything that was ever logged.
    this.logger.error(detail, ErrorCodes.SOURCE_LOAD_FAILED);
    this.recordRulesyncSourceLoadFailure();
  }

  hasRulesyncSourceLoadFailure(): boolean {
    return this.rulesyncSourceLoadFailed;
  }

  /**
   * The paths the orphan sweeps deleted, or would have deleted under
   * `--dry-run`, so a preview and the run it previews report the same list.
   * A deleted directory is listed once, by its own path.
   */
  getRemovedPaths(): readonly DeletedPath[] {
    return this.removedPaths;
  }
}
