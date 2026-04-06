import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_HOOKS_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import {
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

describe("E2E: hooks", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "settings.json") },
    { target: "cursor", outputPath: join(".cursor", "hooks.json") },
    { target: "opencode", outputPath: join(".opencode", "plugins", "rulesync-hooks.js") },
    { target: "codexcli", outputPath: join(".codex", "hooks.json") },
    { target: "geminicli", outputPath: join(".gemini", "settings.json") },
    { target: "copilot", outputPath: join(".github", "hooks", "copilot-hooks.json") },
    { target: "factorydroid", outputPath: join(".factory", "settings.json") },
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
      } else if (target === "cursor") {
        // Cursor uses camelCase event names
        expect(parsed.hooks).toBeDefined();
        expect(parsed.hooks.sessionStart).toBeDefined();
        expect(parsed.hooks.stop).toBeDefined();
      } else {
        // codexcli, copilot, geminicli, factorydroid use JSON with hooks key
        expect(parsed.hooks).toBeDefined();
      }
    }
  });

  it.each([
    // claudecode, geminicli, factorydroid use settings.json (isDeletable=false) — excluded
    { target: "cursor", orphanPath: join(".cursor", "hooks.json") },
    { target: "opencode", orphanPath: join(".opencode", "plugins", "rulesync-hooks.js") },
    { target: "codexcli", orphanPath: join(".codex", "hooks.json") },
    { target: "copilot", orphanPath: join(".github", "hooks", "copilot-hooks.json") },
  ])(
    "should fail in check mode when delete would remove an orphan $target hooks file",
    async ({ target, orphanPath }) => {
      const testDir = getTestDir();

      await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
      await writeFileContent(join(testDir, orphanPath), "# orphan\n");

      await expect(
        runGenerate({
          target,
          features: "hooks",
          deleteFiles: true,
          check: true,
          env: { NODE_ENV: "e2e" },
        }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "Files are not up to date. Run 'rulesync generate' to update.",
        ),
      });

      expect(await readFileContent(join(testDir, orphanPath))).toBe("# orphan\n");
    },
  );
});

describe("E2E: hooks (import)", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    {
      target: "claudecode",
      sourcePath: join(".claude", "settings.json"),
      sourceContent: {
        hooks: {
          SessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "echo session started" }] },
          ],
        },
      },
    },
    {
      target: "cursor",
      sourcePath: join(".cursor", "hooks.json"),
      sourceContent: {
        hooks: {
          sessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "echo session started" }] },
          ],
        },
      },
    },
    {
      target: "codexcli",
      sourcePath: join(".codex", "hooks.json"),
      sourceContent: {
        hooks: {
          sessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "echo session started" }] },
          ],
        },
      },
    },
    // copilot hooks import does not preserve hook entries — excluded
    {
      target: "geminicli",
      sourcePath: join(".gemini", "settings.json"),
      sourceContent: {
        hooks: {
          sessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "echo session started" }] },
          ],
        },
      },
    },
    {
      target: "factorydroid",
      sourcePath: join(".factory", "settings.json"),
      sourceContent: {
        hooks: {
          sessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "echo session started" }] },
          ],
        },
      },
    },
  ])("should import $target hooks", async ({ target, sourcePath, sourceContent }) => {
    const testDir = getTestDir();

    await writeFileContent(join(testDir, sourcePath), JSON.stringify(sourceContent, null, 2));

    await runImport({ target, features: "hooks" });

    const importedContent = await readFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH));
    expect(importedContent).toContain("sessionStart");
  });
});

describe("E2E: hooks (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "settings.json") },
    { target: "codexcli", outputPath: join(".codex", "hooks.json") },
    { target: "geminicli", outputPath: join(".gemini", "settings.json") },
    { target: "opencode", outputPath: join(".config", "opencode", "plugins", "rulesync-hooks.js") },
    { target: "factorydroid", outputPath: join(".factory", "settings.json") },
    { target: "deepagents", outputPath: join(".deepagents", "hooks.json") },
  ])("should generate $target hooks in home directory", async ({ target, outputPath }) => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    const hooksContent = JSON.stringify(
      {
        version: 1,
        root: true,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(projectDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({
      target,
      features: "hooks",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generatedContent = await readFileContent(join(homeDir, outputPath));
    if (target === "opencode") {
      expect(generatedContent).toContain("RulesyncHooksPlugin");
    } else {
      expect(generatedContent).toContain("hooks");
    }
  });
});
