import { describe, expect, it } from "vitest";

import type { HookEvent, HooksConfig } from "../../types/hooks.js";
import type { PascalHooksConverterConfig } from "./pascal-hooks-converter.js";
import { canonicalToPascalHooks, pascalHooksToCanonical } from "./pascal-hooks-converter.js";

const TEST_CONFIG: PascalHooksConverterConfig = {
  supportedEvents: ["sessionStart", "preToolUse", "stop"],
  canonicalToToolEventNames: {
    sessionStart: "SessionStart",
    preToolUse: "PreToolUse",
    stop: "Stop",
  },
  toolToCanonicalEventNames: {
    SessionStart: "sessionStart",
    PreToolUse: "preToolUse",
    Stop: "stop",
  },
  projectDirVar: "$TEST_PROJECT_DIR",
};

type MatcherEntry = { matcher?: string; hooks: Array<Record<string, unknown>> };

function makeConfig(hooks: HooksConfig["hooks"], overrides?: Partial<HooksConfig>): HooksConfig {
  return { version: 1, hooks, ...overrides };
}

function getHooks(entry: unknown): Array<Record<string, unknown>> {
  return (entry as MatcherEntry).hooks;
}

describe("canonicalToPascalHooks", () => {
  it("should filter out events not in supportedEvents", () => {
    const config = makeConfig({
      sessionStart: [{ type: "command", command: "./start.sh" }],
      notification: [{ type: "command", command: "./notify.sh" }],
    });
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: undefined,
      converterConfig: TEST_CONFIG,
    });
    expect(result).toHaveProperty("SessionStart");
    expect(result).not.toHaveProperty("Notification");
    expect(result).not.toHaveProperty("notification");
  });

  it("should merge toolOverrideHooks over shared hooks", () => {
    const config = makeConfig({
      sessionStart: [{ type: "command", command: "./shared.sh" }],
    });
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: {
        sessionStart: [{ type: "command", command: "./override.sh" }],
      },
      converterConfig: TEST_CONFIG,
    });
    const entries = result.SessionStart!;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      hooks: [{ type: "command", command: "$TEST_PROJECT_DIR/override.sh" }],
    });
  });

  it("should use only shared hooks when toolOverrideHooks is undefined", () => {
    const config = makeConfig({
      sessionStart: [{ type: "command", command: "./start.sh" }],
    });
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: undefined,
      converterConfig: TEST_CONFIG,
    });
    expect(result.SessionStart![0]).toEqual({
      hooks: [{ type: "command", command: "$TEST_PROJECT_DIR/start.sh" }],
    });
  });

  it("should not prefix commands starting with $", () => {
    const config = makeConfig({
      sessionStart: [{ type: "command", command: "$HOME/scripts/start.sh" }],
    });
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: undefined,
      converterConfig: TEST_CONFIG,
    });
    const hooks = getHooks(result.SessionStart![0]);
    expect(hooks[0]!.command).toBe("$HOME/scripts/start.sh");
  });

  it("should prefix commands not starting with $ and strip leading ./", () => {
    const config = makeConfig({
      sessionStart: [{ type: "command", command: "./hooks/start.sh" }],
    });
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: undefined,
      converterConfig: TEST_CONFIG,
    });
    const hooks = getHooks(result.SessionStart![0]);
    expect(hooks[0]!.command).toBe("$TEST_PROJECT_DIR/hooks/start.sh");
  });

  it("should prefix commands without ./ prefix", () => {
    const config = makeConfig({
      sessionStart: [{ type: "command", command: "hooks/start.sh" }],
    });
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: undefined,
      converterConfig: TEST_CONFIG,
    });
    const hooks = getHooks(result.SessionStart![0]);
    expect(hooks[0]!.command).toBe("$TEST_PROJECT_DIR/hooks/start.sh");
  });

  it("should group defs by matcher", () => {
    const config = makeConfig({
      preToolUse: [
        { type: "command", command: "./a.sh", matcher: "Bash" },
        { type: "command", command: "./b.sh", matcher: "Bash" },
        { type: "command", command: "./c.sh", matcher: "Read" },
      ],
    });
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: undefined,
      converterConfig: TEST_CONFIG,
    });
    const entries = result.PreToolUse!;
    expect(entries).toHaveLength(2);
    const bashEntry = entries.find((e) => (e as MatcherEntry).matcher === "Bash") as MatcherEntry;
    expect(bashEntry.hooks).toHaveLength(2);
  });

  it("should output entries without matcher key when matcher is empty", () => {
    const config = makeConfig({
      sessionStart: [{ type: "command", command: "./start.sh" }],
    });
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: undefined,
      converterConfig: TEST_CONFIG,
    });
    expect(result.SessionStart![0]).not.toHaveProperty("matcher");
  });

  it("should convert event names via canonicalToToolEventNames", () => {
    const config = makeConfig({
      sessionStart: [{ type: "command", command: "./start.sh" }],
      stop: [{ type: "command", command: "./stop.sh" }],
    });
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: undefined,
      converterConfig: TEST_CONFIG,
    });
    expect(result).toHaveProperty("SessionStart");
    expect(result).toHaveProperty("Stop");
    expect(result).not.toHaveProperty("sessionStart");
    expect(result).not.toHaveProperty("stop");
  });

  it("should pass through event names not in canonicalToToolEventNames", () => {
    const configWithCustom: PascalHooksConverterConfig = {
      ...TEST_CONFIG,
      supportedEvents: [...TEST_CONFIG.supportedEvents, "customEvent" as HookEvent],
    };
    const config = makeConfig({
      customEvent: [{ type: "command", command: "./custom.sh" }],
    });
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: undefined,
      converterConfig: configWithCustom,
    });
    expect(result).toHaveProperty("customEvent");
  });

  it("should include prompt and timeout fields when present", () => {
    const config = makeConfig({
      sessionStart: [{ type: "prompt", prompt: "Check this", timeout: 5000 }],
    });
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: undefined,
      converterConfig: TEST_CONFIG,
    });
    const hooks = getHooks(result.SessionStart![0]);
    expect(hooks[0]!.prompt).toBe("Check this");
    expect(hooks[0]!.timeout).toBe(5000);
  });

  it("should omit command key when command is undefined", () => {
    const config = makeConfig({
      sessionStart: [{ type: "prompt", prompt: "Check this" }],
    });
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: undefined,
      converterConfig: TEST_CONFIG,
    });
    const hooks = getHooks(result.SessionStart![0]);
    expect(hooks[0]).not.toHaveProperty("command");
  });

  it("should return empty result when config.hooks is empty", () => {
    const config = makeConfig({});
    const result = canonicalToPascalHooks({
      config,
      toolOverrideHooks: undefined,
      converterConfig: TEST_CONFIG,
    });
    expect(result).toEqual({});
  });
});

