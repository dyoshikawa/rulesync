import { describe, expect, it } from "vitest";

import type { HooksConfig } from "../../types/hooks.js";
import type { PascalHooksConverterConfig } from "./pascal-hooks-converter.js";
import { canonicalToPascalHooks, pascalHooksToCanonical } from "./pascal-hooks-converter.js";

const CFG: PascalHooksConverterConfig = {
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

type Entry = { matcher?: string; hooks: Array<Record<string, unknown>> };
const cfg = (hooks: HooksConfig["hooks"]): HooksConfig => ({ version: 1, hooks });
const hooks = (entry: unknown) => (entry as Entry).hooks;

describe("canonicalToPascalHooks", () => {
  it("should filter unsupported events and convert event names", () => {
    const result = canonicalToPascalHooks({
      config: cfg({
        sessionStart: [{ type: "command", command: "./start.sh" }],
        notification: [{ type: "command", command: "./notify.sh" }],
      }),
      toolOverrideHooks: undefined,
      converterConfig: CFG,
    });
    expect(result).toHaveProperty("SessionStart");
    expect(result).not.toHaveProperty("notification");
    expect(result).not.toHaveProperty("sessionStart");
  });

  it("should merge toolOverrideHooks over shared hooks", () => {
    const result = canonicalToPascalHooks({
      config: cfg({ sessionStart: [{ type: "command", command: "./shared.sh" }] }),
      toolOverrideHooks: { sessionStart: [{ type: "command", command: "./override.sh" }] },
      converterConfig: CFG,
    });
    expect(hooks(result.SessionStart![0])[0]!.command).toBe("$TEST_PROJECT_DIR/override.sh");
  });

  it("should prefix non-$ commands, strip ./, and skip $ commands", () => {
    const result = canonicalToPascalHooks({
      config: cfg({
        sessionStart: [
          { type: "command", command: "./hooks/a.sh" },
          { type: "command", command: "hooks/b.sh" },
          { type: "command", command: "$HOME/c.sh" },
        ],
      }),
      toolOverrideHooks: undefined,
      converterConfig: CFG,
    });
    const h = hooks(result.SessionStart![0]);
    expect(h[0]!.command).toBe("$TEST_PROJECT_DIR/hooks/a.sh");
    expect(h[1]!.command).toBe("$TEST_PROJECT_DIR/hooks/b.sh");
    expect(h[2]!.command).toBe("$HOME/c.sh");
  });

  it("should group defs by matcher", () => {
    const result = canonicalToPascalHooks({
      config: cfg({
        preToolUse: [
          { type: "command", command: "./a.sh", matcher: "Bash" },
          { type: "command", command: "./b.sh", matcher: "Bash" },
          { type: "command", command: "./c.sh", matcher: "Read" },
        ],
      }),
      toolOverrideHooks: undefined,
      converterConfig: CFG,
    });
    expect(result.PreToolUse!).toHaveLength(2);
    const bash = result.PreToolUse!.find((e) => (e as Entry).matcher === "Bash") as Entry;
    expect(bash.hooks).toHaveLength(2);
  });

  it("should include prompt/timeout and omit absent command", () => {
    const result = canonicalToPascalHooks({
      config: cfg({ sessionStart: [{ type: "prompt", prompt: "Check", timeout: 5000 }] }),
      toolOverrideHooks: undefined,
      converterConfig: CFG,
    });
    const h = hooks(result.SessionStart![0]);
    expect(h[0]!.prompt).toBe("Check");
    expect(h[0]!.timeout).toBe(5000);
    expect(h[0]).not.toHaveProperty("command");
  });
});

describe("pascalHooksToCanonical", () => {
  it("should return {} for null/undefined/non-object input", () => {
    for (const input of [null, undefined, "string"]) {
      expect(pascalHooksToCanonical({ hooks: input, converterConfig: CFG })).toEqual({});
    }
  });

  it("should convert event names and strip projectDirVar prefix", () => {
    const result = pascalHooksToCanonical({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "$TEST_PROJECT_DIR/start.sh" }] }],
      },
      converterConfig: CFG,
    });
    expect(result).toHaveProperty("sessionStart");
    expect(result).not.toHaveProperty("SessionStart");
    expect(result.sessionStart![0]!.command).toBe("./start.sh");
  });

  it("should leave non-projectDirVar commands unchanged", () => {
    const result = pascalHooksToCanonical({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "$HOME/start.sh" }] }] },
      converterConfig: CFG,
    });
    expect(result.sessionStart![0]!.command).toBe("$HOME/start.sh");
  });

  it("should propagate matcher and omit empty matcher", () => {
    const result = pascalHooksToCanonical({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./a.sh" }] }],
        SessionStart: [{ matcher: "", hooks: [{ type: "command", command: "./b.sh" }] }],
      },
      converterConfig: CFG,
    });
    expect(result.preToolUse![0]!.matcher).toBe("Bash");
    expect(result.sessionStart![0]).not.toHaveProperty("matcher");
  });

  it("should skip invalid entries and non-array events", () => {
    const result = pascalHooksToCanonical({
      hooks: {
        SessionStart: [
          "bad",
          { matcher: 123, hooks: [] },
          { hooks: [{ type: "command", command: "./ok.sh" }] },
        ],
        Stop: "not-array",
      },
      converterConfig: CFG,
    });
    expect(result.sessionStart!).toHaveLength(1);
    expect(result.sessionStart![0]!.command).toBe("./ok.sh");
    expect(result).not.toHaveProperty("stop");
  });

  it("should default invalid type to command and handle prompt/timeout", () => {
    const result = pascalHooksToCanonical({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "invalid", command: "./a.sh" }] },
          { hooks: [{ type: "prompt", prompt: "Check", timeout: 5000 }] },
          { hooks: [{ type: "command", command: "./b.sh", timeout: "bad" }] },
        ],
      },
      converterConfig: CFG,
    });
    const defs = result.sessionStart!;
    expect(defs[0]!.type).toBe("command");
    expect(defs[1]!.prompt).toBe("Check");
    expect(defs[1]!.timeout).toBe(5000);
    expect(defs[2]).not.toHaveProperty("timeout");
  });
});
