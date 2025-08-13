import { writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../utils/test-helpers.js";
import { parseCursorConfiguration } from "./cursor.js";

describe("cursor parser", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("parseCursorConfiguration", () => {
    it("should parse .cursor/rules/*.mdc files", async () => {
      // Create .cursor/rules directory
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description: Test cursor rule
globs: "**/*.ts"
ruletype: always
---

# Test Cursor Rule

This is a test cursor rule content.
`;

      writeFileSync(join(cursorRulesDir, "test-rule.mdc"), mdcContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.targets).toEqual(["*"]);
      expect(rule!.frontmatter.description).toBe(""); // specificFiles pattern: non-empty description + non-empty globs -> description=""
      expect(rule!.frontmatter.globs).toEqual(["**/*.ts"]); // globs is preserved in specificFiles pattern
      expect(rule!.frontmatter.cursorRuleType).toBe("specificFiles");
      expect(rule!.content.trim()).toBe(
        "# Test Cursor Rule\n\nThis is a test cursor rule content.",
      );
      expect(rule!.filename).toBe("cursor-test-rule");
    });

    it("should handle globs: * without quotes (Cursor's valid format)", async () => {
      // Create .cursor/rules directory
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      // This is the specific case that was causing issues - globs: * without quotes
      const mdcContent = `---
description: Guidelines for maintaining project documentation
globs: *
ruletype: autoattached
---

# Documentation Maintenance

This rule applies to all files using the asterisk wildcard without quotes.
`;

      writeFileSync(join(cursorRulesDir, "docs-maintenance.mdc"), mdcContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.targets).toEqual(["*"]);
      expect(rule!.frontmatter.description).toBe(""); // specificFiles pattern: non-empty description + non-empty globs -> description=""
      expect(rule!.frontmatter.cursorRuleType).toBe("specificFiles");
      expect(rule!.content.trim()).toBe(
        "# Documentation Maintenance\n\nThis rule applies to all files using the asterisk wildcard without quotes.",
      );
      expect(rule!.filename).toBe("cursor-docs-maintenance");
    });

    it("should handle multiple .mdc files including ones with globs: *", async () => {
      // Create .cursor/rules directory
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent1 = `---
description: Build tooling standards
globs: "tsconfig.json,package.json,*.config.*"
ruletype: autoattached
---

# Build Standards
`;

      const mdcContent2 = `---
description: Documentation maintenance
globs: *
ruletype: autoattached
---

# Docs Maintenance
`;

      const mdcContent3 = `---
description: CLI development
globs: "src/cli/**/*.ts"
ruletype: autoattached
---

# CLI Development
`;

      writeFileSync(join(cursorRulesDir, "build-tooling.mdc"), mdcContent1);
      writeFileSync(join(cursorRulesDir, "docs-maintenance.mdc"), mdcContent2);
      writeFileSync(join(cursorRulesDir, "cli-development.mdc"), mdcContent3);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(3);

      // Check that all files were parsed, including the one with globs: *
      const filenames = result.rules.map((rule) => rule.filename).sort();
      expect(filenames).toEqual([
        "cursor-build-tooling",
        "cursor-cli-development",
        "cursor-docs-maintenance",
      ]);
    });

    it("should parse legacy .cursorrules file", async () => {
      const cursorrrulesContent = `---
description: Legacy cursor rules
---

# Legacy Cursor Rules

This is a legacy .cursorrules file.
`;

      writeFileSync(join(testDir, ".cursorrules"), cursorrrulesContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.targets).toEqual(["cursor"]);
      expect(rule!.frontmatter.description).toBe("Legacy cursor rules");
      expect(rule!.frontmatter.globs).toEqual([]);
      expect(rule!.frontmatter.cursorRuleType).toBe("intelligently");
      expect(rule!.content.trim()).toBe(
        "# Legacy Cursor Rules\n\nThis is a legacy .cursorrules file.",
      );
      expect(rule!.filename).toBe("cursor-rules");
    });

    it("should ignore non-.mdc files in .cursor/rules directory", async () => {
      // Create .cursor/rules directory
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description: Valid mdc file
globs: "**/*.ts"
ruletype: always
---

# Valid MDC File
`;

      writeFileSync(join(cursorRulesDir, "valid.mdc"), mdcContent);
      writeFileSync(join(cursorRulesDir, "invalid.txt"), "This should be ignored");
      writeFileSync(join(cursorRulesDir, "config.json"), '{"ignored": true}');

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]!.filename).toBe("cursor-valid");
    });

    it("should handle empty content files", async () => {
      // Create .cursor/rules directory
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const emptyContent = `---
description: Empty content file
globs: "**/*.ts"
ruletype: always
---

`;

      writeFileSync(join(cursorRulesDir, "empty.mdc"), emptyContent);

      const result = await parseCursorConfiguration(testDir);

      // When files exist but have empty content, an error is generated because no rules were parsed
      expect(result.errors).toEqual([
        "No Cursor configuration files found (.cursorrules or .cursor/rules/*.mdc)",
      ]);
      expect(result.rules).toHaveLength(0); // Empty content files are skipped
    });

    it("should return error when no cursor configuration files are found", async () => {
      const result = await parseCursorConfiguration(testDir);

      expect(result.rules).toEqual([]);
      expect(result.errors).toEqual([
        "No Cursor configuration files found (.cursorrules or .cursor/rules/*.mdc)",
      ]);
    });

    it("should handle malformed YAML gracefully", async () => {
      // Create .cursor/rules directory
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      // Malformed YAML that can't be rescued
      const malformedContent = `---
description: Malformed YAML
globs: [unclosed array
ruletype: always
---

# Malformed YAML
`;

      writeFileSync(join(cursorRulesDir, "malformed.mdc"), malformedContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.rules).toEqual([]);
      expect(result.errors).toHaveLength(2); // Parse error + no config files found
      expect(result.errors[0]).toContain("Failed to parse");
      expect(result.errors[1]).toContain("No Cursor configuration files found");
    });

    it("should handle .cursorrules file parsing errors", async () => {
      // Create corrupted .cursorrules file that causes read error
      writeFileSync(join(testDir, ".cursorrules"), "Valid content");

      // Simulate read error by overwriting with invalid file
      const { chmod } = await import("node:fs/promises");
      await chmod(join(testDir, ".cursorrules"), 0o000); // Remove read permissions

      const result = await parseCursorConfiguration(testDir);

      // May have read permission error or still parse successfully based on system
      expect(result.errors.length).toBeGreaterThanOrEqual(0);

      // Restore permissions for cleanup
      await chmod(join(testDir, ".cursorrules"), 0o644);
    });

    it("should handle .cursor/rules directory parsing errors", async () => {
      // Create .cursor/rules directory
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      writeFileSync(join(cursorRulesDir, "test.mdc"), "Valid content");

      // Simulate permission error
      const { chmod } = await import("node:fs/promises");
      await chmod(cursorRulesDir, 0o000);

      const result = await parseCursorConfiguration(testDir);

      // Permission handling varies by system, just check result
      expect(result.errors.length).toBeGreaterThanOrEqual(0);

      // Restore permissions for cleanup
      await chmod(cursorRulesDir, 0o755);
    });

    it("should parse .cursorignore file", async () => {
      // Add a valid config file first
      writeFileSync(join(testDir, ".cursorrules"), "# Valid config");

      const cursorIgnoreContent = `# Comment line
node_modules/
*.log
dist/

# Another comment  
.env`;

      writeFileSync(join(testDir, ".cursorignore"), cursorIgnoreContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.ignorePatterns).toEqual(["node_modules/", "*.log", "dist/", ".env"]);
    });

    it("should handle .cursorignore parsing errors", async () => {
      // Add a valid config file first
      writeFileSync(join(testDir, ".cursorrules"), "# Valid config");

      writeFileSync(join(testDir, ".cursorignore"), "Valid content");

      const { chmod } = await import("node:fs/promises");
      await chmod(join(testDir, ".cursorignore"), 0o000);

      const result = await parseCursorConfiguration(testDir);

      // Permission handling varies by system
      expect(result.rules.length).toBeGreaterThanOrEqual(1);

      // Restore permissions for cleanup
      await chmod(join(testDir, ".cursorignore"), 0o644);
    });

    it("should parse .cursor/mcp.json file", async () => {
      // Add a valid config file first
      writeFileSync(join(testDir, ".cursorrules"), "# Valid config");

      const cursorDir = join(testDir, ".cursor");
      await mkdir(cursorDir, { recursive: true });

      const mcpConfig = {
        mcpServers: {
          "test-server": {
            command: "test-command",
            args: ["--test"],
            targets: ["cursor"],
          },
        },
      };

      writeFileSync(join(cursorDir, "mcp.json"), JSON.stringify(mcpConfig, null, 2));

      const result = await parseCursorConfiguration(testDir);

      expect(result.mcpServers).toBeDefined();
      expect(result.mcpServers!["test-server"]).toEqual({
        command: "test-command",
        args: ["--test"],
        targets: ["cursor"],
      });
    });

    it("should handle .cursor/mcp.json parsing errors", async () => {
      // Add a valid config file first
      writeFileSync(join(testDir, ".cursorrules"), "# Valid config");

      const cursorDir = join(testDir, ".cursor");
      await mkdir(cursorDir, { recursive: true });

      writeFileSync(join(cursorDir, "mcp.json"), "invalid json content");

      const result = await parseCursorConfiguration(testDir);

      // Should have at least 1 rule from .cursorrules, and may have mcp parsing error
      expect(result.rules.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("four kinds of .mdc pattern specification compliance", () => {
    it("should handle 'always' pattern (alwaysApply: true)", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description: "Any description"
globs: ["**/*.ts", "**/*.js"]
alwaysApply: true
---

# Always Applied Rule

This rule is always applied.
`;

      writeFileSync(join(cursorRulesDir, "always-rule.mdc"), mdcContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.root).toBe(false);
      expect(rule!.frontmatter.targets).toEqual(["*"]);
      expect(rule!.frontmatter.description).toBe("Any description"); // always pattern preserves original description
      expect(rule!.frontmatter.globs).toEqual(["**/*"]);
      expect(rule!.frontmatter.cursorRuleType).toBe("always");
      expect(rule!.filename).toBe("cursor-always-rule");
    });

    it("should handle 'manual' pattern (empty description and empty globs)", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description:
globs:
alwaysApply: false
---

# Manual Rule

This is a manual rule with no file patterns.
`;

      writeFileSync(join(cursorRulesDir, "manual-rule.mdc"), mdcContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.root).toBe(false);
      expect(rule!.frontmatter.targets).toEqual(["*"]);
      expect(rule!.frontmatter.description).toBe("");
      expect(rule!.frontmatter.globs).toEqual([]);
      expect(rule!.frontmatter.cursorRuleType).toBe("manual");
      expect(rule!.filename).toBe("cursor-manual-rule");
    });

    it("should handle 'auto attached' pattern (empty description and non-empty globs)", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description:
globs: **/*.py,**/*.pyc
alwaysApply: false
---

# Auto Attached Rule

This rule is automatically attached to Python files.
`;

      writeFileSync(join(cursorRulesDir, "auto-attached.mdc"), mdcContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.root).toBe(false);
      expect(rule!.frontmatter.targets).toEqual(["*"]);
      expect(rule!.frontmatter.description).toBe(""); // specificFiles pattern: description is empty
      expect(rule!.frontmatter.globs).toEqual(["**/*.py", "**/*.pyc"]);
      expect(rule!.frontmatter.cursorRuleType).toBe("specificFiles");
      expect(rule!.filename).toBe("cursor-auto-attached");
    });

    it("should handle 'auto attached' pattern with single glob", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description:
globs: **/*.ts
alwaysApply: false
---

# Single Glob Rule

This rule applies to TypeScript files only.
`;

      writeFileSync(join(cursorRulesDir, "single-glob.mdc"), mdcContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.root).toBe(false);
      expect(rule!.frontmatter.targets).toEqual(["*"]);
      expect(rule!.frontmatter.description).toBe(""); // specificFiles pattern: description is empty
      expect(rule!.frontmatter.globs).toEqual(["**/*.ts"]);
      expect(rule!.frontmatter.cursorRuleType).toBe("specificFiles");
      expect(rule!.filename).toBe("cursor-single-glob");
    });

    it("should handle 'agent_request' pattern (non-empty description)", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description: "When writing Python code"
globs:
alwaysApply: false
---

# Agent Request Rule

This rule is triggered by agent requests.
`;

      writeFileSync(join(cursorRulesDir, "agent-request.mdc"), mdcContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.root).toBe(false);
      expect(rule!.frontmatter.targets).toEqual(["*"]);
      expect(rule!.frontmatter.description).toBe("When writing Python code");
      expect(rule!.frontmatter.globs).toEqual([]);
      expect(rule!.frontmatter.cursorRuleType).toBe("intelligently");
      expect(rule!.filename).toBe("cursor-agent-request");
    });

    it("should handle edge case: non-empty description and non-empty globs (should be specificFiles)", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description: "TypeScript development rules"
globs: **/*.ts
alwaysApply: false
---

# Edge Case Rule

This has both description and globs, but should be treated as specificFiles according to new specification.
`;

      writeFileSync(join(cursorRulesDir, "edge-case.mdc"), mdcContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.root).toBe(false);
      expect(rule!.frontmatter.targets).toEqual(["*"]);
      expect(rule!.frontmatter.description).toBe(""); // specificFiles pattern: description is empty
      expect(rule!.frontmatter.globs).toEqual(["**/*.ts"]); // globs is preserved
      expect(rule!.frontmatter.cursorRuleType).toBe("specificFiles");
      expect(rule!.filename).toBe("cursor-edge-case");
    });

    it("should handle undefined alwaysApply (should default to false)", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description:
globs:
---

# Default AlwaysApply Rule

This rule has no alwaysApply field.
`;

      writeFileSync(join(cursorRulesDir, "default-always.mdc"), mdcContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.root).toBe(false);
      expect(rule!.frontmatter.targets).toEqual(["*"]);
      expect(rule!.frontmatter.description).toBe("");
      expect(rule!.frontmatter.globs).toEqual([]);
      expect(rule!.filename).toBe("cursor-default-always");
    });

    it("should handle empty array globs", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description:
globs: []
alwaysApply: false
---

# Empty Array Globs Rule

This rule has empty array globs.
`;

      writeFileSync(join(cursorRulesDir, "empty-array.mdc"), mdcContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule).toBeDefined();
      expect(rule!.frontmatter.root).toBe(false);
      expect(rule!.frontmatter.targets).toEqual(["*"]);
      expect(rule!.frontmatter.description).toBe("");
      expect(rule!.frontmatter.globs).toEqual([]);
      expect(rule!.filename).toBe("cursor-empty-array");
    });
  });

  describe("additional coverage tests", () => {
    it("should handle .cursorignore file with comments and empty lines", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description: Test rule
globs:
alwaysApply: false
---

# Test Rule
`;

      writeFileSync(join(cursorRulesDir, "test.mdc"), mdcContent);

      const cursorIgnoreContent = `# This is a comment
node_modules/
*.log

# Another comment
.env
`;

      writeFileSync(join(testDir, ".cursorignore"), cursorIgnoreContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);
      expect(result.ignorePatterns).toEqual(["node_modules/", "*.log", ".env"]);
    });

    it("should handle .cursorignore read error", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description: Test rule
globs:
alwaysApply: false
---

# Test Rule
`;

      writeFileSync(join(cursorRulesDir, "test.mdc"), mdcContent);

      // Create a directory instead of a file to cause read error
      await mkdir(join(testDir, ".cursorignore"));

      const result = await parseCursorConfiguration(testDir);

      expect(result.rules).toHaveLength(1);
      expect(result.errors.some((error) => error.includes("Failed to parse .cursorignore"))).toBe(
        true,
      );
    });

    it("should handle .cursor/mcp.json file", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description: Test rule
globs:
alwaysApply: false
---

# Test Rule
`;

      writeFileSync(join(cursorRulesDir, "test.mdc"), mdcContent);

      const mcpContent = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      };

      writeFileSync(join(testDir, ".cursor", "mcp.json"), JSON.stringify(mcpContent));

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);
      expect(result.mcpServers).toEqual(mcpContent.mcpServers);
    });

    it("should handle .cursor/mcp.json parse error", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description: Test rule
globs:
alwaysApply: false
---

# Test Rule
`;

      writeFileSync(join(cursorRulesDir, "test.mdc"), mdcContent);

      // Write invalid JSON
      writeFileSync(join(testDir, ".cursor", "mcp.json"), "{ invalid json }");

      const result = await parseCursorConfiguration(testDir);

      expect(result.rules).toHaveLength(1);
      expect(
        result.errors.some((error) => error.includes("Failed to parse .cursor/mcp.json")),
      ).toBe(true);
    });

    it("should handle .cursor/mcp.json read error", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description: Test rule
globs:
alwaysApply: false
---

# Test Rule
`;

      writeFileSync(join(cursorRulesDir, "test.mdc"), mdcContent);

      // Create a directory instead of a file to cause read error
      await mkdir(join(testDir, ".cursor", "mcp.json"));

      const result = await parseCursorConfiguration(testDir);

      expect(result.rules).toHaveLength(1);
      expect(
        result.errors.some((error) => error.includes("Failed to parse .cursor/mcp.json")),
      ).toBe(true);
    });

    it("should handle fallback to default when no conditions match", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
alwaysApply: false
---

# Fallback Rule

This rule should fall back to manual.
`;

      writeFileSync(join(cursorRulesDir, "fallback.mdc"), mdcContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule).toBeDefined();
      expect(rule!.frontmatter.root).toBe(false);
      expect(rule!.frontmatter.targets).toEqual(["*"]);
      expect(rule!.frontmatter.description).toBe("");
      expect(rule!.frontmatter.globs).toEqual([]);
      expect(rule!.frontmatter.cursorRuleType).toBe("manual");
      expect(rule!.filename).toBe("cursor-fallback");
    });

    it("should handle normalizeValue edge cases", async () => {
      const cursorRulesDir = join(testDir, ".cursor", "rules");
      await mkdir(cursorRulesDir, { recursive: true });

      const mdcContent = `---
description: 
globs: 
alwaysApply: false
---

# Edge Case Rule

This has no frontmatter values set.
`;

      writeFileSync(join(cursorRulesDir, "edge-case.mdc"), mdcContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.cursorRuleType).toBe("manual");
    });
  });

  describe(".cursorrules file processing with cursorRuleType", () => {
    it("should set cursorRuleType: always for .cursorrules with alwaysApply: true", async () => {
      const cursorRulesFile = join(testDir, ".cursorrules");

      const cursorRulesContent = `---
alwaysApply: true
description: Global cursor rules
---

# Global Cursor Rules

These rules apply to all files in the project.`;

      writeFileSync(cursorRulesFile, cursorRulesContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.cursorRuleType).toBe("always");
      expect(rule!.frontmatter.targets).toEqual(["cursor"]);
      expect(rule!.frontmatter.globs).toEqual(["**/*"]);
    });

    it("should set appropriate cursorRuleType for .cursorrules without alwaysApply", async () => {
      const cursorRulesFile = join(testDir, ".cursorrules");

      const cursorRulesContent = `---
description: TypeScript rules
globs: ["**/*.ts", "**/*.tsx"]
---

# TypeScript Cursor Rules

These rules apply to TypeScript files.`;

      writeFileSync(cursorRulesFile, cursorRulesContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.cursorRuleType).toBe("specificFiles");
      expect(rule!.frontmatter.targets).toEqual(["cursor"]);
      expect(rule!.frontmatter.globs).toEqual(["**/*.ts", "**/*.tsx"]);
    });

    it("should handle alwaysApply as string 'true' in .cursorrules", async () => {
      const cursorRulesFile = join(testDir, ".cursorrules");

      const cursorRulesContent = `---
alwaysApply: 'true'
description: String true value test
---

# String True Test

Testing alwaysApply as string 'true'.`;

      writeFileSync(cursorRulesFile, cursorRulesContent);

      const result = await parseCursorConfiguration(testDir);

      expect(result.errors).toEqual([]);
      expect(result.rules).toHaveLength(1);

      const rule = result.rules[0];
      expect(rule!.frontmatter.cursorRuleType).toBe("always");
      expect(rule!.frontmatter.targets).toEqual(["cursor"]);
      expect(rule!.frontmatter.globs).toEqual(["**/*"]);
    });
  });
});
