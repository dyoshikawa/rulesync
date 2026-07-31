import { describe, expect, it } from "vitest";

import { RulesyncPermissionsFileSchema } from "./permissions.js";

const withOverride = (override: Record<string, unknown>) => ({
  permission: {},
  ...override,
});

describe("RulesyncPermissionsFileSchema tool-scoped override enums", () => {
  describe("cursor.approvalMode", () => {
    it.each(["allowlist", "auto-review", "unrestricted"])("should accept %s", (value) => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({ cursor: { approvalMode: value } }),
      );
      expect(result.success).toBe(true);
    });

    it("should reject an unknown value", () => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({ cursor: { approvalMode: "yolo" } }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe("warp.agent_mode_coding_permissions", () => {
    it.each(["always_ask_before_reading", "always_allow_reading", "allow_reading_specific_files"])(
      "should accept %s",
      (value) => {
        const result = RulesyncPermissionsFileSchema.safeParse(
          withOverride({ warp: { agent_mode_coding_permissions: value } }),
        );
        expect(result.success).toBe(true);
      },
    );

    it("should reject an unknown value", () => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({ warp: { agent_mode_coding_permissions: "never_read" } }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe("warp.execution_profile", () => {
    it.each(["agent_decides", "always_allow", "always_ask"])(
      "should accept action permission %s",
      (value) => {
        const result = RulesyncPermissionsFileSchema.safeParse(
          withOverride({
            warp: {
              execution_profile: {
                read_files: value,
                execute_commands: value,
                mcp_permissions: value,
              },
            },
          }),
        );
        expect(result.success).toBe(true);
      },
    );

    it("should accept the tool-specific enums and list keys", () => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({
          warp: {
            execution_profile: {
              write_to_pty: "ask_on_first_write",
              ask_user_question: "ask_except_in_auto_approve",
              run_agents: "never_allow",
              computer_use: "never",
              directory_allowlist: ["/home/me/projects"],
              mcp_allowlist: ["trusted"],
              mcp_denylist: ["untrusted"],
            },
          },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("should reject an unknown action permission value", () => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({ warp: { execution_profile: { read_files: "sometimes" } } }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe("antigravity-cli.toolPermission", () => {
    it.each(["request-review", "proceed-in-sandbox", "always-proceed", "strict"])(
      "should accept %s",
      (value) => {
        const result = RulesyncPermissionsFileSchema.safeParse(
          withOverride({ "antigravity-cli": { toolPermission: value } }),
        );
        expect(result.success).toBe(true);
      },
    );

    it("should reject an unknown value", () => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({ "antigravity-cli": { toolPermission: "lenient" } }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe("amp.permissions entries", () => {
    it.each(["allow", "ask", "reject", "delegate"])("should accept action %s", (action) => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({ amp: { permissions: [{ tool: "Bash", action }] } }),
      );
      expect(result.success).toBe(true);
    });

    it.each(["thread", "subagent"])("should accept context %s", (context) => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({ amp: { permissions: [{ tool: "Bash", action: "allow", context }] } }),
      );
      expect(result.success).toBe(true);
    });

    it("should reject an unknown action", () => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({ amp: { permissions: [{ tool: "Bash", action: "deny" }] } }),
      );
      expect(result.success).toBe(false);
    });

    it("should reject an unknown context", () => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({
          amp: { permissions: [{ tool: "Bash", action: "allow", context: "global" }] },
        }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe("amp.mcpPermissions entries", () => {
    it.each(["allow", "reject"])("should accept action %s", (action) => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({
          amp: { mcpPermissions: [{ matches: { url: "https://example.com" }, action }] },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("should reject an unknown action", () => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({
          amp: { mcpPermissions: [{ matches: { url: "https://example.com" }, action: "ask" }] },
        }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe("augmentcode.toolPermissions entries", () => {
    it.each(["allow", "deny", "ask-user", "webhook-policy", "script-policy"])(
      "should accept permission.type %s",
      (type) => {
        const result = RulesyncPermissionsFileSchema.safeParse(
          withOverride({
            augmentcode: { toolPermissions: [{ toolName: "view", permission: { type } }] },
          }),
        );
        expect(result.success).toBe(true);
      },
    );

    it.each(["tool-call", "tool-response"])("should accept eventType %s", (eventType) => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({
          augmentcode: {
            toolPermissions: [{ toolName: "view", eventType, permission: { type: "allow" } }],
          },
        }),
      );
      expect(result.success).toBe(true);
    });

    it("should reject an unknown permission.type", () => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({
          augmentcode: { toolPermissions: [{ toolName: "view", permission: { type: "ask" } }] },
        }),
      );
      expect(result.success).toBe(false);
    });

    it("should reject an unknown eventType", () => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({
          augmentcode: {
            toolPermissions: [
              { toolName: "view", eventType: "tool-error", permission: { type: "allow" } },
            ],
          },
        }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe("takt.step_permission_overrides", () => {
    it.each(["readonly", "edit", "full"])("should accept %s", (value) => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({ takt: { step_permission_overrides: { ai_review: value } } }),
      );
      expect(result.success).toBe(true);
    });

    it("should reject an unknown value", () => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({ takt: { step_permission_overrides: { ai_review: "write" } } }),
      );
      expect(result.success).toBe(false);
    });
  });

  describe("junie.defaultBehavior", () => {
    it("rejects values outside allow/ask (verified against release 2383.10)", () => {
      // Junie's AllowListDecision accepts only allow/ask; a stray value fails
      // Junie's whole-file parse, which makes it discard and overwrite
      // allowlist.json — so the schema rejects it up front (issue #2411).
      expect(
        RulesyncPermissionsFileSchema.safeParse(
          withOverride({ junie: { defaultBehavior: "deny" } }),
        ).success,
      ).toBe(false);
      expect(
        RulesyncPermissionsFileSchema.safeParse(withOverride({ junie: { defaultBehavior: "ask" } }))
          .success,
      ).toBe(true);
    });
  });

  describe("fields deliberately kept as free strings", () => {
    it("cursor.sandbox accepts arbitrary values (bounds are undocumented)", () => {
      const result = RulesyncPermissionsFileSchema.safeParse(
        withOverride({ cursor: { sandbox: { mode: "anything", networkAccess: "custom" } } }),
      );
      expect(result.success).toBe(true);
    });
  });
});
