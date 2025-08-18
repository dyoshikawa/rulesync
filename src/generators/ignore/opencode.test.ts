import { describe, expect, it } from "vitest";
import { createMockConfigByTool } from "../../test-utils/index.js";
import type { ParsedRule } from "../../types/index.js";
import { generateOpenCodeIgnoreFiles } from "./opencode.js";

const createMockRule = (content: string, filepath = "test.md"): ParsedRule => ({
  frontmatter: {
    root: false,
    targets: ["opencode"],
    description: "Test rule",
    globs: ["**/*.ts"],
  },
  content,
  filename: filepath.replace(/\.md$/, ""),
  filepath,
});

describe("generateOpenCodeIgnoreFiles", () => {
  const mockConfig = createMockConfigByTool("opencode");

  it("should generate opencode.json with default security permissions", async () => {
    const rules = [createMockRule("Basic project rule")];

    const result = await generateOpenCodeIgnoreFiles(rules, mockConfig);

    expect(result).toHaveLength(1);
    expect(result[0]?.filepath).toContain("opencode.json");
    expect(result[0]?.tool).toBe("opencode");

    const config = JSON.parse(result[0]?.content || "{}");
    expect(config.$schema).toBe("https://opencode.ai/config.json");
    expect(config.permission).toBeDefined();
    expect(config.permission.read?.default).toBe("allow");
    expect(config.permission.write?.default).toBe("ask");
    expect(config.permission.run?.default).toBe("ask");

    // Check security patterns
    expect(config.permission.read?.patterns).toEqual({
      "**/.env*": "deny",
      "**/secrets/**": "deny",
      "*.key": "deny",
      "*.pem": "deny",
      "~/.ssh/**": "deny",
      "~/.aws/**": "deny",
    });
  });

  it("should extract permission configurations from JSON blocks in rules", async () => {
    const rules = [
      createMockRule(`
Permission configuration:
\`\`\`json
{
  "permission": {
    "read": {
      "default": "allow",
      "patterns": {
        "config/production/**": "deny",
        "src/**/*.ts": "allow"
      }
    },
    "write": {
      "default": "ask",
      "patterns": {
        "*.md": "allow"
      }
    }
  }
}
\`\`\`
    `),
    ];

    const result = await generateOpenCodeIgnoreFiles(rules, mockConfig);
    const config = JSON.parse(result[0]?.content || "{}");

    expect(config.permission.read?.patterns).toEqual({
      "**/.env*": "deny",
      "**/secrets/**": "deny",
      "*.key": "deny",
      "*.pem": "deny",
      "~/.ssh/**": "deny",
      "~/.aws/**": "deny",
      "config/production/**": "deny",
      "src/**/*.ts": "allow",
    });
    expect(config.permission.write?.patterns).toEqual({
      ".env*": "deny",
      "config/production/**": "deny",
      "secrets/**": "deny",
      "*.md": "allow",
    });
  });

  it("should merge multiple permission configurations", async () => {
    const rules = [
      createMockRule(
        `
\`\`\`json
{
  "permission": {
    "read": {
      "patterns": {
        "secrets/**": "deny"
      }
    }
  }
}
\`\`\`
      `,
        "rule1.md",
      ),
      createMockRule(
        `
\`\`\`json
{
  "permission": {
    "read": {
      "patterns": {
        "config/**": "ask"
      }
    },
    "write": {
      "default": "allow"
    }
  }
}
\`\`\`
      `,
        "rule2.md",
      ),
    ];

    const result = await generateOpenCodeIgnoreFiles(rules, mockConfig);
    const config = JSON.parse(result[0]?.content || "{}");

    expect(config.permission.read?.patterns).toEqual({
      "**/.env*": "deny",
      "**/secrets/**": "deny",
      "*.key": "deny",
      "*.pem": "deny",
      "~/.ssh/**": "deny",
      "~/.aws/**": "deny",
      "secrets/**": "deny",
      "config/**": "ask",
    });
    expect(config.permission.write?.default).toBe("allow");
  });

  it("should handle invalid JSON blocks gracefully", async () => {
    const rules = [
      createMockRule(`
\`\`\`json
{
  "permission": {
    "read": { invalid json
\`\`\`
Valid content here.
    `),
    ];

    const result = await generateOpenCodeIgnoreFiles(rules, mockConfig);
    const config = JSON.parse(result[0]?.content || "{}");

    // Should still have default permissions despite invalid JSON
    expect(config.permission).toBeDefined();
    expect(config.permission.read?.default).toBe("allow");
  });

  it("should support baseDir parameter", async () => {
    const rules = [createMockRule("Test rule")];

    const result = await generateOpenCodeIgnoreFiles(rules, mockConfig, "/custom/path");

    expect(result[0]?.filepath).toBe("/custom/path/opencode.json");
  });

  it("should format JSON with proper indentation", async () => {
    const rules = [createMockRule("Test rule")];

    const result = await generateOpenCodeIgnoreFiles(rules, mockConfig);

    // Check that JSON is properly formatted
    expect(result[0]?.content).toContain('  "$schema": "https://opencode.ai/config.json"');
    expect(result[0]?.content).toContain('  "permission": {');
    expect(result[0]?.content).toContain('    "read": {');
    expect(result[0]?.content).toContain('      "default": "allow"');
  });

  it("should only generate opencode.json file", async () => {
    const rules = [createMockRule("Test rule with patterns")];

    const result = await generateOpenCodeIgnoreFiles(rules, mockConfig);

    // OpenCode only generates opencode.json, not .gitignore
    expect(result).toHaveLength(1);
    expect(result[0]?.filepath).toContain("opencode.json");
    expect(result[0]?.tool).toBe("opencode");
  });

  it("should handle empty rules array", async () => {
    const rules: ParsedRule[] = [];

    const result = await generateOpenCodeIgnoreFiles(rules, mockConfig);

    expect(result).toHaveLength(1);
    const config = JSON.parse(result[0]?.content || "{}");
    expect(config.$schema).toBe("https://opencode.ai/config.json");
    expect(config.permission).toBeDefined();
  });
});
