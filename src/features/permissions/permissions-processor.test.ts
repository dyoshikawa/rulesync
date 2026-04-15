import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import { ClaudecodePermissions } from "./claudecode-permissions.js";
import { CodexcliPermissions } from "./codexcli-permissions.js";
import { GeminicliPermissions } from "./geminicli-permissions.js";
import { OpencodePermissions } from "./opencode-permissions.js";
import { PermissionsProcessor } from "./permissions-processor.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

const logger = createMockLogger();

describe("PermissionsProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create instance with default baseDir", () => {
      const processor = new PermissionsProcessor({ logger, toolTarget: "claudecode" });

      expect(processor).toBeInstanceOf(PermissionsProcessor);
    });

    it("should create instance with custom baseDir", () => {
      const processor = new PermissionsProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      expect(processor).toBeInstanceOf(PermissionsProcessor);
    });

    it("should validate toolTarget parameter", () => {
      expect(() => {
        const _instance = new PermissionsProcessor({
          logger,
          baseDir: testDir,
          toolTarget: "invalid-target" as any,
        });
      }).toThrow();
    });

    it("should accept claudecode tool target", () => {
      expect(() => {
        const _instance = new PermissionsProcessor({
          logger,
          baseDir: testDir,
          toolTarget: "claudecode",
        });
      }).not.toThrow();
    });
  });

  describe("getToolTargets", () => {
    it("should return claudecode, codexcli, geminicli and opencode for project mode", () => {
      const targets = PermissionsProcessor.getToolTargets();
      expect(targets).toEqual(["claudecode", "codexcli", "geminicli", "opencode"]);
    });

    it("should return claudecode, codexcli, geminicli and opencode for global mode", () => {
      const targets = PermissionsProcessor.getToolTargets({ global: true });
      expect(targets).toEqual(["claudecode", "codexcli", "geminicli", "opencode"]);
    });

    it("should return importable targets", () => {
      const targets = PermissionsProcessor.getToolTargets({ importOnly: true });
      expect(targets).toEqual(["claudecode", "codexcli", "geminicli", "opencode"]);
    });
  });

  describe("loadRulesyncFiles", () => {
    it("should load rulesync permissions file", async () => {
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);
      await writeFileContent(
        join(rulesyncDir, RULESYNC_PERMISSIONS_FILE_NAME),
        JSON.stringify({
          permission: {
            bash: { "*": "ask", "git *": "allow" },
          },
        }),
      );

      const processor = new PermissionsProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const files = await processor.loadRulesyncFiles();

      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(RulesyncPermissions);
    });

    it("should return empty array when permissions file does not exist", async () => {
      const processor = new PermissionsProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const files = await processor.loadRulesyncFiles();

      expect(files).toHaveLength(0);
    });
  });

  describe("loadToolFiles", () => {
    it("should load Claude Code settings.json", async () => {
      const settingsDir = join(testDir, ".claude");
      await ensureDir(settingsDir);
      await writeFileContent(
        join(settingsDir, "settings.json"),
        JSON.stringify({
          permissions: {
            allow: ["Bash(npm *)"],
          },
        }),
      );

      const processor = new PermissionsProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const files = await processor.loadToolFiles();

      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(ClaudecodePermissions);
    });

    it("should return non-deletable files for forDeletion", async () => {
      const processor = new PermissionsProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const files = await processor.loadToolFiles({ forDeletion: true });

      // ClaudecodePermissions.isDeletable() returns false, so should be empty
      expect(files).toHaveLength(0);
    });

    it("should load OpenCode opencode.jsonc", async () => {
      await writeFileContent(
        join(testDir, "opencode.jsonc"),
        JSON.stringify({
          permission: {
            bash: { "git *": "allow" },
          },
        }),
      );

      const processor = new PermissionsProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const files = await processor.loadToolFiles();

      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(OpencodePermissions);
    });

    it("should load Codex CLI .codex/config.toml", async () => {
      const codexDir = join(testDir, ".codex");
      await ensureDir(codexDir);
      await writeFileContent(
        join(codexDir, "config.toml"),
        `
default_permissions = "rulesync"

[permissions.rulesync.filesystem]
"/workspace/project" = "read"
`,
      );

      const processor = new PermissionsProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "codexcli",
      });

      const files = await processor.loadToolFiles();

      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(CodexcliPermissions);
    });

    it("should load Gemini CLI .gemini/settings.json", async () => {
      const geminiDir = join(testDir, ".gemini");
      await ensureDir(geminiDir);
      await writeFileContent(
        join(geminiDir, "settings.json"),
        JSON.stringify({
          tools: {
            allowed: ["run_shell_command(git status)"],
          },
        }),
      );

      const processor = new PermissionsProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "geminicli",
      });

      const files = await processor.loadToolFiles();

      expect(files).toHaveLength(1);
      expect(files[0]).toBeInstanceOf(GeminicliPermissions);
    });
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should convert rulesync permissions to Claude Code tool files", async () => {
      const rulesyncPermissions = new RulesyncPermissions({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "npm *": "allow", "rm *": "deny" },
            edit: { "src/**": "allow" },
          },
        }),
      });

      const processor = new PermissionsProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const toolFiles = await processor.convertRulesyncFilesToToolFiles([rulesyncPermissions]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]).toBeInstanceOf(ClaudecodePermissions);

      const content = JSON.parse(toolFiles[0]!.getFileContent());
      expect(content.permissions.allow).toContain("Bash(npm *)");
      expect(content.permissions.allow).toContain("Edit(src/**)");
      expect(content.permissions.deny).toContain("Bash(rm *)");
    });

    it("should throw when no rulesync permissions file is provided", async () => {
      const processor = new PermissionsProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      await expect(processor.convertRulesyncFilesToToolFiles([])).rejects.toThrow(
        "No .rulesync/permissions.json found.",
      );
    });
  });

  describe("convertToolFilesToRulesyncFiles", () => {
    it("should convert Claude Code permissions to rulesync format", async () => {
      const claudePermissions = new ClaudecodePermissions({
        baseDir: testDir,
        relativeDirPath: ".claude",
        relativeFilePath: "settings.json",
        fileContent: JSON.stringify({
          permissions: {
            allow: ["Bash(npm *)"],
            deny: ["Bash(rm *)"],
          },
        }),
      });

      const processor = new PermissionsProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles([claudePermissions]);

      expect(rulesyncFiles).toHaveLength(1);
      expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncPermissions);

      const config = (rulesyncFiles[0] as RulesyncPermissions).getJson();
      expect(config.permission.bash!["npm *"]).toBe("allow");
      expect(config.permission.bash!["rm *"]).toBe("deny");
    });
  });

  describe("end-to-end generate flow", () => {
    it("should generate Claude Code settings.json from rulesync permissions", async () => {
      // Set up rulesync permissions
      const rulesyncDir = join(testDir, RULESYNC_RELATIVE_DIR_PATH);
      await ensureDir(rulesyncDir);
      await writeFileContent(
        join(rulesyncDir, RULESYNC_PERMISSIONS_FILE_NAME),
        JSON.stringify({
          permission: {
            bash: { "npm *": "allow", "git commit *": "allow", "rm *": "deny" },
            read: { ".env": "deny" },
            webfetch: { "domain:github.com": "allow" },
          },
        }),
      );

      const processor = new PermissionsProcessor({
        logger,
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      expect(rulesyncFiles).toHaveLength(1);

      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      expect(toolFiles).toHaveLength(1);

      await processor.writeAiFiles(toolFiles);

      const settingsPath = join(testDir, ".claude", "settings.json");
      const content = JSON.parse(await readFileContent(settingsPath));

      expect(content.permissions.allow).toContain("Bash(git commit *)");
      expect(content.permissions.allow).toContain("Bash(npm *)");
      expect(content.permissions.allow).toContain("WebFetch(domain:github.com)");
      expect(content.permissions.deny).toContain("Bash(rm *)");
      expect(content.permissions.deny).toContain("Read(.env)");
    });
  });
});
