import * as smolToml from "smol-toml";
import { describe, expect, it } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { VibePluginSubagent } from "./vibe-plugin-subagent.js";

const buildRulesyncSubagent = ({
  relativeFilePath = "reviewer.md",
  description = "Reviews code",
  vibe,
}: {
  relativeFilePath?: string;
  description?: string;
  vibe?: Record<string, unknown>;
} = {}) =>
  new RulesyncSubagent({
    outputRoot: ".",
    relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: {
      targets: ["*"],
      name: "reviewer",
      ...(description !== undefined && { description }),
      ...(vibe !== undefined && { vibe }),
    },
    body: "Review the changes.",
    validate: false,
  });

describe("VibePluginSubagent", () => {
  it("writes ai.mistral.vibe/agents/<name>.toml with the prompt inline", () => {
    const logger = createMockLogger();

    const subagent = VibePluginSubagent.fromRulesyncSubagent({
      outputRoot: ".",
      relativeDirPath: "ai.mistral.vibe/agents",
      rulesyncSubagent: buildRulesyncSubagent({
        vibe: {
          safety: "safe",
          enabled_tools: ["read_file", "grep"],
          tools: { bash: { permission: "ask" } },
        },
      }),
      logger,
    });

    expect(subagent.getRelativeDirPath()).toBe("ai.mistral.vibe/agents");
    expect(subagent.getRelativeFilePath()).toBe("reviewer.toml");
    expect(smolToml.parse(subagent.getFileContent())).toEqual({
      schema_version: 1,
      agent_type: "subagent",
      display_name: "reviewer",
      description: "Reviews code",
      safety: "safe",
      enabled_tools: ["read_file", "grep"],
      tools: { bash: { permission: "ask" } },
      instructions: "Review the changes.",
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("drops fields the plugin document rejects and forces a subagent", () => {
    const logger = createMockLogger();

    const subagent = VibePluginSubagent.fromRulesyncSubagent({
      outputRoot: ".",
      relativeDirPath: "ai.mistral.vibe/agents",
      rulesyncSubagent: buildRulesyncSubagent({
        vibe: { agent_type: "agent", system_prompt_id: "x", compaction_prompt: "y" },
      }),
      logger,
    });

    const toml = smolToml.parse(subagent.getFileContent());
    expect(toml.agent_type).toBe("subagent");
    expect(toml).not.toHaveProperty("system_prompt_id");
    expect(toml).not.toHaveProperty("compaction_prompt");
    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    expect(warnings).toEqual([
      expect.stringContaining("Dropping system_prompt_id, compaction_prompt"),
      expect.stringContaining('agent_type "agent"'),
    ]);
  });

  it("falls back to the name for a missing description and warns about invalid names", () => {
    const logger = createMockLogger();

    const subagent = VibePluginSubagent.fromRulesyncSubagent({
      outputRoot: ".",
      relativeDirPath: "ai.mistral.vibe/agents",
      rulesyncSubagent: buildRulesyncSubagent({
        relativeFilePath: "Code_Reviewer.md",
        description: "",
      }),
      logger,
    });

    expect(smolToml.parse(subagent.getFileContent()).description).toBe("reviewer");
    const warnings = logger.warn.mock.calls.map(([message]) => String(message));
    expect(warnings).toEqual([
      expect.stringContaining("has no description"),
      expect.stringContaining("lowercase kebab-case"),
    ]);
  });

  it("imports instructions as the body and keeps the Vibe fields in the vibe section", () => {
    const subagent = new VibePluginSubagent({
      outputRoot: ".",
      relativeDirPath: "ai.mistral.vibe/agents",
      relativeFilePath: "reviewer.toml",
      body: smolToml.stringify({
        schema_version: 1,
        agent_type: "subagent",
        display_name: "Reviewer",
        description: "Reviews code",
        active_model: "devstral",
        instructions: "Review the changes.",
      }),
      fileContent: "",
    });

    const rulesyncSubagent = subagent.toRulesyncSubagent();
    expect(rulesyncSubagent.getRelativeFilePath()).toBe("reviewer.md");
    expect(rulesyncSubagent.getBody()).toBe("Review the changes.");
    expect(rulesyncSubagent.getFrontmatter()).toEqual({
      targets: ["*"],
      name: "Reviewer",
      description: "Reviews code",
      vibe: { display_name: "Reviewer", active_model: "devstral" },
    });
  });

  it("rejects a document that is not a plugin subagent", () => {
    expect(
      () =>
        new VibePluginSubagent({
          outputRoot: ".",
          relativeDirPath: "ai.mistral.vibe/agents",
          relativeFilePath: "reviewer.toml",
          body: smolToml.stringify({ agent_type: "agent", description: "x" }),
          fileContent: "",
        }),
    ).toThrow(/Invalid TOML/);
  });
});
