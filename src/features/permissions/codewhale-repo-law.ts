import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import type { Logger } from "../../utils/logger.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { ALL_TOOLS_PERMISSION_CATEGORY } from "./shell-command-categories.js";
import { PERMISSION_ACTION_PRIORITY } from "./single-action-collapse.js";

/**
 * Project-scope Codewhale permissions: the enforced `protected_invariants` of
 * the repo constitution `.codewhale/constitution.json`.
 *
 * An invariant written as an object with `paths` compiles into a write hold
 * that Codewhale's tool gate evaluates for `write_file`, `edit_file`,
 * `apply_patch` and `fim_edit`: `action = "block"` denies the write in every
 * posture, `action = "ask"` (the default) force-prompts. The schema has no
 * allow shape, so only `deny` / `ask` rules can be written.
 *
 * @see https://github.com/Hmbown/Codewhale/blob/main/docs/CONFIGURATION.md#enforced-repo-law-invariants
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/repo_law.rs
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/project_context/constitution.rs
 */

/** The `schema_version` Codewhale's constitution loader understands. */
const CODEWHALE_CONSTITUTION_SCHEMA_VERSION = 1;

/**
 * Marks the invariants rulesync wrote, so a regenerate replaces only those and
 * leaves hand-written ones alone. Codewhale ignores unknown keys.
 */
const MANAGED_BY_KEY = "managed_by";
const MANAGED_BY_VALUE = "rulesync";

/**
 * Canonical categories whose rules become write holds. Repo law holds every
 * write tool at once, so `write` and `edit` cannot be told apart.
 */
const REPO_LAW_CATEGORIES: readonly string[] = ["write", "edit", ALL_TOOLS_PERMISSION_CATEGORY];

type RepoLawAction = "ask" | "block";

type ManagedInvariant = {
  text: string;
  paths: string[];
  action: RepoLawAction;
  [MANAGED_BY_KEY]: typeof MANAGED_BY_VALUE;
};

type EnforcedInvariant = {
  paths: string[];
  action: RepoLawAction;
};

function toRepoLawAction(action: PermissionAction): RepoLawAction {
  return action === "deny" ? "block" : "ask";
}

/**
 * Codewhale compiles `paths` with `globset`, and a glob it cannot compile makes
 * it hold every write. Only the syntax that always compiles is passed through:
 * `*`, `?`, `**` and balanced `{a,b}` alternates. A `[...]` class or a `\`
 * escape is rejected rather than risk an invalid one.
 *
 * @see https://github.com/BurntSushi/ripgrep/blob/globset-0.4.20/crates/globset/src/glob.rs
 */
