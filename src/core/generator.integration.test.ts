import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../types/index.js";
import { getDefaultConfig } from "../utils/config.js";
import { generateConfigurations } from "./generator.js";
import { parseRulesFromDirectory } from "./parser.js";

describe("generator integration tests", () => {
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

  it("should generate configurations for targeted tools", async () => {
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
      // Tool-specific specifications - now included for all tools with targets ["*"]
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
        filename: "specification-claudecode-rules.md",
        content: `---
root: false
targets: ["*"]
description: "Claude Code specific rules"
globs: ["**/*.ts"]
---

Claude Code rules content`,
      },
    ];

    for (const rule of rules) {
      await writeFile(join(rulesDir, rule.filename), rule.content);
    }

    const parsedRules = await parseRulesFromDirectory(rulesDir);
    expect(parsedRules).toHaveLength(3);

    const config: Config = {
      ...getDefaultConfig(),
      defaultTargets: ["claudecode"],
    };

    const outputs = await generateConfigurations(parsedRules, config, ["claudecode"]);

    // Check that outputs were generated
    const claudecodeOutputs = outputs.filter((o) => o.tool === "claudecode");
    expect(claudecodeOutputs.length).toBeGreaterThan(0);

    // Should include root file and all specification files (since isToolSpecificRule was removed)
    const claudeMemoryFiles = claudecodeOutputs.filter((o) =>
      o.filepath.includes(".claude/memories/"),
    );

    // Should have the root file plus all specification files
    expect(claudeMemoryFiles.length).toBeGreaterThan(1);
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
globs: ["**/*.ts"]
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

    // Both should also get all specification files now (since isToolSpecificRule was removed)
    expect(cursorOutputs.some((o) => o.filepath.includes("specification-copilot"))).toBe(true);
    expect(clineOutputs.some((o) => o.filepath.includes("specification-copilot"))).toBe(true);
  });
});
