import { join } from "node:path";

import {
  RULESYNC_IGNORE_YAML_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { RulesyncFile, RulesyncFileParams } from "../../types/rulesync-file.js";
import { readFileContent } from "../../utils/file.js";
import { IgnoreRule, buildIgnoreYamlContent, parseIgnoreRulesFromYaml } from "./ignore-rules.js";

export type RulesyncIgnoreYamlSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export class RulesyncIgnoreYaml extends RulesyncFile {
  private readonly rules: IgnoreRule[];
  private readonly warnings: string[];

  constructor(params: RulesyncFileParams) {
    super(params);
    const parsed = parseIgnoreRulesFromYaml(this.fileContent);
    this.rules = parsed.rules;
    this.warnings = parsed.warnings;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  getRules(): IgnoreRule[] {
    return this.rules;
  }

  getWarnings(): string[] {
    return this.warnings;
  }

  static getSettablePaths(): RulesyncIgnoreYamlSettablePaths {
    return {
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_IGNORE_YAML_FILE_NAME,
    };
  }

  static async fromFile(): Promise<RulesyncIgnoreYaml> {
    const baseDir = process.cwd();
    const paths = this.getSettablePaths();
    const filePath = join(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = await readFileContent(filePath);

    return new RulesyncIgnoreYaml({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  static fromRules({
    baseDir = process.cwd(),
    rules,
  }: {
    baseDir?: string;
    rules: IgnoreRule[];
  }): RulesyncIgnoreYaml {
    const paths = this.getSettablePaths();
    return new RulesyncIgnoreYaml({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: buildIgnoreYamlContent(rules),
      validate: true,
    });
  }
}
