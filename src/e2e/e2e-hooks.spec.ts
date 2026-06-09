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

/**
 * Verify that a parsed hooks config preserves the canonical command paths
 * configured in the rulesync source. Event-name casing/mapping varies per tool
 * (e.g. claudecode uses PascalCase `Stop`, geminicli maps `stop` to
 * `AfterAgent`), so checking command paths inside the serialized hooks block
 * is the most tool-agnostic assertion.
 */
function assertHookCommandsPreserved(parsed: { hooks?: unknown }): void {
  expect(parsed.hooks).toBeDefined();
  const serialized = JSON.stringify(parsed.hooks);
  expect(serialized).toContain(".rulesync/hooks/session-start.sh");
  expect(serialized).toContain(".rulesync/hooks/audit.sh");
}

describe("E2E: hooks", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "settings.json") },
    { target: "cursor", outputPath: join(".cursor", "hooks.json") },
    { target: "opencode", outputPath: join(".opencode", "plugins", "rulesync-hooks.js") },
    { target: "codexcli", outputPath: join(".codex", "hooks.json") },
    { target: "geminicli", outputPath: join(".gemini", "settings.json") },
    {
      target: "goose",
      outputPath: join(".agents", "plugins", "rulesync", "hooks", "hooks.json"),
    },
    { target: "copilot", outputPath: join(".github", "hooks", "copilot-hooks.json") },
    { target: "copilotcli", outputPath: join(".github", "hooks", "copilotcli-hooks.json") },
    { target: "factorydroid", outputPath: join(".factory", "settings.json") },
    { target: "kiro", outputPath: join(".kiro", "agents", "default.json") },
    { target: "antigravity-ide", outputPath: join(".agents", "hooks.json") },
    { target: "antigravity-cli", outputPath: join(".agents", "hooks.json") },
    { target: "augmentcode", outputPath: join(".augment", "settings.json") },
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
      } else if (target === "kiro") {
        // Kiro CLI uses its own event names: sessionStart → agentSpawn, stop → stop
        expect(parsed.hooks).toBeDefined();
        expect(parsed.hooks.agentSpawn).toBeDefined();
        expect(parsed.hooks.stop).toBeDefined();
        expect(parsed.hooks.agentSpawn[0].command).toBe(".rulesync/hooks/session-start.sh");
        expect(parsed.hooks.stop[0].command).toBe(".rulesync/hooks/audit.sh");
      } else if (target === "copilot" || target === "copilotcli") {
        // Copilot and Copilot CLI use camelCase event names. Neither supports
        // the `stop` hook event (see COPILOT_HOOK_EVENTS in src/types/hooks.ts),
        // so audit.sh is intentionally dropped during generation and cannot be
        // asserted here.
        expect(parsed.hooks).toBeDefined();
        expect(parsed.hooks.sessionStart).toBeDefined();
        expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");
      } else if (target === "augmentcode") {
        // AugmentCode mirrors Claude's PascalCase event names but emits commands
        // verbatim (AUGMENT_PROJECT_DIR is a runtime env var, not an inline prefix).
        expect(parsed.hooks).toBeDefined();
        expect(parsed.hooks.SessionStart).toBeDefined();
        expect(parsed.hooks.Stop).toBeDefined();
        expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");
        expect(JSON.stringify(parsed.hooks)).not.toContain("$CLAUDE_PROJECT_DIR");
      } else if (target === "antigravity-ide" || target === "antigravity-cli") {
        // Antigravity nests the event → matcher-entry map under a generated
        // `rulesync` hook name and supports preToolUse/postToolUse/
        // preModelInvocation/postModelInvocation/stop (see ANTIGRAVITY_HOOK_EVENTS
        // in src/types/hooks.ts). `sessionStart` is therefore dropped, and only
        // audit.sh — mapped to `Stop` — survives generation.
        expect(parsed.rulesync.Stop).toBeDefined();
        expect(JSON.stringify(parsed)).toContain(".rulesync/hooks/audit.sh");
      } else {
        // codexcli, geminicli, factorydroid, goose: event-name casing/mapping
        // varies per tool, so verify the configured hook command paths are preserved.
        assertHookCommandsPreserved(parsed);
      }
    }
  });

  it("should generate devin hooks", async () => {
    const testDir = getTestDir();

    // Devin supports file/command/MCP lifecycle events but not sessionStart/stop,
    // so this dedicated case uses devin-supported canonical events.
    const hooksContent = JSON.stringify(
      {
        version: 1,
        hooks: {
          beforeShellExecution: [{ command: ".rulesync/hooks/pre-run.sh" }],
          afterFileEdit: [{ command: ".rulesync/hooks/post-edit.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({ target: "devin", features: "hooks" });

    const generatedContent = await readFileContent(join(testDir, ".windsurf", "hooks.json"));
    const parsed = JSON.parse(generatedContent);
    // Devin maps beforeShellExecution → pre_run_command and afterFileEdit → post_write_code.
    expect(parsed.hooks.pre_run_command).toBeDefined();
    expect(parsed.hooks.post_write_code).toBeDefined();
    expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/pre-run.sh");
    expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/post-edit.sh");
  });

  it.each([
    // claudecode, geminicli, factorydroid, kiro use shared config files (isDeletable=false) — excluded
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

  it("should succeed in check mode when a claudecode hooks file is non-deletable", async () => {
    const testDir = getTestDir();

    await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
    await writeFileContent(
      join(testDir, ".claude", "settings.json"),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [{ matcher: "", hooks: [{ type: "command", command: "echo hi" }] }],
          },
          theme: "dark",
        },
        null,
        2,
      ),
    );

    const { stdout } = await runGenerate({
      target: "claudecode",
      features: "hooks",
      deleteFiles: true,
      check: true,
      env: { NODE_ENV: "e2e" },
    });

    expect(stdout).toContain("All files are up to date.");
  });
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
    {
      target: "copilot",
      sourcePath: join(".github", "hooks", "copilot-hooks.json"),
      // Copilot uses a flat entry schema: { type, bash, powershell, timeoutSec }
      // rather than the canonical { matcher, hooks: [...] } shape.
      sourceContent: {
        version: 1,
        hooks: {
          sessionStart: [{ type: "command", bash: "echo session started" }],
        },
      },
    },
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
    {
      target: "kiro",
      sourcePath: join(".kiro", "agents", "default.json"),
      sourceContent: {
        hooks: {
          agentSpawn: [{ command: "echo session started" }],
        },
      },
    },
    {
      // Antigravity nests the event → matcher-entry map under a named hook, so
      // the imported canonical config exposes `preToolUse` rather than
      // `sessionStart`. The IDE fixture uses the documented named-hook wrapper.
      target: "antigravity-ide",
      sourcePath: join(".agents", "hooks.json"),
      sourceContent: {
        rulesync: {
          PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "echo pre tool" }] }],
        },
      },
      expectedEvent: "preToolUse",
    },
    {
      // The CLI fixture uses the legacy flat shape, which still imports.
      target: "antigravity-cli",
      sourcePath: join(".agents", "hooks.json"),
      sourceContent: {
        PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "echo pre tool" }] }],
      },
      expectedEvent: "preToolUse",
    },
    {
      // Devin hooks.json maps each Devin event name to a flat array of
      // command/powershell hook objects. `pre_run_command` round-trips to the
      // canonical `beforeShellExecution` event.
      target: "devin",
      sourcePath: join(".windsurf", "hooks.json"),
      sourceContent: {
        hooks: {
          pre_run_command: [{ command: "echo session started" }],
        },
      },
      expectedEvent: "beforeShellExecution",
    },
    {
      // AugmentCode stores hooks under the `hooks` key of the shared settings
      // file using Claude-style PascalCase event names; SessionStart round-trips
      // to the canonical `sessionStart` event.
      target: "augmentcode",
      sourcePath: join(".augment", "settings.json"),
      sourceContent: {
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo session started" }] }],
        },
      },
    },
    {
      // Goose reads `.agents/plugins/<name>/hooks/hooks.json` with Claude-style
      // PascalCase event names; SessionStart round-trips to canonical `sessionStart`.
      target: "goose",
      sourcePath: join(".agents", "plugins", "rulesync", "hooks", "hooks.json"),
      sourceContent: {
        hooks: {
          SessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "echo session started" }] },
          ],
        },
      },
    },
  ])(
    "should import $target hooks",
    async ({ target, sourcePath, sourceContent, expectedEvent }) => {
      const testDir = getTestDir();

      await writeFileContent(join(testDir, sourcePath), JSON.stringify(sourceContent, null, 2));

      await runImport({ target, features: "hooks" });

      const importedContent = await readFileContent(
        join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH),
      );
      expect(importedContent).toContain(expectedEvent ?? "sessionStart");
    },
  );
});

