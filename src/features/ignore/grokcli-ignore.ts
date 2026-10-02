import { join } from "node:path";

import {
  GROKCLI_DIR,
  GROKCLI_SANDBOX_FILE_NAME,
  GROKCLI_SANDBOX_PROFILE_NAME,
} from "../../constants/grokcli-paths.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { warnWithFallback } from "../../utils/logger.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  parseSharedConfig,
  type SharedConfigDocument,
  stringifySharedConfig,
} from "../shared/shared-config-gateway.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreParams,
  ToolIgnoreSettablePaths,
  ToolIgnoreSettablePathsParams,
} from "./tool-ignore.js";

export type GrokcliIgnoreParams = ToolIgnoreParams;

/** The base built-in profile the rulesync profile extends (Grok's own default). */
const GROKCLI_SANDBOX_BASE_PROFILE = "workspace";

const parseSandboxDocument = ({
  fileContent,
  filePath,
}: {
  fileContent: string;
  filePath?: string;
}): SharedConfigDocument =>
  parseSharedConfig({ format: "toml", fileContent, filePath, invalidRootPolicy: "error" });

const profilesTableOf = (document: SharedConfigDocument): Record<string, unknown> =>
  isPlainObject(document.profiles) ? document.profiles : {};

/**
 * Refuse to rewrite a sandbox file whose `profiles` key is not a table:
 * rebuilding it would silently drop whatever the user put there.
 */
const assertProfilesTable = (document: SharedConfigDocument, filePath: string): void => {
  if (document.profiles !== undefined && !isPlainObject(document.profiles)) {
    throw new Error(`Expected \`profiles\` in ${filePath} to be a table.`);
  }
};

