import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { GeminicliPermissions } from "./geminicli-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";

describe("GeminicliPermissions", () => {
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

  it("should convert rulesync permissions to Gemini CLI tools allowed/exclude", async () => {
    const rulesyncPermissions = new RulesyncPermissions({
      baseDir: testDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: "permissions.json",
      fileContent: JSON.stringify({
        permission: {
          bash: { "git *": "allow", "rm *": "deny" },
          read: { "src/**": "allow" },
        },
      }),
    });

    const geminiPermissions = await GeminicliPermissions.fromRulesyncPermissions({
      baseDir: testDir,
      rulesyncPermissions,
    });

    const content = JSON.parse(geminiPermissions.getFileContent());
    expect(content.tools.allowed).toContain("run_shell_command(git *)");
    expect(content.tools.allowed).toContain("read_file(src/**)");
    expect(content.tools.exclude).toContain("run_shell_command(rm *)");
  });

  it("should convert Gemini CLI tools allowed/exclude to rulesync format", () => {
    const geminiPermissions = new GeminicliPermissions({
      baseDir: testDir,
      relativeDirPath: ".gemini",
      relativeFilePath: "settings.json",
      fileContent: JSON.stringify({
        tools: {
          allowed: ["run_shell_command(git *)", "read_file(src/**)"],
          exclude: ["run_shell_command(rm *)"],
        },
      }),
    });

    const rulesyncPermissions = geminiPermissions.toRulesyncPermissions();
    const json = rulesyncPermissions.getJson();

    expect(json.permission.bash?.["git *"]).toBe("allow");
    expect(json.permission.read?.["src/**"]).toBe("allow");
    expect(json.permission.bash?.["rm *"]).toBe("deny");
  });

  it("should load existing .gemini/settings.json", async () => {
    const geminiDir = join(testDir, ".gemini");
    await ensureDir(geminiDir);
    await writeFileContent(join(geminiDir, "settings.json"), JSON.stringify({ model: "x" }));

    const loaded = await GeminicliPermissions.fromFile({ baseDir: testDir });
    expect(loaded).toBeInstanceOf(GeminicliPermissions);
    expect(JSON.parse(loaded.getFileContent()).model).toBe("x");
  });
});
