import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod/mini";
import { AiFileParams } from "../types/ai-file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";

// Claude Code permissions schema for validation
export const ClaudecodePermissionsSchema = z.object({
  deny: z.optional(z.array(z.string())),
  allow: z.optional(z.array(z.string())),
  additionalDirectories: z.optional(z.array(z.string())),
  defaultMode: z.optional(z.string()),
});

export type ClaudecodePermissions = z.infer<typeof ClaudecodePermissionsSchema>;

export interface ClaudecodeIgnoreParams extends AiFileParams {
  permissions?: ClaudecodePermissions;
}

export class ClaudecodeIgnore extends ToolIgnore {
  private readonly permissions: ClaudecodePermissions;

  constructor({ permissions = {}, ...rest }: ClaudecodeIgnoreParams) {
    // Extract file patterns from permission rules for the parent class
    const patterns = ClaudecodeIgnore.extractFilePatterns(permissions.deny || []);

    super({
      patterns,
      ...rest,
    });

    this.permissions = permissions;
  }

  getPermissions(): ClaudecodePermissions {
    return this.permissions;
  }

  toRulesyncIgnore(): RulesyncIgnore {
    // Convert Claude Code permissions to unified ignore patterns
    const body = this.generateIgnorePatternsFromPermissions();

    return new RulesyncIgnore({
      baseDir: this.baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".rulesyncignore",
      body,
      fileContent: body,
    });
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): ClaudecodeIgnore {
    const body = rulesyncIgnore.getBody();

    // Extract patterns from body and convert to Claude Code permission rules
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    // Generate permission deny rules from patterns
    const denyRules = patterns.map((pattern) => {
      // Convert gitignore patterns to Claude Code Edit/Read rules
      if (pattern.includes("/") || pattern.includes("*")) {
        return `Edit(${pattern})`;
      }
      return pattern;
    });

    // Add default security rules
    const permissions: ClaudecodePermissions = {
      deny: [...ClaudecodeIgnore.getDefaultDenyRules(), ...denyRules],
    };

    return new ClaudecodeIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".claude/settings.json",
      permissions,
      fileContent: JSON.stringify({ permissions }, null, 2),
    });
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<ClaudecodeIgnore> {
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
      "permissions" in settingsObject
        ? settingsObject.permissions || {}
        : {};
    const result = ClaudecodePermissionsSchema.safeParse(permissions);
    if (!result.success) {
      throw new Error(`Invalid permissions in ${filePath}: ${result.error.message}`);
    }

    const filename = basename(filePath);

    return new ClaudecodeIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: filename,
      permissions: result.data,
      fileContent,
    });
  }

  generateSettingsJson(): string {
    const settings = {
      permissions: this.permissions,
    };
    return JSON.stringify(settings, null, 2);
  }

  private generateIgnorePatternsFromPermissions(): string {
    const patterns: string[] = [];
    const denyRules = this.permissions.deny || [];

    patterns.push("# Generated from Claude Code permissions");
    patterns.push("");

    // Extract file patterns from permission rules
    const filePatterns = ClaudecodeIgnore.extractFilePatterns(denyRules);
    if (filePatterns.length > 0) {
      patterns.push("# File access restrictions");
      patterns.push(...filePatterns);
      patterns.push("");
    }

    // Add other rule types as comments for context
    const otherRules = denyRules.filter((rule) => !ClaudecodeIgnore.isFileOperationRule(rule));
    if (otherRules.length > 0) {
      patterns.push("# Other restrictions (not file patterns):");
      patterns.push(...otherRules.map((rule) => `# ${rule}`));
      patterns.push("");
    }

    return patterns.join("\n");
  }

  private static parsePermissionRule(rule: string): { type: string; pattern: string } {
    // Parse Claude Code permission rule syntax
    if (rule.startsWith("Edit(") && rule.endsWith(")")) {
      return { type: "edit", pattern: rule.slice(5, -1) };
    }
    if (rule.startsWith("Read(") && rule.endsWith(")")) {
      return { type: "read", pattern: rule.slice(5, -1) };
    }
    if (rule.startsWith("Bash(") && rule.endsWith(")")) {
      return { type: "bash", pattern: rule.slice(5, -1) };
    }
    if (rule.startsWith("WebFetch(") && rule.endsWith(")")) {
      return { type: "webfetch", pattern: rule.slice(9, -1) };
    }
    if (rule.startsWith("mcp__")) {
      return { type: "mcp", pattern: rule };
    }
    return { type: "tool", pattern: rule };
  }

  private static isFileOperationRule(rule: string): boolean {
    return rule.startsWith("Edit(") || rule.startsWith("Read(");
  }

  private static extractFilePatterns(rules: string[]): string[] {
    const patterns: string[] = [];

    for (const rule of rules) {
      const parsed = this.parsePermissionRule(rule);
      if (parsed.type === "edit" || parsed.type === "read") {
        patterns.push(parsed.pattern);
      }
    }

    return patterns;
  }

  static getDefaultDenyRules(): string[] {
    return [
      // Security-critical files
      "Edit(.env*)",
      "Read(.env*)",
      "Edit(*.key)",
      "Read(*.key)",
      "Edit(*.pem)",
      "Read(*.pem)",
      "Edit(secrets/**)",
      "Read(secrets/**)",
      "Edit(~/.ssh/**)",
      "Read(~/.ssh/**)",

      // Dangerous commands
      "Bash(rm -rf /*)",
      "Bash(sudo:*)",
      "Bash(curl:*)",
      "Bash(wget:*)",

      // System directories
      "Edit(/etc/**)",
      "Read(/etc/passwd)",
      "Read(/etc/shadow)",

      // Network restrictions
      "WebFetch",
      "WebSearch",
    ];
  }

  static createWithDefaultRules(params: Partial<ClaudecodeIgnoreParams> = {}): ClaudecodeIgnore {
    const defaultPermissions: ClaudecodePermissions = {
      deny: this.getDefaultDenyRules(),
      defaultMode: "acceptEdits",
    };

    return new ClaudecodeIgnore({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath || ".claude",
      relativeFilePath: params.relativeFilePath || "settings.json",
      permissions: defaultPermissions,
      fileContent: JSON.stringify({ permissions: defaultPermissions }, null, 2),
      ...params,
    });
  }

  static getSupportedFileNames(): readonly string[] {
    return ["settings.json", "settings.local.json", "managed-settings.json"] as const;
  }
}
