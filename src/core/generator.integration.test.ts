import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../types/index.js";
import { getDefaultConfig } from "../utils/config.js";
import { generateConfigurations, parseRulesFromDirectory } from "./index.js";

describe("generator integration tests - specification filtering", () => {
  let tempDir: string;
  let rulesDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rulesync-test-"));
    rulesDir = join(tempDir, ".rulesync");
    await mkdir(rulesDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should only generate tool-specific specifications for their intended tools", async () => {
    const rules = [
      // General rule - should be included for all tools
      {
        filename: "coding-standards.md",
        content: `---
root: true
targets: ["*"]
description: "General coding standards"
globs: ["**/*.ts"]
---

General coding standards content`,
      },
      // Tool-specific specifications
      {
        filename: "specification-copilot-rules.md",
        content: `---
root: false
targets: ["*"]
description: "Copilot specific rules"
globs: ["**/*.ts"]
---

Copilot rules content`,
      },
      {
        filename: "specification-cursor-rules.md",
        content: `---
root: false
targets: ["*"]
description: "Cursor specific rules"
globs: ["**/*.ts"]
---

Cursor rules content`,
      },
      {
        filename: "specification-claudecode-rules.md",
        content: `---
root: false
targets: ["*"]
description: "Claude Code specific rules"
globs: ["**/*.ts"]
---

Claude Code rules content`,
      },
      {
        filename: "specification-geminicli-rules.md",
        content: `---
root: false
targets: ["*"]
description: "Gemini CLI specific rules"
globs: ["**/*.ts"]
---

Gemini CLI rules content`,
      },
    ];

    for (const rule of rules) {
      await writeFile(join(rulesDir, rule.filename), rule.content);
    }

    const parsedRules = await parseRulesFromDirectory(rulesDir);
    expect(parsedRules).toHaveLength(5);

    const config: Config = {
      ...getDefaultConfig(),
      defaultTargets: ["claudecode", "geminicli"],
    };

    const outputs = await generateConfigurations(parsedRules, config, ["claudecode", "geminicli"]);

    // Check that only appropriate files were generated
    const claudecodeOutputs = outputs.filter((o) => o.tool === "claudecode");
    const geminicliOutputs = outputs.filter((o) => o.tool === "geminicli");

    // Claude Code should have:
    // - CLAUDE.md (root file)
    // - coding-standards.md (general rule)
    // - specification-claudecode-rules.md (its own specification)
    // But NOT specification-copilot-rules.md, specification-cursor-rules.md, etc.

    const claudeMemoryFiles = claudecodeOutputs.filter((o) =>
      o.filepath.includes(".claude/memories/"),
    );
    const claudeSpecFiles = claudeMemoryFiles.filter((o) => o.filepath.includes("specification-"));

    // Should only have its own specification file
    expect(claudeSpecFiles).toHaveLength(1);
    expect(claudeSpecFiles[0]?.filepath).toContain("specification-claudecode-rules.md");

    // Gemini CLI should have similar behavior
    const geminiMemoryFiles = geminicliOutputs.filter((o) =>
      o.filepath.includes(".gemini/memories/"),
    );
    const geminiSpecFiles = geminiMemoryFiles.filter((o) => o.filepath.includes("specification-"));

    expect(geminiSpecFiles).toHaveLength(1);
    expect(geminiSpecFiles[0]?.filepath).toContain("specification-geminicli-rules.md");

    const allSpecFiles = outputs.filter((o) => o.filepath.includes("specification-"));
    for (const output of allSpecFiles) {
      if (output.tool === "claudecode") {
        expect(output.filepath).not.toContain("specification-copilot");
        expect(output.filepath).not.toContain("specification-cursor");
        expect(output.filepath).not.toContain("specification-geminicli");
      }
      if (output.tool === "geminicli") {
        expect(output.filepath).not.toContain("specification-copilot");
        expect(output.filepath).not.toContain("specification-cursor");
        expect(output.filepath).not.toContain("specification-claudecode");
      }
    }
  });

  it("should include general rules for all targeted tools", async () => {
    const rules = [
      {
        filename: "build-tooling.md",
        content: `---
root: false
targets: ["*"]
description: "Build tooling standards"
globs: ["**/*.ts"]
---

Build tooling content`,
      },
      {
        filename: "specification-copilot-mcp.md",
        content: `---
root: false
targets: ["*"]
description: "Copilot MCP configuration"
globs: ["**/*.json"]
---

Copilot MCP content`,
      },
    ];

    for (const rule of rules) {
      await writeFile(join(rulesDir, rule.filename), rule.content);
    }

    const parsedRules = await parseRulesFromDirectory(rulesDir);
    const config: Config = {
      ...getDefaultConfig(),
      defaultTargets: ["cursor", "cline"],
    };

    const outputs = await generateConfigurations(parsedRules, config, ["cursor", "cline"]);

    // Both tools should get the general rule
    const cursorOutputs = outputs.filter((o) => o.tool === "cursor");
    const clineOutputs = outputs.filter((o) => o.tool === "cline");

    expect(cursorOutputs.some((o) => o.filepath.includes("build-tooling.md"))).toBe(true);
    expect(clineOutputs.some((o) => o.filepath.includes("build-tooling.md"))).toBe(true);

    // Neither should get the copilot specification
    expect(cursorOutputs.some((o) => o.filepath.includes("specification-copilot"))).toBe(false);
    expect(clineOutputs.some((o) => o.filepath.includes("specification-copilot"))).toBe(false);
  });
});
