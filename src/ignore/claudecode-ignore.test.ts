import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { ClaudecodeIgnore, ClaudecodePermissions } from "./claudecode-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";

describe("ClaudecodeIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create ClaudecodeIgnore with permissions", () => {
      const permissions: ClaudecodePermissions = {
        deny: ["Edit(*.env)", "Bash(rm:*)"],
        allow: ["Edit(public/**)", "Bash(npm test)"],
        defaultMode: "acceptEdits",
      };

      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        permissions,
        fileContent: JSON.stringify({ permissions }, null, 2),
      });

      expect(claudecodeIgnore.getPermissions()).toEqual(permissions);
      expect(claudecodeIgnore.getPatterns()).toEqual(["*.env"]); // Extracted file patterns
    });

    it("should create ClaudecodeIgnore with empty permissions", () => {
      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: "{}",
      });

      expect(claudecodeIgnore.getPermissions()).toEqual({});
      expect(claudecodeIgnore.getPatterns()).toEqual([]);
    });

    it("should extract file patterns from permission rules", () => {
      const permissions: ClaudecodePermissions = {
        deny: ["Edit(src/**)", "Read(secrets/**)", "Bash(rm:*)", "WebFetch", "mcp__server__tool"],
      };

      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        permissions,
        fileContent: JSON.stringify({ permissions }, null, 2),
      });

      expect(claudecodeIgnore.getPatterns()).toEqual(["src/**", "secrets/**"]);
    });
  });

  describe("toRulesyncIgnore", () => {
    it("should convert ClaudecodeIgnore to RulesyncIgnore", () => {
      const permissions: ClaudecodePermissions = {
        deny: ["Edit(*.env)", "Read(secrets/**)", "Bash(sudo:*)", "WebFetch"],
        defaultMode: "acceptEdits",
      };

      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        permissions,
        fileContent: JSON.stringify({ permissions }, null, 2),
      });

      const rulesyncIgnore = claudecodeIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.relativeDirPath).toBe(".");
      expect(rulesyncIgnore.relativeFilePath).toBe(".rulesyncignore");

      const body = rulesyncIgnore.getBody();
      expect(body).toContain("# Generated from Claude Code permissions");
      expect(body).toContain("# File access restrictions");
      expect(body).toContain("*.env");
      expect(body).toContain("secrets/**");
      expect(body).toContain("# Other restrictions (not file patterns):");
      expect(body).toContain("# Bash(sudo:*)");
      expect(body).toContain("# WebFetch");
    });

    it("should handle empty permissions", () => {
      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: "{}",
      });

      const rulesyncIgnore = claudecodeIgnore.toRulesyncIgnore();
      const body = rulesyncIgnore.getBody();

      expect(body).toContain("# Generated from Claude Code permissions");
      expect(body).not.toContain("# File access restrictions");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("should create ClaudecodeIgnore from RulesyncIgnore", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["claudecode"],
          description: "Test ignore rules",
        },
        body: "*.env\nsecrets/**\nnode_modules/",
        fileContent: "Test content",
      });

      const claudecodeIgnore = ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        rulesyncIgnore,
      });

      const permissions = claudecodeIgnore.getPermissions();
      expect(permissions.deny).toContain("Edit(*.env)");
      expect(permissions.deny).toContain("Edit(secrets/**)");
      expect(permissions.deny).toContain("Edit(node_modules/)");

      // Should include default deny rules
      expect(permissions.deny).toContain("Edit(.env*)");
      expect(permissions.deny).toContain("Bash(rm -rf /*)");
      expect(permissions.deny).toContain("WebFetch");
    });

    it("should handle empty patterns", () => {
      const rulesyncIgnore = new RulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".rulesync/ignore",
        relativeFilePath: "empty.md",
        frontmatter: {
          targets: ["claudecode"],
          description: "Empty ignore rules",
        },
        body: "",
        fileContent: "",
      });

      const claudecodeIgnore = ClaudecodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        rulesyncIgnore,
      });

      const permissions = claudecodeIgnore.getPermissions();
      // Should still include default deny rules
      expect(permissions.deny).toContain("Edit(.env*)");
      expect(permissions.deny).toContain("Bash(rm -rf /*)");
    });
  });

  describe("fromFilePath", () => {
    it("should load ClaudecodeIgnore from valid settings.json", async () => {
      const permissions = {
        deny: ["Edit(*.env)", "Bash(rm:*)", "WebFetch"],
        allow: ["Bash(npm test)"],
        defaultMode: "acceptEdits",
      };

      const settings = { permissions };
      const filePath = join(testDir, "settings.json");
      await writeFile(filePath, JSON.stringify(settings, null, 2));

      const claudecodeIgnore = await ClaudecodeIgnore.fromFilePath({ filePath });

      expect(claudecodeIgnore.getPermissions()).toEqual(permissions);
      expect(claudecodeIgnore.getRelativeFilePath()).toBe("settings.json");
    });

    it("should handle settings.json without permissions", async () => {
      const settings = {
        someOtherConfig: "value",
      };

      const filePath = join(testDir, "settings.json");
      await writeFile(filePath, JSON.stringify(settings, null, 2));

      const claudecodeIgnore = await ClaudecodeIgnore.fromFilePath({ filePath });

      expect(claudecodeIgnore.getPermissions()).toEqual({});
    });

    it("should throw error for invalid JSON", async () => {
      const filePath = join(testDir, "invalid.json");
      await writeFile(filePath, "{ invalid json }");

      await expect(ClaudecodeIgnore.fromFilePath({ filePath })).rejects.toThrow(/Invalid JSON/);
    });

    it("should throw error for invalid permissions", async () => {
      const settings = {
        permissions: {
          deny: "not-an-array", // Invalid: should be array
        },
      };

      const filePath = join(testDir, "invalid-permissions.json");
      await writeFile(filePath, JSON.stringify(settings, null, 2));

      await expect(ClaudecodeIgnore.fromFilePath({ filePath })).rejects.toThrow(
        /Invalid permissions/,
      );
    });
  });

  describe("generateSettingsJson", () => {
    it("should generate valid settings.json", () => {
      const permissions: ClaudecodePermissions = {
        deny: ["Edit(*.env)", "Bash(sudo:*)"],
        allow: ["Bash(npm test)"],
        defaultMode: "acceptEdits",
      };

      const claudecodeIgnore = new ClaudecodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        permissions,
        fileContent: "",
      });

      const json = claudecodeIgnore.generateSettingsJson();
      const parsed = JSON.parse(json);

      expect(parsed.permissions).toEqual(permissions);
    });
  });

  describe("getDefaultDenyRules", () => {
    it("should return security-focused default deny rules", () => {
      const defaultRules = ClaudecodeIgnore.getDefaultDenyRules();

      expect(defaultRules).toContain("Edit(.env*)");
      expect(defaultRules).toContain("Read(.env*)");
      expect(defaultRules).toContain("Edit(*.key)");
      expect(defaultRules).toContain("Bash(rm -rf /*)");
      expect(defaultRules).toContain("Bash(sudo:*)");
      expect(defaultRules).toContain("WebFetch");
      expect(defaultRules).toContain("WebSearch");
      expect(defaultRules.length).toBeGreaterThan(10);
    });
  });

  describe("createWithDefaultRules", () => {
    it("should create ClaudecodeIgnore with default security rules", () => {
      const claudecodeIgnore = ClaudecodeIgnore.createWithDefaultRules({
        baseDir: testDir,
      });

      const permissions = claudecodeIgnore.getPermissions();
      expect(permissions.deny).toContain("Edit(.env*)");
      expect(permissions.deny).toContain("Bash(rm -rf /*)");
      expect(permissions.defaultMode).toBe("acceptEdits");
    });

    it("should use default parameters if none provided", () => {
      const claudecodeIgnore = ClaudecodeIgnore.createWithDefaultRules();

      expect(claudecodeIgnore.getRelativeDirPath()).toBe(".claude");
      expect(claudecodeIgnore.getRelativeFilePath()).toBe("settings.json");
    });
  });

  describe("getSupportedFileNames", () => {
    it("should return supported Claude Code settings filenames", () => {
      const supportedNames = ClaudecodeIgnore.getSupportedFileNames();

      expect(supportedNames).toContain("settings.json");
      expect(supportedNames).toContain("settings.local.json");
      expect(supportedNames).toContain("managed-settings.json");
      expect(supportedNames.length).toBe(3);
    });
  });

  describe("permission rule parsing", () => {
    it("should extract file patterns correctly", () => {
      const patterns = [
        "Edit(src/**)",
        "Read(*.env)",
        "Bash(rm:*)",
        "WebFetch",
        "mcp__server__tool",
      ];

      const filePatterns = ClaudecodeIgnore["extractFilePatterns"](patterns);

      expect(filePatterns).toEqual(["src/**", "*.env"]);
    });

    it("should parse permission rules correctly", () => {
      const parseRule = ClaudecodeIgnore["parsePermissionRule"];

      expect(parseRule("Edit(src/**)")).toEqual({ type: "edit", pattern: "src/**" });
      expect(parseRule("Read(*.env)")).toEqual({ type: "read", pattern: "*.env" });
      expect(parseRule("Bash(sudo:*)")).toEqual({ type: "bash", pattern: "sudo:*" });
      expect(parseRule("WebFetch(domain:example.com)")).toEqual({
        type: "webfetch",
        pattern: "domain:example.com",
      });
      expect(parseRule("mcp__server__tool")).toEqual({
        type: "mcp",
        pattern: "mcp__server__tool",
      });
      expect(parseRule("SomeTool")).toEqual({ type: "tool", pattern: "SomeTool" });
    });

    it("should identify file operation rules correctly", () => {
      const isFileOp = ClaudecodeIgnore["isFileOperationRule"];

      expect(isFileOp("Edit(src/**)")).toBe(true);
      expect(isFileOp("Read(*.env)")).toBe(true);
      expect(isFileOp("Bash(sudo:*)")).toBe(false);
      expect(isFileOp("WebFetch")).toBe(false);
      expect(isFileOp("mcp__server__tool")).toBe(false);
    });
  });
});
