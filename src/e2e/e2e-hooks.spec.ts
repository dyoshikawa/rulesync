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
 * (e.g. claudecode uses PascalCase `Stop`), so checking command paths inside
 * the serialized hooks block is the most tool-agnostic assertion.
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
    { target: "qwencode", outputPath: join(".qwen", "settings.json") },
    {
      target: "goose",
      outputPath: join(".agents", "plugins", "rulesync", "hooks", "hooks.json"),
    },
    { target: "copilot", outputPath: join(".github", "hooks", "copilot-hooks.json") },
    { target: "copilotcli", outputPath: join(".github", "hooks", "copilotcli-hooks.json") },
    { target: "factorydroid", outputPath: join(".factory", "hooks.json") },
    { target: "kiro", outputPath: join(".kiro", "agents", "default.json") },
    { target: "kiro-ide", outputPath: join(".kiro", "hooks", "rulesync.json") },
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
        expect(parsed.hooks.SessionStart[0].hooks[0].command).toContain('"$CLAUDE_PROJECT_DIR"/');
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
        // Copilot and Copilot CLI use camelCase event names and both map the
        // canonical `stop` event to `agentStop` (see COPILOT_HOOK_EVENTS /
        // COPILOTCLI_HOOK_EVENTS in src/types/hooks.ts).
        expect(parsed.hooks).toBeDefined();
        expect(parsed.hooks.sessionStart).toBeDefined();
        expect(parsed.hooks.agentStop).toBeDefined();
        expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");
        expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/audit.sh");
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
      } else if (target === "qwencode") {
        // Qwen Code uses Claude-style PascalCase event names under the `hooks`
        // key of .qwen/settings.json, but its mapping differs from Gemini CLI:
        // canonical `sessionStart` → `SessionStart`, `stop` → `Stop`
        // (NOT Gemini's BeforeAgent/AfterAgent). See
        // CANONICAL_TO_QWENCODE_EVENT_NAMES in src/types/hooks.ts.
        expect(parsed.hooks).toBeDefined();
        expect(parsed.hooks.SessionStart).toBeDefined();
        expect(parsed.hooks.Stop).toBeDefined();
        expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");
        expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/audit.sh");
      } else if (target === "kiro-ide") {
        // Kiro IDE emits a `{ version: "v1", hooks: [...] }` envelope with one
        // entry per hook. Canonical `sessionStart` → `SessionStart`,
        // `stop` → `Stop` (PascalCase triggers). See
        // CANONICAL_TO_KIRO_IDE_EVENT_NAMES in src/types/hooks.ts.
        expect(parsed.version).toBe("v1");
        const triggers = (parsed.hooks as Array<{ trigger: string }>).map((h) => h.trigger);
        expect(triggers).toContain("SessionStart");
        expect(triggers).toContain("Stop");
        expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");
        expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/audit.sh");
      } else {
        // codexcli, factorydroid, goose: event-name casing/mapping
        // varies per tool, so verify the configured hook command paths are preserved.
        assertHookCommandsPreserved(parsed);
      }
    }
  });

  it("should map canonical stop/subagentStop to copilot agentStop/subagentStop", async () => {
    const testDir = getTestDir();

    const hooksContent = JSON.stringify(
      {
        version: 1,
        hooks: {
          stop: [{ command: ".rulesync/hooks/agent-stop.sh" }],
          subagentStop: [{ command: ".rulesync/hooks/subagent-stop.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({ target: "copilot", features: "hooks" });

    const generatedContent = await readFileContent(
      join(testDir, ".github", "hooks", "copilot-hooks.json"),
    );
    const parsed = JSON.parse(generatedContent);
    // Canonical `stop` → `agentStop`, `subagentStop` → `subagentStop`.
    expect(parsed.hooks.agentStop).toBeDefined();
    expect(JSON.stringify(parsed.hooks.agentStop)).toContain(".rulesync/hooks/agent-stop.sh");
    expect(parsed.hooks.subagentStop).toBeDefined();
    expect(JSON.stringify(parsed.hooks.subagentStop)).toContain(".rulesync/hooks/subagent-stop.sh");
  });

  it("should generate vibe hooks (.vibe/hooks.toml + experimental flag)", async () => {
    const testDir = getTestDir();

    // Vibe supports before_tool/after_tool/post_agent_turn (← preToolUse/
    // postToolUse/stop). It emits a flat `[[hooks]]` TOML array, not JSON.
    const hooksContent = JSON.stringify(
      {
        version: 1,
        hooks: {
          preToolUse: [{ command: ".rulesync/hooks/audit.sh", matcher: "bash" }],
          stop: [{ command: ".rulesync/hooks/session-start.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({ target: "vibe", features: "hooks" });

    const generatedContent = await readFileContent(join(testDir, ".vibe", "hooks.toml"));
    // Snake_case event types and the matcher mapped to `match`.
    expect(generatedContent).toContain('type = "before_tool"');
    expect(generatedContent).toContain('type = "post_agent_turn"');
    expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
    expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");

    // The experimental gating flag is merged into .vibe/config.toml.
    const configContent = await readFileContent(join(testDir, ".vibe", "config.toml"));
    expect(configContent).toContain("enable_experimental_hooks = true");
  });

  it("should import vibe hooks from .vibe/hooks.toml", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".vibe", "hooks.toml"),
      [
        "[[hooks]]",
        'name = "deny-rm-rf"',
        'type = "before_tool"',
        'match = "bash"',
        'command = "echo audit"',
        "",
      ].join("\n"),
    );

    await runImport({ target: "vibe", features: "hooks" });

    const importedContent = await readFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH));
    expect(importedContent).toContain("preToolUse");
    expect(importedContent).toContain("echo audit");
  });

  it("should generate devin hooks", async () => {
    const testDir = getTestDir();

    // Devin Local uses Claude-style lifecycle events. The standalone
    // .devin/hooks.v1.json holds the event map directly (no wrapper key).
    const hooksContent = JSON.stringify(
      {
        version: 1,
        hooks: {
          preToolUse: [{ matcher: "exec", command: ".rulesync/hooks/pre-run.sh" }],
          stop: [{ command: ".rulesync/hooks/on-stop.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({ target: "devin", features: "hooks" });

    const generatedContent = await readFileContent(join(testDir, ".devin", "hooks.v1.json"));
    const parsed = JSON.parse(generatedContent);
    // Events live at the top level (no "hooks" wrapper key).
    expect(parsed.hooks).toBeUndefined();
    expect(parsed.PreToolUse).toBeDefined();
    expect(parsed.Stop).toBeDefined();
    expect(JSON.stringify(parsed)).toContain(".rulesync/hooks/pre-run.sh");
    expect(JSON.stringify(parsed)).toContain(".rulesync/hooks/on-stop.sh");
  });

  it("should generate reasonix hooks (.reasonix/settings.json, flat per-event arrays)", async () => {
    const testDir = getTestDir();

    // Reasonix only maps four events (PreToolUse/PostToolUse/UserPromptSubmit/Stop);
    // sessionStart has no mapped Reasonix equivalent in rulesync's scoped surface.
    const hooksContent = JSON.stringify(
      {
        version: 1,
        hooks: {
          preToolUse: [{ command: ".rulesync/hooks/pre-tool.sh", matcher: "bash", timeout: 5 }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
          sessionStart: [{ command: ".rulesync/hooks/session-start.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({ target: "reasonix", features: "hooks" });

    const generatedContent = await readFileContent(join(testDir, ".reasonix", "settings.json"));
    const parsed = JSON.parse(generatedContent);
    // Flat array of hook objects per event, no matcher-group wrapper.
    expect(parsed.hooks.PreToolUse).toEqual([
      { match: "bash", command: ".rulesync/hooks/pre-tool.sh", timeout: 5000 },
    ]);
    expect(parsed.hooks.Stop).toEqual([{ command: ".rulesync/hooks/audit.sh" }]);
    expect(parsed.hooks.SessionStart).toBeUndefined();
  });

  it("should import reasonix hooks from .reasonix/settings.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".reasonix", "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ match: "bash", command: "echo audit", timeout: 5000 }],
          Stop: [{ command: "echo done" }],
        },
      }),
    );

    await runImport({ target: "reasonix", features: "hooks" });

    const importedContent = await readFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH));
    const parsed = JSON.parse(importedContent);
    expect(parsed.hooks.preToolUse[0].command).toBe("echo audit");
    expect(parsed.hooks.preToolUse[0].matcher).toBe("bash");
    expect(parsed.hooks.preToolUse[0].timeout).toBe(5);
    expect(parsed.hooks.stop[0].command).toBe("echo done");
  });

  it.each([
    // claudecode, kiro use shared config files (isDeletable=false) — excluded.
    // factorydroid now writes a dedicated .factory/hooks.json (isDeletable=true).
    { target: "cursor", orphanPath: join(".cursor", "hooks.json") },
    { target: "opencode", orphanPath: join(".opencode", "plugins", "rulesync-hooks.js") },
    { target: "codexcli", orphanPath: join(".codex", "hooks.json") },
    { target: "copilot", orphanPath: join(".github", "hooks", "copilot-hooks.json") },
    { target: "factorydroid", orphanPath: join(".factory", "hooks.json") },
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
      target: "factorydroid",
      sourcePath: join(".factory", "hooks.json"),
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
      // Devin Local's standalone .devin/hooks.v1.json holds the Claude-style
      // event map directly (no wrapper key). PreToolUse round-trips to the
      // canonical `preToolUse` event.
      target: "devin",
      sourcePath: join(".devin", "hooks.v1.json"),
      sourceContent: {
        PreToolUse: [{ matcher: "exec", hooks: [{ type: "command", command: "echo pre tool" }] }],
      },
      expectedEvent: "preToolUse",
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
    { target: "qwencode", outputPath: join(".qwen", "settings.json") },
    {
      target: "goose",
      outputPath: join(".agents", "plugins", "rulesync", "hooks", "hooks.json"),
    },
    { target: "opencode", outputPath: join(".config", "opencode", "plugins", "rulesync-hooks.js") },
    { target: "factorydroid", outputPath: join(".factory", "hooks.json") },
    { target: "deepagents", outputPath: join(".deepagents", "hooks.json") },
    { target: "junie", outputPath: join(".junie", "config.json") },
    { target: "cursor", outputPath: join(".cursor", "hooks.json") },
    { target: "copilotcli", outputPath: join(".copilot", "hooks", "copilot-hooks.json") },
    { target: "antigravity-ide", outputPath: join(".gemini", "config", "hooks.json") },
    { target: "antigravity-cli", outputPath: join(".gemini", "config", "hooks.json") },
    { target: "augmentcode", outputPath: join(".augment", "settings.json") },
    { target: "kiro-ide", outputPath: join(".kiro", "hooks", "rulesync.json") },
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
      // Junie CLI supports SessionStart, UserPromptSubmit, Stop, and SessionEnd
      // (PascalCase), so both `sessionStart` and `stop` (audit.sh) survive.
      const parsed = JSON.parse(generatedContent);
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.Stop).toBeDefined();
      expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");
      expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/audit.sh");
    } else if (target === "antigravity-ide" || target === "antigravity-cli") {
      // Antigravity nests the event map under a generated `rulesync` hook name
      // and supports preToolUse/postToolUse/preModelInvocation/
      // postModelInvocation/stop, so `sessionStart` is dropped and only audit.sh
      // (mapped to `Stop`) survives generation.
      const parsed = JSON.parse(generatedContent);
      expect(parsed.rulesync.Stop).toBeDefined();
      expect(JSON.stringify(parsed)).toContain(".rulesync/hooks/audit.sh");
    } else if (target === "qwencode") {
      // Qwen Code emits Claude-style PascalCase event names under the `hooks`
      // key of .qwen/settings.json: canonical `sessionStart` → `SessionStart`,
      // `stop` → `Stop`. See CANONICAL_TO_QWENCODE_EVENT_NAMES in
      // src/types/hooks.ts.
      const parsed = JSON.parse(generatedContent);
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.Stop).toBeDefined();
      expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");
      expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/audit.sh");
    } else {
      assertHookCommandsPreserved(JSON.parse(generatedContent));
    }
  });

  it("should generate devin hooks in home directory", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // In global mode Devin hooks live under the `hooks` key of
    // ~/.config/devin/config.json (shared with mcp/permissions).
    const hooksContent = JSON.stringify(
      {
        version: 1,
        root: true,
        hooks: {
          preToolUse: [{ matcher: "exec", command: ".rulesync/hooks/pre-run.sh" }],
          stop: [{ command: ".rulesync/hooks/on-stop.sh" }],
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
      join(homeDir, ".config", "devin", "config.json"),
    );
    const parsed = JSON.parse(generatedContent);
    expect(parsed.hooks.PreToolUse).toBeDefined();
    expect(parsed.hooks.Stop).toBeDefined();
    expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/pre-run.sh");
    expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/on-stop.sh");
  });

  it("should generate vibe hooks in home directory", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    const hooksContent = JSON.stringify(
      {
        version: 1,
        root: true,
        hooks: {
          preToolUse: [{ command: ".rulesync/hooks/audit.sh", matcher: "bash" }],
          stop: [{ command: ".rulesync/hooks/session-start.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(projectDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({
      target: "vibe",
      features: "hooks",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generatedContent = await readFileContent(join(homeDir, ".vibe", "hooks.toml"));
    expect(generatedContent).toContain('type = "before_tool"');
    expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
    expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");

    const configContent = await readFileContent(join(homeDir, ".vibe", "config.toml"));
    expect(configContent).toContain("enable_experimental_hooks = true");
  });

  it("should generate hermesagent hooks in home directory", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // Hermes Agent has no project-scoped hooks location; hooks are merged into
    // the shared global ~/.hermes/config.yaml (YAML, global only) under
    // Hermes's real `VALID_HOOKS` event keys — NOT a `hooks.rulesync` blob,
    // which Hermes would silently ignore.
    const hooksContent = JSON.stringify(
      {
        version: 1,
        root: true,
        hooks: {
          sessionStart: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }],
          preToolUse: [
            { type: "command", command: ".rulesync/hooks/audit.sh", matcher: "terminal" },
          ],
          // Not part of Hermes's VALID_HOOKS mapping table — must be dropped.
          worktreeCreate: [{ command: ".rulesync/hooks/wt.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(projectDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({
      target: "hermesagent",
      features: "hooks",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    // The config is YAML; assert the canonical hooks survive generation under
    // Hermes's real, functioning event keys.
    const generatedContent = await readFileContent(join(homeDir, ".hermes", "config.yaml"));
    expect(generatedContent).not.toContain("rulesync:");
    expect(generatedContent).toContain("on_session_start");
    expect(generatedContent).toContain("pre_tool_call");
    expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");
    expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
    expect(generatedContent).toContain("matcher: terminal");
    expect(generatedContent).not.toContain(".rulesync/hooks/wt.sh");
  });

  it("should generate reasonix hooks in home directory", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    const hooksContent = JSON.stringify(
      {
        version: 1,
        root: true,
        hooks: {
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(projectDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({
      target: "reasonix",
      features: "hooks",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generatedContent = await readFileContent(join(homeDir, ".reasonix", "settings.json"));
    const parsed = JSON.parse(generatedContent);
    expect(parsed.hooks.Stop).toEqual([{ command: ".rulesync/hooks/audit.sh" }]);
  });
});
