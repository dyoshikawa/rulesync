import type { OpenCodePermissionConfig } from "../generators/ignore/opencode.js";

/**
 * Merges permission configurations, with source overriding target values
 */
export function mergePermissions(
  target: OpenCodePermissionConfig["permission"],
  source: OpenCodePermissionConfig["permission"],
): void {
  if (!source) return;

  for (const permissionType of ["read", "write", "run"] as const) {
    const sourcePermission = source[permissionType];
    if (sourcePermission) {
      // Initialize target permission if it doesn't exist
      if (!target) {
        throw new Error("Target permission object cannot be undefined");
      }

      target[permissionType] = target[permissionType] || {};
      const targetPermission = target[permissionType];
      if (!targetPermission) {
        continue;
      }

      // Merge default permission
      if (sourcePermission.default) {
        targetPermission.default = sourcePermission.default;
      }

      // Merge pattern-specific permissions
      if (sourcePermission.patterns) {
        targetPermission.patterns = {
          ...targetPermission.patterns,
          ...sourcePermission.patterns,
        };
      }
    }
  }
}

/**
 * Creates a default permission configuration for OpenCode with security patterns
 */
export function createDefaultPermissions(): OpenCodePermissionConfig["permission"] {
  return {
    read: {
      default: "allow",
      patterns: {
        "**/.env*": "deny",
        "**/secrets/**": "deny",
        "*.key": "deny",
        "*.pem": "deny",
        "~/.ssh/**": "deny",
        "~/.aws/**": "deny",
      },
    },
    write: {
      default: "ask",
      patterns: {
        ".env*": "deny",
        "config/production/**": "deny",
        "secrets/**": "deny",
      },
    },
    run: {
      default: "ask",
      patterns: {
        "sudo *": "deny",
        "rm -rf *": "deny",
        "chmod 777 *": "deny",
      },
    },
  };
}
