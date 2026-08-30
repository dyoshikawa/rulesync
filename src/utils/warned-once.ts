import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The messages a once-per-run warning has already emitted in this process.
 * This lives in its own module, importing nothing of rulesync's, so the vitest
 * setup file can clear it between tests without pulling `logger.js` into every
 * test's module graph (which would defeat the module mocks some of those tests
 * install).
 */
const processWideMessages = new Set<string>();

/**
 * The set an operation that opened its own scope uses instead.
 *
 * The MCP server does not serialize requests, so two runs can be in flight at
 * once. Sharing one set between them would let the first run spend the token
 * for a message and leave the second one's result silent about a diagnostic
 * that applies to it just as much. A scope gives each run its own bookkeeping.
 */
const scopedMessages = new AsyncLocalStorage<Set<string>>();

function currentMessages(): Set<string> {
  return scopedMessages.getStore() ?? processWideMessages;
}

/** Whether `message` has not been emitted yet; records it when it has not. */
export function claimWarnOnce(message: string): boolean {
  const messages = currentMessages();
  if (messages.has(message)) {
    return false;
  }
  messages.add(message);
  return true;
}

/** Forget which warnings were already emitted, so the next run starts silent. */
export function resetWarnedOnceMessages(): void {
  currentMessages().clear();
}

/**
 * Run `operation` with its own once-per-run bookkeeping, so a concurrent run
 * neither spends its tokens nor clears its record.
 */
export async function withWarnOnceScope<T>(operation: () => Promise<T>): Promise<T> {
  return await scopedMessages.run(new Set(), operation);
}
