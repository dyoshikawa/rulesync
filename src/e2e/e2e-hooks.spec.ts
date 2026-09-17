import { join } from "node:path";

import * as smolToml from "smol-toml";
import { describe, expect, it } from "vitest";

import { CLAUDECODE_SETTINGS_SCHEMA_URL } from "../constants/claudecode-paths.js";
import {
  RULESYNC_HOOKS_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { getHermesagentGlobalDir } from "../utils/hermesagent.js";
import {
  assertGenerateMatrixCoversTargets,
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

/**
 * Verify that a parsed hooks config preserves the canonical command paths
 * configured in the rulesync source. Event-name casing/mapping varies per tool
 * (e.g. claudecode uses PascalCase `Stop`), and so does the file shape — Factory
 * Droid's standalone `hooks.json` is keyed directly by event name with no
 * `hooks` wrapper — so checking the command paths anywhere in the serialized
 * file is the most tool-agnostic assertion.
 */
function assertHookCommandsPreserved(parsed: { hooks?: unknown }): void {
  expect(Object.keys(parsed).length).toBeGreaterThan(0);
  const serialized = JSON.stringify(parsed.hooks ?? parsed);
  expect(serialized).toContain(".rulesync/hooks/session-start.sh");
  expect(serialized).toContain(".rulesync/hooks/audit.sh");
}

// Targets that emit a Claude-shaped `{ hooks: { <Event>: [...] } }` document
// and differ only in how they spell the canonical `sessionStart` / `stop`
// events. Every one of them writes hook commands verbatim (no
// `$CLAUDE_PROJECT_DIR` prefix — that is Claude Code's own convention).
// See the CANONICAL_TO_<TOOL>_EVENT_NAMES maps in src/types/hooks.ts.
const hooksKeyedEventNames: Record<string, { sessionStart: string; stop: string }> = {
  // Cursor uses camelCase event names.
  cursor: { sessionStart: "sessionStart", stop: "stop" },
  // Copilot and Copilot CLI use camelCase event names and both map the
  // canonical `stop` event to `agentStop`.
  copilot: { sessionStart: "sessionStart", stop: "agentStop" },
  copilotcli: { sessionStart: "sessionStart", stop: "agentStop" },
  // AugmentCode mirrors Claude's PascalCase event names but emits commands
  // verbatim (AUGMENT_PROJECT_DIR is a runtime env var, not an inline prefix).
  augmentcode: { sessionStart: "SessionStart", stop: "Stop" },
  // IBM Bob stores Claude-style PascalCase events under the top-level `hooks`
  // key of .bob/settings.json.
  bob: { sessionStart: "SessionStart", stop: "Stop" },
  // Qwen Code uses Claude-style PascalCase event names under the `hooks` key
  // of .qwen/settings.json, but its mapping differs from Gemini CLI:
  // `stop` → `Stop` (NOT Gemini's AfterAgent).
  qwencode: { sessionStart: "SessionStart", stop: "Stop" },
  // Tabnine CLI stores PascalCase events under the `hooks` key of
  // .tabnine/agent/settings.json: `stop` → `AfterAgent`; hook timeouts are
  // written in milliseconds.
  tabnine: { sessionStart: "SessionStart", stop: "AfterAgent" },
  // Snowflake Cortex Code stores Claude-style PascalCase events under the
  // `hooks` key of .cortex/settings.json (project) and
  // ~/.snowflake/cortex/hooks.json (global); commands are anchored with
  // $CORTEX_PROJECT_DIR only when they start with `./`.
  cortexcode: { sessionStart: "SessionStart", stop: "Stop" },
  // Command Code stores Claude-style PascalCase events under the `hooks` key
  // of .commandcode/settings.json in both scopes; commands are anchored with
  // $COMMANDCODE_PROJECT_DIR only when they start with `./`.
  commandcode: { sessionStart: "SessionStart", stop: "Stop" },
  // Continue stores Claude-style PascalCase events under the `hooks` key of
  // .continue/settings.json in both scopes; commands are anchored with
  // $CONTINUE_PROJECT_DIR only when they start with `./`.
  continue: { sessionStart: "SessionStart", stop: "Stop" },
};

function assertHooksKeyedEvents({
  target,
  parsed,
}: {
  target: string;
  parsed: { hooks?: Record<string, unknown> };
}): void {
  const eventNames = hooksKeyedEventNames[target];
  expect(eventNames).toBeDefined();
  expect(parsed.hooks).toBeDefined();
  expect(parsed.hooks?.[eventNames?.sessionStart ?? ""]).toBeDefined();
  expect(parsed.hooks?.[eventNames?.stop ?? ""]).toBeDefined();
  const serialized = JSON.stringify(parsed.hooks);
  expect(serialized).toContain(".rulesync/hooks/session-start.sh");
  expect(serialized).toContain(".rulesync/hooks/audit.sh");
  expect(serialized).not.toContain("$CLAUDE_PROJECT_DIR");
}

// Tools whose event mapping/serialization needs a
// bespoke assertion (vibe, devin, reasonix) live in their own standalone `it`s
// below; `hooksProjectStandaloneTargets` lists them so the completeness check
// still accounts for them. The check only enforces that this enumeration matches
// the processor's declared target set — it does NOT verify a matching standalone
// `it` exists for each name, so keep this list in sync with the actual `it`s by hand.
const hooksGenerateTargets = [
  { target: "amp", outputPath: join(".amp", "plugins", "rulesync-hooks.ts") },
  { target: "claudecode", outputPath: join(".claude", "settings.json") },
  { target: "claudecode-plugin", outputPath: join("hooks", "hooks.json") },
  { target: "cursor", outputPath: join(".cursor", "hooks.json") },
  { target: "opencode", outputPath: join(".opencode", "plugins", "rulesync-hooks.js") },
  { target: "kilo", outputPath: join(".kilo", "plugins", "rulesync-hooks.js") },
  { target: "pi", outputPath: join(".pi", "extensions", "rulesync-hooks.ts") },
  { target: "codexcli", outputPath: join(".codex", "hooks.json") },
  { target: "qwencode", outputPath: join(".qwen", "settings.json") },
  {
    target: "goose",
    outputPath: join(".agents", "plugins", "rulesync", "hooks", "hooks.json"),
  },
  { target: "copilot", outputPath: join(".github", "hooks", "copilot-hooks.json") },
  { target: "copilotcli", outputPath: join(".github", "hooks", "copilotcli-hooks.json") },
  { target: "factorydroid", outputPath: join(".factory", "hooks.json") },
  { target: "deepagents", outputPath: join(".deepagents", "hooks.json") },
  { target: "kiro", outputPath: join(".kiro", "agents", "default.json") },
  { target: "kiro-cli", outputPath: join(".kiro", "hooks", "rulesync.json") },
  { target: "kiro-ide", outputPath: join(".kiro", "hooks", "rulesync.json") },
  { target: "antigravity-ide", outputPath: join(".agents", "hooks.json") },
  { target: "antigravity-plugin", outputPath: "hooks.json" },
  { target: "antigravity-cli", outputPath: join(".agents", "hooks.json") },
  { target: "augmentcode", outputPath: join(".augment", "settings.json") },
  { target: "bob", outputPath: join(".bob", "settings.json") },
  { target: "tabnine", outputPath: join(".tabnine", "agent", "settings.json") },
  { target: "cortexcode", outputPath: join(".cortex", "settings.json") },
  { target: "commandcode", outputPath: join(".commandcode", "settings.json") },
  { target: "continue", outputPath: join(".continue", "settings.json") },
  { target: "grokcli", outputPath: join(".grok", "hooks", "rulesync.json") },
  { target: "cline", outputPath: join(".clinerules", "hooks", "rulesync-hooks.json") },
] as const;

// Targets exercised by dedicated `it`s (bespoke per-tool serialization).
const hooksProjectStandaloneTargets = ["vibe", "devin", "reasonix", "crush"] as const;

describe("E2E: hooks", () => {
  const { getTestDir } = useTestDirectory();

  it("generate matrix must cover every native hooks tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: HooksProcessor,
      testedTargets: [
        ...hooksGenerateTargets.map((e) => e.target),
        ...hooksProjectStandaloneTargets,
      ],
    });
  });

  it.each(hooksGenerateTargets)("should generate $target hooks", async ({ target, outputPath }) => {
    const testDir = getTestDir();

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

    await runGenerate({ target, features: "hooks" });

    const generatedContent = await readFileContent(join(testDir, outputPath));

    if (target === "amp") {
      expect(generatedContent).toContain('amp.on("session.start"');
      expect(generatedContent).toContain('amp.on("agent.end"');
      expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");
      expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
    } else if (target === "opencode") {
      // OpenCode generates a JavaScript plugin file, not JSON
      expect(generatedContent).toContain("export const RulesyncHooksPlugin");
      expect(generatedContent).toContain('"session.created"');
      expect(generatedContent).toContain('"session.idle"');
      expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");
      expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
    } else if (target === "kilo") {
      // Kilo also emits a JavaScript plugin (.kilo/plugins/rulesync-hooks.js),
      // so assert the canonical command paths survive rather than parsing JSON.
      expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");
      expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
    } else if (target === "cline") {
      // Cline resolves an executable per event; the generated file at the
      // settable path is the manifest naming the scripts rulesync owns.
      expect(JSON.parse(generatedContent).events).toEqual(["TaskStart"]);
      const script = await readFileContent(join(testDir, ".clinerules", "hooks", "TaskStart"));
      expect(script).toContain(".rulesync/hooks/session-start.sh");
      expect(script).toContain("#!/bin/bash");
      expect(
        await readFileContent(join(testDir, ".clinerules", "hooks", "TaskStart.ps1")),
      ).toContain(".rulesync/hooks/session-start.sh");
    } else if (target === "pi") {
      // Pi emits a TypeScript extension (.pi/extensions/rulesync-hooks.ts)
      // that subscribes to snake_case extension events: sessionStart →
      // session_start, stop → agent_end.
      expect(generatedContent).toContain('pi.on("session_start"');
      expect(generatedContent).toContain('pi.on("agent_end"');
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
      } else if (target === "kiro") {
        // The deprecated `kiro` alias keeps the embedded
        // .kiro/agents/default.json agent-hook format and event mapping:
        // sessionStart → agentSpawn, stop → stop.
        expect(parsed.hooks).toBeDefined();
        expect(parsed.hooks.agentSpawn).toBeDefined();
        expect(parsed.hooks.stop).toBeDefined();
        expect(parsed.hooks.agentSpawn[0].command).toBe(".rulesync/hooks/session-start.sh");
        expect(parsed.hooks.stop[0].command).toBe(".rulesync/hooks/audit.sh");
      } else if (target in hooksKeyedEventNames) {
        assertHooksKeyedEvents({ target, parsed });
      } else if (
        target === "antigravity-ide" ||
        target === "antigravity-cli" ||
        target === "antigravity-plugin"
      ) {
        // Antigravity nests the event → matcher-entry map under a generated
        // `rulesync` hook name and supports preToolUse/postToolUse/
        // preModelInvocation/postModelInvocation/stop (see ANTIGRAVITY_HOOK_EVENTS
        // in src/types/hooks.ts). `sessionStart` is therefore dropped, and only
        // audit.sh — mapped to `Stop` — survives generation.
        expect(parsed.rulesync.Stop).toBeDefined();
        expect(JSON.stringify(parsed)).toContain(".rulesync/hooks/audit.sh");
      } else if (target === "kiro-ide" || target === "kiro-cli") {
        // Kiro's standalone hooks format, shared by the IDE and by CLI 3.0:
        // a `{ version: "v1", hooks: [...] }` envelope with one entry per hook.
        // Canonical `sessionStart` → `SessionStart`, `stop` → `Stop`
        // (PascalCase triggers). See CANONICAL_TO_KIRO_IDE_EVENT_NAMES in
        // src/types/hooks.ts.
        expect(parsed.version).toBe("v1");
        const triggers = (parsed.hooks as Array<{ trigger: string }>).map((h) => h.trigger);
        expect(triggers).toContain("SessionStart");
        expect(triggers).toContain("Stop");
        expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");
        expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/audit.sh");
      } else if (target === "deepagents") {
        // deepagents-cli gets the Hooks v2 document: PascalCase HookEvent keys
        // over matcher groups holding string commands (no bash -c argv
        // wrapping). See CANONICAL_TO_DEEPAGENTS_EVENT_NAMES in src/types/hooks.ts.
        expect(parsed.hooks.SessionStart).toEqual([
          { hooks: [{ type: "command", command: ".rulesync/hooks/session-start.sh" }] },
        ]);
        expect(parsed.hooks.Stop).toEqual([
          { hooks: [{ type: "command", command: ".rulesync/hooks/audit.sh" }] },
        ]);
      } else {
        // codexcli, factorydroid, goose: event-name casing/mapping
        // varies per tool, so verify the configured hook command paths are preserved.
        assertHookCommandsPreserved(parsed);
      }
    }
  });

  it("should generate hooks from hooks.jsonc (preferred over hooks.json)", async () => {
    const testDir = getTestDir();

    // The stale .json variant must lose to the .jsonc variant.
    await writeFileContent(
      join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH),
      JSON.stringify({ hooks: { sessionStart: [{ command: "echo stale" }] } }),
    );
    await writeFileContent(
      join(testDir, ".rulesync", "hooks.jsonc"),
      `{
        "hooks": {
          // JSONC source with comments and trailing commas
          "sessionStart": [{ "command": "echo from-jsonc", }],
        },
      }`,
    );

    await runGenerate({ target: "claudecode", features: "hooks" });

    const generatedContent = await readFileContent(join(testDir, ".claude", "settings.json"));
    expect(generatedContent).toContain("echo from-jsonc");
    expect(generatedContent).not.toContain("echo stale");
    expect(Object.keys(JSON.parse(generatedContent))[0]).toBe("$schema");
    expect(JSON.parse(generatedContent).$schema).toBe(CLAUDECODE_SETTINGS_SCHEMA_URL);
  });

  it("should round-trip the legacy Kiro agent-config hook cache TTL", async () => {
    const testDir = getTestDir();
    await writeFileContent(
      join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH),
      JSON.stringify({
        hooks: {
          beforeSubmitPrompt: [{ command: "echo context", cacheTtl: 60 }],
        },
      }),
    );

    // `cache_ttl_seconds` belongs to the embedded agent-config format, which
    // only the deprecated `kiro` alias still writes.
    await runGenerate({ target: "kiro", features: "hooks" });

    const generatedPath = join(testDir, ".kiro", "agents", "default.json");
    const generated = JSON.parse(await readFileContent(generatedPath));
    expect(generated.hooks.userPromptSubmit[0].cache_ttl_seconds).toBe(60);

    await runImport({ target: "kiro", features: "hooks" });

    const imported = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH)),
    );
    expect(imported.hooks.beforeSubmitPrompt[0].cacheTtl).toBe(60);
  });

  it("should write one consistent Kiro hooks file whichever standalone target runs last", async () => {
    const testDir = getTestDir();
    await writeFileContent(
      join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH),
      JSON.stringify({
        hooks: {
          sessionStart: [{ command: "echo shared" }],
        },
        // Both standalone targets write `.kiro/hooks/rulesync.json`, so they
        // read this one shared block instead of per-target blocks.
        kiro: {
          hooks: {
            PostFileSave: [{ command: "echo saved" }],
          },
        },
      }),
    );

    const generatedPath = join(testDir, ".kiro", "hooks", "rulesync.json");

    await runGenerate({ target: "kiro-ide", features: "hooks" });
    const afterIde = await readFileContent(generatedPath);

    await runGenerate({ target: "kiro-cli", features: "hooks" });
    const afterCli = await readFileContent(generatedPath);

    expect(afterCli).toBe(afterIde);
    const triggers = (JSON.parse(afterCli).hooks as Array<{ trigger: string }>).map(
      (entry) => entry.trigger,
    );
    expect(triggers).toEqual(expect.arrayContaining(["SessionStart", "PostFileSave"]));

    // The deprecated `kiro` alias reads the same block but writes the embedded
    // agent-config format, which does not define `PostFileSave`, so the trigger
    // must not leak into it.
    await runGenerate({ target: "kiro", features: "hooks" });
    const agentConfig = JSON.parse(
      await readFileContent(join(testDir, ".kiro", "agents", "default.json")),
    );
    expect(agentConfig.hooks.agentSpawn).toBeDefined();
    expect(agentConfig.hooks.PostFileSave).toBeUndefined();
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

  it("should generate vibe hooks into .vibe/hooks.toml without touching config.toml", async () => {
    const testDir = getTestDir();

    // Vibe supports pre_tool/post_tool/post_agent (← preToolUse/
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
    expect(generatedContent).toContain('type = "pre_tool"');
    expect(generatedContent).toContain('type = "post_agent"');
    expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
    expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");

    // v2.21.0 removed the experimental gate, so hooks generation writes no
    // auxiliary .vibe/config.toml at all.
    expect(await fileExists(join(testDir, ".vibe", "config.toml"))).toBe(false);
  });

  it("should import vibe hooks from .vibe/hooks.toml", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, ".vibe", "hooks.toml"),
      [
        "[[hooks]]",
        'name = "deny-rm-rf"',
        'type = "pre_tool"',
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

  it("should generate crush hooks into the hooks.PreToolUse list of crush.json", async () => {
    const testDir = getTestDir();

    // Crush only fires PreToolUse, so the generic matrix fixture (sessionStart/
    // stop) would produce nothing; seed the one event it supports instead.
    const hooksContent = JSON.stringify(
      {
        version: 1,
        hooks: {
          preToolUse: [{ command: ".rulesync/hooks/audit.sh", matcher: "bash", timeout: 5 }],
          stop: [{ command: ".rulesync/hooks/on-stop.sh" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);
    // Unrelated top-level keys of the shared config file must survive.
    await writeFileContent(
      join(testDir, "crush.json"),
      JSON.stringify({ options: { debug: true } }, null, 2),
    );

    await runGenerate({ target: "crush", features: "hooks" });

    const parsed = JSON.parse(await readFileContent(join(testDir, "crush.json")));
    expect(parsed.hooks).toEqual({
      PreToolUse: [{ matcher: "bash", command: ".rulesync/hooks/audit.sh", timeout: 5 }],
    });
    expect(parsed.options).toEqual({ debug: true });
  });

  it("should import crush hooks from crush.json", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, "crush.json"),
      JSON.stringify(
        { hooks: { PreToolUse: [{ matcher: "bash|edit", command: "echo audit" }] } },
        null,
        2,
      ),
    );

    await runImport({ target: "crush", features: "hooks" });

    const imported = JSON.parse(
      await readFileContent(join(testDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH)),
    );
    expect(imported.hooks.preToolUse).toEqual([
      { type: "command", matcher: "bash|edit", command: "echo audit" },
    ]);
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

    // Reasonix maps thirteen events; sessionStart ⇄ SessionStart,
    // postModelInvocation ⇄ PostLLMCall, notification ⇄ Notification, and
    // preCompact ⇄ PreCompact are among them, while beforeReadFile has no mapped
    // Reasonix equivalent in rulesync's scoped surface and is dropped.
    const hooksContent = JSON.stringify(
      {
        version: 1,
        hooks: {
          preToolUse: [{ command: ".rulesync/hooks/pre-tool.sh", matcher: "bash", timeout: 5 }],
          stop: [{ command: ".rulesync/hooks/audit.sh" }],
          sessionStart: [{ command: ".rulesync/hooks/session-start.sh" }],
          postModelInvocation: [{ command: ".rulesync/hooks/post-llm.sh" }],
          notification: [{ command: ".rulesync/hooks/notify.sh" }],
          preCompact: [{ command: ".rulesync/hooks/pre-compact.sh" }],
          beforeReadFile: [{ command: ".rulesync/hooks/read.sh" }],
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
    expect(parsed.hooks.SessionStart).toEqual([{ command: ".rulesync/hooks/session-start.sh" }]);
    expect(parsed.hooks.PostLLMCall).toEqual([{ command: ".rulesync/hooks/post-llm.sh" }]);
    expect(parsed.hooks.Notification).toEqual([{ command: ".rulesync/hooks/notify.sh" }]);
    expect(parsed.hooks.PreCompact).toEqual([{ command: ".rulesync/hooks/pre-compact.sh" }]);
    expect(parsed.hooks.BeforeReadFile).toBeUndefined();
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
    { target: "pi", orphanPath: join(".pi", "extensions", "rulesync-hooks.ts") },
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
      // IBM Bob stores hooks under the top-level `hooks` key of .bob/settings.json
      // using Claude-style PascalCase event names; SessionStart round-trips to
      // the canonical `sessionStart` event.
      target: "bob",
      sourcePath: join(".bob", "settings.json"),
      sourceContent: {
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo session started" }] }],
        },
      },
    },
    {
      // Tabnine CLI stores hooks under the `hooks` key of
      // .tabnine/agent/settings.json using PascalCase event names;
      // SessionStart round-trips to the canonical `sessionStart` event.
      target: "tabnine",
      sourcePath: join(".tabnine", "agent", "settings.json"),
      sourceContent: {
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "echo session started", timeout: 30000 }] },
          ],
        },
      },
    },
    {
      // Snowflake Cortex Code stores hooks under the `hooks` key of
      // .cortex/settings.json using PascalCase event names; SessionStart
      // round-trips to the canonical `sessionStart` event.
      target: "cortexcode",
      sourcePath: join(".cortex", "settings.json"),
      sourceContent: {
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "echo session started", timeout: 30 }] },
          ],
        },
      },
    },
    {
      // Command Code stores hooks under the `hooks` key of
      // .commandcode/settings.json using Claude-style PascalCase event names;
      // SessionStart round-trips to the canonical `sessionStart` event.
      target: "commandcode",
      sourcePath: join(".commandcode", "settings.json"),
      sourceContent: {
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "echo session started", timeout: 30 }] },
          ],
        },
      },
    },
    {
      // Continue stores hooks under the `hooks` key of .continue/settings.json
      // using Claude-style PascalCase event names; SessionStart round-trips to
      // the canonical `sessionStart` event.
      target: "continue",
      sourcePath: join(".continue", "settings.json"),
      sourceContent: {
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "echo session started", timeout: 30 }] },
          ],
        },
      },
    },
    {
      // deepagents-cli uses the Hooks v2 document (PascalCase HookEvent keys
      // over matcher groups); SessionStart round-trips to canonical `sessionStart`.
      target: "deepagents",
      sourcePath: join(".deepagents", "hooks.json"),
      sourceContent: {
        hooks: {
          SessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "echo session started" }] },
          ],
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

