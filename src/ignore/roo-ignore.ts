import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams, ToolIgnoreParams } from "./tool-ignore.js";

export type RooIgnoreParams = {
  patterns: string[];
} & ToolIgnoreParams;

/**
 * RooIgnore represents ignore patterns for the Roo Code AI coding assistant.
 *
 * Based on the Roo Code specification:
 * - File location: Workspace root folder only (.rooignore)
 * - Syntax: Same as .gitignore (fully compatible)
 * - Immediate reflection when saved (no restart required)
 * - Self-protection: .rooignore itself is always implicitly ignored
 * - Strict blocking: Both read and write operations are prohibited
 * - Visual indicators: Shows lock icon (🔒) when showRooIgnoredFiles=true
 * - Bypass mechanism: Explicit @/path/to/file mentions bypass ignore rules
 * - Support started: Official support in Roocode 3.8 (2025-03-13)
 */
export class RooIgnore extends ToolIgnore {
  constructor({ patterns, ...rest }: RooIgnoreParams) {
    super({
      patterns,
      ...rest,
    });
  }

  /**
   * Convert RooIgnore to RulesyncIgnore format
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
   * Create RooIgnore from RulesyncIgnore
   */
  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): RooIgnore {
    const body = rulesyncIgnore.getBody();

    // Extract patterns from body (split by lines and filter comments/empty lines)
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    return new RooIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".rooignore",
      patterns,
      fileContent: patterns.join("\n"),
    });
  }

  /**
   * Load RooIgnore from .rooignore file
   */
  static async fromFilePath({ filePath }: { filePath: string }): Promise<RooIgnore> {
    const fileContent = await readFile(filePath, "utf-8");

    // Parse patterns from file content (same as gitignore syntax)
    const patterns = fileContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    const filename = basename(filePath);

    return new RooIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: filename,
      patterns,
      fileContent,
    });
  }

  /**
   * Get default patterns commonly used for Roo projects
   * Based on best practices from the specification and security guidelines
   */
  static getDefaultPatterns(): string[] {
    return [
      // Large generated artifacts and dependencies
      "node_modules/",
      "build/",
      "dist/",
      "out/",
      "target/",
      ".next/",
      ".nuxt/",

      // Sensitive information and secrets
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
      "apikeys.txt",
      "**/apikeys/",
      "**/*_token*",
      "**/*_secret*",
      "**/*api_key*",

      // Large files over 40KB as recommended by specification
      "*.png",
      "*.jpg",
      "*.jpeg",
      "*.gif",
      "*.svg",
      "*.mp4",
      "*.avi",
      "*.mov",
      "*.pdf",
      "*.zip",
      "*.tar.gz",
      "*.rar",

      // Performance optimization - test fixtures and generated files
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

      // Database files
      "*.db",
      "*.sqlite",
      "*.sqlite3",

      // Cloud provider credentials
      ".aws/",
      "aws-exports.js",
      "gcp-service-account*.json",
      "azure-credentials.json",
    ];
  }

  /**
   * Create RooIgnore with default patterns
   */
  static createWithDefaultPatterns({
    baseDir = ".",
    relativeDirPath = ".",
    relativeFilePath = ".rooignore",
  }: {
    baseDir?: string;
    relativeDirPath?: string;
    relativeFilePath?: string;
  } = {}): RooIgnore {
    const patterns = this.getDefaultPatterns();
    const fileContent = patterns.join("\n");

    return new RooIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      patterns,
      fileContent,
    });
  }

  /**
   * Get supported ignore file names for Roo Code
   */
  static getSupportedIgnoreFileNames(): string[] {
    return [".rooignore"];
  }
}
