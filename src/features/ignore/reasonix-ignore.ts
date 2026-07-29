import { join } from "node:path";

import {
  REASONIX_GLOBAL_DIR,
  REASONIX_GLOBAL_PERMISSIONS_FILE_NAME,
  REASONIX_PROJECT_PERMISSIONS_FILE_NAME,
} from "../../constants/reasonix-paths.js";
import type { ClaudeSettingsJson } from "../../types/claude-settings.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  applyIgnoreReadDenies,
  buildReadDenyEntry,
  isReadDenyEntry,
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

export type ReasonixIgnoreParams = ToolIgnoreParams;

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const permissionsTableOf = (document: SharedConfigDocument): Record<string, unknown> =>
  isPlainObject(document.permissions) ? document.permissions : {};

/**
 * Reshape the parsed TOML document into the `permissions.allow/ask/deny` shape
 * {@link applyIgnoreReadDenies} operates on. Reasonix's `[permissions]` table
 * is Claude-Code-shaped (SPEC.md §3.7), so the entry-level ownership rule the
 * gateway already implements applies verbatim; only the surrounding file
 * format differs. Sibling keys such as `mode` pass through untouched.
 */
const asClaudeStyleSettings = (document: SharedConfigDocument): ClaudeSettingsJson => {
  const table = permissionsTableOf(document);
  return {
    ...document,
    permissions: {
      ...table,
      allow: toStringArray(table.allow),
      ask: toStringArray(table.ask),
      deny: toStringArray(table.deny),
    },
  };
};

/**
 * Drop a `[permissions]` table that ended up with nothing in it, so an empty
 * `.rulesyncignore` does not add a bare table header to a file that never had
 * one.
 */
const withoutEmptyPermissions = (settings: ClaudeSettingsJson): SharedConfigDocument => {
  const document = { ...settings } as SharedConfigDocument;
  const permissions = document.permissions;
  if (isPlainObject(permissions) && Object.keys(permissions).length === 0) {
    delete document.permissions;
  }
  return document;
};

/**
 * Writes `.rulesyncignore` patterns as `Read(<pattern>)` entries in the
 * `[permissions] deny` table of `reasonix.toml` (project) /
 * `~/.reasonix/config.toml` (global).
 *
 * `deny` is the right target rather than `[sandbox] forbid_read`: deny rules
 * take glob specifiers (`Edit(docs/**)`) and are "a hard block in every mode",
 * while `forbid_read` is documented as absolute paths with no glob support.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SPEC.md
 */
export class ReasonixIgnore extends ToolIgnore {
  constructor(params: ReasonixIgnoreParams) {
    super(params);

    const document = parseSharedConfig({ format: "toml", fileContent: this.fileContent });
    this.patterns = toStringArray(permissionsTableOf(document).deny);
  }

  static getSettablePaths({
    global = false,
  }: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: global ? REASONIX_GLOBAL_DIR : ".",
      relativeFilePath: global
        ? REASONIX_GLOBAL_PERMISSIONS_FILE_NAME
        : REASONIX_PROJECT_PERMISSIONS_FILE_NAME,
    };
  }

  /**
   * The config file also carries `[[plugins]]`, `[permissions]` rules from the
   * permissions feature and user-authored tables, so rulesync must never
   * delete it.
   */
  override isDeletable(): boolean {
    return false;
  }

  toRulesyncIgnore(): RulesyncIgnore {
    const rulesyncPatterns = this.patterns
      .filter((pattern) => isReadDenyEntry(pattern))
      .map((pattern) => pattern.slice("Read(".length, -1))
      .filter((pattern) => pattern.length > 0);

    return new RulesyncIgnore({
      outputRoot: this.outputRoot,
      relativeDirPath: RulesyncIgnore.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: RulesyncIgnore.getSettablePaths().recommended.relativeFilePath,
      fileContent: rulesyncPatterns.join("\n"),
    });
  }

  static async fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
    global = false,
  }: ToolIgnoreFromRulesyncIgnoreParams): Promise<ReasonixIgnore> {
    const patterns = rulesyncIgnore
      .getFileContent()
      .split(/\r?\n|\r/)
      .map((line: string) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    const readDenies = patterns.map((pattern) => buildReadDenyEntry(pattern));

    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existingDocument = parseSharedConfig({
      format: "toml",
      fileContent: existingContent,
      filePath,
    });

    // The gateway owns the `permissions.deny` merge shared with the permissions
    // feature; here we only state the intent (deny these Read patterns).
    const document = withoutEmptyPermissions(
      applyIgnoreReadDenies({
        settings: asClaudeStyleSettings(existingDocument),
        readDenies,
      }),
    );

    return new ReasonixIgnore({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: stringifySharedConfig({ format: "toml", document }),
      validate: true,
      global,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolIgnoreFromFileParams): Promise<ReasonixIgnore> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";

    return new ReasonixIgnore({
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
  }: ToolIgnoreForDeletionParams): ReasonixIgnore {
    return new ReasonixIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
