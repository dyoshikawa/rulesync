import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, fileExists, writeFileContent } from "../../utils/file.js";
import { QwencodePermissions } from "./qwencode-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("QwencodePermissions", () => {
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

  it("should resolve settable paths", () => {
    expect(QwencodePermissions.getSettablePaths()).toEqual({
      relativeDirPath: ".qwen",
      relativeFilePath: "settings.json",
    });
  });

  it("should convert rulesync permissions into Qwen settings.json format", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow", "rm *": "deny", "*": "ask" },
          read: { ".env": "deny" },
          webfetch: { "github.com": "allow" },
        },
      }),
    });

    const instance = await QwencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(instance.getFileContent());
    expect(content.permissions.allow).toContain("Bash(git *)");
    expect(content.permissions.allow).toContain("WebFetch(github.com)");
    expect(content.permissions.ask).toContain("Bash");
    expect(content.permissions.deny).toContain("Bash(rm *)");
    expect(content.permissions.deny).toContain("Read(.env)");
  });

  it("should preserve unrelated keys in existing settings.json", async () => {
    const settingsDir = join(testDir, ".qwen");
    await ensureDir(settingsDir);
    await writeFileContent(
      join(settingsDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        permissions: { allow: ["Bash(npm *)"] },
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { read: { "src/**": "allow" } },
      }),
    });

    const instance = await QwencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(instance.getFileContent());
    expect(content.theme).toBe("dark");
    // Bash entry preserved (not managed)
    expect(content.permissions.allow).toContain("Bash(npm *)");
    // New Read entry added
    expect(content.permissions.allow).toContain("Read(src/**)");
  });

  it("should round-trip Qwen settings to rulesync permissions", () => {
    const instance = new QwencodePermissions({
      relativeDirPath: ".qwen",
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        permissions: {
          allow: ["Bash(npm run *)", "Read(src/**)"],
          ask: ["Bash(git push *)"],
          deny: ["Bash(rm -rf *)"],
        },
      }),
    });

    const config = instance.toRulesyncPermissions().getJson();
    expect(config.permission.bash).toEqual({
      "npm run *": "allow",
      "git push *": "ask",
      "rm -rf *": "deny",
    });
    expect(config.permission.read).toEqual({ "src/**": "allow" });
  });

  it("forDeletion returns non-deletable instance", () => {
    const instance = QwencodePermissions.forDeletion({
      outputRoot: testDir,
      relativeDirPath: ".qwen",
      relativeFilePath: "settings.json",
    });
    expect(instance.isDeletable()).toBe(false);
  });

  it("should round-trip patterns containing nested parentheses (single, sequential, and multi-nest)", () => {
    const instance = new QwencodePermissions({
      relativeDirPath: ".qwen",
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        permissions: {
          allow: [
            // Single-level nesting (baseline).
            "Bash(echo (a))",
            "Bash(grep (foo|bar))",
            // Sequential parens at the same nesting level — each opens and closes before the next.
            "Bash(grep (foo) | wc (-l))",
            // Multi-level nesting — `lastIndexOf(')')` must still anchor on the outermost `)`.
            "Bash(echo ((deep)))",
          ],
        },
      }),
    });

    const config = instance.toRulesyncPermissions().getJson();
    // Last `)` is used as the closing delimiter so all inner parens (single, sequential, deep) are preserved.
    expect(config.permission.bash).toEqual({
      "echo (a)": "allow",
      "grep (foo|bar)": "allow",
      "grep (foo) | wc (-l)": "allow",
      "echo ((deep))": "allow",
    });
  });

  it("should warn on malformed entries with trailing characters and fall back to '*'", () => {
    const instance = new QwencodePermissions({
      relativeDirPath: ".qwen",
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        permissions: {
          // Malformed: trailing chars after closing paren.
          allow: ["Bash(npm *)trailing"],
        },
      }),
    });

    // Round-trip uses the parser internally.
    const config = instance.toRulesyncPermissions().getJson();
    expect(config.permission.bash).toEqual({ "*": "allow" });
  });

  it("should not create the .qwen directory when generating with no existing file (dry-run safe)", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify({
        permission: { bash: { "git *": "allow" } },
      }),
    });

    await QwencodePermissions.fromRulesyncPermissions({
      outputRoot: testDir,
      rulesyncPermissions,
    });

    // The construction phase MUST NOT create the destination file/directory; that is
    // performed only by `writeAiFiles`. This protects dry-run mode.
    expect(await fileExists(join(testDir, ".qwen"))).toBe(false);
    expect(await fileExists(join(testDir, ".qwen", "settings.json"))).toBe(false);
  });
});
