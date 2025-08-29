import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod/mini";
import { AiFileParams } from "../types/ai-file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";

// OpenCode permission schema for validation
export const OpencodePermissionsSchema = z.object({
  write: z.optional(
    z.union([
      z.enum(["allow", "ask", "deny"]),
      z.object({
        default: z.enum(["allow", "ask", "deny"]),
        patterns: z.record(z.string(), z.enum(["allow", "ask", "deny"])),
      }),
    ]),
  ),
  read: z.optional(
    z.union([
      z.enum(["allow", "ask", "deny"]),
      z.object({
        default: z.enum(["allow", "ask", "deny"]),
        patterns: z.record(z.string(), z.enum(["allow", "ask", "deny"])),
      }),
    ]),
  ),
  run: z.optional(
    z.union([
      z.enum(["allow", "ask", "deny"]),
      z.object({
        default: z.enum(["allow", "ask", "deny"]),
        patterns: z.record(z.string(), z.enum(["allow", "ask", "deny"])),
      }),
    ]),
  ),
});

export type OpencodePermissions = z.infer<typeof OpencodePermissionsSchema>;

export interface OpencodeIgnoreParams extends AiFileParams {
  permissions?: OpencodePermissions;
}

export class OpencodeIgnore extends ToolIgnore {
  private readonly permissions: OpencodePermissions;

  constructor({ permissions = {}, ...rest }: OpencodeIgnoreParams) {
    // OpenCode primarily relies on .gitignore, so return empty patterns
    super({
      patterns: [],
      ...rest,
    });

    this.permissions = permissions;
  }

  getPermissions(): OpencodePermissions {
    return this.permissions;
  }

  toRulesyncIgnore(): RulesyncIgnore {
    // Convert OpenCode permissions to unified ignore patterns
    const body = this.generateIgnorePatternsFromPermissions();

    return new RulesyncIgnore({
      baseDir: this.baseDir,
      relativeDirPath: ".rulesync/ignore",
      relativeFilePath: `${basename(this.relativeFilePath, ".json")}.md`,
      frontmatter: {
        targets: ["opencode"],
        description: `Generated from OpenCode settings: ${this.relativeFilePath}`,
      },
      body,
      fileContent: body,
    });
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): OpencodeIgnore {
    const body = rulesyncIgnore.getBody();

    // Extract patterns from body and convert to OpenCode permission rules
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    // Generate permission deny rules from patterns
    const patternRules: Record<string, "deny"> = {};
    for (const pattern of patterns) {
      patternRules[pattern] = "deny";
    }

    const permissions: OpencodePermissions = {
      read: {
        default: "allow",
        patterns: patternRules,
      },
      write: {
        default: "ask",
        patterns: patternRules,
      },
    };

    return new OpencodeIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath: "opencode.json",
      permissions,
      fileContent: JSON.stringify({ permission: permissions }, null, 2),
    });
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<OpencodeIgnore> {
    const fileContent = await readFile(filePath, "utf-8");
    let parsedContent: unknown;

    try {
      parsedContent = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Validate permissions structure
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const settingsObject = parsedContent as Record<string, unknown>;
    const permissions =
      typeof settingsObject === "object" &&
      settingsObject !== null &&
      "permission" in settingsObject
        ? settingsObject.permission || {}
        : {};
    const result = OpencodePermissionsSchema.safeParse(permissions);
    if (!result.success) {
      throw new Error(`Invalid permissions in ${filePath}: ${result.error.message}`);
    }

    const filename = basename(filePath);

    return new OpencodeIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: filename,
      permissions: result.data,
      fileContent,
    });
  }

  generateOpencodeJson(): string {
    const settings = {
      $schema: "https://opencode.ai/config.json",
      permission: this.permissions,
    };
    return JSON.stringify(settings, null, 2);
  }

  private generateIgnorePatternsFromPermissions(): string {
    const patterns: string[] = [];

    patterns.push("# Generated from OpenCode permissions");
    patterns.push("# Note: OpenCode primarily relies on .gitignore for file exclusion");
    patterns.push("");

    // Extract file patterns from read permissions
    if (
      this.permissions.read &&
      typeof this.permissions.read === "object" &&
      "patterns" in this.permissions.read
    ) {
      const readPatterns = Object.entries(this.permissions.read.patterns).filter(
        ([, permission]) => permission === "deny",
      );
      if (readPatterns.length > 0) {
        patterns.push("# Read-denied patterns");
        patterns.push(...readPatterns.map(([pattern]) => pattern));
        patterns.push("");
      }
    }

    // Extract file patterns from write permissions
    if (
      this.permissions.write &&
      typeof this.permissions.write === "object" &&
      "patterns" in this.permissions.write
    ) {
      const writePatterns = Object.entries(this.permissions.write.patterns).filter(
        ([, permission]) => permission === "deny",
      );
      if (writePatterns.length > 0) {
        patterns.push("# Write-denied patterns");
        patterns.push(...writePatterns.map(([pattern]) => pattern));
        patterns.push("");
      }
    }

    // Add OpenCode built-in exclusions as comments for reference
    patterns.push("# Built-in exclusions (handled automatically by OpenCode):");
    patterns.push(...this.getBuiltinExclusions().map((pattern) => `# ${pattern}`));

    return patterns.join("\n");
  }

  /**
   * Get built-in exclusion patterns that OpenCode handles automatically
   */
  private getBuiltinExclusions(): string[] {
    return [
      "node_modules/",
      "vendor/",
      ".pnpm-store/",
      ".*", // Hidden files and directories
      "dist/",
      "build/",
      "out/",
      "target/",
      "*.log",
      "*.tmp",
      ".cache/",
      "*.exe",
      "*.dll",
      "*.so",
      "*.dylib",
      "*.png",
      "*.jpg",
      "*.jpeg",
      "*.gif",
      "*.mp4",
      "*.avi",
      "*.zip",
      "*.tar.gz",
    ];
  }

  /**
   * Get security-focused patterns that should typically be excluded
   */
  static getSecurityPatterns(): string[] {
    return [
      ".env",
      ".env.*",
      "*.key",
      "*.pem",
      "*.crt",
      "*.p12",
      "*.pfx",
      "secrets/",
      "credentials/",
      "~/.ssh/**",
      "aws-credentials.json",
      "gcp-service-account*.json",
      "azure-credentials.json",
      "*.tfstate",
      "*.tfstate.*",
      ".terraform/",
      "database.yml",
    ];
  }

  static createWithDefaultRules(params: Partial<OpencodeIgnoreParams> = {}): OpencodeIgnore {
    const securityPatterns = this.getSecurityPatterns();
    const patternRules: Record<string, "deny"> = {};

    for (const pattern of securityPatterns) {
      patternRules[pattern] = "deny";
    }

    const defaultPermissions: OpencodePermissions = {
      read: {
        default: "allow",
        patterns: patternRules,
      },
      write: {
        default: "ask",
        patterns: patternRules,
      },
      run: "ask",
    };

    return new OpencodeIgnore({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath || ".",
      relativeFilePath: params.relativeFilePath || "opencode.json",
      permissions: defaultPermissions,
      fileContent: JSON.stringify(
        { $schema: "https://opencode.ai/config.json", permission: defaultPermissions },
        null,
        2,
      ),
      ...params,
    });
  }

  static getSupportedFileNames(): readonly string[] {
    return ["opencode.json", "AGENTS.md"] as const;
  }
}