const hooksGlobalTargets = [
  { target: "amp", outputPath: join(".config", "amp", "plugins", "rulesync-hooks.ts") },
  { target: "claudecode", outputPath: join(".claude", "settings.json") },
  { target: "codexcli", outputPath: join(".codex", "hooks.json") },
  { target: "qwencode", outputPath: join(".qwen", "settings.json") },
  {
    target: "goose",
    outputPath: join(".agents", "plugins", "rulesync", "hooks", "hooks.json"),
  },
  { target: "opencode", outputPath: join(".config", "opencode", "plugins", "rulesync-hooks.js") },
  { target: "kilo", outputPath: join(".config", "kilo", "plugins", "rulesync-hooks.js") },
  { target: "pi", outputPath: join(".pi", "agent", "extensions", "rulesync-hooks.ts") },
  { target: "factorydroid", outputPath: join(".factory", "hooks.json") },
  { target: "deepagents", outputPath: join(".deepagents", "hooks.json") },
  { target: "junie", outputPath: join(".junie", "config.json") },
  { target: "cursor", outputPath: join(".cursor", "hooks.json") },
  { target: "copilot", outputPath: join(".copilot", "hooks", "copilot-ide-hooks.json") },
  { target: "copilotcli", outputPath: join(".copilot", "hooks", "copilot-hooks.json") },
  { target: "antigravity-ide", outputPath: join(".gemini", "config", "hooks.json") },
  { target: "antigravity-cli", outputPath: join(".gemini", "config", "hooks.json") },
  { target: "augmentcode", outputPath: join(".augment", "settings.json") },
  { target: "bob", outputPath: join(".bob", "settings", "settings.json") },
  { target: "tabnine", outputPath: join(".tabnine", "agent", "settings.json") },
  { target: "cortexcode", outputPath: join(".snowflake", "cortex", "hooks.json") },
  { target: "commandcode", outputPath: join(".commandcode", "settings.json") },
  { target: "continue", outputPath: join(".continue", "settings.json") },
  { target: "kiro-ide", outputPath: join(".kiro", "hooks", "rulesync.json") },
  { target: "kiro-cli", outputPath: join(".kiro", "hooks", "rulesync.json") },
  { target: "grokcli", outputPath: join(".grok", "hooks", "rulesync.json") },
  { target: "cline", outputPath: join("Documents", "Cline", "Hooks", "rulesync-hooks.json") },
  { target: "zcode", outputPath: join(".zcode", "cli", "config.json") },
] as const;

