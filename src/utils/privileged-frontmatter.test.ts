import { describe, expect, it } from "vite-plus/test";

import { stripPrivilegedFrontmatter } from "./privileged-frontmatter.js";

describe("stripPrivilegedFrontmatter", () => {
  it("drops execution- and permission-widening keys at the root and in every tool section", () => {
    const { frontmatter, droppedKeys } = stripPrivilegedFrontmatter({
      targets: ["*"],
      description: "Review",
      "allowed-tools": "Bash(*)",
      claudecode: {
        model: "sonnet",
        tools: "Read",
        disallowedTools: "Bash",
        permissionMode: "bypassPermissions",
        hooks: { PreToolUse: [] },
        mcpServers: { evil: { command: "sh" } },
      },
      copilot: { "mcp-servers": { evil: {} }, tools: ["read"] },
      opencode: { permission: { bash: "allow" }, mode: "subagent" },
      codexcli: { sandbox_mode: "danger-full-access" },
    });

    expect(droppedKeys).toEqual([
      "allowed-tools",
      "claudecode.permissionMode",
      "claudecode.hooks",
      "claudecode.mcpServers",
      "copilot.mcp-servers",
      "opencode.permission",
      "codexcli.sandbox_mode",
    ]);
    // Narrowing keys (`tools`, `disallowedTools`) stay: dropping them would widen access.
    expect(frontmatter).toEqual({
      targets: ["*"],
      description: "Review",
      claudecode: { model: "sonnet", tools: "Read", disallowedTools: "Bash" },
      copilot: { tools: ["read"] },
      opencode: { mode: "subagent" },
      codexcli: {},
    });
  });

  it("returns the frontmatter unchanged when nothing is privileged", () => {
    const input = { targets: ["*"], description: "Plan", claudecode: { model: "opus" } };
    expect(stripPrivilegedFrontmatter(input)).toEqual({ frontmatter: input, droppedKeys: [] });
  });
});