describe("pascalHooksToCanonical", () => {
  it("should return {} for null input", () => {
    expect(pascalHooksToCanonical({ hooks: null, converterConfig: TEST_CONFIG })).toEqual({});
  });

  it("should return {} for undefined input", () => {
    expect(pascalHooksToCanonical({ hooks: undefined, converterConfig: TEST_CONFIG })).toEqual({});
  });

  it("should return {} for non-object input", () => {
    expect(pascalHooksToCanonical({ hooks: "string", converterConfig: TEST_CONFIG })).toEqual({});
  });

  it("should convert tool event names to canonical", () => {
    const hooks = {
      SessionStart: [{ hooks: [{ type: "command", command: "./start.sh" }] }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    expect(result).toHaveProperty("sessionStart");
    expect(result).not.toHaveProperty("SessionStart");
  });

  it("should strip projectDirVar prefix from commands", () => {
    const hooks = {
      SessionStart: [{ hooks: [{ type: "command", command: "$TEST_PROJECT_DIR/hooks/start.sh" }] }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    const defs = result.sessionStart!;
    expect(defs[0]!.command).toBe("./hooks/start.sh");
  });

  it("should leave commands without projectDirVar prefix unchanged", () => {
    const hooks = {
      SessionStart: [{ hooks: [{ type: "command", command: "$HOME/scripts/start.sh" }] }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    const defs = result.sessionStart!;
    expect(defs[0]!.command).toBe("$HOME/scripts/start.sh");
  });

  it("should propagate matcher from entry to hook definition", () => {
    const hooks = {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./check.sh" }] }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    const defs = result.preToolUse!;
    expect(defs[0]!.matcher).toBe("Bash");
  });

  it("should omit matcher when entry.matcher is empty string", () => {
    const hooks = {
      SessionStart: [{ matcher: "", hooks: [{ type: "command", command: "./start.sh" }] }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    const defs = result.sessionStart!;
    expect(defs[0]).not.toHaveProperty("matcher");
  });

  it("should skip entries that are not valid PascalMatcherEntry", () => {
    const hooks = {
      SessionStart: ["invalid-string-entry", { hooks: [{ type: "command", command: "./ok.sh" }] }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    const defs = result.sessionStart!;
    expect(defs).toHaveLength(1);
    expect(defs[0]!.command).toBe("./ok.sh");
  });

  it("should skip entries with non-string matcher", () => {
    const hooks = {
      SessionStart: [{ matcher: 123, hooks: [{ type: "command", command: "./bad.sh" }] }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    expect(result).not.toHaveProperty("sessionStart");
  });

  it("should skip entries with non-array hooks property", () => {
    const hooks = {
      SessionStart: [{ hooks: "not-an-array" }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    expect(result).not.toHaveProperty("sessionStart");
  });

  it("should skip events where matcherEntries is not an array", () => {
    const hooks = {
      SessionStart: "not-an-array",
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    expect(result).not.toHaveProperty("sessionStart");
  });

  it("should not include event when all entries have no hooks", () => {
    const hooks = {
      SessionStart: [{ matcher: "test" }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    expect(result).not.toHaveProperty("sessionStart");
  });

  it("should preserve prompt field", () => {
    const hooks = {
      SessionStart: [{ hooks: [{ type: "prompt", prompt: "Check this" }] }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    const defs = result.sessionStart!;
    expect(defs[0]!.prompt).toBe("Check this");
    expect(defs[0]!.type).toBe("prompt");
  });

  it("should default type to command when type is invalid", () => {
    const hooks = {
      SessionStart: [{ hooks: [{ type: "invalid", command: "./start.sh" }] }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    const defs = result.sessionStart!;
    expect(defs[0]!.type).toBe("command");
  });

  it("should omit timeout when not a number", () => {
    const hooks = {
      SessionStart: [{ hooks: [{ type: "command", command: "./start.sh", timeout: "5000" }] }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    const defs = result.sessionStart!;
    expect(defs[0]).not.toHaveProperty("timeout");
  });

  it("should preserve timeout when it is a number", () => {
    const hooks = {
      SessionStart: [{ hooks: [{ type: "command", command: "./start.sh", timeout: 5000 }] }],
    };
    const result = pascalHooksToCanonical({ hooks, converterConfig: TEST_CONFIG });
    const defs = result.sessionStart!;
    expect(defs[0]!.timeout).toBe(5000);
  });
});
