import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RulesProcessor, ValidationResult } from "../types/rules-processor.js";
import { fileExists } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";

export class RulesyncRulesProcessor implements RulesProcessor {
  private rulesDir: string;

  constructor() {
    // RulesSync definitions are always placed in {projectRoot}/.rulesync/
    this.rulesDir = join(process.cwd(), ".rulesync");
  }

  static build(): RulesyncRulesProcessor {
    return new RulesyncRulesProcessor();
  }

  async generate(rule: RulesyncRule): Promise<void> {
    await mkdir(this.rulesDir, { recursive: true });
    await writeFile(rule.getFilePath(), rule.getFileContent(), "utf-8");
  }

  async validate(): Promise<ValidationResult> {
    const errors: { filePath: string; error: Error }[] = [];

    // Check if .rulesync directory exists
    if (!(await fileExists(this.rulesDir))) {
      return {
        success: false,
        errors: [
          {
            filePath: this.rulesDir,
            error: new Error(".rulesync directory does not exist"),
          },
        ],
      };
    }

    // TODO: Add more validation logic for rulesync rule files

    if (errors.length > 0) {
      return {
        success: false,
        errors,
      };
    }

    return {
      success: true,
      errors: [],
    };
  }
}
