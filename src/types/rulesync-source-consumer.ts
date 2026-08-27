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

  hasRulesyncSourceLoadFailure(): boolean {
    return this.rulesyncSourceLoadFailed;
  }
}
