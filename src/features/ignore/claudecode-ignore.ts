import { join } from "node:path";
import { uniq } from "es-toolkit";
import { fileExists, readFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";

export type ClaudecodeIgnoreParams = ToolIgnoreParams;

type SettingsJsonValue = {
  permissions?: {
    deny?: string[] | null;
  } | null;
};

export class ClaudecodeIgnore extends ToolIgnore {
  constructor(params: ClaudecodeIgnoreParams) {
    super(params);

    const jsonValue: SettingsJsonValue = JSON.parse(this.fileContent);
    this.patterns = jsonValue.permissions?.deny ?? [];
  }

  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".claude",
      relativeFilePath: "settings.local.json",
    };
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

    // Create the content in .rulesyncignore format (one pattern per line)
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
  }: ToolIgnoreFromRulesyncIgnoreParams): Promise<ClaudecodeIgnore> {
    const fileContent = rulesyncIgnore.getFileContent();

    const patterns = fileContent
      .split(/\r?\n|\r/)
      .map((line: string) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    const deniedValues = patterns.map((pattern) => `Read(${pattern})`);

    const filePath = join(
      baseDir,
      this.getSettablePaths().relativeDirPath,
      this.getSettablePaths().relativeFilePath,
    );
    const exists = await fileExists(filePath);
    const existingFileContent = exists ? await readFileContent(filePath) : "{}";
    const existingJsonValue: SettingsJsonValue = JSON.parse(existingFileContent);
    const jsonValue: SettingsJsonValue = {
      ...existingJsonValue,
      permissions: {
        ...existingJsonValue.permissions,
        deny: uniq([...(existingJsonValue.permissions?.deny ?? []), ...deniedValues].toSorted()),
      },
    };

    return new ClaudecodeIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: JSON.stringify(jsonValue, null, 2),
      validate: true,
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<ClaudecodeIgnore> {
    const fileContent = await readFileContent(
      join(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new ClaudecodeIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: fileContent,
      validate,
    });
  }
}
