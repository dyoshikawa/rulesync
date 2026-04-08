import { join } from "node:path";

import { uniq } from "es-toolkit";

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

type SettingsJsonValue = {
  permissions?: {
    deny?: string[] | null;
  } | null;
};

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

const resolveFileMode = (
  options?: { fileMode?: unknown } | undefined,
): ClaudecodeIgnoreFileMode => {
  const value = options?.fileMode;
  if (value === "local") return "local";
  return "shared";
};

const fileNameForMode = (fileMode: ClaudecodeIgnoreFileMode): string => {
  return fileMode === "local" ? LOCAL_SETTINGS_FILE : SHARED_SETTINGS_FILE;
};

export class ClaudecodeIgnore extends ToolIgnore {
  constructor(params: ClaudecodeIgnoreParams) {
    super(params);

    const jsonValue: SettingsJsonValue = JSON.parse(this.fileContent);
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
   * ClaudecodeIgnore uses settings.json, which can include non-ignore settings.
   * It should not be deleted by rulesync.
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
    const existingJsonValue: SettingsJsonValue = JSON.parse(existingFileContent);
    const existingDenies = existingJsonValue.permissions?.deny ?? [];
    const preservedDenies = existingDenies.filter((deny) => {
      const isReadPattern = deny.startsWith("Read(") && deny.endsWith(")");
      if (isReadPattern) {
        return deniedValues.includes(deny);
      }

      return true;
    });

    const jsonValue: SettingsJsonValue = {
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
    const paths = this.getSettablePaths({ options });
    const fileContent = await readFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
    );

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
