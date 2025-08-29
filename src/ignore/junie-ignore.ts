import { readFile } from "node:fs/promises";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

/**
 * JetBrains Junie ignore file implementation.
 * Supports .aiignore files for controlling AI file access.
 */
interface JunieIgnoreParams {
  baseDir?: string;
  relativeDirPath?: string;
  relativeFilePath?: string;
  patterns: string[];
  fileContent?: string;
  validate?: boolean;
}

export class JunieIgnore extends ToolIgnore {
  static readonly toolName = "junie";
  static readonly fileName = ".aiignore";

  constructor({
    baseDir = ".",
    relativeDirPath = ".",
    relativeFilePath = ".aiignore",
    patterns,
    fileContent,
    validate = true,
  }: JunieIgnoreParams) {
    const content = fileContent || JunieIgnore.generateDefaultContent(patterns);

    super({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      patterns,
      fileContent: content,
      validate,
    });
  }

  toRulesyncIgnore(): RulesyncIgnore {
    const body = this.patterns.join("\n");

    return new RulesyncIgnore({
      baseDir: this.baseDir,
      relativeDirPath: ".rulesync/ignore",
      relativeFilePath: "junie-ignore.md",
      frontmatter: {
        targets: ["junie"],
        description: "JetBrains Junie AI ignore file for controlling file access and privacy",
      },
      body,
      fileContent: body,
    });
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath = ".",
    rulesyncIgnore,
  }: {
    baseDir?: string;
    relativeDirPath?: string;
    rulesyncIgnore: RulesyncIgnore;
  }): JunieIgnore {
    const body = rulesyncIgnore.getBody();
    const patterns = body
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && !line.startsWith("#"));

    return new JunieIgnore({
      baseDir,
      relativeDirPath,
      patterns,
    });
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<JunieIgnore> {
    const content = await readFile(filePath, "utf-8");

    const patterns = content
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && !line.startsWith("#"));

    return new JunieIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      patterns,
      fileContent: content,
    });
  }

  static getDefaultPatterns(): string[] {
    return [
      "# Secrets & Credentials",
      "*.pem",
      "*.key",
      "*.crt",
      "*.p12",
      "*.pfx",
      "*.der",
      "id_rsa*",
      "id_dsa*",
      "",
      "# Environment files",
      ".env",
      ".env.*",
      "!.env.example",
      "",
      "# Build artifacts",
      "build/",
      "dist/",
      "out/",
      "target/",
      "",
      "# Dependencies",
      "node_modules/",
      ".pnpm-store/",
      ".yarn/",
      "",
      "# IDE and editor files",
      ".vscode/settings.json",
      ".idea/",
      "*.swp",
      "*.swo",
      "",
      "# Logs and temporary files",
      "*.log",
      "logs/",
      "*.tmp",
      ".cache/",
      "",
      "# Data files",
      "*.csv",
      "*.xlsx",
      "*.json",
      "data/",
      "datasets/",
      "",
      "# Media files",
      "*.mp4",
      "*.avi",
      "*.png",
      "*.jpg",
      "*.jpeg",
      "*.gif",
      "",
      "# Large test files",
      "test-data/",
      "fixtures/large-*",
      "",
      "# AWS credentials",
      ".aws/",
      "**/.aws/**",
      "",
      "# Infrastructure state",
      "terraform.tfstate*",
      "cdk.out/",
      "",
      "# Generic secret patterns",
      "**/*secret*.json",
      "**/*secrets*.yml",
      "**/config/**/prod*.yaml",
      "",
      "# Security-sensitive documentation",
      "internal-docs/",
      "confidential/",
      "",
      "# Test data that might confuse AI",
      "test/fixtures/large-*.json",
      "benchmark-results/",
      "",
      "# Source Control Metadata",
      ".git/",
      ".svn/",
      ".hg/",
      "*.iml",
      "",
      "# OS specific files",
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",
    ];
  }

  static createWithDefaultPatterns(params: Partial<JunieIgnoreParams> = {}): JunieIgnore {
    return new JunieIgnore({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath || ".",
      patterns: [...JunieIgnore.getDefaultPatterns(), ...(params.patterns || [])],
    });
  }

  static generateDefaultContent(customPatterns: string[] = []): string {
    const lines: string[] = [];

    lines.push("# JetBrains Junie AI ignore file");
    lines.push("# Controls which files the AI can access automatically");
    lines.push("# Syntax identical to .gitignore");
    lines.push("");

    // Add default patterns
    lines.push(...JunieIgnore.getDefaultPatterns());

    // Add custom patterns
    if (customPatterns.length > 0) {
      lines.push("");
      lines.push("# Custom patterns");
      lines.push(...customPatterns);
    }

    return lines.join("\n") + "\n";
  }

  static getSupportedFileNames(): readonly string[] {
    return [".aiignore", ".cursorignore", ".codeiumignore", ".aiexclude", ".noai"] as const;
  }
}
