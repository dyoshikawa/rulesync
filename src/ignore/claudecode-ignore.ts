import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreParams } from "./tool-ignore.js";

export interface ClaudeCodeIgnoreParams extends ToolIgnoreParams {
  patterns: string[];
}

export class ClaudeCodeIgnore extends ToolIgnore {
  constructor({ patterns, ...rest }: ClaudeCodeIgnoreParams) {
    super({
      patterns,
      ...rest,
    });
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return new RulesyncIgnore({
      baseDir: ".",
      relativeDirPath: ".rulesync/ignore",
      relativeFilePath: `${basename(this.relativeFilePath, ".ignore")}.md`,
      frontmatter: {
        targets: ["claudecode"],
        description: `Generated from Claude Code ignore file: ${this.relativeFilePath}`,
      },
      body: this.patterns.join("\n"),
      fileContent: this.patterns.join("\n"),
    });
  }

  static fromRulesyncIgnore(rulesyncIgnore: RulesyncIgnore): ClaudeCodeIgnore {
    const body = rulesyncIgnore.getBody();

    // Extract patterns from body (split by lines and filter empty lines)
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    return new ClaudeCodeIgnore({
      baseDir: ".",
      relativeDirPath: ".claude",
      relativeFilePath: "settings.json",
      patterns,
      fileContent: patterns.join("\n"),
    });
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<ClaudeCodeIgnore> {
    // Claude Code uses settings.json with permission.deny patterns
    // For now, we'll read plain text patterns (future enhancement for JSON parsing)
    const fileContent = await readFile(filePath, "utf-8");

    // Parse patterns from file content
    const patterns = fileContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    const filename = basename(filePath);

    return new ClaudeCodeIgnore({
      baseDir: ".",
      relativeDirPath: ".claude",
      relativeFilePath: filename,
      patterns,
      fileContent,
    });
  }
}
