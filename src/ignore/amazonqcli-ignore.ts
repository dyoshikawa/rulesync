import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams, ToolIgnoreParams } from "./tool-ignore.js";

export type AmazonqcliIgnoreParams = ToolIgnoreParams;

/**
 * Amazon Q CLI Ignore implementation
 *
 * Note: As of current version, Amazon Q CLI does not have native ignore file support.
 * This implementation follows the proposed .q-ignore specification based on community requests.
 * See GitHub Issue #205 for the feature request status.
 *
 * The implementation supports:
 * - Proposed .q-ignore file format (primary community request)
 * - Alternative .amazonqignore file format
 * - Fallback to proposed patterns when no ignore files exist
 * - Integration with Amazon Q's context management system
 */
export class AmazonqcliIgnore extends ToolIgnore {
  constructor({ patterns, ...rest }: AmazonqcliIgnoreParams) {
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
      relativeDirPath: ".rulesync/ignore",
      relativeFilePath: `${basename(this.relativeFilePath, ".ignore")}.md`,
      frontmatter: {
        targets: ["amazonqcli"],
        description: `Generated from Amazon Q CLI ignore file: ${this.relativeFilePath}`,
      },
      body: this.patterns.join("\n"),
      fileContent: this.patterns.join("\n"),
    });
  }

  /**
   * Create AmazonqcliIgnore from RulesyncIgnore
   * Supports conversion from unified rulesync format to Amazon Q CLI specific format
   */
  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): AmazonqcliIgnore {
    const body = rulesyncIgnore.getBody();

    // Extract patterns from body (split by lines and filter empty lines)
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    return new AmazonqcliIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".q-ignore",
      patterns,
      fileContent: patterns.join("\n"),
    });
  }

  /**
   * Create AmazonqcliIgnore from file path
   * Supports both proposed .q-ignore and .amazonqignore formats
   */
  static async fromFilePath({ filePath }: { filePath: string }): Promise<AmazonqcliIgnore> {
    const fileContent = await readFile(filePath, "utf-8");

    // Parse patterns from file content (gitignore-style format)
    const patterns = fileContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    const filename = basename(filePath);

    return new AmazonqcliIgnore({
      baseDir: ".",
      relativeDirPath: ".amazonq",
      relativeFilePath: filename,
      patterns,
      fileContent,
    });
  }

  /**
   * Get default/proposed patterns for Amazon Q CLI
   * Based on community requests and common development patterns
   */
  static getProposedPatterns(): string[] {
    return [
      // Dependencies and Modules
      "node_modules/",
      ".pnpm-store/",
      ".yarn/",
      "venv/",
      ".venv/",
      "__pycache__/",
      "vendor/bundle/",
      "go.mod",
      "go.sum",

      // Build Artifacts
      "build/",
      "dist/",
      "out/",
      "target/",
      "*.exe",
      "*.dll",
      "*.so",
      "*.dylib",
      "*.zip",
      "*.tar.gz",
      "*.rar",

      // Development Files
      ".vscode/",
      ".idea/",
      "*.swp",
      "*.swo",
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",
      "*.log",
      "logs/",

      // Data and Media Files
      "*.csv",
      "*.xlsx",
      "data/",
      "datasets/",
      "*.mp4",
      "*.avi",
      "*.png",
      "*.jpg",
      "*.jpeg",
      "*.gif",

      // Security-Sensitive Files (high priority)
      ".env",
      ".env.*",
      "!.env.example",
      "*.pem",
      "*.key",
      "*.crt",
      "secrets/",
      "credentials/",
      "config/production/",
      "config/secrets/",

      // Amazon Q specific exclusions
      ".amazonq/",
      "*.q-ignore",
      ".q-*",
    ];
  }

  /**
   * Create AmazonqcliIgnore with proposed patterns
   * Useful for when no ignore file exists yet but default protection is needed
   */
  static createWithProposedPatterns(baseDir = "."): AmazonqcliIgnore {
    const patterns = AmazonqcliIgnore.getProposedPatterns();

    return new AmazonqcliIgnore({
      baseDir,
      relativeDirPath: ".amazonq",
      relativeFilePath: ".q-ignore",
      patterns,
      fileContent: [
        "# Amazon Q CLI Ignore File",
        "# Generated with proposed patterns from community requests",
        "# See GitHub Issue #205 for status",
        "",
        ...patterns,
      ].join("\n"),
    });
  }

  /**
   * Get supported ignore file names for Amazon Q CLI
   * Based on community requests and proposed implementations
   */
  static getSupportedIgnoreFileNames(): readonly string[] {
    return [
      ".q-ignore", // Primary community request
      ".amazonqignore", // Alternative name
    ] as const;
  }
}
