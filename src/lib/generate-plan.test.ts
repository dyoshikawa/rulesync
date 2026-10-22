import { describe, expect, it } from "vitest";

import { buildGeneratePlan } from "./generate-plan.js";

describe("buildGeneratePlan", () => {
  it("should list writes before deletes per feature, sorted, in feature order", () => {
    const plan = buildGeneratePlan({
      featureResults: {
        mcp: { paths: [".mcp.json"] },
        rules: { paths: ["CLAUDE.md", ".claude/rules/b.md", ".claude/rules/a.md"] },
        skills: { paths: [] },
      },
      deletedPathsByFeature: {
        rules: [{ path: ".claude/rules/old.md", kind: "file" }],
        skills: [{ path: ".claude/skills/retired", kind: "directory" }],
      },
      keyOperationsByFeature: {},
    });

    expect(plan).toEqual({
      version: 2,
      operations: [
        { action: "write", kind: "file", feature: "mcp", path: ".mcp.json" },
        { action: "write", kind: "file", feature: "rules", path: ".claude/rules/a.md" },
        { action: "write", kind: "file", feature: "rules", path: ".claude/rules/b.md" },
        { action: "write", kind: "file", feature: "rules", path: "CLAUDE.md" },
        { action: "delete", kind: "file", feature: "rules", path: ".claude/rules/old.md" },
        {
          action: "delete",
          kind: "directory",
          feature: "skills",
          path: ".claude/skills/retired",
        },
      ],
    });
  });

  it("should list a feature's key operations between its file writes and its deletes", () => {
    const plan = buildGeneratePlan({
      featureResults: { mcp: { paths: [".codex/config.toml"] } },
      deletedPathsByFeature: { mcp: [{ path: ".cursor/mcp.json", kind: "file" }] },
      keyOperationsByFeature: {
        mcp: [{ action: "delete", path: ".codex/config.toml", key: "mcp_servers" }],
      },
    });

    expect(plan).toEqual({
      version: 2,
      operations: [
        { action: "write", kind: "file", feature: "mcp", path: ".codex/config.toml" },
        {
          action: "delete",
          kind: "key",
          feature: "mcp",
          path: ".codex/config.toml",
          key: "mcp_servers",
        },
        { action: "delete", kind: "file", feature: "mcp", path: ".cursor/mcp.json" },
      ],
    });
  });

  it("should list a path written by several targets once", () => {
    const plan = buildGeneratePlan({
      featureResults: { rules: { paths: ["AGENTS.md", "AGENTS.md"] } },
      deletedPathsByFeature: {},
      keyOperationsByFeature: {},
    });

    expect(plan.operations).toEqual([
      { action: "write", kind: "file", feature: "rules", path: "AGENTS.md" },
    ]);
  });
});
