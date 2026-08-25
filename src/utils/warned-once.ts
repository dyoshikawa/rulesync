/**
 * The messages a once-per-run warning has already emitted in this process.
 * This lives in its own module, free of imports, so the vitest setup file can
 * clear it between tests without pulling `logger.js` into every test's module
 * graph (which would defeat the module mocks some of those tests install).
 */
const warnedOnceMessages = new Set<string>();

/** Whether `message` has not been emitted yet; records it when it has not. */
export function claimWarnOnce(message: string): boolean {
  if (warnedOnceMessages.has(message)) {
    return false;
  }
  warnedOnceMessages.add(message);
  return true;
}

/** Forget which warnings were already emitted, so each test starts silent. */
export function resetWarnedOnceMessages(): void {
  warnedOnceMessages.clear();
}
