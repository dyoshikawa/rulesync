import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/mini";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";

// Kiro ignore file configuration schema
const KiroIgnoreFileSchema = z.object({
  gitignore: z.optional(z.array(z.string())),
  aiignore: z.optional(z.array(z.string())),
  kirodeignore: z.optional(z.array(z.string())),
});

export type KiroIgnoreFile = z.infer<typeof KiroIgnoreFileSchema>;

export interface KiroIgnoreParams {
  baseDir?: string;
  relativeDirPath: string;
  gitignorePatterns?: string[];
  aiignorePatterns?: string[];
  kirodeignorePatterns?: string[];
  validate?: boolean | undefined;
  dryRun?: boolean | undefined;
}

export class KiroIgnore extends ToolIgnore {
  static readonly toolName = "kiro";

  private readonly gitignorePatterns: string[];
  private readonly aiignorePatterns: string[];
  private readonly kirodeignorePatterns: string[];
  protected readonly dryRun: boolean;

  constructor({
    baseDir = ".",
    relativeDirPath,
    gitignorePatterns = [],
    aiignorePatterns = [],
    kirodeignorePatterns = [],
    validate = true,
    dryRun = false,
  }: KiroIgnoreParams) {
    // Combine all patterns for parent class
    const allPatterns = [...gitignorePatterns, ...aiignorePatterns, ...kirodeignorePatterns];

    const fileContent = JSON.stringify(
      {
        gitignore: gitignorePatterns,
        aiignore: aiignorePatterns,
        kirodeignore: kirodeignorePatterns,
      },
      null,
      2,
    );

    super({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".kiro-ignore-config.json",
      patterns: allPatterns,
      fileContent,
      validate,
    });

    this.gitignorePatterns = gitignorePatterns;
    this.aiignorePatterns = aiignorePatterns;
    this.kirodeignorePatterns = kirodeignorePatterns;
    this.dryRun = dryRun;
  }

  getGitignorePatterns(): string[] {
    return this.gitignorePatterns;
  }

  getAiignorePatterns(): string[] {
    return this.aiignorePatterns;
  }

  getKirodeignorePatterns(): string[] {
    return this.kirodeignorePatterns;
  }

  async write(): Promise<void> {
    if (this.dryRun) {
      return;
    }

    // Write .gitignore
    const gitignoreContent = this.generateGitignoreContent();
    const gitignorePath = join(this.baseDir, ".gitignore");
    await writeFile(gitignorePath, gitignoreContent);

    // Write .aiignore
    const aiignoreContent = this.generateAiignoreContent();
    const aiignorePath = join(this.baseDir, ".aiignore");
    await writeFile(aiignorePath, aiignoreContent);

    // Write .kirodeignore
    const kirodeignoreContent = this.generateKirodeignoreContent();
    const kirodeignorePath = join(this.baseDir, ".kirodeignore");
    await writeFile(kirodeignorePath, kirodeignoreContent);
  }

