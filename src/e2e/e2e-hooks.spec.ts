import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RULESYNC_HOOKS_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate, useTestDirectory } from "./e2e-helper.js";

describe("E2E: hooks", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "settings.json") },
    { target: "cursor", outputPath: join(".cursor", "hooks.json") },
  ])("should generate $target hooks", async ({ target, outputPath }) => {
    const testDir = getTestDir();

    // Setup: Create .rulesync/hooks.json
    const hooksContent = JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    // Execute: Generate hooks for the target
    await runGenerate({ target, features: "hooks" });

    // Verify that the expected output file was generated
    const generatedContent = await readFileContent(join(testDir, outputPath));
    const parsed = JSON.parse(generatedContent);

    if (target === "claudecode") {
      // Claude Code uses PascalCase event names and $CLAUDE_PROJECT_DIR prefix
      expect(parsed.hooks).toBeDefined();
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.Stop).toBeDefined();
      expect(JSON.stringify(parsed.hooks)).toContain("$CLAUDE_PROJECT_DIR/");
    } else {
      // Cursor uses camelCase event names
      expect(parsed.hooks).toBeDefined();
      expect(parsed.hooks.sessionStart).toBeDefined();
      expect(parsed.hooks.stop).toBeDefined();
    }
  });
});
