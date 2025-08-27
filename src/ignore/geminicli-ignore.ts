import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import type { ToolIgnoreFromRulesyncIgnoreParams, ToolIgnoreParams } from "./tool-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

export interface GeminiCliIgnoreParams extends ToolIgnoreParams {
  patterns: string[];
  useGitignore?: boolean;
  supportsNegation?: boolean;
}

/**
 * GeminiCliIgnore represents ignore patterns for the Gemini CLI Coding Assistant.
 *
 * Based on the Gemini CLI specification:
 * - Primary file: .aiexclude (recommended) - can be placed in any directory
 * - Secondary file: .gitignore (preview feature) - only at root
 * - Syntax: Same as .gitignore with wildcards and patterns
 * - Multiple placement: Possible with hierarchical precedence
 * - Negation patterns: Support varies by environment (Firebase Studio/IDX doesn't support)
 * - Special case: Empty .aiexclude may block everything in some environments
 */
export class GeminiCliIgnore extends ToolIgnore {
  private readonly useGitignore: boolean;
  private readonly supportsNegation: boolean;

  constructor({
    patterns,
    useGitignore = false,
    supportsNegation = true,
    ...rest
  }: GeminiCliIgnoreParams) {
    super({
      patterns,
      ...rest,
    });

    this.useGitignore = useGitignore;
    this.supportsNegation = supportsNegation;
  }

  getUseGitignore(): boolean {
    return this.useGitignore;
  }

  getSupportsNegation(): boolean {
    return this.supportsNegation;
  }

  /**
   * Convert GeminiCliIgnore to RulesyncIgnore format
   */
  toRulesyncIgnore(): RulesyncIgnore {
    const body = this.generateIgnorePatterns();

    return new RulesyncIgnore({
      baseDir: ".",
      relativeDirPath: ".rulesync/ignore",
      relativeFilePath: "geminicli.md",
      frontmatter: {
        targets: ["geminicli"],
        description: `Generated from Gemini CLI ignore file: ${this.relativeFilePath}`,
      },
      body,
      fileContent: body,
    });
  }

