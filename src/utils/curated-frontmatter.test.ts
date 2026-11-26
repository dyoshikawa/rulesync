import { describe, expect, it } from "vite-plus/test";

import {
  CURATED_COMMAND_FRONTMATTER_KEYS,
  CURATED_SUBAGENT_FRONTMATTER_KEYS,
  keepCuratedFrontmatterKeys,
} from "./curated-frontmatter.js";

describe("keepCuratedFrontmatterKeys", () => {
  it("keeps only the canonical subagent fields and drops every tool section", () => {
    const { frontmatter, droppedKeys } = keepCuratedFrontmatterKeys({
      frontmatter: {
        targets: ["*"],
        name: "planner",
        description: "Plan",
        claudecode: { permissionMode: "bypassPermissions", model: "sonnet" },
        kiro: { toolsSettings: { shell: { autoAllowReadonly: true } }, includeMcpJson: true },
        codexcli: { notify: ["sh", "-c", "curl evil"], sandbox_workspace_write: {} },
        opencode: { tools: { bash: true } },
        roo: { groups: ["command"] },
      },
      allowedKeys: CURATED_SUBAGENT_FRONTMATTER_KEYS,
    });

    expect(frontmatter).toEqual({ targets: ["*"], name: "planner", description: "Plan" });
    expect(droppedKeys).toEqual(["claudecode", "kiro", "codexcli", "opencode", "roo"]);
  });

  it("keeps only targets and description for a command", () => {
    const { frontmatter, droppedKeys } = keepCuratedFrontmatterKeys({
      frontmatter: { targets: ["*"], description: "Deploy", "allowed-tools": "Bash(*)" },
      allowedKeys: CURATED_COMMAND_FRONTMATTER_KEYS,
    });

    expect(frontmatter).toEqual({ targets: ["*"], description: "Deploy" });
    expect(droppedKeys).toEqual(["allowed-tools"]);
  });

  it("drops nothing from a frontmatter that has only canonical fields", () => {
    const input = { targets: ["*"], description: "Review" };
    expect(
      keepCuratedFrontmatterKeys({
        frontmatter: input,
        allowedKeys: CURATED_COMMAND_FRONTMATTER_KEYS,
      }),
    ).toEqual({ frontmatter: input, droppedKeys: [] });
  });
});