const rulesyncProfileOf = (document: SharedConfigDocument): Record<string, unknown> | undefined => {
  const profile = profilesTableOf(document)[GROKCLI_SANDBOX_PROFILE_NAME];
  return isPlainObject(profile) ? profile : undefined;
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Grok treats an entry as a glob exactly when it contains `*`, `?` or `[`. */
const isGrokcliGlob = (entry: string): boolean => /[*?[]/.test(entry);

/**
 * Why Grok would reject a character class in `glob`, or `undefined`. Only the
 * simple subset is accepted: no literal `]` as the first member, no nested `[`
 * (which also covers POSIX `[[:…:]]`), and every class must be closed.
 */
const unsupportedCharacterClassReason = (glob: string): string | undefined => {
  let index = 0;
  while (index < glob.length) {
    if (glob[index] !== "[") {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    if (glob[cursor] === "!" || glob[cursor] === "^") cursor += 1;
    if (glob[cursor] === "]") return "a literal `]` as the first class member is not supported";
    while (cursor < glob.length && glob[cursor] !== "]") {
      if (glob[cursor] === "[") return "nested `[` and POSIX `[[:…:]]` classes are not supported";
      cursor += 1;
    }
    if (cursor >= glob.length) return "the character class is not closed";
    index = cursor + 1;
  }
  return undefined;
};

/**
 * Why Grok would reject a relative `deny` entry, or `undefined` when it
 * accepts it. Mirrors `validate_deny_glob` in Grok's sandbox crate: Grok fails
 * closed on a glob it cannot interpret identically on macOS and Linux — it
 * refuses to start the sandbox — so such an entry must never be written.
 */
const unsupportedDenyReason = (entry: string): string | undefined => {
  const segments = entry.split("/");
  if (segments.some((segment) => segment === "")) return "empty path segments are not supported";
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return "`.` and `..` path segments are not supported";
  }
  if (!isGrokcliGlob(entry)) {
    return undefined;
  }
  if (/[{}]/.test(entry)) return "brace alternation is not supported";
  if (entry.includes("\\")) return "backslash escapes are not supported";
  if (segments.some((segment) => segment.includes("**") && segment !== "**")) {
    return "`**` must be a whole path segment";
  }
  return unsupportedCharacterClassReason(entry);
};

const DESCENDANTS_SUFFIX = "/**";

/**
 * Translate one gitignore-style `.rulesync/.aiignore` pattern into Grok
 * sandbox `deny` entries, or return the reason it cannot be expressed.
 *
 * - A leading `/` (anchored to the repository root in gitignore) is dropped:
 *   Grok anchors relative entries at the workspace but reads a leading `/` as
 *   an absolute filesystem path.
 * - A pattern with no other `/` matches at any depth in gitignore, while Grok
 *   anchors relative entries at the workspace, so it gains a leading `**`
 *   segment.
 * - A glob denies only the paths it matches itself (on macOS it becomes a
 *   whole-path regex), not what lies under a matched directory, so a glob is
 *   paired with its `<glob>/**` descendants. A directory-only pattern (trailing
 *   `/`, which Grok rejects as an empty segment) keeps only the descendants.
 *   An exact entry needs neither: Grok denies an existing directory as a
 *   subpath. The pairing trades Linux headroom for macOS coverage: Linux
 *   expands each glob to its matches at launch and refuses to start past a
 *   match limit, so a large directory is best denied by an anchored pattern.
 */
export const toGrokcliDenyEntries = (
  pattern: string,
): { entries: string[]; reason?: undefined } | { entries?: undefined; reason: string } => {
  if (pattern.startsWith("!")) {
    return { reason: "negation patterns cannot be expressed as a deny list" };
  }
  const directoryOnly = pattern.endsWith("/");
  const withoutTrailingSlash = pattern.replace(/\/+$/, "");
  const body = withoutTrailingSlash.replace(/^\/+/, "");
  const anchored = body.length !== withoutTrailingSlash.length;
  if (body.length === 0) {
    return { reason: "the pattern names the whole workspace" };
  }
  const base = anchored || body.includes("/") ? body : `**/${body}`;
  const reason = unsupportedDenyReason(base);
  if (reason !== undefined) {
    return { reason };
  }
  if (!isGrokcliGlob(base) || base.endsWith(DESCENDANTS_SUFFIX)) {
    return { entries: [base] };
  }
  const descendants = `${base}${DESCENDANTS_SUFFIX}`;
  return { entries: directoryOnly ? [descendants] : [base, descendants] };
};

/** Reverse the anchoring applied by {@link toGrokcliDenyEntries}. */
const stripGrokcliDenyAnchor = (entry: string): string => {
  if (entry.startsWith("**/")) {
    const rest = entry.slice("**/".length);
    if (rest.length > 0 && !rest.includes("/")) {
      return rest;
    }
  }
  // A single-segment relative entry is anchored at the workspace root.
  return entry.includes("/") ? entry : `/${entry}`;
};

/**
 * Translate Grok sandbox `deny` entries back into `.rulesync/.aiignore`
 * patterns. Absolute paths, which a workspace-relative ignore pattern cannot
 * express, are skipped, as are entries that would read as a negation or a
 * comment in an ignore file. A `<glob>/**` entry folds into its `<glob>`
 * partner, or becomes a directory-only `<pattern>/` when it has none.
 */
const fromGrokcliDenyEntries = (entries: string[]): string[] => {
  const trimmed = entries.map((entry) => entry.trim());
  const present = new Set(trimmed);
  const patterns: string[] = [];
  for (const entry of trimmed) {
    if (entry.length === 0 || /^[/!#]/.test(entry)) {
      continue;
    }
    if (entry.endsWith(DESCENDANTS_SUFFIX)) {
      const base = entry.slice(0, -DESCENDANTS_SUFFIX.length);
      if (isGrokcliGlob(base)) {
        if (!present.has(base)) {
          patterns.push(`${stripGrokcliDenyAnchor(base)}/`);
        }
        continue;
      }
    }
    patterns.push(stripGrokcliDenyAnchor(entry));
  }
  return [...new Set(patterns)];
};

/**
 * Writes `.rulesync/.aiignore` patterns as the `deny` list of a rulesync-owned
 * custom sandbox profile, `[profiles.rulesync]`, in `.grok/sandbox.toml`
 * (project) / `~/.grok/sandbox.toml` (global). Grok Build has no ignore file;
 * a custom profile's `deny` list is its only path-deny surface, and it is
 * kernel-enforced for reads and writes.
 *
 * The deny list only takes effect while the profile is active
 * (`grok --sandbox rulesync`, `GROK_SANDBOX=rulesync`, or `[sandbox] profile`
 * in the user `config.toml`). Only the `rulesync` profile is managed: the
 * other profiles in the file are the user's and are preserved, as are any
 * extra keys the user adds to the `rulesync` profile itself.
 * @see https://docs.x.ai/build/features/sandbox
 */
export class GrokcliIgnore extends ToolIgnore {
  constructor(params: GrokcliIgnoreParams) {
    super(params);

    const document = parseSandboxDocument({ fileContent: this.fileContent });
    this.patterns = toStringArray(rulesyncProfileOf(document)?.deny);
  }

  static getSettablePaths(_params: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    // Same relative layout in both scopes: `./.grok/` and `~/.grok/`.
    return {
      relativeDirPath: GROKCLI_DIR,
      relativeFilePath: GROKCLI_SANDBOX_FILE_NAME,
    };
  }

  /** The file also holds the user's own sandbox profiles. */
  override isDeletable(): boolean {
    return false;
  }

  toRulesyncIgnore(): RulesyncIgnore {
    const rulesyncPatterns = fromGrokcliDenyEntries(this.patterns);

    return new RulesyncIgnore({
      // The rulesync source always belongs to the project, even when the
      // sandbox file it was imported from lives in the home directory.
      outputRoot: ".",
      relativeDirPath: RulesyncIgnore.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: RulesyncIgnore.getSettablePaths().recommended.relativeFilePath,
      fileContent: rulesyncPatterns.join("\n"),
    });
  }

  static async fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
    global = false,
  }: ToolIgnoreFromRulesyncIgnoreParams): Promise<GrokcliIgnore> {
    const patterns = rulesyncIgnore
      .getFileContent()
      .split(/\r?\n|\r/)
      .map((line: string) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    const denyEntries: string[] = [];
    for (const pattern of patterns) {
      const { entries, reason } = toGrokcliDenyEntries(pattern);
      if (entries === undefined) {
        warnWithFallback(
          undefined,
          `Skipping ignore pattern ${quoteValueForWarning(pattern)} for Grok CLI: ${reason}.`,
        );
        continue;
      }
      denyEntries.push(...entries);
    }

    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const document = parseSandboxDocument({ fileContent: existingContent, filePath });
    assertProfilesTable(document, filePath);

    const profiles: Record<string, unknown> = { ...profilesTableOf(document) };
    const existingProfile = rulesyncProfileOf(document);
    // With nothing to deny, an existing profile is kept with an empty list
    // rather than removed: Grok refuses to start when the profile a user
    // selected (`--sandbox rulesync`, `GROK_SANDBOX`) is unknown.
    if (denyEntries.length > 0 || existingProfile !== undefined) {
      profiles[GROKCLI_SANDBOX_PROFILE_NAME] = {
        extends: GROKCLI_SANDBOX_BASE_PROFILE,
        ...existingProfile,
        deny: [...new Set(denyEntries)],
      };
    }

    const nextDocument: SharedConfigDocument = { ...document };
    if (Object.keys(profiles).length > 0) {
      nextDocument.profiles = profiles;
    } else {
      delete nextDocument.profiles;
    }

    return new GrokcliIgnore({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: stringifySharedConfig({ format: "toml", document: nextDocument }),
      validate: true,
      global,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolIgnoreFromFileParams): Promise<GrokcliIgnore> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";

    return new GrokcliIgnore({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolIgnoreForDeletionParams): GrokcliIgnore {
    return new GrokcliIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