  toRulesyncIgnore(): RulesyncIgnore {
    const body = this.generateCombinedIgnoreContent();

    return new RulesyncIgnore({
      baseDir: this.baseDir,
      relativeDirPath: ".rulesync/ignore",
      relativeFilePath: "kiro-ignore.md",
      frontmatter: {
        targets: ["kiro"],
        description:
          "Generated from Kiro three-file ignore system (.gitignore, .aiignore, .kirodeignore)",
      },
      body,
      fileContent: body,
    });
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): KiroIgnore {
    const body = rulesyncIgnore.getBody();

    // Extract patterns from body
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    // Distribute patterns across three files based on content
    const gitignorePatterns: string[] = [];
    const aiignorePatterns: string[] = [];
    const kirodeignorePatterns: string[] = [];

    for (const pattern of patterns) {
      if (pattern.startsWith("!")) {
        // Re-inclusion patterns go to .kirodeignore
        kirodeignorePatterns.push(pattern);
      } else if (
        pattern.includes("secret") ||
        pattern.includes("key") ||
        pattern.includes("credential") ||
        pattern.includes(".env") ||
        pattern.includes("node_modules") ||
        pattern.includes("dist/") ||
        pattern.includes("build/")
      ) {
        // Security and build patterns go to .gitignore
        gitignorePatterns.push(pattern);
      } else {
        // Other AI-specific patterns go to .aiignore
        aiignorePatterns.push(pattern);
      }
    }

    // Add default patterns
    gitignorePatterns.unshift(...KiroIgnore.getDefaultGitignorePatterns());
    aiignorePatterns.unshift(...KiroIgnore.getDefaultAiignorePatterns());
    kirodeignorePatterns.unshift(...KiroIgnore.getDefaultKirodeignorePatterns());

    return new KiroIgnore({
      baseDir,
      relativeDirPath,
      gitignorePatterns,
      aiignorePatterns,
      kirodeignorePatterns,
    });
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<KiroIgnore> {
    const fileContent = await readFile(filePath, "utf-8");
    let parsedContent: unknown;

    try {
      parsedContent = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const result = KiroIgnoreFileSchema.safeParse(parsedContent);
    if (!result.success) {
      throw new Error(`Invalid Kiro ignore file format in ${filePath}: ${result.error.message}`);
    }

    return new KiroIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      gitignorePatterns: result.data.gitignore || [],
      aiignorePatterns: result.data.aiignore || [],
      kirodeignorePatterns: result.data.kirodeignore || [],
    });
  }

  private generateGitignoreContent(): string {
    const lines: string[] = [];

    lines.push("# Generated by rulesync - Git ignore file (primary exclusions)");
    lines.push("# This file excludes sensitive and build artifacts from both Git and AI");
    lines.push("");

    // Add default .gitignore patterns
    lines.push("# ───── Secrets & Credentials ─────");
    lines.push("# Environment files");
    lines.push(".env");
    lines.push(".env.*");
    lines.push("!.env.example");
    lines.push("");

    lines.push("# Key material");
    lines.push("*.pem");
    lines.push("*.key");
    lines.push("*.crt");
    lines.push("*.p12");
    lines.push("*.pfx");
    lines.push("*.der");
    lines.push("id_rsa*");
    lines.push("id_dsa*");
    lines.push("*.ppk");
    lines.push("");

    lines.push("# AWS Credentials");
    lines.push(".aws/");
    lines.push("**/.aws/**");
    lines.push("");

    lines.push("# Infrastructure state");
    lines.push("terraform.tfstate*");
    lines.push("cdk.out/");
    lines.push("");

    lines.push("# ───── Build Artifacts ─────");
    lines.push("dist/");
    lines.push("build/");
    lines.push("target/");
    lines.push("*.log");
    lines.push("");

    lines.push("# ───── Dependencies ─────");
    lines.push("node_modules/");
    lines.push(".pnpm-store/");
    lines.push("");

    // Add custom gitignore patterns
    if (this.gitignorePatterns.length > 0) {
      lines.push("# ───── Custom patterns ─────");
      lines.push(...this.gitignorePatterns);
      lines.push("");
    }

    return lines.join("\n");
  }

  private generateAiignoreContent(): string {
    const lines: string[] = [];

    lines.push("# Generated by rulesync - AI-specific exclusions");
    lines.push("# This file excludes files that can be in Git but shouldn't be read by the AI");
    lines.push("");

    // Add default .aiignore patterns
    lines.push("# Data files AI shouldn't process");
    lines.push("*.csv");
    lines.push("*.tsv");
    lines.push("*.sqlite");
    lines.push("*.db");
    lines.push("");

    lines.push("# Large binary files");
    lines.push("*.zip");
    lines.push("*.tar.gz");
    lines.push("*.rar");
    lines.push("");

    lines.push("# Sensitive documentation");
    lines.push("internal-docs/");
    lines.push("confidential/");
    lines.push("");

    lines.push("# Test data that might confuse AI");
    lines.push("test/fixtures/large-*.json");
    lines.push("benchmark-results/");
    lines.push("");

    lines.push("# Reinforce critical exclusions from .gitignore");
    lines.push("*.pem");
    lines.push("*.key");
    lines.push(".env*");
    lines.push("");

    // Add custom aiignore patterns
    if (this.aiignorePatterns.length > 0) {
      lines.push("# ───── Custom AI exclusions ─────");
      lines.push(...this.aiignorePatterns);
      lines.push("");
    }

    return lines.join("\n");
  }

