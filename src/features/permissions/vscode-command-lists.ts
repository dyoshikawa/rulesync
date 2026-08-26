import type { PermissionAction } from "../../types/permissions.js";
import type { Logger } from "../../utils/logger.js";
import { warnWithFallback } from "../../utils/logger.js";

/**
 * Characters an author is most likely to have meant as a glob, and which the
 * Roo Code / Zoo Code lineage matches literally instead.
 *
 * `findLongestPrefixMatch` lowercases both sides and compares with
 * `startsWith`, with exactly one special case: the entry `"*"` on its own,
 * which matches any command. Every other character — `*` in the middle or at
 * the end included — is just part of the prefix.
 *
 * @see https://github.com/RooCodeInc/Roo-Code/blob/v3.54.0/src/core/auto-approval/commands.ts
 */
const GLOB_METACHARACTERS = /[*?[\]{}]/;

/**
 * Whether a pattern reads as a glob but will be matched as a literal prefix.
 *
 * The bare `"*"` is excluded because it is the one entry the extension does
 * interpret, so writing it is correct rather than a mistake.
 */
function looksLikeAnUnsupportedGlob(pattern: string): boolean {
  return pattern !== "*" && GLOB_METACHARACTERS.test(pattern);
}

/**
 * The literal prefix an author most likely meant, used only inside the warning.
 * Everything from the first glob metacharacter on is dropped, since that is
 * where the pattern stops being a prefix.
 */
function toPrefixHint(pattern: string): string {
  const index = pattern.search(GLOB_METACHARACTERS);
  return index <= 0 ? pattern : pattern.slice(0, index);
}

function formatPatterns(patterns: string[]): string {
  const quoted = patterns.map((pattern) => JSON.stringify(pattern));
  return quoted.length === 1 ? `pattern ${quoted[0]}` : `patterns ${quoted.join(", ")}`;
}

/**
 * Split one canonical category's rules into the two command lists the Roo Code
 * and Zoo Code lineages read from `.vscode/settings.json`.
 *
 * Entries are matched as command **prefixes**, and a command matching both
 * lists is resolved by the longer match: auto-approval needs a strictly longer
 * allowed match, and a denied match that is longer or equal auto-denies. `ask`
 * is represented by listing the pattern in neither list, which leaves the
 * extension's own approval prompt in charge.
 *
 * Both lists are always returned, empty ones included, and the caller writes
 * them verbatim. An empty array is **not** the same as an absent key here: the
 * extension reads the effective configuration value, so an absent
 * `allowedCommands` resolves to the contributed default
 * `["git log", "git diff", "git show"]` and silently re-grants those three
 * auto-approvals, while `[]` overrides it at workspace scope and short-circuits
 * `isAutoApprovedSingleCommand` on `!allowedCommands?.length`. A canonical
 * config of `{"git ": "deny"}` must not leave `git log` auto-approved.
 *
 * (The lists the extension finally uses are still merged with its own
 * global-state entries, which live in VS Code extension storage rather than in
 * any committable file, so they are outside what rulesync can express.)
 *
 * A glob-shaped pattern is passed through unchanged but warned about, because
 * the canonical `bash` category is glob-shaped for most other targets and the
 * mismatch fails **open** on this one: `{"*": "allow", "rm -rf *": "deny"}`
 * yields a denied entry that never matches `rm -rf /` — the literal text
 * `rm -rf *` is not a prefix of it — while the bare `"*"` on the allow side
 * still matches everything, so the command auto-approves with no prompt.
 * Rewriting the pattern instead would silently change what a security setting
 * means, so the author is told and left in control.
 */
export function buildVscodeCommandLists({
  rules,
  toolLabel,
  logger,
}: {
  rules: Record<string, PermissionAction>;
  toolLabel: string;
  logger?: Logger | undefined;
}): { allowed: string[]; denied: string[] } {
  const allowed: string[] = [];
  const denied: string[] = [];
  const globbedAllows: string[] = [];
  const globbedDenies: string[] = [];
  for (const [pattern, action] of Object.entries(rules)) {
    if (action === "allow") {
      allowed.push(pattern);
      if (looksLikeAnUnsupportedGlob(pattern)) {
        globbedAllows.push(pattern);
      }
    } else if (action === "deny") {
      denied.push(pattern);
      if (looksLikeAnUnsupportedGlob(pattern)) {
        globbedDenies.push(pattern);
      }
    }
  }

  // Denies are warned about first and separately: a deny that fails to match is
  // the direction that widens what runs unattended, while a glob-shaped allow
  // only narrows it (it matches fewer commands than intended, so more of them
  // reach the approval prompt).
  const firstGlobbedDeny = globbedDenies[0];
  if (firstGlobbedDeny !== undefined) {
    warnWithFallback(
      logger,
      `${toolLabel}: deny ${formatPatterns(globbedDenies)} will be matched as a literal command ` +
        `prefix, not as a glob, so ${JSON.stringify(firstGlobbedDeny)} does not deny the commands ` +
        `it looks like it denies. Write the literal prefix instead — for example ` +
        `${JSON.stringify(toPrefixHint(firstGlobbedDeny))}. A deny that never matches leaves the ` +
        `command auto-approved whenever an allow entry does match.`,
    );
  }
  if (globbedAllows.length > 0) {
    warnWithFallback(
      logger,
      `${toolLabel}: allow ${formatPatterns(globbedAllows)} will be matched as a literal command ` +
        `prefix, not as a glob, so it approves fewer commands than it looks like it does. Write ` +
        `the literal prefix instead; a bare "*" is the one entry that is treated as a wildcard.`,
    );
  }

  return { allowed, denied };
}
