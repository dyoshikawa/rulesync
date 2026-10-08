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

/** More alternatives than this from one `{a,b}` pattern are not expanded. */
const MAX_BRACE_EXPANSIONS = 64;

/** Every `[...]` class of a pattern, which widens to the single-character `?`. */
const CHARACTER_CLASS = /\[[!^]?\]?[^\]]*\]/g;

/** An absolute, home-relative or drive-letter path, outside the workspace. */
const ROOTED_PATH = /^(?:\/|~|[A-Za-z]:)/;

/**
 * Printable ASCII without surrounding spaces. Codewhale trims with Rust's
 * Unicode `White_Space`, which differs from JavaScript's `trim()` (U+FEFF,
 * U+0085), so a hand-written value is compared only when both trims agree.
 */
const PLAIN_ASCII = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/;

/** An empty `{a,b}` alternative, which `globset` drops. */
const EMPTY_ALTERNATIVE = /\{[,}]|,[,}]/;

/**
 * Codewhale strips the workspace prefix and the empty and `.` segments from
 * each write target, so a pattern is compared in the same shape. `null` when a
 * `..` segment points outside the workspace.
 */
function normalizeSegments(path: string): string | null {
  const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
  return segments.includes("..") ? null : segments.join("/");
}

/**
 * Expand `{a,b}` groups (nested ones included) into separate paths, so an
 * empty alternative keeps its meaning: `globset`, which Codewhale compiles
 * `paths` with, drops empty alternatives (`.env{,.local}` would not match
 * `.env`). `null` when the braces do not balance or expand to too many paths.
 */
function expandBraces(pattern: string): string[] | null {
  const open = pattern.indexOf("{");
  if (open < 0) {
    return pattern.includes("}") ? null : [pattern];
  }
  if (pattern.slice(0, open).includes("}")) {
    return null;
  }
  let depth = 0;
  let segmentStart = open + 1;
  const alternatives: string[] = [];
  for (let index = open; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        alternatives.push(pattern.slice(segmentStart, index));
        const prefix = pattern.slice(0, open);
        const suffix = pattern.slice(index + 1);
        const expanded: string[] = [];
        for (const alternative of alternatives) {
          const paths = expandBraces(`${prefix}${alternative}${suffix}`);
          if (paths === null) return null;
          expanded.push(...paths);
          if (expanded.length > MAX_BRACE_EXPANSIONS) return null;
        }
        return expanded;
      }
    } else if (character === "," && depth === 1) {
      alternatives.push(pattern.slice(segmentStart, index));
      segmentStart = index + 1;
    }
  }
  return null;
}

/**
 * The workspace-relative glob Codewhale matches a write target against, or
 * `null` when the pattern cannot be written. A glob Codewhale cannot compile
 * makes it hold every write, so only `*`, `?` and `**` reach the file: a
 * `[...]` class widens to `?` (a restriction may only grow), `{a,b}` groups
 * are expanded by {@link toRepoLawPaths}, and a `\` escape or a control
 * character is rejected. A trailing `/` names a directory and becomes `/**`.
 * An absolute, home-relative or `..` pattern names nothing inside the
 * workspace.
 *
 * @see https://github.com/BurntSushi/ripgrep/blob/globset-0.4.20/crates/globset/src/glob.rs
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/repo_law.rs (`push_normalized`)
 */
function toRepoLawGlob(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (
    // oxlint-disable-next-line no-control-regex -- control characters are rejected on purpose
    /[\\\u0000-\u001f\u007f]/.test(trimmed) ||
    // A lone surrogate is written as an escape `serde_json` refuses to read.
    /[\uD800-\uDFFF]/u.test(trimmed) ||
    ROOTED_PATH.test(trimmed)
  ) {
    return null;
  }
  const widened = trimmed.replace(CHARACTER_CLASS, "?");
  if (/[[\]]/.test(widened)) {
    return null;
  }
  const normalized = normalizeSegments(widened.endsWith("/") ? `${widened}**` : widened);
  if (normalized === null || normalized === "" || toRepoLawPaths(normalized) === null) {
    return null;
  }
  return normalized;
}

