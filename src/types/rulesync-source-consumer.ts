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
 * means.
 */
export abstract class RulesyncSourceConsumer {
  /**
   * Set when a `.rulesync/` source could not be read at all. The processor
   * still returns no files so the rest of the run continues, but generate must
   * not report success afterwards: "nothing was written" and "nothing needed
   * writing" are indistinguishable to a scripted caller otherwise, and the
   * orphan sweep would read the missing output as no longer wanted.
   */
  private rulesyncSourceLoadFailed = false;

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
    logger,
    message,
    error,
  }: {
    logger: Logger;
    message: string;
    error: unknown;
  }): void {
    const detail = `${message}: ${formatError(error)}`;

    if (isRulesyncSourceMissing(error)) {
      logger.debug(detail);
      return;
    }

    logger.error(detail);
    this.recordRulesyncSourceLoadFailure();
  }

  hasRulesyncSourceLoadFailure(): boolean {
    return this.rulesyncSourceLoadFailed;
  }
}
