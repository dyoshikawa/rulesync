import { join } from "node:path";

import {
  FIREBENDER_CONFIG_FILE_NAME,
  getFirebenderConfigDir,
} from "../../constants/firebender-paths.js";
import { readFileContent, readFileContentOrNull } from "../../utils/file.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  parseIgnorePatterns,
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreParams,
  ToolIgnoreSettablePaths,
  ToolIgnoreSettablePathsParams,
} from "./tool-ignore.js";

function readIgnorePatterns(fileContent: string): string[] {
  const json = parseSharedConfig({ format: "json", fileContent });
  const ignore = json.ignore;
  if (!Array.isArray(ignore)) {
    return [];
  }
  return ignore.filter((pattern): pattern is string => typeof pattern === "string");
}

/**
 * Ignore generator for Firebender.
 *
 * Firebender reads gitignore-style patterns from the `ignore` array of
 * `firebender.json` (project root) and `~/.firebender/firebender.json`
 * (personal); the two lists are appended together. The file is shared with the
 * MCP (`mcpServers`) and subagents (`agents`) features and carries settings
 * rulesync does not own, so only the `ignore` key is written and the file is
 * never deleted.
 *
 * @see https://docs.firebender.com/api-reference/syntax
 */
export class FirebenderIgnore extends ToolIgnore {
  constructor(params: ToolIgnoreParams) {
    super(params);
    this.patterns = readIgnorePatterns(this.fileContent || "{}");
  }

  static getSettablePaths({
    global = false,
  }: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: getFirebenderConfigDir({ global }),
      relativeFilePath: FIREBENDER_CONFIG_FILE_NAME,
    };
  }

  /** `firebender.json` is a user-managed config file, so rulesync never deletes it. */
  override isDeletable(): boolean {
    return false;
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault({
      fileContent: this.patterns.filter((pattern) => pattern.length > 0).join("\n"),
    });
  }

  static async fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
    global = false,
  }: ToolIgnoreFromRulesyncIgnoreParams): Promise<FirebenderIgnore> {
    const patterns = parseIgnorePatterns(rulesyncIgnore.getFileContent());

    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    // `ignore` is owned wholesale by this feature, so a pattern deleted from
    // `.rulesync/.aiignore` is retracted here too. Source order is kept
    // (gitignore-style negations depend on it) with duplicates dropped, and
    // the key is removed rather than written as `[]` when no pattern is left.
    const managedPatterns = [...new Set(patterns)];

    return new FirebenderIgnore({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "ignore",
        existingContent,
        patch: { ignore: managedPatterns.length > 0 ? managedPatterns : undefined },
        filePath,
      }),
      validate: true,
      global,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolIgnoreFromFileParams): Promise<FirebenderIgnore> {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );
    return new FirebenderIgnore({
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
  }: ToolIgnoreForDeletionParams): FirebenderIgnore {
    return new FirebenderIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
