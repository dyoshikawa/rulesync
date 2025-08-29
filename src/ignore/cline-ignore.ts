import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams, ToolIgnoreParams } from "./tool-ignore.js";

export interface ClineIgnoreParams extends ToolIgnoreParams {
  patterns: string[];
}

/**
 * ClineIgnore represents ignore patterns for the Cline VSCode extension.
 *
 * Based on the Cline specification:
 * - File location: Workspace root folder only (.clineignore)
 * - Syntax: Same as .gitignore
 * - Immediate reflection when saved
 * - Complete blocking of file access for ignored patterns
 * - Shows lock icon (🔒) for ignored files in listings
 */
export class ClineIgnore extends ToolIgnore {
  constructor({ patterns, ...rest }: ClineIgnoreParams) {
    super({
      patterns,
      ...rest,
    });
  }

  /**
   * Convert ClineIgnore to RulesyncIgnore format
   */
  toRulesyncIgnore(): RulesyncIgnore {
    return new RulesyncIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".rulesyncignore",
      body: this.patterns.join("\n"),
      fileContent: this.patterns.join("\n"),
    });
  }

  /**
   * Create ClineIgnore from RulesyncIgnore
   */
  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): ClineIgnore {
    const body = rulesyncIgnore.getBody();

    // Extract patterns from body (split by lines and filter comments/empty lines)
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    return new ClineIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".clineignore",
      patterns,
      fileContent: patterns.join("\n"),
    });
  }

  /**
   * Load ClineIgnore from .clineignore file
   */
  static async fromFilePath({ filePath }: { filePath: string }): Promise<ClineIgnore> {
    const fileContent = await readFile(filePath, "utf-8");

    // Parse patterns from file content (same as gitignore syntax)
    const patterns = fileContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    const filename = basename(filePath);

    return new ClineIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: filename,
      patterns,
      fileContent,
    });
  }

  /**
   * Get default patterns commonly used for Cline projects
   * Based on best practices from the specification
   */
  static getDefaultPatterns(): string[] {
    return [
      // Large generated artifacts
      "node_modules/",
      "build/",
      "dist/",
      "out/",
      "target/",
      ".next/",
      ".nuxt/",

      // Sensitive information
      ".env",
      ".env.*",
      "!.env.example",
      "secret.json",
      "secrets/",
      "*.key",
      "*.pem",
      "*.crt",
      "*.p12",
      "*.pfx",

      // Performance optimization
      "**/test-fixtures/**",
      "**/*.snap",
      "coverage/",
      ".nyc_output/",

      // Logs and temporary files
      "*.log",
      "logs/",
      "temp/",
      "tmp/",
      ".cache/",
      ".temp/",

      // IDE and system files
      ".vscode/",
      ".idea/",
      ".DS_Store",
      "Thumbs.db",
      "*.swp",
      "*.swo",
      "*~",

      // Version control
      ".git/",
      ".svn/",
      ".hg/",

      // Package manager files that are typically not needed by AI
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
    ];
  }

  /**
   * Create ClineIgnore with default patterns
   */
  static createWithDefaultPatterns({
    baseDir = ".",
    relativeDirPath = ".",
    relativeFilePath = ".clineignore",
  }: {
    baseDir?: string;
    relativeDirPath?: string;
    relativeFilePath?: string;
  } = {}): ClineIgnore {
    const patterns = this.getDefaultPatterns();
    const fileContent = patterns.join("\n");

    return new ClineIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      patterns,
      fileContent,
    });
  }

  /**
   * Get supported ignore file names for Cline
   */
  static getSupportedIgnoreFileNames(): string[] {
    return [".clineignore"];
  }
}
