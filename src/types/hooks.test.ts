import { describe, expect, it } from "vitest";

import {
  HOOK_TYPES,
  HookDefinitionSchema,
  HooksConfigSchema,
  CANONICAL_TO_CLAUDE_EVENT_NAMES,
  CANONICAL_TO_CODEXCLI_EVENT_NAMES,
  CANONICAL_TO_CURSOR_EVENT_NAMES,
  CANONICAL_TO_DEEPAGENTS_EVENT_NAMES,
  CANONICAL_TO_FACTORYDROID_EVENT_NAMES,
  CANONICAL_TO_JUNIE_EVENT_NAMES,
  CANONICAL_TO_OPENCODE_EVENT_NAMES,
  CLAUDE_HOOK_EVENTS,
  CODEXCLI_HOOK_EVENTS,
  CODEXCLI_TO_CANONICAL_EVENT_NAMES,
  CURSOR_HOOK_EVENTS,
  DEEPAGENTS_HOOK_EVENTS,
  FACTORYDROID_HOOK_EVENTS,
  JUNIE_HOOK_EVENTS,
  JUNIE_TO_CANONICAL_EVENT_NAMES,
  OPENCODE_HOOK_EVENTS,
} from "./hooks.js";

describe("Event map completeness", () => {
  it("every CLAUDE_HOOK_EVENTS entry should exist in CANONICAL_TO_CLAUDE_EVENT_NAMES", () => {
    for (const event of CLAUDE_HOOK_EVENTS) {
      expect(CANONICAL_TO_CLAUDE_EVENT_NAMES).toHaveProperty(event);
    }
  });

  it("every FACTORYDROID_HOOK_EVENTS entry should exist in CANONICAL_TO_FACTORYDROID_EVENT_NAMES", () => {
    for (const event of FACTORYDROID_HOOK_EVENTS) {
      expect(CANONICAL_TO_FACTORYDROID_EVENT_NAMES).toHaveProperty(event);
    }
  });

  it("every CURSOR_HOOK_EVENTS entry should exist in CANONICAL_TO_CURSOR_EVENT_NAMES", () => {
    for (const event of CURSOR_HOOK_EVENTS) {
      expect(CANONICAL_TO_CURSOR_EVENT_NAMES).toHaveProperty(event);
    }
  });

  it("every OPENCODE_HOOK_EVENTS entry should exist in CANONICAL_TO_OPENCODE_EVENT_NAMES", () => {
    // The shell events are not in the generic event map: OpenCode has no
    // shell-execution lifecycle event, so they are emitted as bash-gated
    // named tool.execute.* hooks (SHELL_EVENT_TOOL_GATES in
    // opencode-style-generator.ts).
    const namedHookOnlyEvents = new Set(["beforeShellExecution", "afterShellExecution"]);
    for (const event of OPENCODE_HOOK_EVENTS) {
      if (namedHookOnlyEvents.has(event)) {
        continue;
      }
      expect(CANONICAL_TO_OPENCODE_EVENT_NAMES).toHaveProperty(event);
    }
  });

  it("every DEEPAGENTS_HOOK_EVENTS entry should exist in CANONICAL_TO_DEEPAGENTS_EVENT_NAMES", () => {
    for (const event of DEEPAGENTS_HOOK_EVENTS) {
      expect(CANONICAL_TO_DEEPAGENTS_EVENT_NAMES).toHaveProperty(event);
    }
  });

  it("every CODEXCLI_HOOK_EVENTS entry should exist in CANONICAL_TO_CODEXCLI_EVENT_NAMES", () => {
    for (const event of CODEXCLI_HOOK_EVENTS) {
      expect(CANONICAL_TO_CODEXCLI_EVENT_NAMES).toHaveProperty(event);
    }
  });

  it("every JUNIE_HOOK_EVENTS entry should exist in CANONICAL_TO_JUNIE_EVENT_NAMES", () => {
    for (const event of JUNIE_HOOK_EVENTS) {
      expect(CANONICAL_TO_JUNIE_EVENT_NAMES).toHaveProperty(event);
    }
  });
});

