import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams, ToolIgnoreParams } from "./tool-ignore.js";

export interface CodexcliIgnoreParams extends Omit<ToolIgnoreParams, "patterns"> {
  patterns?: string[];
}

export class CodexcliIgnore extends ToolIgnore {
  constructor({ patterns = CodexcliIgnore.getProposedPatterns(), ...rest }: CodexcliIgnoreParams) {
    super({
      patterns,
      ...rest,
    });
  }

  toRulesyncIgnore(): RulesyncIgnore {
    // Convert Codex CLI ignore patterns to unified ignore format
    const body = this.generateIgnoreBody();

    return new RulesyncIgnore({
      baseDir: this.baseDir,
      relativeDirPath: ".rulesync/ignore",
      relativeFilePath: `${basename(this.relativeFilePath, ".codexignore")}-ignore.md`,
      frontmatter: {
        targets: ["codexcli"],
        description: `Generated from OpenAI Codex CLI ignore file: ${this.relativeFilePath}`,
      },
      body,
      fileContent: body,
    });
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): CodexcliIgnore {
    const body = rulesyncIgnore.getBody();

    // Extract patterns from body (filter out comments and empty lines)
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    return new CodexcliIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".codexignore",
      patterns,
      fileContent: patterns.join("\n"),
      validate: false, // Skip validation to allow empty patterns
    });
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<CodexcliIgnore> {
    try {
      const fileContent = await readFile(filePath, "utf-8");

      // Parse gitignore-style patterns
      const patterns = fileContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));

      const filename = basename(filePath);

      return new CodexcliIgnore({
        baseDir: ".",
        relativeDirPath: ".",
        relativeFilePath: filename,
        patterns,
        fileContent,
        validate: false, // Skip validation to allow empty patterns
      });
    } catch (error) {
      // Handle file not found gracefully - common for proposed files
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        // Return instance with proposed patterns
        return CodexcliIgnore.createWithProposedPatterns();
      }
      throw new Error(
        `Failed to read Codex CLI ignore file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private generateIgnoreBody(): string {
    const lines: string[] = [];

    lines.push("# OpenAI Codex CLI Ignore Patterns");
    lines.push("# Note: Native .codexignore support is a community request (GitHub Issue #205)");
    lines.push("# These patterns represent proposed ignore functionality");
    lines.push("");

    // Group patterns by category for better organization
    const securityPatterns = this.patterns.filter((pattern) =>
      CodexcliIgnore.isSecurityPattern(pattern),
    );
    const performancePatterns = this.patterns.filter((pattern) =>
      CodexcliIgnore.isPerformancePattern(pattern),
    );
    const otherPatterns = this.patterns.filter(
      (pattern) =>
        !CodexcliIgnore.isSecurityPattern(pattern) && !CodexcliIgnore.isPerformancePattern(pattern),
    );

    if (securityPatterns.length > 0) {
      lines.push("# Security and Sensitive Files");
      lines.push(...securityPatterns);
      lines.push("");
    }

    if (performancePatterns.length > 0) {
      lines.push("# Performance Optimization");
      lines.push(...performancePatterns);
      lines.push("");
    }

    if (otherPatterns.length > 0) {
      lines.push("# Other Exclusions");
      lines.push(...otherPatterns);
    }

    return lines.join("\n");
  }

  static getProposedPatterns(): string[] {
    return [
      ...CodexcliIgnore.getSecurityPatterns(),
      ...CodexcliIgnore.getPerformancePatterns(),
      ...CodexcliIgnore.getDevelopmentPatterns(),
    ];
  }

  static getSecurityPatterns(): string[] {
    return [
      // Environment files
      ".env",
      ".env.*",
      "!.env.example",

      // API keys and secrets
      "*.key",
      "*.pem",
      "*.p12",
      "*.pfx",
      "*.der",
      "**/apikeys/",
      "**/*_token*",
      "**/*_secret*",
      "**/*api_key*",
      "secrets/",
      "credentials/",

      // SSH keys
      "id_rsa*",
      "id_dsa*",
      "*.ppk",

      // Cloud provider credentials
      "aws-credentials.json",
      "gcp-service-account*.json",
      "azure-credentials.json",

      // Database configuration
      "database.yml",
      "**/database/config.*",

      // Infrastructure state
      "*.tfstate",
      "*.tfstate.*",
      ".terraform/",
    ];
  }

  static getPerformancePatterns(): string[] {
    return [
      // Dependencies
      "node_modules/",
      ".pnpm-store/",
      ".yarn/",
      "vendor/",
      "venv/",
      "*.egg-info/",

      // Build artifacts
      "dist/",
      "build/",
      "out/",
      "target/",
      ".next/",
      ".nuxt/",

      // Logs
      "*.log",
      "logs/",
      ".npm/_logs/",

      // Cache directories
      ".cache/",
      ".parcel-cache/",
      "node_modules/.cache/",

      // Large files
      "*.zip",
      "*.tar.gz",
      "*.rar",
      "*.mp4",
      "*.avi",
      "*.mov",
      "*.png",
      "*.jpg",
      "*.jpeg",
      "*.gif",

      // Data files
      "*.csv",
      "*.xlsx",
      "*.sqlite",
      "*.db",
      "data/",
      "datasets/",
    ];
  }

  static getDevelopmentPatterns(): string[] {
    return [
      // IDE and editor files
      ".vscode/settings.json",
      ".idea/workspace.xml",
      "*.swp",
      "*.swo",
      "*~",

      // OS files
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",

      // Test coverage
      "coverage/",
      ".nyc_output/",

      // Temporary files
      "*.tmp",
      ".tmp/",
      "temp/",
    ];
  }

  static createWithProposedPatterns(baseDir = "."): CodexcliIgnore {
    const patterns = CodexcliIgnore.getProposedPatterns();

    // Generate file content with comments
    const fileContent = [
      "# OpenAI Codex CLI Proposed Ignore File",
      "# Based on community request GitHub Issue #205",
      "# This functionality is not yet implemented in Codex CLI",
      "",
      "# Security and Sensitive Files",
      ...CodexcliIgnore.getSecurityPatterns(),
      "",
      "# Performance Optimization",
      ...CodexcliIgnore.getPerformancePatterns(),
      "",
      "# Development Files",
      ...CodexcliIgnore.getDevelopmentPatterns(),
    ].join("\n");

    return new CodexcliIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".codexignore",
      patterns,
      fileContent,
    });
  }

  static getSupportedIgnoreFileNames(): readonly string[] {
    return [".codexignore", ".aiexclude"] as const;
  }

  private static isSecurityPattern(pattern: string): boolean {
    const securityKeywords = [
      ".env",
      "key",
      "pem",
      "secret",
      "token",
      "credential",
      "ssh",
      "aws",
      "gcp",
      "azure",
      "database",
      "tfstate",
      "terraform",
    ];
    return securityKeywords.some((keyword) => pattern.toLowerCase().includes(keyword));
  }

  private static isPerformancePattern(pattern: string): boolean {
    const performanceKeywords = [
      "node_modules",
      "dist",
      "build",
      "target",
      "cache",
      "log",
      "zip",
      "tar",
      "mp4",
      "avi",
      "png",
      "jpg",
      "csv",
      "sqlite",
      "data",
    ];
    return performanceKeywords.some((keyword) => pattern.toLowerCase().includes(keyword));
  }
}
