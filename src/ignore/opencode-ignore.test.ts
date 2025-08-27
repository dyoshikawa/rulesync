import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { OpencodeIgnore, OpencodePermissions } from "./opencode-ignore.js";

describe("OpencodeIgnore", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("creates instance with default parameters", () => {
      const ignore = new OpencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "{}",
      });

      expect(ignore.getPatterns()).toEqual([]);
      expect(ignore.getPermissions()).toEqual({});
    });

    it("creates instance with permissions", () => {
      const permissions: OpencodePermissions = {
        read: "allow",
        write: "ask",
        run: "deny",
      };

      const ignore = new OpencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "{}",
        permissions,
      });

      expect(ignore.getPermissions()).toEqual(permissions);
    });
  });

  describe("getPatterns", () => {
    it("returns empty array as OpenCode relies on .gitignore", () => {
      const ignore = new OpencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "{}",
      });

      expect(ignore.getPatterns()).toEqual([]);
    });
  });

  describe("getSupportedFileNames", () => {
    it("returns supported OpenCode configuration files", () => {
      const supportedFiles = OpencodeIgnore.getSupportedFileNames();
      expect(supportedFiles).toEqual(["opencode.json", "AGENTS.md"]);
    });
  });

  describe("getSecurityPatterns", () => {
    it("returns security-focused exclusion patterns", () => {
      const patterns = OpencodeIgnore.getSecurityPatterns();

      expect(patterns).toContain(".env");
      expect(patterns).toContain("*.key");
      expect(patterns).toContain("*.pem");
      expect(patterns).toContain("secrets/");
      expect(patterns).toContain("credentials/");
    });
  });

  describe("createWithDefaultRules", () => {
    it("creates instance with default security rules", () => {
      const ignore = OpencodeIgnore.createWithDefaultRules({
        baseDir: testDir,
      });

      const permissions = ignore.getPermissions();
      expect(permissions.read).toBeDefined();
      expect(permissions.write).toBeDefined();
      expect(permissions.run).toBe("ask");

      // Check that security patterns are applied
      if (
        typeof permissions.read === "object" &&
        permissions.read &&
        "patterns" in permissions.read
      ) {
        expect(permissions.read.patterns[".env"]).toBe("deny");
        expect(permissions.read.patterns["*.key"]).toBe("deny");
      }
    });

    it("generates proper opencode.json content", () => {
      const ignore = OpencodeIgnore.createWithDefaultRules();
      const json = ignore.generateOpencodeJson();
      const parsed = JSON.parse(json);

      expect(parsed.$schema).toBe("https://opencode.ai/config.json");
      expect(parsed.permission).toBeDefined();
    });
  });

  describe("fromFilePath", () => {
    it("loads OpenCode configuration from file", async () => {
      const configPath = join(testDir, "opencode.json");
      const configContent = {
        $schema: "https://opencode.ai/config.json",
        permission: {
          read: "allow",
          write: "ask",
          run: "deny",
        },
      };

      await writeFile(configPath, JSON.stringify(configContent, null, 2));

      const ignore = await OpencodeIgnore.fromFilePath({ filePath: configPath });

      expect(ignore.getPermissions()).toEqual(configContent.permission);
    });

    it("handles file with complex permission patterns", async () => {
      const configPath = join(testDir, "opencode.json");
      const configContent = {
        permission: {
          read: {
            default: "allow",
            patterns: {
              ".env*": "deny",
              "secrets/**": "deny",
            },
          },
          write: {
            default: "ask",
            patterns: {
              "*.md": "allow",
              "src/**/*.ts": "allow",
            },
          },
        },
      };

      await writeFile(configPath, JSON.stringify(configContent, null, 2));

      const ignore = await OpencodeIgnore.fromFilePath({ filePath: configPath });
      const permissions = ignore.getPermissions();

      expect(permissions.read).toEqual(configContent.permission.read);
      expect(permissions.write).toEqual(configContent.permission.write);
    });

    it("throws error for invalid JSON", async () => {
      const configPath = join(testDir, "invalid.json");
      await writeFile(configPath, "{ invalid json");

      await expect(OpencodeIgnore.fromFilePath({ filePath: configPath })).rejects.toThrow(
        "Invalid JSON",
      );
    });

    it("handles file without permission section", async () => {
      const configPath = join(testDir, "opencode.json");
      const configContent = {
        $schema: "https://opencode.ai/config.json",
        provider: "openai",
        model: "gpt-4",
      };

      await writeFile(configPath, JSON.stringify(configContent, null, 2));

      const ignore = await OpencodeIgnore.fromFilePath({ filePath: configPath });

      expect(ignore.getPermissions()).toEqual({});
    });
  });

  describe("toRulesyncIgnore", () => {
    it("converts to RulesyncIgnore with proper format", () => {
      const permissions: OpencodePermissions = {
        read: {
          default: "allow",
          patterns: {
            ".env*": "deny",
            "secrets/**": "deny",
          },
        },
      };

      const ignore = new OpencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "{}",
        permissions,
      });

      const rulesyncIgnore = ignore.toRulesyncIgnore();

      expect(rulesyncIgnore.getFrontmatter().targets).toEqual(["opencode"]);
      expect(rulesyncIgnore.getBody()).toContain("Generated from OpenCode permissions");
      expect(rulesyncIgnore.getBody()).toContain(".env*");
      expect(rulesyncIgnore.getBody()).toContain("secrets/**");
    });
  });

  describe("fromRulesyncIgnore", () => {
    it("creates OpencodeIgnore from RulesyncIgnore", async () => {
      // Create a mock RulesyncIgnore
      const mockRulesyncIgnore = {
        getBody: () => `# Test patterns
.env
*.key
secrets/`,
        getFrontmatter: () => ({ targets: ["opencode"] }),
      };

      const ignore = OpencodeIgnore.fromRulesyncIgnore({
        baseDir: testDir,
        relativeDirPath: ".",

        rulesyncIgnore: mockRulesyncIgnore as any,
      });

      const permissions = ignore.getPermissions();
      expect(permissions.read).toBeDefined();
      expect(permissions.write).toBeDefined();

      if (
        typeof permissions.read === "object" &&
        permissions.read &&
        "patterns" in permissions.read
      ) {
        expect(permissions.read.patterns[".env"]).toBe("deny");
        expect(permissions.read.patterns["*.key"]).toBe("deny");
        expect(permissions.read.patterns["secrets/"]).toBe("deny");
      }
    });
  });

  describe("generateOpencodeJson", () => {
    it("generates valid OpenCode JSON configuration", () => {
      const permissions: OpencodePermissions = {
        read: "allow",
        write: "ask",
        run: "deny",
      };

      const ignore = new OpencodeIgnore({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
        fileContent: "{}",
        permissions,
      });

      const json = ignore.generateOpencodeJson();
      const parsed = JSON.parse(json);

      expect(parsed.$schema).toBe("https://opencode.ai/config.json");
      expect(parsed.permission).toEqual(permissions);
    });
  });
});