function isCompilableGlob(pattern: string): boolean {
  if (/[[\]\\]/.test(pattern)) {
    return false;
  }
  let depth = 0;
  for (const character of pattern) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * The workspace-relative glob Codewhale matches a write target against, or
 * `null` when the pattern cannot be written. Codewhale strips the workspace
 * prefix and `.` segments from each target, so a leading `./` is dropped; an
 * absolute, home-relative or `..` pattern names nothing inside the workspace.
 */
function toRepoLawGlob(pattern: string): string | null {
  const trimmed = pattern.trim().replace(/^(\.\/)+/, "");
  if (trimmed === "" || trimmed.startsWith("/") || trimmed.startsWith("~")) {
    return null;
  }
  if (trimmed.split("/").includes("..") || !isCompilableGlob(trimmed)) {
    return null;
  }
  return trimmed;
}

function invariantText({ glob, action }: { glob: string; action: RepoLawAction }): string {
  return action === "block"
    ? `rulesync permissions: writes to ${glob} are denied`
    : `rulesync permissions: writes to ${glob} need approval`;
}

/** The strongest deny / ask action per glob across the write-hold categories. */
function collectRestrictions({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): Map<string, PermissionAction> {
  const restrictions = new Map<string, PermissionAction>();
  const skippedCategories: string[] = [];
  let skippedAllowCount = 0;
  for (const [category, rules] of Object.entries(config.permission)) {
    if (!REPO_LAW_CATEGORIES.includes(category)) {
      if (Object.keys(rules).length > 0) skippedCategories.push(category);
      continue;
    }
    for (const [pattern, action] of Object.entries(rules)) {
      if (action === "allow") {
        skippedAllowCount += 1;
        continue;
      }
      const glob = toRepoLawGlob(pattern);
      if (glob === null) {
        logger?.warn(
          `Codewhale permissions: skipping "${category}" pattern "${pattern}"; .codewhale/constitution.json holds only workspace-relative globs built from "*", "?", "**" and "{a,b}".`,
        );
        continue;
      }
      const current = restrictions.get(glob);
      if (
        current === undefined ||
        PERMISSION_ACTION_PRIORITY[action] > PERMISSION_ACTION_PRIORITY[current]
      ) {
        restrictions.set(glob, action);
      }
    }
  }
  if (skippedCategories.length > 0) {
    logger?.warn(
      `Codewhale permissions: skipping ${skippedCategories.map((category) => `"${category}"`).join(", ")} in project scope; .codewhale/constitution.json only holds file writes (use --global for ~/.codewhale/permissions.toml).`,
    );
  }
  if (skippedAllowCount > 0) {
    logger?.warn(
      `Codewhale permissions: skipping ${skippedAllowCount} allow rule(s) in project scope; .codewhale/constitution.json can only add holds.`,
    );
  }
  if (config.codewhale?.rules !== undefined && config.codewhale.rules.length > 0) {
    logger?.warn(
      'Codewhale permissions: "codewhale.rules" is written only in global scope (~/.codewhale/permissions.toml).',
    );
  }
  return restrictions;
}

function isManagedInvariant(entry: unknown): boolean {
  return isPlainObject(entry) && entry[MANAGED_BY_KEY] === MANAGED_BY_VALUE;
}

/**
 * The invariants Codewhale compiles into write holds: an object with a
 * non-empty `text`, at least one non-empty path, and an `action` of `ask`
 * (the default) or `block`.
 */
function toEnforcedInvariant(entry: unknown): EnforcedInvariant | null {
  if (!isPlainObject(entry) || typeof entry.text !== "string" || entry.text.trim() === "") {
    return null;
  }
  const action = entry.action ?? "ask";
  if ((action !== "ask" && action !== "block") || !Array.isArray(entry.paths)) {
    return null;
  }
  if (!entry.paths.every((path) => typeof path === "string")) {
    return null;
  }
  const paths = entry.paths.map((path: string) => path.trim()).filter((path) => path !== "");
  return paths.length > 0 ? { paths, action } : null;
}

/** Parse `.codewhale/constitution.json`; an empty file is an empty document. */
export function parseCodewhaleConstitution({
  fileContent,
  filePath,
}: {
  fileContent: string;
  filePath: string;
}): Record<string, unknown> {
  if (fileContent.trim() === "") {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(
      `Failed to parse existing Codewhale constitution at ${filePath}: ${formatError(error)}`,
      { cause: error },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Existing Codewhale constitution at ${filePath} is not a JSON object.`);
  }
  return parsed;
}

/**
 * Merge the canonical write restrictions into an existing constitution. Every
 * other key and every invariant rulesync did not write is kept; the invariants
 * rulesync wrote earlier are replaced. A restriction a hand-written invariant
 * already holds with the same action is not repeated.
 */
export function mergeCodewhaleConstitution({
  existing,
  config,
  logger,
}: {
  existing: Record<string, unknown>;
  config: PermissionsConfig;
  logger?: Logger;
}): Record<string, unknown> {
  const restrictions = collectRestrictions({ config, logger });
  const existingInvariants = Array.isArray(existing.protected_invariants)
    ? existing.protected_invariants
    : [];
  const keptInvariants = existingInvariants.filter((entry) => !isManagedInvariant(entry));
  const heldByHand = new Set(
    keptInvariants.flatMap((entry) => {
      const enforced = toEnforcedInvariant(entry);
      return enforced ? enforced.paths.map((path) => JSON.stringify([path, enforced.action])) : [];
    }),
  );

  const managed: ManagedInvariant[] = [];
  for (const [glob, permissionAction] of restrictions) {
    const action = toRepoLawAction(permissionAction);
    if (heldByHand.has(JSON.stringify([glob, action]))) continue;
    managed.push({
      text: invariantText({ glob, action }),
      paths: [glob],
      action,
      [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
    });
  }

  const isNewFile = Object.keys(existing).length === 0;
  if (isNewFile && managed.length === 0) {
    return {};
  }
  const invariants = [...keptInvariants, ...managed];
  const { protected_invariants: _replaced, ...rest } = existing;
  return {
    ...(isNewFile && { schema_version: CODEWHALE_CONSTITUTION_SCHEMA_VERSION }),
    ...rest,
    ...((invariants.length > 0 || existing.protected_invariants !== undefined) && {
      protected_invariants: invariants,
    }),
  };
}

/**
 * The canonical `write` / `edit` rules for the enforced invariants of a
 * constitution, hand-written ones included: each path becomes a `deny`
 * (`block`) or `ask` rule under both categories, since the hold covers every
 * write tool. The strongest action wins when paths repeat.
 */
export function codewhaleConstitutionToCanonical(
  document: Record<string, unknown>,
): PermissionsConfig["permission"] {
  const restrictions = new Map<string, PermissionAction>();
  const entries = Array.isArray(document.protected_invariants) ? document.protected_invariants : [];
  for (const entry of entries) {
    const enforced = toEnforcedInvariant(entry);
    if (!enforced) continue;
    const action: PermissionAction = enforced.action === "block" ? "deny" : "ask";
    for (const path of enforced.paths) {
      const current = restrictions.get(path);
      if (
        current === undefined ||
        PERMISSION_ACTION_PRIORITY[action] > PERMISSION_ACTION_PRIORITY[current]
      ) {
        restrictions.set(path, action);
      }
    }
  }
  if (restrictions.size === 0) {
    return {};
  }
  const rules = Object.fromEntries(restrictions);
  return { write: { ...rules }, edit: { ...rules } };
}