describe("Junie CLI event naming", () => {
  it("should map canonical event names to documented Junie PascalCase names", () => {
    // Verified against https://junie.jetbrains.com/docs/junie-cli-hooks.html
    expect(CANONICAL_TO_JUNIE_EVENT_NAMES.sessionStart).toBe("SessionStart");
    expect(CANONICAL_TO_JUNIE_EVENT_NAMES.beforeSubmitPrompt).toBe("UserPromptSubmit");
    expect(CANONICAL_TO_JUNIE_EVENT_NAMES.preToolUse).toBe("PreToolUse");
    expect(CANONICAL_TO_JUNIE_EVENT_NAMES.stop).toBe("Stop");
    expect(CANONICAL_TO_JUNIE_EVENT_NAMES.stopFailure).toBe("StopFailure");
    expect(CANONICAL_TO_JUNIE_EVENT_NAMES.permissionRequest).toBe("PermissionRequest");
    expect(CANONICAL_TO_JUNIE_EVENT_NAMES.sessionEnd).toBe("SessionEnd");
  });

  it("should support the seven documented Junie CLI hook events", () => {
    expect(JUNIE_HOOK_EVENTS).toEqual([
      "sessionStart",
      "beforeSubmitPrompt",
      "preToolUse",
      "stop",
      "stopFailure",
      "permissionRequest",
      "sessionEnd",
    ]);
  });

  it("should round-trip every Junie event name back to canonical", () => {
    for (const [canonical, junie] of Object.entries(CANONICAL_TO_JUNIE_EVENT_NAMES)) {
      expect(JUNIE_TO_CANONICAL_EVENT_NAMES[junie]).toBe(canonical);
    }
  });
});

describe("Codex CLI event naming", () => {
  it("should support the postCompact event mapped to PostCompact", () => {
    // Verified against https://developers.openai.com/codex/hooks
    expect(CODEXCLI_HOOK_EVENTS).toContain("postCompact");
    expect(CANONICAL_TO_CODEXCLI_EVENT_NAMES.postCompact).toBe("PostCompact");
    expect(CODEXCLI_TO_CANONICAL_EVENT_NAMES.PostCompact).toBe("postCompact");
  });

  it("should keep preCompact distinct from postCompact", () => {
    expect(CANONICAL_TO_CODEXCLI_EVENT_NAMES.preCompact).toBe("PreCompact");
    expect(CODEXCLI_TO_CANONICAL_EVENT_NAMES.PreCompact).toBe("preCompact");
  });
});

describe("Cursor event naming", () => {
  it("should support the workspaceOpen event", () => {
    // Verified against https://cursor.com/docs/hooks
    expect(CURSOR_HOOK_EVENTS).toContain("workspaceOpen");
    expect(CANONICAL_TO_CURSOR_EVENT_NAMES.workspaceOpen).toBe("workspaceOpen");
  });
});

describe("Factory Droid removed events", () => {
  it("should not list setup/permissionRequest (not valid Droid events)", () => {
    expect(FACTORYDROID_HOOK_EVENTS).not.toContain("setup");
    expect(FACTORYDROID_HOOK_EVENTS).not.toContain("permissionRequest");
    expect(CANONICAL_TO_FACTORYDROID_EVENT_NAMES.setup).toBeUndefined();
    expect(CANONICAL_TO_FACTORYDROID_EVENT_NAMES.permissionRequest).toBeUndefined();
  });
});

describe("DeepAgents event naming", () => {
  it("should map canonical events to the Hooks v2 PascalCase HookEvent values", () => {
    // Verified against langchain-ai/deepagents libs/code/deepagents_code/hooks/models/domain.py
    // (Hooks v2, GA since deepagents-code 0.1.52).
    expect(CANONICAL_TO_DEEPAGENTS_EVENT_NAMES.notification).toBe("Notification");
    expect(CANONICAL_TO_DEEPAGENTS_EVENT_NAMES.sessionStart).toBe("SessionStart");
    expect(CANONICAL_TO_DEEPAGENTS_EVENT_NAMES.beforeSubmitPrompt).toBe("UserPromptSubmit");
    expect(CANONICAL_TO_DEEPAGENTS_EVENT_NAMES.stop).toBe("Stop");
    expect(DEEPAGENTS_HOOK_EVENTS).toContain("notification");
    expect(DEEPAGENTS_HOOK_EVENTS).toContain("subagentStart");
    expect(DEEPAGENTS_HOOK_EVENTS).toContain("subagentStop");
  });

  it("should drop contextOffload, which has no Hooks v2 counterpart", () => {
    expect(CANONICAL_TO_DEEPAGENTS_EVENT_NAMES.contextOffload).toBeUndefined();
    expect(DEEPAGENTS_HOOK_EVENTS).not.toContain("contextOffload");
  });
});

