import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import {
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

describe("E2E: permissions", () => {
  const { getTestDir } = useTestDirectory();

  it("should generate opencode permissions from .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "git *": "allow" },
            read: { ".env": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({ target: "opencode", features: "permissions" });

    const content = JSON.parse(await readFileContent(join(testDir, "opencode.jsonc")));
    expect(content.permission.bash["git *"]).toBe("allow");
    expect(content.permission.read[".env"]).toBe("deny");
  });
});

describe("E2E: permissions (import)", () => {
  const { getTestDir } = useTestDirectory();

  it("should import opencode permissions into .rulesync/permissions.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify(
        {
          permission: {
            bash: { "*": "ask", "npm *": "allow" },
            read: { ".env": "deny" },
          },
        },
        null,
        2,
      ),
    );

    await runImport({ target: "opencode", features: "permissions" });

    const content = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH)),
    );
    expect(content.permission.bash["npm *"]).toBe("allow");
    expect(content.permission.read[".env"]).toBe("deny");
  });
});

describe("E2E: permissions (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("should generate opencode permissions in home directory with --global", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH),
      JSON.stringify(
        {
          root: true,
          permission: {
            bash: { "*": "ask", "git status *": "allow" },
          },
        },
        null,
        2,
      ),
    );

    await runGenerate({
      target: "opencode",
      features: "permissions",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = JSON.parse(
      await readFileContent(join(homeDir, ".config", "opencode", "opencode.jsonc")),
    );
    expect(generated.permission.bash["git status *"]).toBe("allow");
  });
});
