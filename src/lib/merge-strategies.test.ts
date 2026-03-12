import { describe, expect, it } from "vitest";

import { mergeAiignore, mergeHooks, mergeMcpServers } from "./merge-strategies.js";

describe("mergeMcpServers", () => {
  it("should keep base servers when no conflicts", () => {
    const base = { mcpServers: { a: { command: "a" } } };
    const overlay = { mcpServers: { b: { command: "b" } } };

    const result = mergeMcpServers(base, overlay);

    expect(result.mcpServers).toEqual({
      a: { command: "a" },
      b: { command: "b" },
    });
  });

  it("should give precedence to base servers on name conflict", () => {
    const base = { mcpServers: { shared: { command: "base-cmd" } } };
    const overlay = { mcpServers: { shared: { command: "overlay-cmd" } } };

    const result = mergeMcpServers(base, overlay);

    expect(result.mcpServers).toEqual({ shared: { command: "base-cmd" } });
  });

  it("should handle empty base", () => {
    const base = { mcpServers: {} };
    const overlay = { mcpServers: { a: { command: "a" } } };

    const result = mergeMcpServers(base, overlay);

    expect(result.mcpServers).toEqual({ a: { command: "a" } });
  });

  it("should handle empty overlay", () => {
    const base = { mcpServers: { a: { command: "a" } } };
    const overlay = { mcpServers: {} };

    const result = mergeMcpServers(base, overlay);

    expect(result.mcpServers).toEqual({ a: { command: "a" } });
  });
});

describe("mergeHooks", () => {
  it("should concatenate hook arrays for the same event", () => {
    const base = { hooks: { sessionStart: [{ command: "base-cmd" }] } };
    const overlay = { hooks: { sessionStart: [{ command: "overlay-cmd" }] } };

    const result = mergeHooks(base, overlay);

    expect(result.hooks.sessionStart).toEqual([
      { command: "base-cmd" },
      { command: "overlay-cmd" },
    ]);
  });

  it("should add overlay events not present in base", () => {
    const base = { hooks: { sessionStart: [{ command: "start" }] } };
    const overlay = { hooks: { sessionEnd: [{ command: "end" }] } };

    const result = mergeHooks(base, overlay);

    expect(result.hooks.sessionStart).toEqual([{ command: "start" }]);
    expect(result.hooks.sessionEnd).toEqual([{ command: "end" }]);
  });

  it("should merge per-tool hook sections", () => {
    const base = {
      hooks: {},
      cursor: { hooks: { preToolUse: [{ command: "base-hook" }] } },
    };
    const overlay = {
      hooks: {},
      cursor: { hooks: { preToolUse: [{ command: "overlay-hook" }] } },
    };

    const result = mergeHooks(base, overlay);

    expect(result.cursor?.hooks?.preToolUse).toEqual([
      { command: "base-hook" },
      { command: "overlay-hook" },
    ]);
  });

  it("should handle missing per-tool sections in base", () => {
    const base = { hooks: {} };
    const overlay = {
      hooks: {},
      claudecode: { hooks: { sessionStart: [{ command: "init" }] } },
    };

    const result = mergeHooks(base, overlay);

    expect(result.claudecode?.hooks?.sessionStart).toEqual([{ command: "init" }]);
  });

  it("should handle empty hooks objects", () => {
    const base = { hooks: {} };
    const overlay = { hooks: {} };

    const result = mergeHooks(base, overlay);

    expect(result.hooks).toEqual({});
  });
});

describe("mergeAiignore", () => {
  it("should concatenate lines from overlay after base", () => {
    const base = "*.log\n*.tmp\n";
    const overlay = "*.bak\n";

    const result = mergeAiignore(base, overlay);

    expect(result).toBe("*.log\n*.tmp\n*.bak\n");
  });

  it("should deduplicate identical lines", () => {
    const base = "*.log\n*.tmp\n";
    const overlay = "*.log\n*.new\n";

    const result = mergeAiignore(base, overlay);

    expect(result).toBe("*.log\n*.tmp\n*.new\n");
  });

  it("should skip empty lines in overlay", () => {
    const base = "*.log\n";
    const overlay = "\n\n*.bak\n\n";

    const result = mergeAiignore(base, overlay);

    expect(result).toBe("*.log\n*.bak\n");
  });

  it("should return base unchanged when overlay has nothing new", () => {
    const base = "*.log\n*.tmp\n";
    const overlay = "*.log\n*.tmp\n";

    const result = mergeAiignore(base, overlay);

    expect(result).toBe("*.log\n*.tmp\n");
  });

  it("should handle base without trailing newline", () => {
    const base = "*.log";
    const overlay = "*.bak\n";

    const result = mergeAiignore(base, overlay);

    expect(result).toBe("*.log\n*.bak\n");
  });
});
