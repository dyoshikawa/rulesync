import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { AiFileFromFilePathParams } from "../types/ai-file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import type { ToolIgnoreFromRulesyncIgnoreParams, ToolIgnoreParams } from "./tool-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

export interface WindsurfIgnoreParams extends Omit<ToolIgnoreParams, "patterns"> {
  patterns?: string[];
}

/**
 * Windsurf AI code editor ignore file implementation
 * Uses .codeiumignore file with gitignore-compatible syntax
 * Automatically respects .gitignore patterns and has built-in defaults for node_modules/ and hidden files
 */
export class WindsurfIgnore extends ToolIgnore {
  static readonly toolName = "windsurf";

  constructor({ patterns = WindsurfIgnore.getDefaultPatterns(), ...rest }: WindsurfIgnoreParams) {
    super({
      patterns,
      ...rest,
    });
  }

  /**
   * Get default ignore patterns for Windsurf
   */
  static getDefaultPatterns(): string[] {
    return [
      // Security and Secrets - Highest Priority
      "# ───── Secrets & Credentials ─────",
      "# Environment files",
      ".env",
      ".env.*",
      "!.env.example",
      "",
      "# Authentication credentials",
      "*.pem",
      "*.key",
      "*.crt",
      "*.p12",
      "*.pfx",
      "*.der",
      "id_rsa*",
      "id_dsa*",
      "*.ppk",
      "",
      "# Cloud provider credentials",
      ".aws/",
      "aws-exports.js",
      "gcp-service-account*.json",
      "azure-credentials.json",
      "",
      "# API keys and tokens",
      "**/apikeys/",
      "**/*_token*",
      "**/*_secret*",
      "**/*api_key*",
      "",
      "# ───── Build Artifacts & Dependencies ─────",
      "# Dependencies (built-in: node_modules/ already excluded)",
      ".pnpm-store/",
      ".yarn/",
      "vendor/",
      "",
      "# Build outputs",
      "dist/",
      "build/",
      "out/",
      "target/",
      ".next/",
      ".nuxt/",
      "",
      "# ───── Development Files ─────",
      "# IDE configurations (built-in: .* already excluded)",
      ".vscode/settings.json",
      ".idea/workspace.xml",
      "*.swp",
      "*.swo",
      "*~",
      "",
      "# Logs and temporary files",
      "*.log",
      "*.tmp",
      "logs/",
      ".cache/",
      ".parcel-cache/",
      "",
      "# ───── Large Files & Media ─────",
      "# Media files",
      "*.mp4",
      "*.avi",
      "*.mov",
      "*.png",
      "*.jpg",
      "*.jpeg",
      "*.gif",
      "",
      "# Archives and packages",
      "*.zip",
      "*.tar.gz",
      "*.rar",
      "",
      "# Data files",
      "*.csv",
      "*.xlsx",
      "*.sqlite",
      "*.db",
      "data/",
      "datasets/",
      "",
      "# ───── Infrastructure & Deployment ─────",
      "# Terraform",
      "*.tfstate",
      "*.tfstate.*",
      ".terraform/",
      "",
      "# Kubernetes secrets",
      "**/k8s/**/secret*.yaml",
      "**/kubernetes/**/secret*.yaml",
    ];
  }

  /**
   * Convert to RulesyncIgnore format
   */
  toRulesyncIgnore(): RulesyncIgnore {
    return new RulesyncIgnore({
      relativeDirPath: ".",
      relativeFilePath: ".rulesyncignore",
      body: this.patterns.join("\n"),
      fileContent: this.patterns.join("\n"),
    });
  }

  /**
   * Create WindsurfIgnore from RulesyncIgnore
   */
  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): WindsurfIgnore {
    const frontmatter = rulesyncIgnore.getFrontmatter();
    const patterns =
      frontmatter.patterns ||
      rulesyncIgnore
        .getBody()
        .split("\n")
        .filter((line) => line.trim());

    return new WindsurfIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".codeiumignore",
      patterns,
      fileContent: patterns.join("\n"),
    });
  }

  /**
   * Create WindsurfIgnore from file path
   */
  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<WindsurfIgnore> {
    const fileContent = await readFile(filePath, "utf-8");
    const patterns = fileContent
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line && !line.startsWith("#"));

    return new WindsurfIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      patterns,
      fileContent,
      validate,
    });
  }

  /**
   * Get supported file names for Windsurf ignore files
   */
  static getSupportedFileNames(): string[] {
    return [".codeiumignore"];
  }
}
