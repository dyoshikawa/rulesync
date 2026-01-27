import { describe, expect, it } from "vitest";

import {
  generatePluginCacheKey,
  isValidPluginIdentifier,
  parsePluginIdentifier,
} from "./plugin-identifier.js";

describe("parsePluginIdentifier", () => {
  describe("valid identifiers", () => {
    it("should parse a local plugin identifier", () => {
      const result = parsePluginIdentifier("my-rules@local:../shared-rules");

      expect(result).toEqual({
        name: "my-rules",
        sourceType: "local",
        sourcePath: "../shared-rules",
        original: "my-rules@local:../shared-rules",
      });
    });

    it("should parse a GitHub plugin identifier", () => {
      const result = parsePluginIdentifier("typescript-rules@github:rulesync-community/typescript");

      expect(result).toEqual({
        name: "typescript-rules",
        sourceType: "github",
        sourcePath: "rulesync-community/typescript",
        original: "typescript-rules@github:rulesync-community/typescript",
      });
    });

    it("should parse a URL plugin identifier", () => {
      const result = parsePluginIdentifier("remote-rules@url:https://example.com/plugin.zip");

      expect(result).toEqual({
        name: "remote-rules",
        sourceType: "url",
        sourcePath: "https://example.com/plugin.zip",
        original: "remote-rules@url:https://example.com/plugin.zip",
      });
    });

    it("should parse identifiers with special characters in path", () => {
      const result = parsePluginIdentifier("my-rules@local:./path/with-dashes/and_underscores");

      expect(result).toEqual({
        name: "my-rules",
        sourceType: "local",
        sourcePath: "./path/with-dashes/and_underscores",
        original: "my-rules@local:./path/with-dashes/and_underscores",
      });
    });

    it("should parse identifiers with numbers in name", () => {
      const result = parsePluginIdentifier("rules-v2@local:./rules");

      expect(result).toEqual({
        name: "rules-v2",
        sourceType: "local",
        sourcePath: "./rules",
        original: "rules-v2@local:./rules",
      });
    });
  });

  describe("invalid identifiers", () => {
    it("should return null for missing @ separator", () => {
      const result = parsePluginIdentifier("my-rules-local:../shared");

      expect(result).toBeNull();
    });

    it("should return null for missing : separator", () => {
      const result = parsePluginIdentifier("my-rules@local../shared");

      expect(result).toBeNull();
    });

    it("should return null for invalid source type", () => {
      const result = parsePluginIdentifier("my-rules@invalid:../shared");

      expect(result).toBeNull();
    });

    it("should return null for empty identifier", () => {
      const result = parsePluginIdentifier("");

      expect(result).toBeNull();
    });

    it("should return null for identifier with empty name", () => {
      const result = parsePluginIdentifier("@local:./path");

      expect(result).toBeNull();
    });

    it("should return null for identifier with empty path", () => {
      const result = parsePluginIdentifier("my-rules@local:");

      expect(result).toBeNull();
    });
  });
});

describe("isValidPluginIdentifier", () => {
  it("should return true for valid identifiers", () => {
    expect(isValidPluginIdentifier("my-rules@local:./path")).toBe(true);
    expect(isValidPluginIdentifier("rules@github:owner/repo")).toBe(true);
    expect(isValidPluginIdentifier("rules@url:https://example.com")).toBe(true);
  });

  it("should return false for invalid identifiers", () => {
    expect(isValidPluginIdentifier("")).toBe(false);
    expect(isValidPluginIdentifier("invalid")).toBe(false);
    expect(isValidPluginIdentifier("@local:./path")).toBe(false);
    expect(isValidPluginIdentifier("name@invalid:path")).toBe(false);
  });
});

describe("generatePluginCacheKey", () => {
  it("should generate a safe cache key for local plugins", () => {
    const parsed = parsePluginIdentifier("my-rules@local:../shared-rules");
    expect(parsed).not.toBeNull();
    if (parsed) {
      const key = generatePluginCacheKey(parsed);
      expect(key).toBe("my-rules@local-..-shared-rules");
    }
  });

  it("should generate a safe cache key for GitHub plugins", () => {
    const parsed = parsePluginIdentifier("rules@github:owner/repo");
    expect(parsed).not.toBeNull();
    if (parsed) {
      const key = generatePluginCacheKey(parsed);
      expect(key).toBe("rules@github-owner-repo");
    }
  });

  it("should generate a safe cache key for URL plugins", () => {
    const parsed = parsePluginIdentifier("rules@url:https://example.com/plugin");
    expect(parsed).not.toBeNull();
    if (parsed) {
      const key = generatePluginCacheKey(parsed);
      expect(key).toBe("rules@url-https---example.com-plugin");
    }
  });
});
