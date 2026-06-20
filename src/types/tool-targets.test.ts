import { describe, expect, it } from "vitest";

import {
  CommandsProcessorToolTargetSchema,
  toolCommandFactories,
} from "../features/commands/commands-processor.js";
import {
  HooksProcessorToolTargetSchema,
  toolHooksFactories,
} from "../features/hooks/hooks-processor.js";
import {
  IgnoreProcessorToolTargetSchema,
  toolIgnoreFactories,
} from "../features/ignore/ignore-processor.js";
import { McpProcessorToolTargetSchema, toolMcpFactories } from "../features/mcp/mcp-processor.js";
import {
  PermissionsProcessorToolTargetSchema,
  toolPermissionsFactories,
} from "../features/permissions/permissions-processor.js";
import {
  RulesProcessorToolTargetSchema,
  toolRuleFactories,
} from "../features/rules/rules-processor.js";
import {
  SkillsProcessorToolTargetSchema,
  toolSkillFactories,
} from "../features/skills/skills-processor.js";
import {
  SubagentsProcessorToolTargetSchema,
  toolSubagentFactories,
} from "../features/subagents/subagents-processor.js";
import {
  ALL_TOOL_TARGETS,
  ALL_TOOL_TARGETS_WITH_WILDCARD,
  RulesyncTargetsSchema,
  ToolTargetSchema,
  ToolTargetsSchema,
} from "./tool-targets.js";

