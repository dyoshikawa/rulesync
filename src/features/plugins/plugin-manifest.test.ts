import { describe, expect, it } from "vitest";

import { PLUGIN_MANIFEST_FILE_NAME, PluginManifestSchema } from "./plugin-manifest.js";

describe("PluginManifestSchema", () => {
  describe("valid manifests", () => {
    it("should parse a minimal valid manifest", () => {
      const manifest = {
        name: "my-plugin",
        description: "A test plugin",
        version: "1.0.0",
      };

      const result = PluginManifestSchema.safeParse(manifest);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("my-plugin");
        expect(result.data.description).toBe("A test plugin");
        expect(result.data.version).toBe("1.0.0");
      }
    });

    it("should parse a full manifest with all fields", () => {
      const manifest = {
        name: "typescript-rules",
        description: "TypeScript best practices for AI coding agents",
        version: "1.0.0",
        author: {
          name: "rulesync-community",
          email: "contact@example.com",
          url: "https://example.com",
        },
        repository: "https://github.com/rulesync-community/typescript-rules",
        keywords: ["typescript", "rules", "ai"],
        license: "MIT",
      };

      const result = PluginManifestSchema.safeParse(manifest);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("typescript-rules");
        expect(result.data.author?.name).toBe("rulesync-community");
        expect(result.data.author?.email).toBe("contact@example.com");
        expect(result.data.keywords).toEqual(["typescript", "rules", "ai"]);
        expect(result.data.license).toBe("MIT");
      }
    });

    it("should parse a manifest with only author name", () => {
      const manifest = {
        name: "my-plugin",
        description: "A test plugin",
        version: "1.0.0",
        author: {
          name: "John Doe",
        },
      };

      const result = PluginManifestSchema.safeParse(manifest);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.author?.name).toBe("John Doe");
        expect(result.data.author?.email).toBeUndefined();
      }
    });

    it("should allow additional unknown fields (loose object)", () => {
      const manifest = {
        name: "my-plugin",
        description: "A test plugin",
        version: "1.0.0",
        customField: "custom value",
      };

      const result = PluginManifestSchema.safeParse(manifest);

      expect(result.success).toBe(true);
    });
  });

  describe("invalid manifests", () => {
    it("should fail when name is missing", () => {
      const manifest = {
        description: "A test plugin",
        version: "1.0.0",
      };

      const result = PluginManifestSchema.safeParse(manifest);

      expect(result.success).toBe(false);
    });

    it("should fail when description is missing", () => {
      const manifest = {
        name: "my-plugin",
        version: "1.0.0",
      };

      const result = PluginManifestSchema.safeParse(manifest);

      expect(result.success).toBe(false);
    });

    it("should fail when version is missing", () => {
      const manifest = {
        name: "my-plugin",
        description: "A test plugin",
      };

      const result = PluginManifestSchema.safeParse(manifest);

      expect(result.success).toBe(false);
    });

    it("should fail when name is not a string", () => {
      const manifest = {
        name: 123,
        description: "A test plugin",
        version: "1.0.0",
      };

      const result = PluginManifestSchema.safeParse(manifest);

      expect(result.success).toBe(false);
    });
  });
});

describe("PLUGIN_MANIFEST_FILE_NAME", () => {
  it("should be plugin.json", () => {
    expect(PLUGIN_MANIFEST_FILE_NAME).toBe("plugin.json");
  });
});
