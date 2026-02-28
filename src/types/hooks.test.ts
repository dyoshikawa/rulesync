import { describe, expect, it } from "vitest";

import {
  CANONICAL_TO_CLAUDE_EVENT_NAMES,
  CANONICAL_TO_CURSOR_EVENT_NAMES,
  CANONICAL_TO_FACTORYDROID_EVENT_NAMES,
  CANONICAL_TO_OPENCODE_EVENT_NAMES,
  CLAUDE_HOOK_EVENTS,
  CURSOR_HOOK_EVENTS,
  FACTORYDROID_HOOK_EVENTS,
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
    for (const event of OPENCODE_HOOK_EVENTS) {
      expect(CANONICAL_TO_OPENCODE_EVENT_NAMES).toHaveProperty(event);
    }
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
