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

const rulesyncProfileOf = (document: SharedConfigDocument): Record<string, unknown> | undefined => {
  const profile = profilesTableOf(document)[GROKCLI_SANDBOX_PROFILE_NAME];
  return isPlainObject(profile) ? profile : undefined;
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/**
 * Why Grok would reject a `deny` entry, or `undefined` when it accepts it.
 * Grok fails closed on a glob it cannot interpret identically on macOS and
 * Linux — it refuses to start the sandbox — so such an entry must never be
 * written.
 */
const unsupportedDenyReason = (entry: string): string | undefined => {
  if (/[{}]/.test(entry)) return "brace alternation is not supported";
  if (entry.includes("\\")) return "backslash escapes are not supported";
  if (entry.includes("[[:") || entry.includes("[]")) {
    return "POSIX and literal-`]` character classes are not supported";
  }
  if (entry.includes("//")) return "empty path segments are not supported";
  if (entry.split("/").some((segment) => segment === "." || segment === "..")) {
    return "`.` and `..` path segments are not supported";
  }
  return undefined;
};

/**
 * Translate one gitignore-style `.rulesync/.aiignore` pattern into a Grok
 * sandbox `deny` entry, or return the reason it cannot be expressed.
 *
 * - A trailing `/` (directory-only in gitignore) is dropped: Grok rejects an
 *   empty trailing segment, and denying an existing directory already denies
 *   everything under it.
 * - A leading `/` (anchored to the repository root in gitignore) is dropped:
 *   Grok anchors relative entries at the workspace but reads a leading `/` as
 *   an absolute filesystem path.
 * - A pattern with no other `/` matches at any depth in gitignore, while Grok
 *   anchors relative entries at the workspace, so it gains a leading `**`
 *   segment.
 */
export const toGrokcliDenyEntry = (
  pattern: string,
): { entry: string; reason?: undefined } | { entry?: undefined; reason: string } => {
  if (pattern.startsWith("!")) {
    return { reason: "negation patterns cannot be expressed as a deny list" };
  }
  const withoutTrailingSlash = pattern.replace(/\/+$/, "");
  const anchored = withoutTrailingSlash.startsWith("/");
  const body = anchored ? withoutTrailingSlash.slice(1) : withoutTrailingSlash;
  if (body.length === 0) {
    return { reason: "the pattern names the whole workspace" };
  }
  const reason = unsupportedDenyReason(body);
  if (reason !== undefined) {
    return { reason };
  }
  return { entry: anchored || body.includes("/") ? body : `**/${body}` };
};

/**
 * Translate a Grok sandbox `deny` entry back into a `.rulesync/.aiignore`
 * pattern, or `undefined` for an absolute path, which a workspace-relative
 * ignore pattern cannot express.
 */
const fromGrokcliDenyEntry = (entry: string): string | undefined => {
  const trimmed = entry.trim();
  if (trimmed.length === 0 || trimmed.startsWith("/")) {
    return undefined;
  }
  if (trimmed.startsWith("**/")) {
    const rest = trimmed.slice("**/".length);
    if (rest.length > 0 && !rest.includes("/")) {
      return rest;
    }
  }
  // A single-segment relative entry is anchored at the workspace root.
  return trimmed.includes("/") ? trimmed : `/${trimmed}`;
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
    const rulesyncPatterns = this.patterns
      .map((entry) => fromGrokcliDenyEntry(entry))
      .filter((pattern): pattern is string => pattern !== undefined);

    return new RulesyncIgnore({
      // The rulesync source always belongs to the project, even when the
      // sandbox file it was imported from lives in the home directory.
      outputRoot: ".",
      relativeDirPath: RulesyncIgnore.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: RulesyncIgnore.getSettablePaths().recommended.relativeFilePath,
      fileContent: [...new Set(rulesyncPatterns)].join("\n"),
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
      const { entry, reason } = toGrokcliDenyEntry(pattern);
      if (entry === undefined) {
        warnWithFallback(
          undefined,
          `Skipping ignore pattern ${quoteValueForWarning(pattern)} for Grok CLI: ${reason}.`,
        );
        continue;
      }
      denyEntries.push(entry);
    }

    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const document = parseSandboxDocument({ fileContent: existingContent, filePath });

    const profiles: Record<string, unknown> = { ...profilesTableOf(document) };
    if (denyEntries.length > 0) {
      profiles[GROKCLI_SANDBOX_PROFILE_NAME] = {
        extends: GROKCLI_SANDBOX_BASE_PROFILE,
        ...rulesyncProfileOf(document),
        deny: [...new Set(denyEntries)],
      };
    } else {
      // Nothing to deny: retract the profile rather than leave an empty one
      // that would still be selectable and look managed.
      delete profiles[GROKCLI_SANDBOX_PROFILE_NAME];
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
