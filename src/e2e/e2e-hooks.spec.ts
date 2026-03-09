import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_HOOKS_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import { runGenerate, runImport, useTestDirectory } from "./e2e-helper.js";

describe("E2E: hooks", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "settings.json") },
    { target: "cursor", outputPath: join(".cursor", "hooks.json") },
    { target: "opencode", outputPath: join(".opencode", "plugins", "rulesync-hooks.js") },
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

    if (target === "opencode") {
      // OpenCode generates a JavaScript plugin file, not JSON
      expect(generatedContent).toContain("export const RulesyncHooksPlugin");
      expect(generatedContent).toContain('"session.created"');
      expect(generatedContent).toContain('"session.idle"');
      expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");
      expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
    } else {
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
    }
  });
});

describe("E2E: hooks (import)", () => {
  const { getTestDir } = useTestDirectory();

  it("should import claudecode hooks", async () => {
    const testDir = getTestDir();

    // Setup: Create a Claude Code settings.json with hooks
    const settingsContent = JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "echo session started" }],
            },
          ],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, ".claude", "settings.json"), settingsContent);

    // Execute: Import claudecode hooks
    await runImport({ target: "claudecode", features: "hooks" });

    // Verify that the imported hooks file was created
    const importedContent = await readFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH));
    expect(importedContent).toContain("sessionStart");
  });
});
