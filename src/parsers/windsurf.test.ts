import { beforeEach, describe, expect, it, vi } from "vitest";
import { importWindsurfRules } from "./windsurf.js";

// Mock file system operations
const mockFiles: Record<string, string> = {};

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn((path: string) => {
    if (mockFiles[path]) {
      return Promise.resolve(mockFiles[path]);
    }
    return Promise.reject(new Error(`File not found: ${path}`));
  }),
  readdir: vi.fn((path: string) => {
    if (path.includes(".windsurf/rules")) {
      // Return files based on what's actually mocked
      const files: string[] = [];
      Object.keys(mockFiles).forEach((filePath) => {
        if (filePath.includes(path) && filePath.endsWith(".md")) {
          const filename = filePath.split("/").pop();
          if (filename) files.push(filename);
        }
      });
      return Promise.resolve(files);
    }
    return Promise.reject(new Error(`Directory not found: ${path}`));
  }),
}));

describe("importWindsurfRules", () => {
  beforeEach(() => {
    // Reset mock files
    Object.keys(mockFiles).forEach((key) => {
      delete mockFiles[key];
    });
  });

  it("should import single-file variant", async () => {
    const content = `---
activation: always
---

# Project Rules
- Use TypeScript for new projects
- Follow semantic versioning`;

    mockFiles["/test/.windsurf-rules"] = content;

    const results = await importWindsurfRules("/test");

    expect(results).toHaveLength(1);
    expect(results[0]?.frontmatter.windsurfActivationMode).toBe("always");
    expect(results[0]?.frontmatter.windsurfOutputFormat).toBe("single-file");
    expect(results[0]?.content).toContain("# Project Rules");
  });

  it("should import directory variant", async () => {
    const codingStandards = `---
activation: glob
pattern: "**/*.ts"
---

# Coding Standards
- Use strict TypeScript mode
- Prefer functional components`;

    const securityRules = `---
activation: manual
---

# Security Rules
- Never commit API keys
- Use environment variables`;

    mockFiles["/test/.windsurf/rules/coding-standards.md"] = codingStandards;
    mockFiles["/test/.windsurf/rules/security-rules.md"] = securityRules;

    const results = await importWindsurfRules("/test");

    expect(results).toHaveLength(2);

    const codingRule = results.find((r) => r.filename === "coding-standards");
    expect(codingRule?.frontmatter.windsurfActivationMode).toBe("glob");
    expect(codingRule?.frontmatter.globs).toEqual(["**/*.ts"]);
    expect(codingRule?.frontmatter.windsurfOutputFormat).toBe("directory");

    const securityRule = results.find((r) => r.filename === "security-rules");
    expect(securityRule?.frontmatter.windsurfActivationMode).toBe("manual");
    expect(securityRule?.frontmatter.windsurfOutputFormat).toBe("directory");
  });

  it("should handle files without frontmatter", async () => {
    const content = `# Simple Rule
This is a simple rule without frontmatter.`;

    mockFiles["/test/.windsurf/rules/simple.md"] = content;

    const results = await importWindsurfRules("/test");

    expect(results).toHaveLength(1);
    expect(results[0]?.frontmatter.windsurfActivationMode).toBeUndefined();
    expect(results[0]?.frontmatter.windsurfOutputFormat).toBe("directory");
    expect(results[0]?.content).toContain("# Simple Rule");
  });

  it("should handle both single-file and directory variants", async () => {
    const singleFileContent = `# Global Rules
These are global project rules.`;

    const directoryContent = `---
activation: glob
pattern: "**/*.tsx"
---

# React Rules
Use functional components.`;

    mockFiles["/test/.windsurf-rules"] = singleFileContent;
    mockFiles["/test/.windsurf/rules/react.md"] = directoryContent;

    const results = await importWindsurfRules("/test");

    expect(results).toHaveLength(2);

    const globalRule = results.find((r) => r.frontmatter.windsurfOutputFormat === "single-file");
    expect(globalRule?.filename).toBe(".windsurf-rules");

    const reactRule = results.find((r) => r.frontmatter.windsurfOutputFormat === "directory");
    expect(reactRule?.filename).toBe("react");
    expect(reactRule?.frontmatter.windsurfActivationMode).toBe("glob");
  });

  it("should ignore errors when ignoreErrors option is true", async () => {
    // No files exist, should normally throw but won't with ignoreErrors: true
    const results = await importWindsurfRules("/nonexistent", { ignoreErrors: true });

    expect(results).toHaveLength(0);
  });

  it("should handle malformed YAML gracefully", async () => {
    const content = `---
activation: [invalid yaml structure
pattern: "**/*.ts"
---

# Malformed Rule
This has malformed YAML.`;

    mockFiles["/test/.windsurf/rules/malformed.md"] = content;

    const results = await importWindsurfRules("/test");

    // Should still return results, just without the malformed frontmatter
    expect(results).toHaveLength(0); // Since parsing fails, no rule is created
  });
});