  private generateKirodeignoreContent(): string {
    const lines: string[] = [];

    lines.push("# Generated by rulesync - Re-inclusion/allowlist");
    lines.push("# This file can override previous exclusions to selectively re-include files");
    lines.push("");

    // Add default .kirodeignore patterns
    lines.push("# Re-include specific documentation the AI needs");
    lines.push("!docs/api/**");
    lines.push("!docs/architecture.md");
    lines.push("");

    lines.push("# Re-include specific test files for context");
    lines.push("!test/fixtures/example-*.json");
    lines.push("");

    lines.push("# Re-include README files everywhere");
    lines.push("!**/README.md");
    lines.push("");

    lines.push("# Re-include specific config examples");
    lines.push("!config/example.env");
    lines.push("!config/sample-*.yaml");
    lines.push("");

    // Add custom kirodeignore patterns
    if (this.kirodeignorePatterns.length > 0) {
      lines.push("# ───── Custom re-inclusions ─────");
      lines.push(...this.kirodeignorePatterns);
      lines.push("");
    }

    return lines.join("\n");
  }

  private generateCombinedIgnoreContent(): string {
    const lines: string[] = [];

    lines.push("# Kiro Three-File Ignore System");
    lines.push("");
    lines.push("This represents the combined ignore patterns from Kiro's three-file system:");
    lines.push("1. .gitignore - Primary exclusions (Git + AI)");
    lines.push("2. .aiignore - Additional AI-only exclusions");
    lines.push("3. .kirodeignore - Selective re-inclusions");
    lines.push("");

    lines.push("## .gitignore patterns");
    lines.push(...this.gitignorePatterns);
    lines.push("");

    lines.push("## .aiignore patterns");
    lines.push(...this.aiignorePatterns);
    lines.push("");

    lines.push("## .kirodeignore patterns");
    lines.push(...this.kirodeignorePatterns);

    return lines.join("\n");
  }

  static getDefaultGitignorePatterns(): string[] {
    return [
      "# Security Critical",
      "*.pem",
      "*.key",
      ".env*",
      ".aws/",
      "terraform.tfstate*",
      "",
      "# Build & Dependencies",
      "node_modules/",
      "dist/",
      "*.log",
    ];
  }

  static getDefaultAiignorePatterns(): string[] {
    return [
      "# Additional AI Exclusions",
      "*.csv",
      "*.sqlite",
      "test/fixtures/large-*.json",
      "internal-docs/",
    ];
  }

  static getDefaultKirodeignorePatterns(): string[] {
    return [
      "# Re-include for AI Context",
      "!docs/api/**",
      "!.env.example",
      "!test/fixtures/small-*.json",
    ];
  }

  static createWithDefaultPatterns(params: Partial<KiroIgnoreParams> = {}): KiroIgnore {
    const defaultGit = KiroIgnore.getDefaultGitignorePatterns();
    const defaultAi = KiroIgnore.getDefaultAiignorePatterns();
    const defaultKiro = KiroIgnore.getDefaultKirodeignorePatterns();

    return new KiroIgnore({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath || ".",
      gitignorePatterns: [...defaultGit, ...(params.gitignorePatterns || [])],
      aiignorePatterns: [...defaultAi, ...(params.aiignorePatterns || [])],
      kirodeignorePatterns: [...defaultKiro, ...(params.kirodeignorePatterns || [])],
      validate: params.validate,
      dryRun: params.dryRun,
    });
  }

  static getSupportedFileNames(): readonly string[] {
    return [".gitignore", ".aiignore", ".kirodeignore"] as const;
  }
}
