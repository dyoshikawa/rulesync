import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { parseAmazonqcliConfiguration } from "./amazonqcli.js";

describe("parseAmazonqcliConfiguration", () => {
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

  it("should parse empty directory", async () => {
    const result = await parseAmazonqcliConfiguration(testDir);

    expect(result).toEqual({
      rules: [],
      errors: [".amazonq/rules/main.md file not found"],
      ignorePatterns: undefined,
      mcpServers: undefined,
    });
  });

  it("should parse main rule file", async () => {
    const amazonqDir = join(testDir, ".amazonq", "rules");
    await mkdir(amazonqDir, { recursive: true });

    const mainContent = `---
title: Main Amazon Q Rules
---

# Main Configuration

These are the main rules for Amazon Q.`;

    await writeFile(join(amazonqDir, "main.md"), mainContent);

    const result = await parseAmazonqcliConfiguration(testDir);

    expect(result.rules).toHaveLength(2); // main.md parsed twice (main + memory)
    expect(result.rules.some((r) => r.content.includes("# Main Configuration"))).toBe(true);
    expect(result.rules[0]?.frontmatter?.targets).toContain("amazonqcli");
    expect(result.errors).toEqual([]);
  });

  it("should parse multiple rule files", async () => {
    const amazonqDir = join(testDir, ".amazonq", "rules");
    await mkdir(amazonqDir, { recursive: true });

    await writeFile(join(amazonqDir, "main.md"), "# Main Rules\n\nMain configuration.");
    await writeFile(join(amazonqDir, "security.md"), "# Security Rules\n\nSecurity guidelines.");
    await writeFile(
      join(amazonqDir, "performance.md"),
      "# Performance Rules\n\nPerformance guidelines.",
    );

    const result = await parseAmazonqcliConfiguration(testDir);

    expect(result.rules).toHaveLength(4); // main.md + security.md + performance.md (main.md parsed twice)
    expect(result.rules.map((r) => r.filename)).toContain("main");
    expect(result.rules.map((r) => r.filename)).toContain("security");
    expect(result.rules.map((r) => r.filename)).toContain("performance");
    expect(result.errors).toEqual([]);
  });

  it("should parse MCP configuration", async () => {
    const amazonqDir = join(testDir, ".amazonq");
    const rulesDir = join(amazonqDir, "rules");
    await mkdir(rulesDir, { recursive: true });

    // Create main.md first since it's required
    await writeFile(join(rulesDir, "main.md"), "# Main Rules\n\nMain configuration.");

    const mcpConfig = {
      mcpServers: {
        "test-server": {
          command: "node",
          args: ["server.js"],
          env: { API_KEY: "test" },
        },
      },
    };

    await writeFile(join(amazonqDir, "mcp.json"), JSON.stringify(mcpConfig, null, 2));

    const result = await parseAmazonqcliConfiguration(testDir);

    expect(result.mcpServers).toEqual({
      "test-server": {
        command: "node",
        args: ["server.js"],
        env: { API_KEY: "test" },
      },
    });
    expect(result.errors).toEqual([]);
  });

  it("should handle invalid MCP JSON", async () => {
    const amazonqDir = join(testDir, ".amazonq");
    const rulesDir = join(amazonqDir, "rules");
    await mkdir(rulesDir, { recursive: true });

    // Create main.md first since it's required
    await writeFile(join(rulesDir, "main.md"), "# Main Rules\n\nMain configuration.");

    await writeFile(join(amazonqDir, "mcp.json"), "{ invalid json }");

    const result = await parseAmazonqcliConfiguration(testDir);

    expect(result.mcpServers).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to parse settings.json");
  });

  it("should use default baseDir when not provided", async () => {
    const result = await parseAmazonqcliConfiguration();

    expect(result.rules).toBeDefined();
    expect(result.errors).toBeDefined();
  });
});
