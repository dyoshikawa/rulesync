import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import type { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import type { ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

export interface GeminiCliIgnoreParams extends AiFileParams {
  patterns?: string[];
  useGitignore?: boolean;
  supportsNegation?: boolean;
}

/**
 * Represents Gemini CLI Coding Assistant ignore configuration
 *
 * Gemini CLI supports two types of ignore files:
 * 1. .aiexclude (recommended) - Can be placed in any directory, affects subdirectories
 * 2. .gitignore (preview feature) - Only at root working folder
 *
 * When conflicts occur in the same file, .aiexclude takes precedence over .gitignore
 */
export class GeminiCliIgnore extends ToolIgnore {
  private readonly useGitignore: boolean;
  private readonly supportsNegation: boolean;

  constructor({
    patterns = [],
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

  toRulesyncIgnore(): RulesyncIgnore {
    return new RulesyncIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".rulesyncignore",
      body: this.patterns.join("\n"),
      fileContent: this.patterns.join("\n"),
    });
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): GeminiCliIgnore {
    const body = rulesyncIgnore.getBody();

    // Extract patterns from body
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    // Check if patterns contain negation and set supportsNegation accordingly
    const hasNegationPatterns = patterns.some((pattern) =>
      GeminiCliIgnore.isNegationPattern(pattern),
    );

    return new GeminiCliIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".aiexclude",
      patterns,
      supportsNegation: hasNegationPatterns,
      fileContent: patterns.join("\n"),
      validate: false, // Skip validation in conversion
    });
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<GeminiCliIgnore> {
    const fileContent = await readFile(filePath, "utf-8");
    const filename = basename(filePath);

    // Parse ignore patterns from file
    const patterns = fileContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    const useGitignore = filename === ".gitignore";
    const supportsNegation = !filename.endsWith(".gitignore") || filename === ".gitignore";

    // Check if patterns contain negation and adjust supportsNegation accordingly
    const hasNegationPatterns = patterns.some((pattern) =>
      GeminiCliIgnore.isNegationPattern(pattern),
    );

    // If file contains negation patterns, assume environment supports them
    const finalSupportsNegation = hasNegationPatterns || supportsNegation;

    return new GeminiCliIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: filename,
      patterns,
      useGitignore,
      supportsNegation: finalSupportsNegation,
      fileContent,
      validate: false, // Skip validation in fromFilePath as patterns may have negation
    });
  }

  generateAiexcludeContent(): string {
    const lines: string[] = [];

    // Add header comment
    lines.push("# Gemini CLI Coding Assistant Ignore File");
    lines.push("# Exclude files and directories from AI context");
    lines.push("# Syntax: same as .gitignore");
    lines.push("");

    // Filter patterns based on negation support
    const effectivePatterns = this.filterPatterns();

    if (effectivePatterns.length === 0) {
      lines.push("# No patterns specified");
      lines.push("");
      return lines.join("\n");
    }

    // Group patterns by type for better organization
    const securityPatterns = effectivePatterns.filter((pattern) => this.isSecurityPattern(pattern));
    const buildPatterns = effectivePatterns.filter((pattern) => this.isBuildPattern(pattern));
    const dataPatterns = effectivePatterns.filter((pattern) => this.isDataPattern(pattern));
    const otherPatterns = effectivePatterns.filter(
      (pattern) =>
        !this.isSecurityPattern(pattern) &&
        !this.isBuildPattern(pattern) &&
        !this.isDataPattern(pattern),
    );

    // Add security patterns
    if (securityPatterns.length > 0) {
      lines.push("# Security and Secrets");
      lines.push(...securityPatterns);
      lines.push("");
    }

    // Add build patterns
    if (buildPatterns.length > 0) {
      lines.push("# Build Artifacts and Dependencies");
      lines.push(...buildPatterns);
      lines.push("");
    }

    // Add data patterns
    if (dataPatterns.length > 0) {
      lines.push("# Data Files and Large Assets");
      lines.push(...dataPatterns);
      lines.push("");
    }

    // Add other patterns
    if (otherPatterns.length > 0) {
      lines.push("# Other Exclusions");
      lines.push(...otherPatterns);
      lines.push("");
    }

    return lines.join("\n");
  }

  private filterPatterns(): string[] {
    if (this.supportsNegation) {
      return this.patterns;
    }

    // Filter out negation patterns for Firebase Studio/IDX compatibility
    return this.patterns.filter((pattern) => !GeminiCliIgnore.isNegationPattern(pattern));
  }

  private isSecurityPattern(pattern: string): boolean {
    const securityKeywords = [
      ".env",
      "secret",
      "key",
      "pem",
      "crt",
      "p12",
      "pfx",
      "api",
      "token",
      "credential",
      "password",
      "auth",
      ".aws",
    ];
    const lowerPattern = pattern.toLowerCase();
    return securityKeywords.some((keyword) => lowerPattern.includes(keyword));
  }

  private isBuildPattern(pattern: string): boolean {
    const buildKeywords = [
      "node_modules",
      "dist",
      "build",
      "out",
      "target",
      ".cache",
      "*.log",
      "logs",
      ".tmp",
      "temp",
    ];
    const lowerPattern = pattern.toLowerCase();
    return buildKeywords.some((keyword) => lowerPattern.includes(keyword));
  }

  private isDataPattern(pattern: string): boolean {
    const dataKeywords = [
      "*.csv",
      "*.xlsx",
      "*.db",
      "*.sqlite",
      "*.mp4",
      "*.avi",
      "*.png",
      "*.jpg",
      "*.gif",
      "*.zip",
      "*.tar",
      "data",
      "datasets",
    ];
    const lowerPattern = pattern.toLowerCase();
    return dataKeywords.some((keyword) => lowerPattern.includes(keyword));
  }

  static isNegationPattern(pattern: string): boolean {
    return pattern.startsWith("!");
  }

  static getDefaultPatterns(): string[] {
    return [
      "# Secret keys and API keys",
      "*.key",
      "*.pem",
      "*.crt",
      "*.p12",
      "*.pfx",
      ".env",
      ".env.*",
      "apikeys.txt",
      "secret.env",
      "**/secrets/",
      "**/apikeys/",
      "**/*_token*",
      "**/*_secret*",
      "**/*api_key*",
      "",
      "# Build artifacts and dependencies",
      "node_modules/",
      ".pnpm-store/",
      ".yarn/",
      "dist/",
      "build/",
      "out/",
      "target/",
      "*.log",
      "logs/",
      ".cache/",
      ".tmp/",
      "temp/",
      "",
      "# Data files and large assets",
      "*.csv",
      "*.xlsx",
      "*.db",
      "*.sqlite",
      "*.mp4",
      "*.avi",
      "*.png",
      "*.jpg",
      "*.gif",
      "*.zip",
      "*.tar.gz",
      "data/",
      "datasets/",
      "",
      "# IDE and OS files",
      ".vscode/settings.json",
      ".idea/",
      "*.swp",
      "*.swo",
      ".DS_Store",
      "Thumbs.db",
    ];
  }

  static createWithDefaultPatterns(params: Partial<GeminiCliIgnoreParams> = {}): GeminiCliIgnore {
    const defaultPatterns = this.getDefaultPatterns();

    return new GeminiCliIgnore({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath || ".",
      relativeFilePath: params.relativeFilePath || ".aiexclude",
      patterns: defaultPatterns,
      fileContent: defaultPatterns.join("\n"),
      ...params,
    });
  }

  static getSupportedFileNames(): readonly string[] {
    return [".aiexclude", ".gitignore"] as const;
  }

  validate(): ValidationResult {
    const baseValidation = super.validate();
    if (!baseValidation.success) {
      return baseValidation;
    }

    // Validate Gemini CLI specific constraints
    if (!this.supportsNegation) {
      const hasNegation = this.patterns.some((pattern) =>
        GeminiCliIgnore.isNegationPattern(pattern),
      );
      if (hasNegation) {
        return {
          success: false,
          error: new Error(
            "Negation patterns are not supported in Firebase Studio/IDX environment",
          ),
        };
      }
    }

    return { success: true, error: null };
  }
}
