import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";

/** The canonical category that names a shell command's permissions. */
export const SHELL_PERMISSION_CATEGORY = "bash";

/**
 * The canonical all-tools category. A rule written under it applies to every
 * tool, shell commands included, so an adapter that models only shell commands
 * still has to read it — see `collectShellCommandRules`.
 */
export const ALL_TOOLS_PERMISSION_CATEGORY = "*";

export type ShellCommandRules = {
  /**
   * The `[pattern, action]` pairs that govern shell commands, in the order the
   * source file wrote them.
   */
  rules: [string, PermissionAction][];
  /**
   * Categories that are neither `bash` nor `*` and carry a `deny` rule, for the
   * warning an adapter emits about a restriction it cannot express at all.
   */
  foreignDenyCategories: string[];
};

/**
 * Collect the canonical rules that govern shell commands, for the adapters
 * whose tool models commands and nothing else.
 *
 * The `bash` category contributes every rule. The all-tools `*` category
 * contributes its **restricting** rules — `deny` and `ask` — because a rule
 * written there covers shell commands too, and dropping it inverts the
 * author's intent: with `{"*": {"rm *": "deny"}, "bash": {"rm *": "allow"}}`,
 * an adapter that reads only `bash` auto-approves the very command the file
 * denies.
 *
 * Its `allow` rules are deliberately **not** contributed. A pattern under `*`
 * need not be a command at all — `secrets/**` under `*` denies a path — and
 * carrying it in the restricting direction only over-restricts, while carrying
 * it in the permissive direction would grant something the author never said
 * about commands. Both directions therefore fail closed.
 */
export function collectShellCommandRules(
  permission: PermissionsConfig["permission"],
): ShellCommandRules {
  const rules: [string, PermissionAction][] = [];
  const foreignDenyCategories: string[] = [];

  for (const [category, categoryRules] of Object.entries(permission)) {
    if (category === SHELL_PERMISSION_CATEGORY) {
      rules.push(...Object.entries(categoryRules));
      continue;
    }
    if (category === ALL_TOOLS_PERMISSION_CATEGORY) {
      rules.push(...Object.entries(categoryRules).filter(([, action]) => action !== "allow"));
      continue;
    }
    if (Object.values(categoryRules).some((action) => action === "deny")) {
      foreignDenyCategories.push(category);
    }
  }

  return { rules, foreignDenyCategories };
}

/** The allow/deny lists a command-only tool writes, and what was dropped. */
export type CommandListPartition = {
  /** Patterns to auto-approve. */
  allow: string[];
  /** Patterns to block. */
  deny: string[];
  /**
   * Patterns whose `allow` was withheld because a restricting rule names the
   * same pattern — see `partitionCommandRules`.
   */
  shadowedAllowPatterns: string[];
};

/**
 * Split shell-command rules into the allow and deny lists of a tool that models
 * commands with those two tiers and nothing else.
 *
 * `ask` has no list of its own — such a tool already prompts for whatever it
 * does not auto-approve, so an `ask` rule is satisfied by writing nothing. It
 * still has to *withhold* an `allow` that names the same pattern, though: the
 * canonical order is `deny > ask > allow`, so auto-approving a pattern the file
 * also asks about would answer the prompt the author wanted. A `deny` needs no
 * such treatment because the tool's own denylist already outranks its allowlist.
 */
export function partitionCommandRules(
  rules: readonly [string, PermissionAction][],
): CommandListPartition {
  const askPatterns = new Set(
    rules.filter(([, action]) => action === "ask").map(([pattern]) => pattern),
  );
  const allow: string[] = [];
  const deny: string[] = [];
  const shadowedAllowPatterns: string[] = [];

  for (const [pattern, action] of rules) {
    if (action === "deny") {
      deny.push(pattern);
      continue;
    }
    if (action !== "allow") {
      continue;
    }
    if (askPatterns.has(pattern)) {
      shadowedAllowPatterns.push(pattern);
      continue;
    }
    allow.push(pattern);
  }

  return { allow, deny, shadowedAllowPatterns };
}
