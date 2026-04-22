import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiroPermissions } from "./kiro-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("KiroPermissions", () => {
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

  it("should convert rulesync permissions to Kiro default agent permissions", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow", "rm *": "deny" },
          read: { "src/**": "allow", ".env": "deny" },
          write: { "docs/**": "allow" },
          webfetch: { "*": "allow" },
        },
      }),
    });

    const kiroPermissions = await KiroPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(kiroPermissions.getFileContent());
    expect(content.toolsSettings.shell.allowedCommands).toContain("git *");
    expect(content.toolsSettings.shell.deniedCommands).toContain("rm *");
    expect(content.toolsSettings.read.allowedPaths).toContain("src/**");
    expect(content.toolsSettings.read.deniedPaths).toContain(".env");
    expect(content.toolsSettings.write.allowedPaths).toContain("docs/**");
    expect(content.allowedTools).toContain("web_fetch");
  });

  it("should convert Kiro default agent permissions to rulesync format", () => {
    const kiroPermissions = new KiroPermissions({
      baseDir: testDir,
      relativeDirPath: join(".kiro", "agents"),
      relativeFilePath: "default.json",
      fileContent: JSON.stringify({
        allowedTools: ["web_fetch"],
        toolsSettings: {
          shell: {
            allowedCommands: ["git *"],
            deniedCommands: ["rm *"],
          },
          read: {
            allowedPaths: ["src/**"],
            deniedPaths: [".env"],
          },
          write: {
            allowedPaths: ["docs/**"],
            deniedPaths: ["secrets/**"],
          },
        },
      }),
    });

    const rulesyncPermissions = kiroPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();

    expect(json.permission.bash?.["git *"]).toBe("allow");
    expect(json.permission.bash?.["rm *"]).toBe("deny");
    expect(json.permission.read?.["src/**"]).toBe("allow");
    expect(json.permission.read?.[".env"]).toBe("deny");
    expect(json.permission.write?.["docs/**"]).toBe("allow");
    expect(json.permission.write?.["secrets/**"]).toBe("deny");
    expect(json.permission.webfetch?.["*"]).toBe("allow");
  });

  it("should load existing .kiro/agents/default.json", async () => {
    const kiroDir = join(testDir, ".kiro", "agents");
    await ensureDir(kiroDir);
    await writeFileContent(join(kiroDir, "default.json"), JSON.stringify({ model: "x" }));

    const loaded = await KiroPermissions.fromFile({ baseDir: testDir });
    expect(loaded).toBeInstanceOf(KiroPermissions);
    expect(JSON.parse(loaded.getFileContent()).model).toBe("x");
  });

  it("should remove web tools from allowedTools when denied", async () => {
    const kiroDir = join(testDir, ".kiro", "agents");
    await ensureDir(kiroDir);
    await writeFileContent(
      join(kiroDir, "default.json"),
      JSON.stringify({
        allowedTools: ["web_fetch", "web_search", "read"],
      }),
    );

    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          webfetch: { "*": "deny" },
          websearch: { "*": "deny" },
        },
      }),
    });

    const kiroPermissions = await KiroPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(kiroPermissions.getFileContent());
    expect(content.allowedTools).toEqual(["read"]);
  });
});