/** The brace-free paths of a glob from {@link toRepoLawGlob}. */
function toRepoLawPaths(glob: string): string[] | null {
  const expanded = expandBraces(glob);
  if (expanded === null) {
    return null;
  }
  const paths = new Set<string>();
  for (const path of expanded) {
    if (ROOTED_PATH.test(path)) return null;
    // A trailing `/` inside a brace group names a directory too.
    const normalized = normalizeSegments(path.endsWith("/") ? `${path}**` : path);
    if (normalized === null) return null;
    if (normalized !== "") paths.add(normalized);
  }
  return paths.size > 0 ? [...paths] : null;
}

/** Keep the stronger of an existing and a new action for one key. */
function setStrongest(
  restrictions: Map<string, PermissionAction>,
  key: string,
  action: PermissionAction,
): void {
  const current = restrictions.get(key);
  if (
    current === undefined ||
    PERMISSION_ACTION_PRIORITY[action] > PERMISSION_ACTION_PRIORITY[current]
  ) {
    restrictions.set(key, action);
  }
}

function invariantText({ glob, action }: { glob: string; action: RepoLawAction }): string {
  return action === "block"
    ? `rulesync permissions: writes to ${glob} are denied`
    : `rulesync permissions: writes to ${glob} need approval`;
}

/**
 * The strongest deny / ask action per glob across the write-hold categories,
 * and the canonical patterns each glob was built from.
 */
function collectRestrictions({ config, logger }: { config: PermissionsConfig; logger?: Logger }): {
  restrictions: Map<string, PermissionAction>;
  sources: Map<string, Set<string>>;
} {
  const restrictions = new Map<string, PermissionAction>();
  const sources = new Map<string, Set<string>>();
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
          `Codewhale permissions: skipping "${category}" pattern "${pattern}"; .codewhale/constitution.json holds only workspace-relative globs without "\\" escapes, built from "*", "?", "**", "[...]" and "{a,b}".`,
        );
        continue;
      }
      setStrongest(restrictions, glob, action);
      sources.set(glob, (sources.get(glob) ?? new Set()).add(pattern.trim()));
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
  return { restrictions, sources };
}

/** Whether no range of a `[...]` class runs backwards, which `globset` rejects. */
function hasValidClassRanges(pattern: string): boolean {
  for (const [match] of pattern.matchAll(CHARACTER_CLASS)) {
    const body = [...match.slice(1, -1).replace(/^[!^]/, "")];
    for (let index = 0; index < body.length; index += 1) {
      const start = body[index] ?? "";
      const end = body[index + 2];
      if (body[index + 1] === "-" && end !== undefined) {
        if (start > end) return false;
        index += 2;
      }
    }
  }
  return true;
}

/**
 * Whether Codewhale, compiling `pattern` verbatim, holds the same paths as the
 * glob rulesync would write for it: no empty alternative, no trailing `/`,
 * only normalized segments and only valid classes. A hand-written invariant
 * with such a pattern then already holds the restriction.
 */
function isReadVerbatim(pattern: string): boolean {
  if (!PLAIN_ASCII.test(pattern) || EMPTY_ALTERNATIVE.test(pattern)) return false;
  // Inside a group, `globset` reads a `*` next to `{`, `,` or `}` differently
  // from the expanded path (`{a,**}/b` does not match `b`), and a class may
  // hold a `,`; such a pattern is never taken as already held.
  if (pattern.includes("{") && (pattern.includes("[") || /[{},]\*|\*[{},]/.test(pattern))) {
    return false;
  }
  if (!hasValidClassRanges(pattern)) return false;
  const expanded = expandBraces(pattern);
  return (
    expanded !== null &&
    expanded.every((path) => !path.endsWith("/") && normalizeSegments(path) === path)
  );
}

/**
 * The `[path, action]` keys a hand-written invariant holds in Codewhale. Only
 * plain-ASCII text and paths count, so a value Codewhale trims differently
 * (or reads as empty text, skipping the invariant) never stands in for a hold
 * rulesync would otherwise write.
 */
