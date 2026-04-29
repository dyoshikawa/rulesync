import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { CursorPermissions } from "./cursor-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("CursorPermissions", () => {
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

  describe("getSettablePaths", () => {
    it("should return project path .cursor/cli.json by default", () => {
      const paths = CursorPermissions.getSettablePaths();
      expect(paths).toEqual({ relativeDirPath: ".cursor", relativeFilePath: "cli.json" });
    });

    it("should return global path .cursor/cli-config.json when global=true", () => {
      const paths = CursorPermissions.getSettablePaths({ global: true });
      expect(paths).toEqual({ relativeDirPath: ".cursor", relativeFilePath: "cli-config.json" });
    });
  });

  describe("isDeletable", () => {
    it("should return false because the cli config can hold non-permissions settings", () => {
      const instance = new CursorPermissions({
        relativeDirPath: ".cursor",
        relativeFilePath: "cli.json",
        fileContent: "{}",
      });
      expect(instance.isDeletable()).toBe(false);
    });
  });

  describe("fromRulesyncPermissions", () => {
    it("should convert rulesync allow/deny rules to Cursor allow/deny entries", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "git *": "allow", "rm -rf *": "deny" },
            read: { "src/**": "allow" },
            write: { "src/**": "allow" },
            webfetch: { "github.com": "allow" },
          },
        }),
      });

      const cursorPermissions = await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = JSON.parse(cursorPermissions.getFileContent());
      expect(parsed.permissions.allow).toContain("Shell(git *)");
      expect(parsed.permissions.allow).toContain("Read(src/**)");
      expect(parsed.permissions.allow).toContain("Write(src/**)");
      expect(parsed.permissions.allow).toContain("WebFetch(github.com)");
      expect(parsed.permissions.deny).toContain("Shell(rm -rf *)");
    });

    it("should warn and skip 'ask' rules because Cursor CLI does not support ask", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "git *": "allow", "*": "ask" },
          },
        }),
      });

      const cursorPermissions = await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = JSON.parse(cursorPermissions.getFileContent());
      expect(parsed.permissions.allow).toContain("Shell(git *)");
      expect(JSON.stringify(parsed.permissions.allow)).not.toContain("ask");
      expect(JSON.stringify(parsed.permissions.deny ?? [])).not.toContain("ask");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`do not support the "ask" action`),
      );
    });

    it("should preserve unrelated existing permission entries (e.g. Mcp)", async () => {
      const logger = createMockLogger();
      const cursorDir = join(testDir, ".cursor");
      await ensureDir(cursorDir);
      await writeFileContent(
        join(cursorDir, "cli.json"),
        JSON.stringify({
          version: 1,
          editor: { vimMode: false },
          permissions: {
            allow: ["Mcp(custom:tool)"],
            deny: ["Mcp(dangerous:tool)"],
          },
        }),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            bash: { "git *": "allow" },
          },
        }),
      });

      const cursorPermissions = await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = JSON.parse(cursorPermissions.getFileContent());
      expect(parsed.version).toBe(1);
      expect(parsed.editor).toEqual({ vimMode: false });
      expect(parsed.permissions.allow).toContain("Mcp(custom:tool)");
      expect(parsed.permissions.allow).toContain("Shell(git *)");
      expect(parsed.permissions.deny).toContain("Mcp(dangerous:tool)");
    });

    it("should map per-tool MCP categories to Mcp(server:tool) entries", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            mcp__puppeteer__navigate: { "*": "allow" },
            mcp__github__create_issue: { "*": "deny" },
          },
        }),
      });

      const cursorPermissions = await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = JSON.parse(cursorPermissions.getFileContent());
      expect(parsed.permissions.allow).toContain("Mcp(puppeteer:navigate)");
      expect(parsed.permissions.deny).toContain("Mcp(github:create_issue)");
    });

    it("should default-stamp version: 1 when generating from a fresh config (project)", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: { bash: { "git *": "allow" } },
        }),
      });

      const cursorPermissions = await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = JSON.parse(cursorPermissions.getFileContent());
      expect(parsed.version).toBe(1);
    });

    it("should default-stamp version: 1 when generating from a fresh config (global)", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: { bash: { "git *": "allow" } },
        }),
      });

      const cursorPermissions = await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
        global: true,
      });

      const parsed = JSON.parse(cursorPermissions.getFileContent());
      expect(parsed.version).toBe(1);
    });

    it("should preserve a pre-existing non-1 version value", async () => {
      const logger = createMockLogger();
      const cursorDir = join(testDir, ".cursor");
      await ensureDir(cursorDir);
      await writeFileContent(
        join(cursorDir, "cli.json"),
        JSON.stringify({
          version: 2,
          permissions: {},
        }),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: { bash: { "git *": "allow" } },
        }),
      });

      const cursorPermissions = await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = JSON.parse(cursorPermissions.getFileContent());
      expect(parsed.version).toBe(2);
    });

    it("should write to global path .cursor/cli-config.json when global=true", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: { bash: { "git *": "allow" } },
        }),
      });

      const cursorPermissions = await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
        global: true,
      });

      expect(cursorPermissions.getRelativeDirPath()).toBe(".cursor");
      expect(cursorPermissions.getRelativeFilePath()).toBe("cli-config.json");
    });
  });

  describe("toRulesyncPermissions", () => {
    it("should convert Cursor allow/deny entries back to rulesync permissions", () => {
      const cursorPermissions = new CursorPermissions({
        relativeDirPath: ".cursor",
        relativeFilePath: "cli.json",
        fileContent: JSON.stringify({
          permissions: {
            allow: ["Shell(git *)", "Read(src/**)", "WebFetch(github.com)"],
            deny: ["Shell(rm -rf *)"],
          },
        }),
      });

      const rulesyncPermissions = cursorPermissions.toRulesyncPermissions();
      const json = rulesyncPermissions.getJson();
      expect(json.permission.bash?.["git *"]).toBe("allow");
      expect(json.permission.bash?.["rm -rf *"]).toBe("deny");
      expect(json.permission.read?.["src/**"]).toBe("allow");
      expect(json.permission.webfetch?.["github.com"]).toBe("allow");
    });

    it("should round-trip Mcp(server:tool) entries to per-tool canonical categories", () => {
      const cursorPermissions = new CursorPermissions({
        relativeDirPath: ".cursor",
        relativeFilePath: "cli.json",
        fileContent: JSON.stringify({
          permissions: {
            allow: ["Mcp(puppeteer:navigate)"],
            deny: ["Mcp(github:create_issue)"],
          },
        }),
      });

      const json = cursorPermissions.toRulesyncPermissions().getJson();
      expect(json.permission.mcp__puppeteer__navigate?.["*"]).toBe("allow");
      expect(json.permission.mcp__github__create_issue?.["*"]).toBe("deny");
    });

    it("should treat type-only entries as wildcard pattern", () => {
      const cursorPermissions = new CursorPermissions({
        relativeDirPath: ".cursor",
        relativeFilePath: "cli.json",
        fileContent: JSON.stringify({
          permissions: {
            allow: ["Shell"],
            deny: ["WebFetch"],
          },
        }),
      });

      const json = cursorPermissions.toRulesyncPermissions().getJson();
      expect(json.permission.bash?.["*"]).toBe("allow");
      expect(json.permission.webfetch?.["*"]).toBe("deny");
    });
  });

  describe("fromFile", () => {
    it("should load existing project cli.json", async () => {
      const cursorDir = join(testDir, ".cursor");
      await ensureDir(cursorDir);
      await writeFileContent(
        join(cursorDir, "cli.json"),
        JSON.stringify({
          version: 1,
          permissions: { allow: ["Shell(git *)"], deny: [] },
        }),
      );

      const cursorPermissions = await CursorPermissions.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(cursorPermissions).toBeInstanceOf(CursorPermissions);
      const parsed = JSON.parse(cursorPermissions.getFileContent());
      expect(parsed.permissions.allow).toEqual(["Shell(git *)"]);
    });

    it("should load existing global cli-config.json", async () => {
      const cursorDir = join(testDir, ".cursor");
      await ensureDir(cursorDir);
      await writeFileContent(
        join(cursorDir, "cli-config.json"),
        JSON.stringify({
          version: 1,
          permissions: { allow: ["Shell(ls)"] },
        }),
      );

      const cursorPermissions = await CursorPermissions.fromFile({
        outputRoot: testDir,
        validate: false,
        global: true,
      });
      const parsed = JSON.parse(cursorPermissions.getFileContent());
      expect(parsed.permissions.allow).toEqual(["Shell(ls)"]);
    });

    it("should return default content when the file does not exist", async () => {
      const cursorPermissions = await CursorPermissions.fromFile({
        outputRoot: testDir,
        validate: false,
      });
      expect(cursorPermissions.getFileContent()).toBe('{"permissions":{}}');
    });
  });

  describe("forDeletion", () => {
    it("should return a CursorPermissions with empty permissions block", () => {
      const instance = CursorPermissions.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".cursor",
        relativeFilePath: "cli.json",
      });
      expect(instance).toBeInstanceOf(CursorPermissions);
      expect(JSON.parse(instance.getFileContent())).toEqual({ permissions: {} });
    });
  });

  describe("edit/write category merging", () => {
    it("should merge rulesync 'edit' and 'write' rules into a single Cursor Write entry", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            edit: { "src/**": "allow" },
            write: { "docs/**": "allow" },
          },
        }),
      });

      const cursorPermissions = await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = JSON.parse(cursorPermissions.getFileContent());
      expect(parsed.permissions.allow).toEqual(
        expect.arrayContaining(["Write(src/**)", "Write(docs/**)"]),
      );
      // Ensure the rulesync `edit` category did not leak into a non-existent
      // Cursor `Edit` type.
      expect(JSON.stringify(parsed.permissions.allow)).not.toContain("Edit(");
    });

    it("should deduplicate when 'edit' and 'write' produce the same Cursor entry", async () => {
      const logger = createMockLogger();
      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: {
            edit: { "src/**": "allow" },
            write: { "src/**": "allow" },
          },
        }),
      });

      const cursorPermissions = await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = JSON.parse(cursorPermissions.getFileContent());
      const writeSrcEntries: string[] = (parsed.permissions.allow as string[]).filter(
        (e) => e === "Write(src/**)",
      );
      expect(writeSrcEntries.length).toBe(1);
    });
  });

  describe("malformed input tolerance", () => {
    it("should ignore a non-object root value in the existing config", async () => {
      const logger = createMockLogger();
      const cursorDir = join(testDir, ".cursor");
      await ensureDir(cursorDir);
      // Hand-edited config that erroneously serialized an array at the root.
      await writeFileContent(join(cursorDir, "cli.json"), JSON.stringify(["unexpected"]));

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({ permission: { bash: { ls: "allow" } } }),
      });

      const cursorPermissions = await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = JSON.parse(cursorPermissions.getFileContent());
      expect(parsed.permissions.allow).toContain("Shell(ls)");
    });

    it("should preserve sibling keys and rewrite a non-object permissions field on generate", async () => {
      const logger = createMockLogger();
      const cursorDir = join(testDir, ".cursor");
      await ensureDir(cursorDir);
      // Hand-edited config where `permissions` is a string and another sibling
      // key (`model`) should round-trip untouched.
      await writeFileContent(
        join(cursorDir, "cli.json"),
        JSON.stringify({ permissions: "totally-broken", model: "x" }),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({
          permission: { bash: { "git *": "allow" } },
        }),
      });

      const cursorPermissions = await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      const parsed = JSON.parse(cursorPermissions.getFileContent());
      expect(parsed.model).toBe("x");
      expect(parsed.permissions).toEqual({ allow: ["Shell(git *)"] });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("non-object `permissions` field"),
      );
    });

    it("should ignore non-object permissions field on import", () => {
      const cursorPermissions = new CursorPermissions({
        relativeDirPath: ".cursor",
        relativeFilePath: "cli.json",
        fileContent: JSON.stringify({ permissions: "totally-broken" }),
      });
      const json = cursorPermissions.toRulesyncPermissions().getJson();
      expect(json.permission).toEqual({});
    });

    it("should drop non-string entries from allow/deny on import", () => {
      const cursorPermissions = new CursorPermissions({
        relativeDirPath: ".cursor",
        relativeFilePath: "cli.json",
        fileContent: JSON.stringify({
          permissions: {
            allow: ["Shell(git status)", 42, null, "Read(src/**)"],
            deny: ["Shell(rm -rf *)", { weird: true }],
          },
        }),
      });
      const json = cursorPermissions.toRulesyncPermissions().getJson();
      expect(json.permission.bash?.["git status"]).toBe("allow");
      expect(json.permission.read?.["src/**"]).toBe("allow");
      expect(json.permission.bash?.["rm -rf *"]).toBe("deny");
    });

    it("should fall back to plain 'mcp' canonical category when the Mcp pattern is unrecognized", () => {
      // Forward-compat: future Cursor variants with a different shape (e.g.
      // `server:tool(arg)`) should not silently mangle into the per-tool
      // canonical category.
      const cursorPermissions = new CursorPermissions({
        relativeDirPath: ".cursor",
        relativeFilePath: "cli.json",
        fileContent: JSON.stringify({
          permissions: { allow: ["Mcp(unknown-shape-no-colon)"] },
        }),
      });
      const json = cursorPermissions.toRulesyncPermissions().getJson();
      expect(json.permission.mcp).toBeDefined();
    });

    it("should fall back to plain 'mcp' for multi-colon Mcp patterns", () => {
      // Multi-colon shapes like `Mcp(a:b:c)` are not part of the documented
      // `server:tool` form, so they collapse to the plain `mcp` category
      // rather than producing a per-tool canonical category with a colon
      // smuggled into the tool name.
      const cursorPermissions = new CursorPermissions({
        relativeDirPath: ".cursor",
        relativeFilePath: "cli.json",
        fileContent: JSON.stringify({
          permissions: { allow: ["Mcp(a:b:c)"] },
        }),
      });
      const json = cursorPermissions.toRulesyncPermissions().getJson();
      expect(json.permission.mcp).toBeDefined();
      expect(json.permission.mcp__a__b).toBeUndefined();
    });

    it("should warn when generate-side existing config root is non-object", async () => {
      const logger = createMockLogger();
      const cursorDir = join(testDir, ".cursor");
      await ensureDir(cursorDir);
      await writeFileContent(join(cursorDir, "cli.json"), JSON.stringify(["unexpected"]));

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({ permission: { bash: { ls: "allow" } } }),
      });

      await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("is not a JSON object"));
    });

    it("should warn when generate-side existing allow array contains non-string entries", async () => {
      const logger = createMockLogger();
      const cursorDir = join(testDir, ".cursor");
      await ensureDir(cursorDir);
      await writeFileContent(
        join(cursorDir, "cli.json"),
        JSON.stringify({
          permissions: {
            allow: ["Mcp(custom:tool)", 42],
            deny: [null],
          },
        }),
      );

      const rulesyncPermissions = new RulesyncPermissions({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
        fileContent: JSON.stringify({ permission: { bash: { ls: "allow" } } }),
      });

      await CursorPermissions.fromRulesyncPermissions({
        outputRoot: testDir,
        rulesyncPermissions,
        logger,
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("contains a non-string entry"),
      );
    });
  });
});
