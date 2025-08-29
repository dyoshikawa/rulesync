import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams, ToolIgnoreParams } from "./tool-ignore.js";

export interface CursorIgnoreParams extends ToolIgnoreParams {
  patterns: string[];
}

export class CursorIgnore extends ToolIgnore {
  constructor({ patterns, ...rest }: CursorIgnoreParams) {
    super({
      patterns,
      ...rest,
    });
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return new RulesyncIgnore({
      baseDir: ".",
      relativeDirPath: ".rulesync/ignore",
      relativeFilePath: `${basename(this.relativeFilePath, ".cursorignore")}.md`,
      frontmatter: {
        targets: ["cursor"],
        description: `Generated from Cursor ignore file: ${this.relativeFilePath}`,
      },
      body: this.patterns.join("\n"),
      fileContent: this.patterns.join("\n"),
    });
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): CursorIgnore {
    const body = rulesyncIgnore.getBody();

    // Extract patterns from body (split by lines and filter comments/empty lines)
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    return new CursorIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".cursorignore",
      patterns,
      fileContent: patterns.join("\n"),
    });
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<CursorIgnore> {
    // Cursor uses .cursorignore file with gitignore-style patterns
    const fileContent = await readFile(filePath, "utf-8");

    // Parse patterns from file content (filter out comments and empty lines)
    const patterns = fileContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    const filename = basename(filePath);

    return new CursorIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: filename,
      patterns,
      fileContent,
    });
  }

  static getDefaultPatterns(): string[] {
    return [
      "# Dependencies",
      "node_modules/",
      ".pnpm-store/",
      ".yarn/",
      "vendor/",
      "",
      "# Build artifacts",
      "dist/",
      "build/",
      "out/",
      "target/",
      ".next/",
      ".nuxt/",
      "",
      "# Environment files",
      ".env",
      ".env.*",
      "!.env.example",
      "",
      "# Logs and temporary files",
      "*.log",
      "*.tmp",
      "*.cache",
      "logs/",
      "",
      "# IDE and editor files",
      ".vscode/settings.json",
      ".idea/",
      "*.swp",
      "*.swo",
      "*~",
      "",
      "# OS specific files",
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",
      "",
      "# Security-sensitive files",
      "*.key",
      "*.pem",
      "*.crt",
      "*.p12",
      "*.pfx",
      "secrets/",
      "credentials/",
      "",
      "# Test coverage and artifacts",
      "coverage/",
      ".nyc_output/",
      "*.lcov",
    ];
  }

  static createWithDefaultPatterns(baseDir = "."): CursorIgnore {
    const defaultPatterns = this.getDefaultPatterns();

    return new CursorIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".cursorignore",
      patterns: defaultPatterns,
      fileContent: defaultPatterns.join("\n"),
    });
  }

  static getSupportedIgnoreFileNames(): readonly string[] {
    return [".cursorignore"] as const;
  }
}