// Global targets exercised by dedicated `it`s (bespoke per-tool serialization).
// As with the project-scope list, the completeness check only enforces that this
// enumeration matches the processor's declared set — not that a matching `it`
// exists for each name; keep it in sync with the actual `it`s by hand.
const hooksGlobalStandaloneTargets = [
  "crush",
  "devin",
  "vibe",
  "hermesagent",
  "kimi-code",
  "reasonix",
] as const;

describe("E2E: hooks (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("global matrix must cover every native global hooks tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: HooksProcessor,
      testedTargets: [...hooksGlobalTargets.map((e) => e.target), ...hooksGlobalStandaloneTargets],
      global: true,
    });
  });

  it.each(hooksGlobalTargets)(
    "should generate $target hooks in home directory",
    async ({ target, outputPath }) => {
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
      if (target === "amp") {
        expect(generatedContent).toContain('amp.on("session.start"');
        expect(generatedContent).toContain('amp.on("agent.end"');
        expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");
        expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
      } else if (target === "opencode") {
        expect(generatedContent).toContain("RulesyncHooksPlugin");
        expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");
        expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
      } else if (target === "cline") {
        expect(JSON.parse(generatedContent).events).toEqual(["TaskStart"]);
        expect(
          await readFileContent(join(homeDir, "Documents", "Cline", "Hooks", "TaskStart")),
        ).toContain(".rulesync/hooks/session-start.sh");
      } else if (target === "kilo") {
        // Kilo's JS plugin differs from OpenCode's shape; assert command paths.
        expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");
        expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
      } else if (target === "pi") {
        // Pi emits a TypeScript extension subscribing to snake_case events.
        expect(generatedContent).toContain('pi.on("session_start"');
        expect(generatedContent).toContain('pi.on("agent_end"');
        expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");
        expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
      } else if (target === "copilot" || target === "copilotcli") {
        // Neither Copilot target supports the `stop` hook event, so audit.sh is
        // intentionally dropped during generation.
        const parsed = JSON.parse(generatedContent);
        expect(parsed.hooks.sessionStart).toBeDefined();
        expect(JSON.stringify(parsed.hooks)).toContain(".rulesync/hooks/session-start.sh");
      } else if (target === "zcode") {
        // ZCode never executes workspace config hooks, so generation is
        // global-only: the `hooks` block (with `enabled: true`) goes to
        // ~/.zcode/cli/config.json. See CANONICAL_TO_ZCODE_EVENT_NAMES in
        // src/types/hooks.ts.
        const parsedHooks = JSON.parse(generatedContent).hooks;
        expect(parsedHooks.enabled).toBe(true);
        expect(parsedHooks.events.SessionStart).toBeDefined();
        expect(parsedHooks.events.Stop).toBeDefined();
        expect(JSON.stringify(parsedHooks.events)).toContain(".rulesync/hooks/session-start.sh");
        expect(JSON.stringify(parsedHooks.events)).toContain(".rulesync/hooks/audit.sh");
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
      } else if (target in hooksKeyedEventNames) {
        assertHooksKeyedEvents({ target, parsed: JSON.parse(generatedContent) });
      } else {
        assertHookCommandsPreserved(JSON.parse(generatedContent));
      }
    },
  );

  it("should generate crush hooks in the user config", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    const hooksContent = JSON.stringify(
      {
        version: 1,
        root: true,
        hooks: {
          preToolUse: [{ command: ".rulesync/hooks/audit.sh", matcher: "bash" }],
        },
      },
      null,
      2,
    );
    await writeFileContent(join(projectDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH), hooksContent);

    await runGenerate({
      target: "crush",
      features: "hooks",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const parsed = JSON.parse(
      await readFileContent(join(homeDir, ".config", "crush", "crush.json")),
    );
    expect(parsed.hooks.PreToolUse).toEqual([
      { matcher: "bash", command: ".rulesync/hooks/audit.sh" },
    ]);
  });

  it("should generate devin hooks in home directory", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    // In global mode Devin hooks live under the `hooks` key of
    // ~/.config/devin/config.json (shared with permissions).
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

  it("should generate Kimi Code hooks in the shared user config", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();

    await writeFileContent(
      join(projectDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH),
      JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ command: "notify-send 'Kimi started'" }],
          stop: [{ command: "echo 'Kimi stopped'" }],
          preToolUse: [{ command: "bash evil.sh" }],
          postToolUse: [{ command: "npm test" }],
        },
      }),
    );

    await runGenerate({
      target: "kimi-code",
      features: "hooks",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const generated = await readFileContent(join(homeDir, ".kimi-code", "config.toml"));
    const parsed = smolToml.parse(generated) as {
      hooks: Array<{ event: string; command: string }>;
    };
    expect(parsed.hooks.map(({ event }) => event)).toEqual([
      "SessionStart",
      "Stop",
      "PreToolUse",
      "PostToolUse",
    ]);
    expect(parsed.hooks.map(({ command }) => command)).toEqual([
      expect.stringContaining("notify-send 'Kimi started'"),
      expect.stringContaining("echo 'Kimi stopped'"),
      expect.stringContaining("bash evil.sh"),
      expect.stringContaining("npm test"),
    ]);
    for (const hook of parsed.hooks) {
      expect(hook.command).toContain(projectDir);
    }
  });

  it("should import Kimi Code hooks from the shared user config", async () => {
    const homeDir = getHomeDir();

    await writeFileContent(
      join(homeDir, ".kimi-code", "config.toml"),
      [
        "[[hooks]]",
        'event = "PreToolUse"',
        'matcher = "Bash"',
        'command = ".kimi-code/hooks/check.sh"',
        "",
        "[[hooks]]",
        'event = "Stop"',
        `command = "cd -- '/opt/company/security-hooks' && ./gate.sh"`,
      ].join("\n"),
    );

    await runImport({
      target: "kimi-code",
      features: "hooks",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const imported = JSON.parse(
      await readFileContent(join(homeDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH)),
    );
    expect(imported.hooks.preToolUse).toEqual([
      {
        type: "command",
        matcher: "Bash",
        command: ".kimi-code/hooks/check.sh",
      },
    ]);
    expect(imported.hooks.stop).toEqual([
      {
        type: "command",
        command: "cd -- '/opt/company/security-hooks' && ./gate.sh",
      },
    ]);

    await runGenerate({
      target: "kimi-code",
      features: "hooks",
      global: true,
      inputRoots: [join(homeDir, RULESYNC_RELATIVE_DIR_PATH)],
      env: { HOME_DIR: homeDir },
    });
    const regenerated = smolToml.parse(
      await readFileContent(join(homeDir, ".kimi-code", "config.toml")),
    ) as { hooks: Array<{ event: string; command: string }> };
    expect(regenerated.hooks[0]?.command.match(/cd (?:--|\/d) /g)).toHaveLength(1);
    const regeneratedStop = regenerated.hooks.find(({ event }) => event === "Stop");
    expect(regeneratedStop?.command).toContain("RULESYNC_KIMI_HOOK_CWD=1");
    expect(regeneratedStop?.command).toContain("cd -- '/opt/company/security-hooks' && ./gate.sh");
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
    expect(generatedContent).toContain('type = "pre_tool"');
    expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
    expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");

    expect(await fileExists(join(homeDir, ".vibe", "config.toml"))).toBe(false);
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
    const generatedContent = await readFileContent(
      join(homeDir, getHermesagentGlobalDir(), "config.yaml"),
    );
    expect(generatedContent).not.toContain("rulesync:");
    expect(generatedContent).toContain("on_session_start");
    expect(generatedContent).toContain("pre_tool_call");
    expect(generatedContent).toContain(".rulesync/hooks/session-start.sh");
    expect(generatedContent).toContain(".rulesync/hooks/audit.sh");
    expect(generatedContent).toContain("matcher: terminal");
    expect(generatedContent).not.toContain(".rulesync/hooks/wt.sh");
  });

  it("should import Hermes native-only hooks without dropping them", async () => {
    const homeDir = getHomeDir();
    await writeFileContent(
      join(homeDir, getHermesagentGlobalDir(), "config.yaml"),
      [
        "hooks:",
        "  pre_tool_call:",
        "    - command: .rulesync/hooks/audit.sh",
        "      matcher: terminal",
        "  pre_api_request:",
        "    - command: .rulesync/hooks/sign-request.sh",
      ].join("\n"),
    );

    await runImport({
      target: "hermesagent",
      features: "hooks",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    const imported = JSON.parse(
      await readFileContent(join(homeDir, RULESYNC_HOOKS_RELATIVE_FILE_PATH)),
    );
    expect(imported.hooks.preToolUse).toEqual([
      {
        type: "command",
        command: ".rulesync/hooks/audit.sh",
        matcher: "terminal",
      },
    ]);
    expect(imported.hermesagent.hooks.pre_api_request).toEqual([
      {
        type: "command",
        command: ".rulesync/hooks/sign-request.sh",
      },
    ]);
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