describe("tool targets", () => {
  describe("ALL_TOOL_TARGETS", () => {
    it("should contain expected AI tool targets", () => {
      const expectedTargets = [
        "agentsmd",
        "agentsskills",
        "amp",
        "antigravity",
        "antigravity-cli",
        "antigravity-ide",
        "augmentcode",
        "augmentcode-legacy",
        "claudecode",
        "claudecode-legacy",
        "cline",
        "codexcli",
        "copilot",
        "copilotcli",
        "cursor",
        "deepagents",
        "factorydroid",
        "geminicli",
        "goose",
        "grokcli",
        "junie",
        "kilo",
        "kiro",
        "kiro-cli",
        "kiro-ide",
        "opencode",
        "pi",
        "qwencode",
        "replit",
        "roo",
        "rovodev",
        "takt",
        "vibe",
        "warp",
        "devin",
        "zed",
      ];

      expect(ALL_TOOL_TARGETS).toEqual(expectedTargets);
      expect(ALL_TOOL_TARGETS).toHaveLength(expectedTargets.length);
    });

    it("should have unique values", () => {
      const uniqueTargets = [...new Set(ALL_TOOL_TARGETS)];
      expect(uniqueTargets).toHaveLength(ALL_TOOL_TARGETS.length);
    });

    it("should contain only string values", () => {
      ALL_TOOL_TARGETS.forEach((target) => {
        expect(typeof target).toBe("string");
        expect(target.length).toBeGreaterThan(0);
      });
    });
  });

  describe("ALL_TOOL_TARGETS_WITH_WILDCARD", () => {
    it("should include all regular targets plus wildcard", () => {
      expect(ALL_TOOL_TARGETS_WITH_WILDCARD).toEqual([...ALL_TOOL_TARGETS, "*"]);
      expect(ALL_TOOL_TARGETS_WITH_WILDCARD).toHaveLength(ALL_TOOL_TARGETS.length + 1);
    });

    it("should end with wildcard", () => {
      const lastItem = ALL_TOOL_TARGETS_WITH_WILDCARD[ALL_TOOL_TARGETS_WITH_WILDCARD.length - 1];
      expect(lastItem).toBe("*");
    });

    it("should maintain original target order", () => {
      for (let i = 0; i < ALL_TOOL_TARGETS.length; i++) {
        expect(ALL_TOOL_TARGETS_WITH_WILDCARD[i]).toBe(ALL_TOOL_TARGETS[i]);
      }
    });
  });

  describe("ToolTargetSchema", () => {
    it("should validate all defined tool targets", () => {
      for (const target of ALL_TOOL_TARGETS) {
        const result = ToolTargetSchema.parse(target);
        expect(result).toBe(target);
      }
    });

    it("should reject wildcard", () => {
      expect(() => ToolTargetSchema.parse("*")).toThrow();
    });

    it("should reject invalid targets", () => {
      const invalidTargets = ["invalid-tool", "unknown", "", null, undefined, 123, [], {}];

      for (const target of invalidTargets) {
        expect(() => ToolTargetSchema.parse(target)).toThrow();
      }
    });

    it("should be case sensitive", () => {
      expect(() => ToolTargetSchema.parse("CURSOR")).toThrow();
      expect(() => ToolTargetSchema.parse("Cursor")).toThrow();
      expect(ToolTargetSchema.parse("cursor")).toBe("cursor");
    });
  });

  describe("ToolTargetsSchema", () => {
    it("should validate array of valid targets", () => {
      const targets = ["cursor", "claudecode", "copilot"];
      const result = ToolTargetsSchema.parse(targets);
      expect(result).toEqual(targets);
    });

    it("should validate empty array", () => {
      const result = ToolTargetsSchema.parse([]);
      expect(result).toEqual([]);
    });

    it("should validate all targets", () => {
      const result = ToolTargetsSchema.parse(ALL_TOOL_TARGETS);
      expect(result).toEqual(ALL_TOOL_TARGETS);
    });

    it("should reject array with invalid targets", () => {
      const invalidArrays = [
        ["cursor", "invalid"],
        ["", "cursor"],
        [null, "cursor"],
        [123, "cursor"],
        ["cursor", "*"], // wildcard not allowed in ToolTargetsSchema
      ];

      for (const array of invalidArrays) {
        expect(() => ToolTargetsSchema.parse(array)).toThrow();
      }
    });

    it("should reject non-array values", () => {
      const invalidValues = ["cursor", null, undefined, {}, 123, true];

      for (const value of invalidValues) {
        expect(() => ToolTargetsSchema.parse(value)).toThrow();
      }
    });

    it("should preserve order", () => {
      const targets = ["roo", "cursor", "claudecode"];
      const result = ToolTargetsSchema.parse(targets);
      expect(result).toEqual(targets);
      expect(result[0]).toBe("roo");
      expect(result[1]).toBe("cursor");
      expect(result[2]).toBe("claudecode");
    });

    it("should allow duplicates", () => {
      const targets = ["cursor", "cursor", "claudecode"];
      const result = ToolTargetsSchema.parse(targets);
      expect(result).toEqual(targets);
      expect(result).toHaveLength(3);
    });
  });

  describe("RulesyncTargetsSchema", () => {
    it("should validate array with wildcard", () => {
      const targets = ["cursor", "claudecode", "*"];
      const result = RulesyncTargetsSchema.parse(targets);
      expect(result).toEqual(targets);
    });

    it("should validate all targets with wildcard", () => {
      const result = RulesyncTargetsSchema.parse(ALL_TOOL_TARGETS_WITH_WILDCARD);
      expect(result).toEqual(ALL_TOOL_TARGETS_WITH_WILDCARD);
    });

    it("should validate only wildcard", () => {
      const result = RulesyncTargetsSchema.parse(["*"]);
      expect(result).toEqual(["*"]);
    });

    it("should validate without wildcard", () => {
      const targets = ["cursor", "claudecode"];
      const result = RulesyncTargetsSchema.parse(targets);
      expect(result).toEqual(targets);
    });

    it("should reject invalid targets including wildcard context", () => {
      const invalidArrays = [
        ["cursor", "invalid"],
        ["*", "invalid"],
        ["", "*"],
        [null, "*"],
      ];

      for (const array of invalidArrays) {
        expect(() => RulesyncTargetsSchema.parse(array)).toThrow();
      }
    });

    it("should handle mixed valid targets and wildcard", () => {
      const mixedTargets = ["*", "cursor", "claudecode", "copilot", "*"];

      const result = RulesyncTargetsSchema.parse(mixedTargets);
      expect(result).toEqual(mixedTargets);
    });
  });

  describe("schema relationship consistency", () => {
    it("should have ToolTargetSchema as subset of RulesyncTargetsSchema", () => {
      // Every valid ToolTarget should be valid in RulesyncTargets
      for (const target of ALL_TOOL_TARGETS) {
        expect(() => ToolTargetSchema.parse(target)).not.toThrow();
        expect(() => RulesyncTargetsSchema.parse([target])).not.toThrow();
      }
    });

    it("should have RulesyncTargetsSchema accept wildcard but not ToolTargetSchema", () => {
      expect(() => ToolTargetSchema.parse("*")).toThrow();
      expect(() => RulesyncTargetsSchema.parse(["*"])).not.toThrow();
    });

    it("should validate ToolTargetsSchema as valid RulesyncTargetsSchema", () => {
      const validToolTargets = ["cursor", "claudecode"];

      // Should be valid for both schemas
      expect(() => ToolTargetsSchema.parse(validToolTargets)).not.toThrow();
      expect(() => RulesyncTargetsSchema.parse(validToolTargets)).not.toThrow();
    });
  });

  describe("processor tool target consistency", () => {
    const allTargetSet = new Set<string>(ALL_TOOL_TARGETS);

    // This list is hand-maintained: a 9th processor added later must be appended
    // here (and given a `factory` entry) or it will silently escape these checks,
    // reintroducing the "scattered list drift" these tests guard against. There is
    // no central processor registry to derive it from yet; keep it in sync by hand.
    const processors = [
      {
        name: "RulesProcessor",
        schema: RulesProcessorToolTargetSchema,
        factory: toolRuleFactories,
      },
      {
        name: "CommandsProcessor",
        schema: CommandsProcessorToolTargetSchema,
        factory: toolCommandFactories,
      },
      {
        name: "HooksProcessor",
        schema: HooksProcessorToolTargetSchema,
        factory: toolHooksFactories,
      },
      {
        name: "IgnoreProcessor",
        schema: IgnoreProcessorToolTargetSchema,
        factory: toolIgnoreFactories,
      },
      { name: "McpProcessor", schema: McpProcessorToolTargetSchema, factory: toolMcpFactories },
      {
        name: "PermissionsProcessor",
        schema: PermissionsProcessorToolTargetSchema,
        factory: toolPermissionsFactories,
      },
      {
        name: "SkillsProcessor",
        schema: SkillsProcessorToolTargetSchema,
        factory: toolSkillFactories,
      },
      {
        name: "SubagentsProcessor",
        schema: SubagentsProcessorToolTargetSchema,
        factory: toolSubagentFactories,
      },
    ];

    for (const { name, schema } of processors) {
      // Direction asserted: every target a processor declares must exist in
      // ALL_TOOL_TARGETS (catches a typo'd or stale target inside a processor).
      // The reverse (every ALL_TOOL_TARGETS entry must appear in every processor)
      // is intentionally NOT asserted, because not every tool supports every
      // feature. Adding a tool to ALL_TOOL_TARGETS without wiring it into a given
      // processor is therefore legitimate and is not caught here by design.
      it(`${name}: all tool targets must be a subset of ALL_TOOL_TARGETS`, () => {
        const unknownTargets = schema.options.filter((target: string) => !allTargetSet.has(target));
        expect(unknownTargets).toEqual([]);
      });
    }

    // Stronger, bidirectional guarantee: a processor's schema enum must set-equal
    // the keys of its factory Map. This catches drift in either direction within a
    // single processor (a target in the schema but missing a factory, or a factory
    // for a target the schema rejects). Applied to every processor, not just rules.
    for (const { name, schema, factory } of processors) {
      it(`${name}: schema options must match factory map keys`, () => {
        const schemaTargets = [...schema.options].toSorted();
        const factoryTargets = [...factory.keys()].toSorted();
        expect(schemaTargets).toEqual(factoryTargets);
      });
    }

    // ALL_TOOL_TARGETS must equal the union of every processor's factory keys: a
    // tool exists iff at least one feature supports it. This makes the master
    // list a derived view in practice — adding a tool to a factory without
    // listing it here (or vice versa) fails the build. The literal stays because
    // `z.enum` needs a static tuple to infer the `ToolTarget` union type.
    it("ALL_TOOL_TARGETS equals the union of all processor factory keys", () => {
      const union = new Set<string>();
      for (const { factory } of processors) {
        for (const target of factory.keys()) union.add(target);
      }
      expect([...union].toSorted()).toEqual([...ALL_TOOL_TARGETS].toSorted());
    });
  });
});
