import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What one run has already reported.
 *
 * `messages` holds the once-per-run warnings already emitted; `carriedFilesIncomplete`
 * records that a directory's supporting files could not all be read. The two
 * belong together because the second is only ever set beside one of the first:
 * every drop the loader makes is a warning it also prints.
 */
type RunWarningState = {
  messages: Set<string>;
  carriedFilesIncomplete: boolean;
};

function createRunWarningState(): RunWarningState {
  return { messages: new Set(), carriedFilesIncomplete: false };
}

/**
 * The state of a run that opened no scope of its own.
 * This lives in its own module, importing nothing of rulesync's, so the vitest
 * setup file can clear it between tests without pulling `logger.js` into every
 * test's module graph (which would defeat the module mocks some of those tests
 * install).
 */
const processWideState = createRunWarningState();

/**
 * The state an operation that opened its own scope uses instead.
 *
 * The MCP server does not serialize requests, so two runs can be in flight at
 * once. Sharing one set between them would let the first run spend the token
 * for a message and leave the second one's result silent about a diagnostic
 * that applies to it just as much. A scope gives each run its own bookkeeping.
 */
const scopedState = new AsyncLocalStorage<RunWarningState>();

function currentState(): RunWarningState {
  return scopedState.getStore() ?? processWideState;
}

/** Whether `message` has not been emitted yet; records it when it has not. */
export function claimWarnOnce(message: string): boolean {
  const { messages } = currentState();
  if (messages.has(message)) {
    return false;
  }
  messages.add(message);
  return true;
}

/**
 * Record that this run could not read everything a directory carries -- a file
 * it could not open, a walk that hit one of its bounds, a subtree it was denied.
 *
 * Kept here, beside the once-per-run messages, because it shares their lifetime
 * exactly: it is set at the moment such a shortfall is warned about, and cleared
 * when the next run resets its warnings.
 *
 * Deliberate refusals are not shortfalls. A hidden entry, a credential-shaped
 * name, a link into a pseudo-filesystem: those are files Rulesync never carries,
 * on every run, and a run that leaves them out has read its source in full.
 */
export function recordIncompleteCarriedFiles(): void {
  currentState().carriedFilesIncomplete = true;
}

/**
 * Whether {@link recordIncompleteCarriedFiles} fired in this run.
 *
 * A caller that deletes what a run did not write has to ask: a run holding an
 * incomplete picture of its source cannot tell a stale file from one whose
 * source it merely failed to read.
 */
export function hasIncompleteCarriedFiles(): boolean {
  return currentState().carriedFilesIncomplete;
}

/** Forget what was already reported, so the next run starts silent. */
export function resetRunWarningState(): void {
  const state = currentState();
  state.messages.clear();
  state.carriedFilesIncomplete = false;
}

/**
 * Run `operation` with its own once-per-run bookkeeping, so a concurrent run
 * neither spends its tokens nor clears its record.
 */
export async function withWarnOnceScope<T>(operation: () => Promise<T>): Promise<T> {
  return await scopedState.run(createRunWarningState(), operation);
}