function heldKeys(entry: unknown): string[] {
  const enforced = toEnforcedInvariant(entry);
  if (enforced === null || !isPlainObject(entry) || !/[\x21-\x7e]/.test(String(entry.text))) {
    return [];
  }
  const paths = Array.isArray(entry.paths) ? entry.paths : [];
  return paths
    .filter((path): path is string => typeof path === "string" && PLAIN_ASCII.test(path))
    .map((path) => JSON.stringify([path, enforced.action]));
}

/**
 * Whether Codewhale parses an invariant: a string, or an object with a string
 * `text`, an optional string-array `paths` and an optional `ask` / `block`
 * `action`. One entry it cannot parse fails the whole file.
 */
function isReadableInvariant(entry: unknown): boolean {
  if (typeof entry === "string") return true;
  if (!isPlainObject(entry) || typeof entry.text !== "string") return false;
  if (
    Object.hasOwn(entry, "paths") &&
    !(Array.isArray(entry.paths) && entry.paths.every((path) => typeof path === "string"))
  ) {
    return false;
  }
  return !Object.hasOwn(entry, "action") || entry.action === "ask" || entry.action === "block";
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
  // A key Codewhale reads with `#[serde(default)]` defaults only when it is
  // absent; an explicit `null` fails to parse the whole file.
  const action = Object.hasOwn(entry, "action") ? entry.action : "ask";
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
  // Codewhale cannot read such a file, and merging would overwrite the value.
  // `null` reads as an absent list (`Option<Vec<_>>`).
  if (
    parsed.protected_invariants !== undefined &&
    parsed.protected_invariants !== null &&
    !Array.isArray(parsed.protected_invariants)
  ) {
    throw new Error(
      `Existing Codewhale constitution at ${filePath} has a "protected_invariants" that is not an array.`,
    );
  }
  return parsed;
}

/**
 * Merge the canonical write restrictions into an existing constitution. Every
 * other key and every invariant rulesync did not write is kept; the invariants
 * rulesync wrote earlier are replaced. A restriction a hand-written invariant
 * already holds with the same path spelling and action is not repeated.
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
  const { restrictions, sources } = collectRestrictions({ config, logger });
  // `parseCodewhaleConstitution` rejects a value that is not an array.
  const existingInvariants = Array.isArray(existing.protected_invariants)
    ? existing.protected_invariants
    : [];
  const keptInvariants = existingInvariants.filter((entry) => !isManagedInvariant(entry));
  const unreadableCount = keptInvariants.filter((entry) => !isReadableInvariant(entry)).length;
  if (unreadableCount > 0) {
    logger?.warn(
      `Codewhale permissions: ${unreadableCount} hand-written "protected_invariants" invariant(s) in .codewhale/constitution.json cannot be parsed by Codewhale, which then holds every write for approval until the file is fixed.`,
    );
  }
  // Codewhale only trims a hand-written pattern, so `./a` never matches the
  // normalized target `a` and must not count as holding it.
  const heldByHand = new Set(keptInvariants.flatMap(heldKeys));
  const isHeld = (path: string, action: RepoLawAction): boolean =>
    heldByHand.has(JSON.stringify([path, action]));

  const managed: ManagedInvariant[] = [];
  for (const [glob, permissionAction] of restrictions) {
    const action = toRepoLawAction(permissionAction);
    // `toRepoLawGlob` already checked that the glob expands.
    const paths = toRepoLawPaths(glob) ?? [];
    if (paths.every((path) => isHeld(path, action))) continue;
    // A pattern imported from a hand-written invariant, such as `docs/{a,b}.md`.
    const patterns = [...(sources.get(glob) ?? [])];
    // Every source must be held: `[ab]` and `[cd]` both widen to the same `?`.
    if (
      patterns.length > 0 &&
      patterns.every((pattern) => isReadVerbatim(pattern) && isHeld(pattern, action))
    ) {
      continue;
    }
    managed.push({
      text: invariantText({ glob, action }),
      paths,
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
      setStrongest(restrictions, path, action);
    }
  }
  if (restrictions.size === 0) {
    return {};
  }
  const rules = Object.fromEntries(restrictions);
  return { write: { ...rules }, edit: { ...rules } };
}
