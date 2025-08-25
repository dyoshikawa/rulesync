import { RulesyncRule } from "../rulesync-rule.js";

export type ValidationResult =
  | {
      success: true;
      error: null;
    }
  | {
      success: false;
      error: Error;
    };

export interface ToolRule {
  writeFile(): Promise<void>;
  validate(): ValidationResult;
  getFilePath(): string;
  getFileContent(): string;
  toRulesyncRule(): RulesyncRule;
}

export class AugmentcodeLegacyRule implements ToolRule {
  private filePath: string;
  private fileContent: string;

  private constructor(params: { filePath: string; fileContent: string }) {
    this.filePath = params.filePath;
    this.fileContent = params.fileContent;
  }

  static build(params: { filePath: string; fileContent: string }): AugmentcodeLegacyRule {
    return new AugmentcodeLegacyRule(params);
  }

  static async fromFilePath(filePath: string): Promise<AugmentcodeLegacyRule> {
    const { readFile } = await import("node:fs/promises");
    const fileContent = await readFile(filePath, "utf-8");
    return new AugmentcodeLegacyRule({ filePath, fileContent });
  }

  async writeFile(): Promise<void> {
    const { writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const { mkdir } = await import("node:fs/promises");

    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, this.fileContent, "utf-8");
  }

  validate(): ValidationResult {
    try {
      // Check if file content is valid
      if (typeof this.fileContent !== "string") {
        return {
          success: false,
          error: new Error("File content must be a string"),
        };
      }

      // Check if file path is valid
      if (!this.filePath || typeof this.filePath !== "string") {
        return {
          success: false,
          error: new Error("File path must be a non-empty string"),
        };
      }

      // AugmentCode Legacy specific: Check for .augment-guidelines file
      const expectedPath = ".augment-guidelines";
      if (!this.filePath.endsWith(expectedPath)) {
        return {
          success: false,
          error: new Error(`AugmentCode Legacy rule file must be named ${expectedPath}`),
        };
      }

      return {
        success: true,
        error: null,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  toRulesyncRule(): RulesyncRule {
    // AugmentCode Legacy uses plain markdown without frontmatter
    const rulesyncContent = this.fileContent;
    const rulesyncFilePath = this.filePath.replace(".augment-guidelines", ".rulesync.md");

    return RulesyncRule.build({
      filePath: rulesyncFilePath,
      fileContent: rulesyncContent,
    });
  }

  static fromRulesyncRule(rule: RulesyncRule): AugmentcodeLegacyRule {
    const fileContent = rule.getFileContent();
    const filePath = ".augment-guidelines";

    return new AugmentcodeLegacyRule({
      filePath,
      fileContent,
    });
  }

  getFilePath(): string {
    return this.filePath;
  }

  getFileContent(): string {
    return this.fileContent;
  }
}
