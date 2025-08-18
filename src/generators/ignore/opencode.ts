import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";

export interface OpenCodePermissionConfig {
  permission?: {
    read?: {
      default?: "allow" | "ask" | "deny";
      patterns?: Record<string, "allow" | "ask" | "deny">;
    };
    write?: {
      default?: "allow" | "ask" | "deny";
      patterns?: Record<string, "allow" | "ask" | "deny">;
    };
    run?: {
      default?: "allow" | "ask" | "deny";
      patterns?: Record<string, "allow" | "ask" | "deny">;
    };
  };
}

export interface OpenCodeConfig extends OpenCodePermissionConfig {
  $schema: string;
}

/**
 * Extract OpenCode-specific permission patterns from rule content
 */
function extractOpenCodePermissionPatterns(
  content: string,
): OpenCodePermissionConfig["permission"] {
  const permission: OpenCodePermissionConfig["permission"] = {};

  // Extract permission patterns from rule content
  const permissionBlocks = content.match(/```(?:json|javascript)\s*\n([\s\S]*?)\n```/g);
  if (permissionBlocks) {
    for (const block of permissionBlocks) {
      try {
        const jsonContent = block.replace(/```(?:json|javascript)\s*\n/, "").replace(/\n```$/, "");
        const parsed = JSON.parse(jsonContent);

        if (parsed.permission) {
          // Merge permission configurations
          if (parsed.permission.read) {
            permission.read = permission.read || {};
            Object.assign(permission.read, parsed.permission.read);
          }
          if (parsed.permission.write) {
            permission.write = permission.write || {};
            Object.assign(permission.write, parsed.permission.write);
          }
          if (parsed.permission.run) {
            permission.run = permission.run || {};
            Object.assign(permission.run, parsed.permission.run);
          }
        }
      } catch {
        // Ignore invalid JSON blocks
      }
    }
  }

  return Object.keys(permission).length > 0 ? permission : undefined;
}

/**
 * Generate OpenCode configuration with permissions
 */
function generateOpenCodeConfiguration(rules: ParsedRule[]): OpenCodeConfig {
  const config: OpenCodeConfig = {
    $schema: "https://opencode.ai/config.json",
  };

  // Extract permission configurations from rules
  const allPermissions: OpenCodePermissionConfig["permission"] = {};

  for (const rule of rules) {
    const rulePermissions = extractOpenCodePermissionPatterns(rule.content);
    if (rulePermissions) {
      // Merge read permissions
      if (rulePermissions.read) {
        allPermissions.read = allPermissions.read || {};
        if (rulePermissions.read.default) {
          allPermissions.read.default = rulePermissions.read.default;
        }
        if (rulePermissions.read.patterns) {
          allPermissions.read.patterns = {
            ...allPermissions.read.patterns,
            ...rulePermissions.read.patterns,
          };
        }
      }

      // Merge write permissions
      if (rulePermissions.write) {
        allPermissions.write = allPermissions.write || {};
        if (rulePermissions.write.default) {
          allPermissions.write.default = rulePermissions.write.default;
        }
        if (rulePermissions.write.patterns) {
          allPermissions.write.patterns = {
            ...allPermissions.write.patterns,
            ...rulePermissions.write.patterns,
          };
        }
      }

      // Merge run permissions
      if (rulePermissions.run) {
        allPermissions.run = allPermissions.run || {};
        if (rulePermissions.run.default) {
          allPermissions.run.default = rulePermissions.run.default;
        }
        if (rulePermissions.run.patterns) {
          allPermissions.run.patterns = {
            ...allPermissions.run.patterns,
            ...rulePermissions.run.patterns,
          };
        }
      }
    }
  }

  // Add default security permissions if none specified
  if (Object.keys(allPermissions).length === 0) {
    allPermissions.read = {
      default: "allow",
      patterns: {
        "**/.env*": "deny",
        "**/secrets/**": "deny",
        "*.key": "deny",
        "*.pem": "deny",
        "~/.ssh/**": "deny",
        "~/.aws/**": "deny",
      },
    };
    allPermissions.write = {
      default: "ask",
      patterns: {
        ".env*": "deny",
        "config/production/**": "deny",
        "secrets/**": "deny",
      },
    };
    allPermissions.run = {
      default: "ask",
      patterns: {
        "sudo *": "deny",
        "rm -rf *": "deny",
        "chmod 777 *": "deny",
      },
    };
  }

  config.permission = allPermissions;
  return config;
}

/**
 * Generate OpenCode ignore files (.gitignore and opencode.json)
 * OpenCode doesn't use traditional ignore files but relies on .gitignore and permission controls
 */
export async function generateOpenCodeIgnoreFiles(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];
  const outputPath = baseDir || process.cwd();

  // Generate opencode.json with permission configurations
  const opencodeConfig = generateOpenCodeConfiguration(rules);
  outputs.push({
    tool: "opencode",
    filepath: outputPath + "/opencode.json",
    content: `${JSON.stringify(opencodeConfig, null, 2)}\n`,
  });

  // Note: .gitignore generation is handled by git ignore generators
  // OpenCode automatically respects existing .gitignore patterns
  // We only generate a basic security-focused .gitignore if it's specifically requested

  return outputs;
}
