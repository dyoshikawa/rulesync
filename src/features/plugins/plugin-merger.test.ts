import { describe, expect, it } from "vitest";

import { mergeFiles, MergeableFile } from "./plugin-merger.js";

const createLocalFile = (relativePath: string): MergeableFile => ({
  source: "local",
  relativePath,
  absolutePath: `/project/.rulesync/rules/${relativePath}`,
});

const createPluginFile = (relativePath: string, pluginName: string): MergeableFile => ({
  source: "plugin",
  pluginName,
  relativePath,
  absolutePath: `/plugins/${pluginName}/rules/${relativePath}`,
});

describe("mergeFiles", () => {
  describe("no conflicts", () => {
    it("should merge local and plugin files when no conflicts", () => {
      const localFiles = [createLocalFile("local-rule.md")];
      const pluginFiles = [createPluginFile("plugin-rule.md", "my-plugin")];

      const result = mergeFiles({
        localFiles,
        pluginFiles,
        strategy: "local-first",
      });

      expect(result.files).toHaveLength(2);
      expect(result.files.map((f) => f.relativePath)).toContain("local-rule.md");
      expect(result.files.map((f) => f.relativePath)).toContain("plugin-rule.md");
      expect(result.resolvedConflicts).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should include all files from multiple plugins", () => {
      const localFiles: MergeableFile[] = [];
      const pluginFiles = [
        createPluginFile("rule1.md", "plugin-a"),
        createPluginFile("rule2.md", "plugin-b"),
      ];

      const result = mergeFiles({
        localFiles,
        pluginFiles,
        strategy: "local-first",
      });

      expect(result.files).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("local-first strategy", () => {
    it("should keep local file when conflict with plugin", () => {
      const localFiles = [createLocalFile("coding.md")];
      const pluginFiles = [createPluginFile("coding.md", "my-plugin")];

      const result = mergeFiles({
        localFiles,
        pluginFiles,
        strategy: "local-first",
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.source).toBe("local");
      expect(result.resolvedConflicts).toHaveLength(1);
      expect(result.resolvedConflicts[0]).toEqual({
        relativePath: "coding.md",
        winner: "local",
        pluginName: "my-plugin",
      });
    });
  });

  describe("plugin-first strategy", () => {
    it("should use plugin file when conflict with local", () => {
      const localFiles = [createLocalFile("coding.md")];
      const pluginFiles = [createPluginFile("coding.md", "my-plugin")];

      const result = mergeFiles({
        localFiles,
        pluginFiles,
        strategy: "plugin-first",
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.source).toBe("plugin");
      expect(result.files[0]?.pluginName).toBe("my-plugin");
      expect(result.resolvedConflicts).toHaveLength(1);
      expect(result.resolvedConflicts[0]?.winner).toBe("plugin");
    });
  });

  describe("error-on-conflict strategy", () => {
    it("should report error when local and plugin conflict", () => {
      const localFiles = [createLocalFile("coding.md")];
      const pluginFiles = [createPluginFile("coding.md", "my-plugin")];

      const result = mergeFiles({
        localFiles,
        pluginFiles,
        strategy: "error-on-conflict",
      });

      expect(result.files).toHaveLength(1); // Only local file is kept
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Conflict between local");
      expect(result.errors[0]).toContain("my-plugin");
    });
  });

  describe("plugin-to-plugin conflicts", () => {
    it("should always error when two plugins have the same file", () => {
      const localFiles: MergeableFile[] = [];
      const pluginFiles = [
        createPluginFile("shared-rule.md", "plugin-a"),
        createPluginFile("shared-rule.md", "plugin-b"),
      ];

      const result = mergeFiles({
        localFiles,
        pluginFiles,
        strategy: "local-first", // Strategy doesn't matter for plugin conflicts
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Conflict between plugins");
      expect(result.errors[0]).toContain("plugin-a");
      expect(result.errors[0]).toContain("plugin-b");
    });
  });

  describe("multiple conflicts", () => {
    it("should handle multiple conflicts correctly", () => {
      const localFiles = [
        createLocalFile("rule1.md"),
        createLocalFile("rule2.md"),
        createLocalFile("rule3.md"),
      ];
      const pluginFiles = [
        createPluginFile("rule1.md", "plugin-a"),
        createPluginFile("rule2.md", "plugin-b"),
        createPluginFile("rule4.md", "plugin-c"),
      ];

      const result = mergeFiles({
        localFiles,
        pluginFiles,
        strategy: "local-first",
      });

      expect(result.files).toHaveLength(4); // rule1, rule2, rule3, rule4
      expect(result.resolvedConflicts).toHaveLength(2); // rule1 and rule2 conflicts
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("empty inputs", () => {
    it("should handle empty local files", () => {
      const pluginFiles = [createPluginFile("rule.md", "my-plugin")];

      const result = mergeFiles({
        localFiles: [],
        pluginFiles,
        strategy: "local-first",
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.source).toBe("plugin");
    });

    it("should handle empty plugin files", () => {
      const localFiles = [createLocalFile("rule.md")];

      const result = mergeFiles({
        localFiles,
        pluginFiles: [],
        strategy: "local-first",
      });

      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.source).toBe("local");
    });

    it("should handle both empty", () => {
      const result = mergeFiles({
        localFiles: [],
        pluginFiles: [],
        strategy: "local-first",
      });

      expect(result.files).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });
});
