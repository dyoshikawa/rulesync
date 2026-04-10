import { join } from "node:path";

import { uniq } from "es-toolkit";
import { z } from "zod/mini";

import type { ClaudeSettingsJson } from "../../types/claude-settings.js";
import { FeatureOptions } from "../../types/features.js";
import { fileExists, readFileContent } from "../../utils/file.js";
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

export type ClaudecodeIgnoreParams = ToolIgnoreParams;

/**
 * Controls which Claude Code settings file the ignore feature writes to.
 *
 * - `"shared"` (default): writes to `.claude/settings.json` so the deny list
 *   can be committed and shared across the team.
 * - `"local"`: writes to `.claude/settings.local.json`, which is ignored by
 *   git by default and intended for per-developer overrides.
 *
 * History: prior to v7.x the ignore feature wrote to `settings.local.json`;
 * see issue #1094 for the move to shared `settings.json` and #1374 for the
 * follow-up that added this opt-out.
 */
export type ClaudecodeIgnoreFileMode = "shared" | "local";

const SHARED_SETTINGS_FILE = "settings.json";
const LOCAL_SETTINGS_FILE = "settings.local.json";
const DEFAULT_FILE_MODE: ClaudecodeIgnoreFileMode = "shared";

/**
 * Schema for the per-feature options object that may be passed via
 * `features.claudecode.ignore = { fileMode: "local" }`. Unknown keys are
 * preserved (`z.looseObject`) so future tools can add their own keys without
 * a coordinated migration, but `fileMode`, when present, must be one of the
 * known literals — typos like `"LOCAL"` or `"private"` are rejected loudly
 * rather than silently falling back to `"shared"`.
 */
const ClaudecodeIgnoreOptionsSchema = z.looseObject({
  fileMode: z.optional(z.enum(["shared", "local"])),
});

const resolveFileMode = (options?: FeatureOptions | undefined): ClaudecodeIgnoreFileMode => {
  if (!options) return DEFAULT_FILE_MODE;
  const parsed = ClaudecodeIgnoreOptionsSchema.safeParse(options);
  if (!parsed.success) {
    throw new Error(
      `Invalid options for claudecode ignore feature: ${parsed.error.message}. ` +
        `\`fileMode\` must be either "shared" or "local".`,
    );
  }
  return parsed.data.fileMode ?? DEFAULT_FILE_MODE;
};

const fileNameForMode = (fileMode: ClaudecodeIgnoreFileMode): string => {
  return fileMode === "local" ? LOCAL_SETTINGS_FILE : SHARED_SETTINGS_FILE;
};

export class ClaudecodeIgnore extends ToolIgnore {
  constructor(params: ClaudecodeIgnoreParams) {
    super(params);

    const jsonValue: ClaudeSettingsJson = JSON.parse(this.fileContent);
    this.patterns = jsonValue.permissions?.deny ?? [];
  }

  static getSettablePaths(params?: ToolIgnoreSettablePathsParams): ToolIgnoreSettablePaths {
    const fileMode = resolveFileMode(params?.options);
    return {
      relativeDirPath: ".claude",
      relativeFilePath: fileNameForMode(fileMode),
    };
  }

  /**
   * ClaudecodeIgnore uses settings.json (or settings.local.json), which can
   * include non-ignore settings. It should not be deleted by rulesync.
   *
   * NOTE: Because this returns `false`, switching `fileMode` (e.g. from
   * `"local"` to `"shared"`) will not automatically clean up deny patterns
   * in the previously-used file. Users must manually remove stale deny
   * entries from the old file when changing `fileMode`.
   */
  override isDeletable(): boolean {
    return false;
  }

  toRulesyncIgnore(): RulesyncIgnore {
    // Convert ClaudecodeIgnore patterns to RulesyncIgnore format
    // ClaudecodeIgnore stores patterns as "Read(pattern)" in JSON
    // RulesyncIgnore expects plain patterns in text format
    const rulesyncPatterns = this.patterns
      .map((pattern) => {
        // Remove "Read(" prefix and ")" suffix if present
        if (pattern.startsWith("Read(") && pattern.endsWith(")")) {
          return pattern.slice(5, -1);
        }
        return pattern;
      })
      .filter((pattern) => pattern.length > 0);

    // Create the content in .rulesync/.aiignore format (one pattern per line)
    const fileContent = rulesyncPatterns.join("\n");

    return new RulesyncIgnore({
      baseDir: this.baseDir,
      relativeDirPath: RulesyncIgnore.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: RulesyncIgnore.getSettablePaths().recommended.relativeFilePath,
      fileContent,
    });
  }

  static async fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore,
    options,
  }: ToolIgnoreFromRulesyncIgnoreParams): Promise<ClaudecodeIgnore> {
    const fileContent = rulesyncIgnore.getFileContent();

    const patterns = fileContent
      .split(/\r?\n|\r/)
      .map((line: string) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    const deniedValues = patterns.map((pattern) => `Read(${pattern})`);

    const paths = this.getSettablePaths({ options });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const exists = await fileExists(filePath);
    const existingFileContent = exists ? await readFileContent(filePath) : "{}";
    const existingJsonValue: ClaudeSettingsJson = JSON.parse(existingFileContent);
    const existingDenies = existingJsonValue.permissions?.deny ?? [];
    const preservedDenies = existingDenies.filter((deny) => {
      const isReadPattern = deny.startsWith("Read(") && deny.endsWith(")");
      if (isReadPattern) {
        return deniedValues.includes(deny);
      }

      return true;
    });

    const jsonValue: ClaudeSettingsJson = {
      ...existingJsonValue,
      permissions: {
        ...existingJsonValue.permissions,
        deny: uniq([...preservedDenies, ...deniedValues].toSorted()),
      },
    };

    return new ClaudecodeIgnore({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(jsonValue, null, 2),
      validate: true,
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    options,
  }: ToolIgnoreFromFileParams): Promise<ClaudecodeIgnore> {
    const fileMode = resolveFileMode(options);
    const paths = this.getSettablePaths({ options });
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    // When `fileMode: "local"` is configured but the user has not yet created
    // `.claude/settings.local.json` (a common case during `rulesync import`),
    // gracefully fall back to an empty settings document instead of throwing.
    // For "shared" mode, missing settings.json is still an error — it should
    // exist if the user has configured shared ignore patterns.
    const exists = await fileExists(filePath);
    if (!exists && fileMode === "shared") {
      throw new Error(`File not found: ${filePath}`);
    }
    const fileContent = exists ? await readFileContent(filePath) : "{}";

    return new ClaudecodeIgnore({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: fileContent,
      validate,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolIgnoreForDeletionParams): ClaudecodeIgnore {
    return new ClaudecodeIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
