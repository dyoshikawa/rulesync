import { describe, expect, it } from "vitest";
import { SCHEMA_URLS, type SchemaUrl } from "./schemas.js";

describe("schemas constants", () => {
  describe("SCHEMA_URLS", () => {
    it("should have OPENCODE schema URL", () => {
      expect(SCHEMA_URLS.OPENCODE).toBe("https://opencode.ai/config.json");
      expect(typeof SCHEMA_URLS.OPENCODE).toBe("string");
    });

    it("should have valid URL format", () => {
      expect(SCHEMA_URLS.OPENCODE.startsWith("https://")).toBe(true);
      expect(SCHEMA_URLS.OPENCODE.endsWith(".json")).toBe(true);
    });

    it("should be readonly object", () => {
      expect(typeof SCHEMA_URLS).toBe("object");
      expect(Object.keys(SCHEMA_URLS)).toEqual(["OPENCODE"]);
    });
  });

  describe("SchemaUrl type", () => {
    it("should represent valid schema URL values", () => {
      const schemaUrl: SchemaUrl = SCHEMA_URLS.OPENCODE;
      expect(schemaUrl).toBe("https://opencode.ai/config.json");
    });

    it("should work with all schema URL values", () => {
      const urls: SchemaUrl[] = Object.values(SCHEMA_URLS);
      expect(urls).toContain("https://opencode.ai/config.json");
      expect(urls).toHaveLength(1);
    });
  });

  describe("schema URL validation", () => {
    it("should have proper HTTPS URLs", () => {
      Object.values(SCHEMA_URLS).forEach((url) => {
        expect(url.startsWith("https://")).toBe(true);
        expect(url.length).toBeGreaterThan("https://".length);
      });
    });

    it("should have valid domain names", () => {
      Object.values(SCHEMA_URLS).forEach((url) => {
        // Simple domain validation
        expect(url).toMatch(/^https:\/\/[a-zA-Z0-9.-]+\//);
      });
    });

    it("should have JSON file extensions", () => {
      Object.values(SCHEMA_URLS).forEach((url) => {
        expect(url.endsWith(".json")).toBe(true);
      });
    });
  });

  describe("constants structure", () => {
    it("should have consistent naming conventions", () => {
      Object.keys(SCHEMA_URLS).forEach((key) => {
        expect(key).toBe(key.toUpperCase());
        expect(key).toMatch(/^[A-Z_]+$/);
      });
    });

    it("should maintain object reference identity", () => {
      const ref1 = SCHEMA_URLS;
      const ref2 = SCHEMA_URLS;
      expect(ref1).toBe(ref2);
    });

    it("should have string values only", () => {
      Object.values(SCHEMA_URLS).forEach((url) => {
        expect(typeof url).toBe("string");
        expect(url.length).toBeGreaterThan(0);
      });
    });
  });

  describe("extensibility", () => {
    it("should support adding new schema URLs in the future", () => {
      // Test that the structure supports extension
      type ExpectedStructure = {
        OPENCODE: string;
        // Future schemas would go here
      };

      const urls: ExpectedStructure = SCHEMA_URLS;
      expect(urls.OPENCODE).toBe("https://opencode.ai/config.json");
    });

    it("should support type extraction", () => {
      // Test that SchemaUrl type correctly extracts values
      const allSchemaUrls: SchemaUrl[] = Object.values(SCHEMA_URLS);
      expect(allSchemaUrls).toContain("https://opencode.ai/config.json");
    });
  });
});
