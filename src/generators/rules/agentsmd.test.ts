import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import type { Config, ParsedRule } from "../../types/index.js";
import { generateAgentsMdConfig } from "./agentsmd.js";

describe("generateAgentsMdConfig", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testSetup = await setupTestDirectory();
    testDir = testSetup.testDir;
    cleanup = testSetup.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  const defaultConfig: Config = {
    defaultTargets: ["agentsmd"],
    aiRulesDir: ".rulesync/rules",
    outputPaths: {
      agentsmd: ".agents/memories",
      amazonqcli: ".amazonq/rules",
      augmentcode: ".",
      "augmentcode-legacy": ".",
      copilot: ".github/instructions",
      cursor: ".cursor/rules",
      cline: ".clinerules",
      claudecode: ".",
      codexcli: ".",
      opencode: ".",
      qwencode: ".qwen/memories",
      roo: ".roo/rules",
      geminicli: ".gemini/memories",
      kiro: ".kiro/steering",
      junie: ".",
      windsurf: ".",
    },
    watchEnabled: false,
    legacy: false,
  };

  it("should generate AGENTS.md for root rule", async () => {
    const rules: ParsedRule[] = [
      {
        frontmatter: {
          root: true,
          targets: ["agentsmd"],
          description: "Main project guidelines",
          globs: ["**/*"],
        },
        content: "# Project Guidelines\n\nThis is the main project documentation.",
        filename: "main",
        filepath: "/test/main.md",
      },
    ];

    const outputs = await generateAgentsMdConfig(rules, defaultConfig, testDir);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.tool).toBe("agentsmd");
    expect(outputs[0]!.filepath).toBe(join(testDir, "AGENTS.md"));
    expect(outputs[0]!.content).toBe(
      "# Project Guidelines\n\nThis is the main project documentation.",
    );
  });

  it("should generate memory files for detail rules", async () => {
    const rules: ParsedRule[] = [
      {
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          description: "Coding standards",
          globs: ["**/*"],
        },
        content: "# Coding Standards\n\nUse TypeScript strict mode.",
        filename: "coding-standards",
        filepath: "/test/coding-standards.md",
      },
      {
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          description: "Security guidelines",
          globs: ["**/*"],
        },
        content: "# Security\n\nNever commit secrets.",
        filename: "security",
        filepath: "/test/security.md",
      },
    ];

    const outputs = await generateAgentsMdConfig(rules, defaultConfig, testDir);

    expect(outputs).toHaveLength(2);

    const codingStandardsOutput = outputs.find((o) => o.filepath.includes("coding-standards"));
    expect(codingStandardsOutput).toBeDefined();
    expect(codingStandardsOutput?.filepath).toBe(
      join(testDir, ".agents/memories/coding-standards.md"),
    );
    expect(codingStandardsOutput?.content).toBe(
      "# Coding Standards\n\nUse TypeScript strict mode.",
    );

    const securityOutput = outputs.find((o) => o.filepath.includes("security"));
    expect(securityOutput).toBeDefined();
    expect(securityOutput?.filepath).toBe(join(testDir, ".agents/memories/security.md"));
    expect(securityOutput?.content).toBe("# Security\n\nNever commit secrets.");
  });

  it("should generate both AGENTS.md and memory files when both root and detail rules exist", async () => {
    const rules: ParsedRule[] = [
      {
        frontmatter: {
          root: true,
          targets: ["agentsmd"],
          description: "Main project guidelines",
          globs: ["**/*"],
        },
        content: "# Main Project\n\nThis is the main documentation.",
        filename: "main",
        filepath: "/test/main.md",
      },
      {
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          description: "Coding standards",
          globs: ["**/*"],
        },
        content: "# Coding Standards\n\nUse TypeScript strict mode.",
        filename: "coding-standards",
        filepath: "/test/coding-standards.md",
      },
    ];

    const outputs = await generateAgentsMdConfig(rules, defaultConfig, testDir);

    expect(outputs).toHaveLength(2);

    const agentsOutput = outputs.find((o) => o.filepath.endsWith("AGENTS.md"));
    expect(agentsOutput).toBeDefined();
    expect(agentsOutput?.filepath).toBe(join(testDir, "AGENTS.md"));
    expect(agentsOutput?.content).toBe("# Main Project\n\nThis is the main documentation.");

    const memoryOutput = outputs.find((o) => o.filepath.includes(".agents/memories"));
    expect(memoryOutput).toBeDefined();
    expect(memoryOutput?.filepath).toBe(join(testDir, ".agents/memories/coding-standards.md"));
    expect(memoryOutput?.content).toBe("# Coding Standards\n\nUse TypeScript strict mode.");
  });

  it("should skip empty rules", async () => {
    const rules: ParsedRule[] = [
      {
        frontmatter: {
          root: true,
          targets: ["agentsmd"],
          description: "Empty rule",
          globs: ["**/*"],
        },
        content: "",
        filename: "empty",
        filepath: "/test/empty.md",
      },
      {
        frontmatter: {
          root: false,
          targets: ["agentsmd"],
          description: "Valid rule",
          globs: ["**/*"],
        },
        content: "# Valid Content",
        filename: "valid",
        filepath: "/test/valid.md",
      },
    ];

    const outputs = await generateAgentsMdConfig(rules, defaultConfig, testDir);

    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.filepath).toBe(join(testDir, ".agents/memories/valid.md"));
    expect(outputs[0]!.content).toBe("# Valid Content");
  });

  it("should return empty array when no rules provided", async () => {
    const outputs = await generateAgentsMdConfig([], defaultConfig, testDir);
    expect(outputs).toHaveLength(0);
  });
});
