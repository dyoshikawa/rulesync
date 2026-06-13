import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { VibeSubagent, VibeSubagentTomlSchema } from "./vibe-subagent.js";

describe("VibeSubagent", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("should validate Vibe agent and subagent TOML", () => {
    expect(() =>
      VibeSubagentTomlSchema.parse({
        agent_type: "agent",
        display_name: "Red team",
        safety: "safe",
      }),
    ).not.toThrow();
    expect(() => VibeSubagentTomlSchema.parse({ display_name: "Missing type" })).toThrow();
  });

  it("should export rulesync subagents as Vibe subagents by default", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "research.md",
      frontmatter: {
        targets: ["vibe"],
        name: "Research",
        description: "Research agent",
        vibe: {
          safety: "safe",
          enabled_tools: ["grep", "read_file"],
        },
      },
      body: "Research the codebase.",
    });

    const vibeSubagent = VibeSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent,
    }) as VibeSubagent;
    const parsed = smolToml.parse(vibeSubagent.getBody()) as any;

    expect(vibeSubagent.getRelativeDirPath()).toBe(join(".vibe", "agents"));
    expect(vibeSubagent.getRelativeFilePath()).toBe("research.toml");
    expect(parsed).toMatchObject({
      agent_type: "subagent",
      display_name: "Research",
      description: "Research agent",
      safety: "safe",
      enabled_tools: ["grep", "read_file"],
      system_prompt: "Research the codebase.",
    });
  });

  it("should preserve explicit Vibe agent_type agent", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "security-reviewer.md",
      frontmatter: {
        targets: ["vibe"],
        name: "Red team",
        description: "Security review agent",
        vibe: {
          agent_type: "agent",
          active_model: "mistral-medium-latest",
          disabled_tools: ["write_file"],
          tools: { bash: { permission: "ask" } },
        },
      },
      body: "Review for security issues.",
    });

    const vibeSubagent = VibeSubagent.fromRulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      rulesyncSubagent,
    }) as VibeSubagent;
    const parsed = smolToml.parse(vibeSubagent.getBody()) as any;

    expect(parsed.agent_type).toBe("agent");
    expect(parsed.active_model).toBe("mistral-medium-latest");
    expect(parsed.disabled_tools).toEqual(["write_file"]);
    expect(parsed.tools.bash.permission).toBe("ask");
  });

  it("should import Vibe TOML agents into rulesync subagents with a vibe section", () => {
    const toml = [
      'agent_type = "agent"',
      'display_name = "Red team"',
      'description = "Security review agent"',
      'safety = "safe"',
      'system_prompt = "Review for security issues."',
      'disabled_tools = ["write_file"]',
      "",
      "[tools.bash]",
      'permission = "ask"',
    ].join("\n");

    const vibeSubagent = new VibeSubagent({
      outputRoot: testDir,
      relativeDirPath: join(".vibe", "agents"),
      relativeFilePath: "security-reviewer.toml",
      body: toml,
      fileContent: toml,
    });

    const rulesyncSubagent = vibeSubagent.toRulesyncSubagent();

    expect(rulesyncSubagent.getRelativeFilePath()).toBe("security-reviewer.md");
    expect(rulesyncSubagent.getBody()).toBe("Review for security issues.");
    expect(rulesyncSubagent.getFrontmatter()).toMatchObject({
      targets: ["vibe"],
      name: "Red team",
      description: "Security review agent",
      vibe: {
        agent_type: "agent",
        display_name: "Red team",
        safety: "safe",
        disabled_tools: ["write_file"],
        tools: { bash: { permission: "ask" } },
      },
    });
  });
});