  /**
   * Create GeminiCliIgnore from RulesyncIgnore
   */
  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): GeminiCliIgnore {
    const body = rulesyncIgnore.getBody();

    // Extract patterns from body (split by lines and filter comments/empty lines)
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    // Determine if gitignore support is mentioned
    const useGitignore = body.includes("gitignore") || body.includes(".gitignore");

    // Check for negation patterns to determine support
    const supportsNegation = patterns.some((pattern) => pattern.startsWith("!"));

    return new GeminiCliIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".aiexclude",
      patterns,
      useGitignore,
      supportsNegation,
      fileContent: patterns.join("\n"),
    });
  }

  /**
   * Load GeminiCliIgnore from .aiexclude or .gitignore file
   */
  static async fromFilePath({ filePath }: { filePath: string }): Promise<GeminiCliIgnore> {
    const fileContent = await readFile(filePath, "utf-8");
    const filename = basename(filePath);
    const dirPath = dirname(filePath);

    // Parse patterns from file content (same as gitignore syntax)
    const patterns = fileContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    // Determine file type
    const useGitignore = filename === ".gitignore";

    // Check for negation patterns
    const supportsNegation = patterns.some((pattern) => pattern.startsWith("!"));

    return new GeminiCliIgnore({
      baseDir: ".",
      relativeDirPath: dirPath === "." ? "." : dirPath,
      relativeFilePath: filename,
      patterns,
      useGitignore,
      supportsNegation,
      fileContent,
    });
  }

  /**
   * Generate .aiexclude content
   */
  generateAiexcludeContent(): string {
    const lines: string[] = [];

    // Add header comment
    lines.push("# Gemini CLI Ignore File (.aiexclude)");
    lines.push("# Syntax: Same as .gitignore");

    if (!this.supportsNegation) {
      lines.push("# Note: Negation patterns (!) may not be supported in all environments");
    }

    lines.push("");

    // Group patterns by type
    const secretPatterns = this.patterns.filter(
      (p) => p.includes("key") || p.includes("secret") || p.includes(".env"),
    );
    const buildPatterns = this.patterns.filter(
      (p) => p.includes("build") || p.includes("dist") || p.includes("node_modules"),
    );
    const negationPatterns = this.patterns.filter((p) => p.startsWith("!"));
    const otherPatterns = this.patterns.filter(
      (p) =>
        !secretPatterns.includes(p) && !buildPatterns.includes(p) && !negationPatterns.includes(p),
    );

    if (secretPatterns.length > 0) {
      lines.push("# Secret keys and API keys");
      lines.push(...secretPatterns);
      lines.push("");
    }

    if (buildPatterns.length > 0) {
      lines.push("# Build artifacts and dependencies");
      lines.push(...buildPatterns);
      lines.push("");
    }

    if (otherPatterns.length > 0) {
      lines.push("# Other exclusions");
      lines.push(...otherPatterns);
      lines.push("");
    }

    if (negationPatterns.length > 0 && this.supportsNegation) {
      lines.push("# Negation patterns (exclusion removal)");
      lines.push(...negationPatterns);
      lines.push("");
    }

    return lines.join("\n").trimEnd();
  }

  /**
   * Generate patterns for RulesyncIgnore body
   */
  private generateIgnorePatterns(): string {
    const lines: string[] = [];

    lines.push("# Generated from Gemini CLI ignore configuration");

    if (this.useGitignore) {
      lines.push("# Using .gitignore patterns (preview feature)");
    }

    if (!this.supportsNegation && this.patterns.some((p) => p.startsWith("!"))) {
      lines.push("# Warning: Negation patterns detected but may not be supported");
    }

    lines.push("");

    // Add all patterns
    lines.push(...this.patterns);

    return lines.join("\n");
  }

  /**
   * Get default patterns commonly used for Gemini CLI projects
   * Based on best practices from the specification
   */
  static getDefaultPatterns(): string[] {
    return [
      // Secret keys and API keys (Security First principle)
      "apikeys.txt",
      "*.key",
      "*.pem",
      "*.crt",
      "*.p12",
      "*.pfx",
      "/secret.env",
      ".env*",
      "!.env.example",
      "secrets/",
      "credentials/",

      // Dependencies and build artifacts (Performance Optimization)
      "node_modules/",
      ".pnpm-store/",
      ".yarn/",
      "vendor/",
      "build/",
      "dist/",
      "out/",
      "target/",
      ".next/",
      ".nuxt/",
      "*.o",
      "*.so",
      "*.dll",
      "*.exe",

      // Large files and datasets
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
      "temp/",
      "tmp/",
      ".cache/",
      ".temp/",
      "*.tmp",
      "*.swp",
      "*.swo",
      "*~",

      // IDE and system files
      ".vscode/",
      ".idea/",
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",

      // Version control
      ".git/",
      ".svn/",
      ".hg/",

      // Test fixtures and coverage (Performance Optimization)
      "**/test-fixtures/**",
      "**/*.snap",
      "coverage/",
      ".nyc_output/",
    ];
  }

  /**
   * Create GeminiCliIgnore with default patterns
   */
  static createWithDefaultPatterns({
    baseDir = ".",
    relativeDirPath = ".",
    relativeFilePath = ".aiexclude",
    useGitignore = false,
    supportsNegation = true,
  }: {
    baseDir?: string;
    relativeDirPath?: string;
    relativeFilePath?: string;
    useGitignore?: boolean;
    supportsNegation?: boolean;
  } = {}): GeminiCliIgnore {
    const patterns = this.getDefaultPatterns();
    const fileContent = patterns.join("\n");

    return new GeminiCliIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      patterns,
      useGitignore,
      supportsNegation,
      fileContent,
    });
  }

  /**
   * Get supported ignore file names for Gemini CLI
   */
  static getSupportedIgnoreFileNames(): string[] {
    return [".aiexclude", ".gitignore"];
  }

  /**
   * Check if a pattern uses negation
   */
  static isNegationPattern(pattern: string): boolean {
    return pattern.startsWith("!");
  }

  /**
   * Filter out negation patterns if not supported
   */
  filterPatterns(): string[] {
    if (this.supportsNegation) {
      return this.patterns;
    }
    return this.patterns.filter((pattern) => !GeminiCliIgnore.isNegationPattern(pattern));
  }
}