describe("E2E: hooks (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it.each([
    { target: "claudecode", outputPath: join(".claude", "settings.json") },
    { target: "codexcli", outputPath: join(".codex", "hooks.json") },
    { target: "geminicli", outputPath: join(".gemini", "settings.json") },
    {
      target: "goose",
      outputPath: join(".agents", "plugins", "rulesync", "hooks", "hooks.json"),
    },
    { target: "opencode", outputPath: join(".config", "opencode", "plugins", "rulesync-hooks.js") },
    { target: "factorydroid", outputPath: join(".factory", "settings.json") },
    { target: "deepagents", outputPath: join(".deepagents", "hooks.json") },
    { target: "junie", outputPath: join(".junie", "config.json") },
    { target: "cursor", outputPath: join(".cursor", "hooks.json") },
    { target: "copilotcli", outputPath: join(".copilot", "hooks", "copilot-hooks.json") },
    { target: "antigravity-ide", outputPath: join(".gemini", "config", "hooks.json") },
    { target: "antigravity-cli", outputPath: join(".gemini", "config", "hooks.json") },
    { target: "augmentcode", outputPath: join(".augment", "settings.json") },
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
      expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");
      expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
    } else if (target === "copilotcli") {
      // Copilot CLI does not support the `stop` hook event, so audit.sh is
      // intentionally dropped during generation.
      const parsed = JSON.parse(generatedContent);
      expect(parsed.hooks.sessionStart).toBeDefined();
      expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");
    } else if (target === "junie") {
      // Junie CLI only supports the `sessionStart` event (PascalCase
      // SessionStart), so `stop` (audit.sh) is dropped during generation.
      const parsed = JSON.parse(generatedContent);
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");
    } else if (target === "antigravity-ide" || target === "antigravity-cli") {
      // Antigravity nests the event map under a generated `rulesync` hook name
      // and supports preToolUse/postToolUse/preModelInvocation/
      // postModelInvocation/stop, so `sessionStart` is dropped and only audit.sh
      // (mapped to `Stop`) survives generation.
      const parsed = JSON.parse(generatedContent);
      expect(parsed.rulesync.Stop).toBeDefined();
      expect(JSON.stringify(parsed)).toContain(".rulesync/hooks/audit.sh");
    } else {
      assertHookCommandsPreserved(JSON.parse(generatedContent));
    }
  });

  it("should generate devin hooks in home directory", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Devin does not support sessionStart/stop, so this dedicated global case
    // uses devin-supported canonical events.
    const hooksContent = JSON.stringify(
      {
        version: 1,
        root: true,
        hooks: {
          beforeShellExecution: [{ command: ".rulesync/hooks/pre-run.sh" }],
          afterFileEdit: [{ command: ".rulesync/hooks/post-edit.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(projectDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({
      target: "devin",
      features: "hooks",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generatedContent = await readFileContent(
      join(homeDir, ".codeium", "windsurf", "hooks.json"),
    );
    const parsed = JSON.parse(generatedContent);
    expect(parsed.hooks.pre_run_command).toBeDefined();
    expect(parsed.hooks.post_write_code).toBeDefined();
    expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/pre-run.sh");
    expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/post-edit.sh");
  });
});
