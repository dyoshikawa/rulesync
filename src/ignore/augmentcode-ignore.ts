import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams, ToolIgnoreParams } from "./tool-ignore.js";

export type AugmentcodeIgnoreParams = ToolIgnoreParams;

/**
 * AugmentCode Ignore implementation
 *
 * AugmentCode uses a two-tier approach for file exclusion:
 * 1. First pass: .gitignore patterns are evaluated (standard Git behavior)
 * 2. Second pass: .augmentignore patterns are evaluated (can re-include files)
 *
 * Key features:
 * - Single .augmentignore file at repository root
 * - Supports negation patterns (!pattern) for re-including files
 * - Works alongside Git ignore patterns
 * - Security-focused default patterns
 *
 * File format follows standard gitignore syntax:
 * - Comments start with #
 * - Blank lines are ignored
 * - Supports wildcards (*, ?, **)
 * - Leading ! negates patterns (re-includes files)
 */
export class AugmentcodeIgnore extends ToolIgnore {
  constructor({ patterns, ...rest }: AugmentcodeIgnoreParams) {
    super({
      patterns,
      ...rest,
    });
  }

  /**
   * Convert to RulesyncIgnore format
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
   * Create AugmentcodeIgnore from RulesyncIgnore
   * Supports conversion from unified rulesync format to AugmentCode specific format
   */
  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): AugmentcodeIgnore {
    const body = rulesyncIgnore.getBody();

    // Extract patterns from body (split by lines and filter empty lines/comments)
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    return new AugmentcodeIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".augmentignore",
      patterns,
      fileContent: patterns.join("\n"),
    });
  }

  /**
   * Create AugmentcodeIgnore from file path
   * Reads and parses .augmentignore file
   */
  static async fromFilePath({ filePath }: { filePath: string }): Promise<AugmentcodeIgnore> {
    const fileContent = await readFile(filePath, "utf-8");

    // Parse patterns from file content (gitignore-style format)
    // Keep negation patterns (starting with !) as they are important for AugmentCode's re-inclusion feature
    const patterns = fileContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    const filename = basename(filePath);

    return new AugmentcodeIgnore({
      baseDir: ".",
      relativeDirPath: ".augment",
      relativeFilePath: filename,
      patterns,
      fileContent,
    });
  }

  /**
   * Get default patterns for AugmentCode
   * Security-focused patterns that are safe to exclude from AI processing
   */
  static getDefaultPatterns(): string[] {
    return [
      // Security and Secrets (highest priority)
      ".env",
      ".env.*",
      "!.env.example",
      "*.pem",
      "*.key",
      "*.crt",
      "*.p12",
      "*.pfx",
      "*.der",
      "id_rsa*",
      "id_dsa*",
      "*.ppk",
      "secrets/",
      "credentials/",
      "config/secrets/",
      "**/apikeys/",
      "**/*_token*",
      "**/*_secret*",
      "**/*api_key*",

      // AWS and Cloud Credentials
      ".aws/",
      "aws-exports.js",
      "gcp-service-account*.json",
      "azure-credentials.json",

      // Database files
      "*.db",
      "*.sqlite",
      "*.sqlite3",
      "database.yml",
      "**/database/config.*",

      // Infrastructure state
      "*.tfstate",
      "*.tfstate.*",
      ".terraform/",
      "cdk.out/",
      ".serverless/",
      ".aws-sam/",

      // Build artifacts and dependencies
      "node_modules/",
      ".pnpm-store/",
      ".yarn/",
      "dist/",
      "build/",
      "out/",
      "target/",
      ".next/",
      ".nuxt/",

      // Large data files
      "*.csv",
      "*.xlsx",
      "*.sqlite",
      "*.db",
      "data/",
      "datasets/",

      // Media files
      "*.mp4",
      "*.avi",
      "*.mov",
      "*.png",
      "*.jpg",
      "*.jpeg",
      "*.gif",

      // Archives
      "*.zip",
      "*.tar.gz",
      "*.rar",

      // Logs and temporary files
      "*.log",
      "logs/",
      "*.tmp",
      ".cache/",

      // IDE and editor files
      ".vscode/settings.json",
      ".idea/",
      "*.swp",
      "*.swo",
      "*~",
      ".DS_Store",
      "Thumbs.db",
    ];
  }

  /**
   * Create AugmentcodeIgnore with default patterns
   * Useful when no ignore file exists but default protection is needed
   */
  static createWithDefaultPatterns(baseDir = "."): AugmentcodeIgnore {
    const patterns = AugmentcodeIgnore.getDefaultPatterns();

    return new AugmentcodeIgnore({
      baseDir,
      relativeDirPath: ".augment",
      relativeFilePath: ".augmentignore",
      patterns,
      fileContent: [
        "# AugmentCode Ignore File",
        "# Generated with security-focused default patterns",
        "# AugmentCode processes .gitignore first, then .augmentignore",
        "# Use !pattern to re-include files that were excluded by .gitignore",
        "",
        ...patterns,
      ].join("\n"),
    });
  }

  /**
   * Get supported ignore file names for AugmentCode
   */
  static getSupportedIgnoreFileNames(): readonly string[] {
    return [".augmentignore"] as const;
  }
}
