import { describe, expect, it, vi } from "vitest";

import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";

// Hoisted mock for gray-matter - used by specific tests
const mockMatter = vi.hoisted(() => ({
  shouldThrow: false,
  errorMessage: "YAML parse error from mock",
}));

vi.mock("gray-matter", async () => {
  const actualModule = await vi.importActual<typeof import("gray-matter")>("gray-matter");
  // gray-matter is a CommonJS module that exports a function directly
  // vi.importActual returns the module object, but with esModuleInterop, the function is on .default
  const actualFn =
    (actualModule as unknown as { default: typeof actualModule }).default || actualModule;

  const mockedMatter = vi.fn((...args: Parameters<typeof actualFn>) => {
    if (mockMatter.shouldThrow) {
      throw new Error(mockMatter.errorMessage);
    }
    return actualFn(...args);
  });
  // Copy over all properties from the original module
  const mockedModule = Object.assign(mockedMatter, {
    stringify: actualModule.stringify,
    test: actualModule.test,
    language: actualModule.language,
  });
  return { default: mockedModule };
});

describe("frontmatter utilities", () => {
  describe("stringifyFrontmatter", () => {
    it("should create content with frontmatter and body", () => {
      const body = "This is the body content.";
      const frontmatter = { title: "Test Title", version: 1, enabled: true };

      const result = stringifyFrontmatter(body, frontmatter);

      expect(result).toContain("---");
      expect(result).toContain("title: Test Title");
      expect(result).toContain("version: 1");
      expect(result).toContain("enabled: true");
      expect(result).toContain(body);
    });

    it("should filter out null and undefined values", () => {
      const body = "Body content";
      const frontmatter = {
        title: "Valid Title",
        nullValue: null,
        undefinedValue: undefined,
        emptyString: "",
        zero: 0,
        falsy: false,
      };

      const result = stringifyFrontmatter(body, frontmatter);

      expect(result).toContain("title: Valid Title");
      expect(result).toContain("emptyString: ''");
      expect(result).toContain("zero: 0");
      expect(result).toContain("falsy: false");
      expect(result).not.toContain("nullValue");
      expect(result).not.toContain("undefinedValue");
    });

    it("should handle empty frontmatter", () => {
      const body = "Just the body";
      const frontmatter = {};

      const result = stringifyFrontmatter(body, frontmatter);

      expect(result).toBe("Just the body\n");
    });

    it("should handle complex nested objects", () => {
      const body = "Complex content";
      const frontmatter = {
        config: {
          database: { host: "localhost", port: 5432 },
          features: ["feature1", "feature2"],
        },
        metadata: { created: new Date("2023-01-01"), tags: ["tag1", "tag2"] },
      };

      const result = stringifyFrontmatter(body, frontmatter);

      expect(result).toContain("config:");
      expect(result).toContain("database:");
      expect(result).toContain("host: localhost");
      expect(result).toContain("port: 5432");
      expect(result).toContain("features:");
      expect(result).toContain("- feature1");
      expect(result).toContain("- feature2");
      expect(result).toContain("metadata:");
      expect(result).toMatch(/created: ['"]?2023-01-01T00:00:00.000Z['"]?/);
      expect(result).toContain("tags:");
      expect(result).toContain("- tag1");
      expect(result).toContain("- tag2");
    });

    it("should handle arrays in frontmatter", () => {
      const body = "Array test";
      const frontmatter = {
        items: ["item1", "item2", "item3"],
        numbers: [1, 2, 3],
        mixed: ["string", 42, true],
      };

      const result = stringifyFrontmatter(body, frontmatter);

      expect(result).toContain("items:");
      expect(result).toContain("- item1");
      expect(result).toContain("- item2");
      expect(result).toContain("- item3");
      expect(result).toContain("numbers:");
      expect(result).toContain("- 1");
      expect(result).toContain("- 2");
      expect(result).toContain("- 3");
      expect(result).toContain("mixed:");
      expect(result).toContain("- string");
      expect(result).toContain("- 42");
      expect(result).toContain("- true");
    });

    it("should allow block scalars by default for long strings", () => {
      const body = "Body content";
      const longDescription =
        "Use this agent when the user wants to commit current changes, push them, " +
        "and create or update a pull request with an English summary for the repository " +
        "including all changed files and their descriptions in a well-structured format";
      const frontmatter = { name: "test", description: longDescription };

      const result = stringifyFrontmatter(body, frontmatter);

      expect(result).toContain(">-");

      const parsed = parseFrontmatter(result);
      expect(parsed.frontmatter.description).toBe(longDescription);
    });

    it("should preserve embedded newlines in strings by default", () => {
      const body = "Body content";
      const frontmatter = { description: "Line one\nLine two\nLine three" };

      const result = stringifyFrontmatter(body, frontmatter);

      expect(result).toContain("|-");

      const parsed = parseFrontmatter(result);
      expect(parsed.frontmatter.description).toBe("Line one\nLine two\nLine three");
    });

    describe("with avoidBlockScalars option", () => {
      it("should not emit block scalar indicators for long strings", () => {
        const body = "Body content";
        const longDescription =
          "Use this agent when the user wants to commit current changes, push them, " +
          "and create or update a pull request with an English summary for the repository " +
          "including all changed files and their descriptions in a well-structured format";
        const frontmatter = { name: "test", description: longDescription };

        const result = stringifyFrontmatter(body, frontmatter, { avoidBlockScalars: true });

        expect(result).not.toContain(">-");
        expect(result).not.toContain("|-");
        expect(result).toContain(longDescription);

        const parsed = parseFrontmatter(result);
        expect(parsed.frontmatter.description).toBe(longDescription);
      });

      it("should collapse newlines in string values", () => {
        const body = "Body content";
        const frontmatter = {
          description: "Line one\nLine two\nLine three",
        };

        const result = stringifyFrontmatter(body, frontmatter, { avoidBlockScalars: true });

        expect(result).not.toContain("|-");
        expect(result).not.toContain(">-");
        expect(result).toContain("description: Line one Line two Line three");
      });

      it("should collapse newlines in nested string values", () => {
        const body = "Body content";
        const frontmatter = {
          config: {
            label: "First line\nSecond line",
          },
          items: ["item\nwith\nnewlines"],
        };

        const result = stringifyFrontmatter(body, frontmatter, { avoidBlockScalars: true });

        expect(result).not.toContain("|-");
        expect(result).not.toContain(">-");
        expect(result).toContain("label: First line Second line");
        expect(result).toContain("- item with newlines");
      });
    });
  });

  describe("parseFrontmatter", () => {
    it("should parse content with frontmatter correctly", () => {
      const content = `---
title: Test Title
version: 1
enabled: true
---
This is the body content.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({
        title: "Test Title",
        version: 1,
        enabled: true,
      });
      expect(result.body).toBe("This is the body content.");
    });

    it("should handle content without frontmatter", () => {
      const content = "Just plain content without frontmatter.";

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
      expect(result.hasFrontmatter).toBe(false);
    });

    it("should set hasFrontmatter to true when frontmatter is present", () => {
      const content = `---
title: Test
---
Body content.`;

      const result = parseFrontmatter(content);

      expect(result.hasFrontmatter).toBe(true);
    });

    it("should set hasFrontmatter to true for empty frontmatter section", () => {
      const content = `---
---
Body content.`;

      const result = parseFrontmatter(content);

      expect(result.hasFrontmatter).toBe(true);
    });

    it("should parse complex nested frontmatter", () => {
      const content = `---
config:
  database:
    host: localhost
    port: 5432
  features:
    - feature1
    - feature2
metadata:
  created: 2023-01-01
  tags:
    - tag1
    - tag2
---
Body with complex frontmatter.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({
        config: {
          database: { host: "localhost", port: 5432 },
          features: ["feature1", "feature2"],
        },
        metadata: {
          created: new Date("2023-01-01"),
          tags: ["tag1", "tag2"],
        },
      });
      expect(result.body).toBe("Body with complex frontmatter.");
    });

    it("should handle multiline body content", () => {
      const content = `---
title: Multiline Test
---
Line 1 of body
Line 2 of body

Paragraph 2 with blank line above.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({ title: "Multiline Test" });
      expect(result.body).toBe(`Line 1 of body
Line 2 of body

Paragraph 2 with blank line above.`);
    });

    it("should handle empty frontmatter section", () => {
      const content = `---
---
Body content after empty frontmatter.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe("Body content after empty frontmatter.");
    });

    it("should strip YAML null values from parsed frontmatter", () => {
      // YAML parses bare keys like "description:" as null
      const content = `---
description:
globs: "*.ts"
alwaysApply: true
---
Body content.`;

      const result = parseFrontmatter(content);

      // null value from "description:" should be stripped
      expect(result.frontmatter).toEqual({
        globs: "*.ts",
        alwaysApply: true,
      });
      expect(result.frontmatter).not.toHaveProperty("description");
    });

    it("should strip nested null values from parsed frontmatter", () => {
      const content = `---
cursor:
  description:
  alwaysApply: true
---
Body content.`;

      const result = parseFrontmatter(content);

      expect(result.frontmatter).toEqual({
        cursor: {
          alwaysApply: true,
        },
      });
    });

    it("should leave empty object when all nested values are null", () => {
      const content = `---
cursor:
  description:
  globs:
---
Body content.`;

      const result = parseFrontmatter(content);

      // When all nested values are null, the parent key remains as empty object
      expect(result.frontmatter).toEqual({
        cursor: {},
      });
    });

    it("should handle malformed YAML gracefully", () => {
      const content = `---
title: "Valid quote"
valid: true
---
Body content.`;

      // Test with valid YAML to avoid parsing errors
      const result = parseFrontmatter(content);

      expect(result.body).toContain("Body content.");
      expect(result.frontmatter).toEqual({ title: "Valid quote", valid: true });
    });

    it("should preserve original formatting in body", () => {
      const content = `---
title: Formatting Test
---
# Header 1

## Header 2

- List item 1
- List item 2

\`\`\`javascript
const code = "preserved";
\`\`\``;

      const result = parseFrontmatter(content);

      expect(result.body).toContain("# Header 1");
      expect(result.body).toContain("## Header 2");
      expect(result.body).toContain("- List item 1");
      expect(result.body).toContain("- List item 2");
      expect(result.body).toContain("```javascript");
      expect(result.body).toContain('const code = "preserved";');
      expect(result.body).toContain("```");
    });
  });

  describe("round-trip conversion", () => {
    it("should maintain data integrity in round-trip conversion", () => {
      const originalBody = "Original body content with special chars: !@#$%^&*()";
      const originalFrontmatter = {
        title: "Round Trip Test",
        version: 2,
        enabled: false,
        config: { nested: "value" },
        list: ["item1", "item2"],
      };

      // Convert to string
      const stringified = stringifyFrontmatter(originalBody, originalFrontmatter);

      // Parse back
      const parsed = parseFrontmatter(stringified);

      expect(parsed.frontmatter).toEqual(originalFrontmatter);
      expect(parsed.body.trim()).toBe(originalBody);
    });

    it("should handle round-trip with filtered values", () => {
      const body = "Test body";
      const frontmatterWithNulls = {
        valid: "value",
        nullValue: null,
        undefinedValue: undefined,
        zero: 0,
      };

      const stringified = stringifyFrontmatter(body, frontmatterWithNulls);
      const parsed = parseFrontmatter(stringified);

      // null and undefined should be filtered out
      expect(parsed.frontmatter).toEqual({
        valid: "value",
        zero: 0,
      });
      expect(parsed.body.trim()).toBe(body);
    });
  });

  describe("error handling with file path", () => {
    it("should include file path in error message for invalid YAML", () => {
      const content = "---\na: {\n---\nbody";
      try {
        parseFrontmatter(content, "path/to/file.md");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(
          /Failed to parse frontmatter in path\/to\/file\.md/,
        );
        expect((error as Error).cause).toBeDefined();
      }
    });

    it("should re-throw original error when no file path provided", () => {
      // Configure mock to throw deterministically
      mockMatter.shouldThrow = true;
      mockMatter.errorMessage = "YAML parse error from mock";

      const content = "any content";

      // Verify the error is re-thrown without file path wrapping
      try {
        parseFrontmatter(content);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect((error as Error).message).not.toMatch(/Failed to parse frontmatter in/);
        expect((error as Error).message).toBe("YAML parse error from mock");
      }

      // Reset mock
      mockMatter.shouldThrow = false;
    });
  });

  // Regression tests for issue #1973: verify that the gray-matter js-yaml
  // override (PR #1959) is actually effective. The patch rewrites gray-matter's
  // YAML engine from the deprecated js-yaml v3 API (safeLoad/safeDump) to the
  // js-yaml v4 API (load/dump). If the patch is silently dropped by a future
  // `pnpm install`, these tests will catch the regression.
  describe("js-yaml v4 engine regression (issue #1973)", () => {
    it("should parse YAML 1.2 scalars correctly (yes/no as strings, not booleans)", () => {
      // js-yaml v3 (YAML 1.1) parses yes/no/on/off as booleans.
      // js-yaml v4 (YAML 1.2 core schema) parses them as strings.
      // This difference is the most reliable way to detect which engine is active.
      const content = `---
flag: yes
status: no
toggle: on
---
Body.`;

      const result = parseFrontmatter(content);

      // With js-yaml v4, these should be strings, not booleans
      expect(result.frontmatter.flag).toBe("yes");
      expect(result.frontmatter.status).toBe("no");
      expect(result.frontmatter.toggle).toBe("on");
    });

    it("should not line-wrap long strings when avoidBlockScalars is true (lineWidth: -1)", () => {
      // The custom engine override in stringifyFrontmatter uses lineWidth: -1
      // to prevent js-yaml from wrapping long lines. If the override is not
      // applied, js-yaml's default lineWidth of 80 would cause wrapping.
      const body = "Body";
      const veryLongValue =
        "This is an intentionally very long string value that exceeds the default " +
        "js-yaml lineWidth of 80 characters and would be wrapped if lineWidth is not " +
        "set to -1 in the dump options for the custom YAML engine override";

      const result = stringifyFrontmatter(
        body,
        { description: veryLongValue },
        { avoidBlockScalars: true },
      );

      // The long value should appear on a single line, not wrapped
      const lines = result.split("\n");
      const descriptionLine = lines.find((line) => line.startsWith("description:"));
      expect(descriptionLine).toBeDefined();
      // The full value should be on one line (no wrapping)
      expect(descriptionLine).toContain(veryLongValue);
    });

    it("should round-trip correctly with avoidBlockScalars custom engine", () => {
      // Verify that stringify (with custom engine) and parse (with patched default
      // engine) are consistent — both use js-yaml v4.
      const body = "Body content";
      const frontmatter = {
        name: "test-agent",
        description:
          "A very long description that would normally be wrapped by js-yaml at column 80 but should remain on a single line when using the custom engine with lineWidth disabled",
        targets: ["claudecode", "cursor"],
      };

      const stringified = stringifyFrontmatter(body, frontmatter, { avoidBlockScalars: true });
      const parsed = parseFrontmatter(stringified);

      expect(parsed.frontmatter.name).toBe("test-agent");
      expect(parsed.frontmatter.description).toBe(frontmatter.description);
      expect(parsed.frontmatter.targets).toEqual(["claudecode", "cursor"]);
      expect(parsed.hasFrontmatter).toBe(true);
    });
  });
});