describe("Claude Code event naming", () => {
  it("should map the messageDisplay event to Claude's MessageDisplay name", () => {
    // Verified against https://code.claude.com/docs/en/changelog (v2.1.152)
    expect(CANONICAL_TO_CLAUDE_EVENT_NAMES.messageDisplay).toBe("MessageDisplay");
  });

  it("should list messageDisplay as a supported Claude hook event", () => {
    expect(CLAUDE_HOOK_EVENTS).toContain("messageDisplay");
  });
});

describe("Factory Droid event naming", () => {
  it("should map canonical event names to documented Factory Droid PascalCase names", () => {
    // Verified against https://docs.factory.ai/reference/hooks-reference
    expect(CANONICAL_TO_FACTORYDROID_EVENT_NAMES.sessionStart).toBe("SessionStart");
    expect(CANONICAL_TO_FACTORYDROID_EVENT_NAMES.sessionEnd).toBe("SessionEnd");
    expect(CANONICAL_TO_FACTORYDROID_EVENT_NAMES.preToolUse).toBe("PreToolUse");
    expect(CANONICAL_TO_FACTORYDROID_EVENT_NAMES.postToolUse).toBe("PostToolUse");
    expect(CANONICAL_TO_FACTORYDROID_EVENT_NAMES.beforeSubmitPrompt).toBe("UserPromptSubmit");
    expect(CANONICAL_TO_FACTORYDROID_EVENT_NAMES.stop).toBe("Stop");
    expect(CANONICAL_TO_FACTORYDROID_EVENT_NAMES.subagentStop).toBe("SubagentStop");
    expect(CANONICAL_TO_FACTORYDROID_EVENT_NAMES.preCompact).toBe("PreCompact");
    expect(CANONICAL_TO_FACTORYDROID_EVENT_NAMES.notification).toBe("Notification");
  });
});

describe("HookDefinitionSchema", () => {
  it("should accept every canonical hook type", () => {
    for (const type of HOOK_TYPES) {
      const result = HookDefinitionSchema.safeParse({ type });
      expect(result.success).toBe(true);
    }
  });

  it("should reject an unknown hook type", () => {
    const result = HookDefinitionSchema.safeParse({ type: "webhook" });
    expect(result.success).toBe(false);
  });

  it("should accept bash and powershell shells", () => {
    for (const shell of ["bash", "powershell"]) {
      const result = HookDefinitionSchema.safeParse({ type: "command", command: "ls", shell });
      expect(result.success).toBe(true);
    }
  });

  it("should reject an unsupported shell", () => {
    const result = HookDefinitionSchema.safeParse({
      type: "command",
      command: "ls",
      shell: "zsh",
    });
    expect(result.success).toBe(false);
  });
});

describe("HooksConfigSchema", () => {
  it("should accept canonical event names as top-level hooks keys", () => {
    const result = HooksConfigSchema.safeParse({
      hooks: { preToolUse: [{ type: "command", command: "ls" }] },
    });
    expect(result.success).toBe(true);
  });

  it("should reject an unknown top-level event name", () => {
    const result = HooksConfigSchema.safeParse({
      hooks: { preToolUsee: [{ type: "command", command: "ls" }] },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("preToolUsee");
  });

  it("should keep tool-override hook keys lenient for native passthrough triggers", () => {
    const result = HooksConfigSchema.safeParse({
      hooks: {},
      "kiro-ide": { hooks: { PostFileSave: [{ type: "command", command: "ls" }] } },
    });
    expect(result.success).toBe(true);
  });
});
