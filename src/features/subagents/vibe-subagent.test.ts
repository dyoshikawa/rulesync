import { join } from "node:path";

import * as smolToml from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
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
      // Vibe ignores an unknown `system_prompt` key (pydantic `extra="ignore"`),
      // so the body is referenced by id and written to `.vibe/prompts/`.
      system_prompt_id: "research",
    });
    expect(parsed.system_prompt).toBeUndefined();
  });

  it("should emit the body as a .vibe/prompts file alongside the agent TOML (issue #2423)", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "research.md",
      frontmatter: { targets: ["vibe"], name: "Research", description: "Research agent" },
      body: "Research the codebase.",
    });

    const files = VibeSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: [rulesyncSubagent],
    });

    expect(files).toHaveLength(2);
    const promptFile = files.find((file) => file.isPromptFile());
    expect(promptFile?.getRelativeDirPath()).toBe(join(".vibe", "prompts"));
    expect(promptFile?.getRelativeFilePath()).toBe("research.md");
    expect(promptFile?.getFileContent()).toBe("Research the codebase.");
    // The prompt file must always be written together with the id: an
    // unresolvable `system_prompt_id` makes Vibe drop the agent at discovery.
    const agentFile = files.find((file) => !file.isPromptFile());
    expect((smolToml.parse(agentFile?.getBody() ?? "") as any).system_prompt_id).toBe("research");
  });

  it("should emit no prompt file for a subagent with an empty body", () => {
    const rulesyncSubagent = new RulesyncSubagent({
      outputRoot: testDir,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: "empty.md",
      frontmatter: {
        targets: ["vibe"],
        name: "Empty",
        description: "No prompt",
        vibe: { system_prompt_id: "handwritten" },
      },
      body: "",
    });

    const files = VibeSubagent.fromRulesyncSubagents({
      outputRoot: testDir,
      rulesyncSubagents: [rulesyncSubagent],
    });

    expect(files).toHaveLength(1);
    // With no body of its own, a hand-authored id is left pointing at the
    // prompt file the user maintains.
    expect((smolToml.parse(files[0]?.getBody() ?? "") as any).system_prompt_id).toBe("handwritten");
  });

  it("should resolve system_prompt_id into the body on import (issue #2423)", async () => {
    const toml = [
      'agent_type = "subagent"',
      'display_name = "Research"',
      'system_prompt_id = "research"',
    ].join("\n");
    await ensureDir(join(testDir, ".vibe", "agents"));
    await ensureDir(join(testDir, ".vibe", "prompts"));
    await writeFileContent(join(testDir, ".vibe", "agents", "research.toml"), toml);
    await writeFileContent(
      join(testDir, ".vibe", "prompts", "research.md"),
      "Research the codebase.",
    );

    const vibeSubagent = await VibeSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "research.toml",
    });
    const rulesyncSubagent = vibeSubagent.toRulesyncSubagent();

    expect(rulesyncSubagent.getBody()).toBe("Research the codebase.");
    // Resolved, so the id is not duplicated into the vibe section.
    expect((rulesyncSubagent.getFrontmatter().vibe as any)?.system_prompt_id).toBeUndefined();
  });

  it("should keep an unresolvable system_prompt_id in the vibe section", async () => {
    const toml = ['agent_type = "subagent"', 'system_prompt_id = "missing"'].join("\n");
    await ensureDir(join(testDir, ".vibe", "agents"));
    await writeFileContent(join(testDir, ".vibe", "agents", "orphan.toml"), toml);

    const vibeSubagent = await VibeSubagent.fromFile({
      outputRoot: testDir,
      relativeFilePath: "orphan.toml",
    });
    const rulesyncSubagent = vibeSubagent.toRulesyncSubagent();

    expect(rulesyncSubagent.getBody()).toBe("");
    expect((rulesyncSubagent.getFrontmatter().vibe as any)?.system_prompt_id).toBe("missing");
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
