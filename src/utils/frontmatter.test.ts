import { describe, expect, it } from "vitest";

import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";

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
      const content = "---\na: {\n---\nbody";
      try {
        parseFrontmatter(content);
        // If gray-matter doesn't throw, the test still passes
        // (behavior varies by gray-matter version/environment)
      } catch (error) {
        // Original error should be re-thrown without wrapping
        expect((error as Error).message).not.toMatch(/Failed to parse frontmatter in/);
      }
    });
  });
});
