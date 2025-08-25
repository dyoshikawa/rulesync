import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { fileExists, findFiles } from "../../utils/file-utils.js";
import { ToolRuleConstructor } from "../types.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";
import { ClaudecodeRule } from "./claudecode-rule.js";

export class ClaudecodeRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }): ToolRulesProcessor {
    return new ClaudecodeRulesProcessor(params);
  }

  protected getRuleClass(): ToolRuleConstructor {
    return ClaudecodeRule as unknown;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    const paths: string[] = [];

    // CLAUDE.md
    const claudeMdFile = join(this.baseDir, "CLAUDE.md");
    if (await fileExists(claudeMdFile)) {
      paths.push(claudeMdFile);
    }

    // .claude/memories/*.md
    const claudeMemoriesDir = join(this.baseDir, ".claude", "memories");
    if (await fileExists(claudeMemoriesDir)) {
      const memoryFiles = await findFiles(claudeMemoriesDir, ".md");
      paths.push(...memoryFiles);
    }

    return paths;
  }
}
