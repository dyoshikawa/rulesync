import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_MCP_RELATIVE_FILE_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, removeFile, writeFileContent } from "../utils/file.js";
import { execFileAsync, rulesyncArgs, rulesyncCmd, useTestDirectory } from "./e2e-helper.js";

const ROOT_RULE = `---
root: true
targets: ["*"]
description: "Overview"
globs: ["**/*"]
---

# Overview
`;

const DETAIL_RULE = `---
root: false
targets: ["*"]
description: "Detail"
globs: ["src/**/*"]
---

# Detail
`;

type GenerateJsonDocument = {
  success: boolean;
  data?: { plan?: unknown };
  error?: { details?: { plan?: unknown } };
};

async function runGenerateJson(
  extraArgs: string[],
  { target = "claudecode", feature = "rules" }: { target?: string; feature?: string } = {},
): Promise<GenerateJsonDocument> {
  const args = [
    ...rulesyncArgs,
    "generate",
    "--json",
    "--targets",
    target,
    "--features",
    feature,
    "--delete",
    ...extraArgs,
  ];
  try {
    const { stdout } = await execFileAsync(rulesyncCmd, args, {
      env: { ...process.env, NODE_ENV: "e2e" },
    });
    return JSON.parse(stdout);
  } catch (error) {
    const { stderr } = error as { stderr?: string };
    return JSON.parse(stderr ?? "");
  }
}

describe("E2E: generate --json mutation plan", () => {
  const { getTestDir } = useTestDirectory();

  it("should report the same write and delete operations in preview, check and apply", async () => {
    const testDir = getTestDir();
    const rulesDir = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
    await writeFileContent(join(rulesDir, "overview.md"), ROOT_RULE);
    await writeFileContent(join(rulesDir, "detail.md"), DETAIL_RULE);

    const firstRun = await runGenerateJson([]);
    expect(firstRun.success).toBe(true);
    expect(firstRun.data?.plan).toEqual({
      version: 2,
      operations: [
        { action: "write", kind: "file", feature: "rules", path: ".claude/rules/detail.md" },
        { action: "write", kind: "file", feature: "rules", path: "CLAUDE.md" },
      ],
    });

    // Retiring a source leaves its generated file as an orphan for `--delete`.
    await removeFile(join(rulesDir, "detail.md"));
    const expectedPlan = {
      version: 2,
      operations: [
        { action: "delete", kind: "file", feature: "rules", path: ".claude/rules/detail.md" },
      ],
    };

    const preview = await runGenerateJson(["--dry-run"]);
    expect(preview.success).toBe(true);
    expect(preview.data?.plan).toEqual(expectedPlan);
    // A repeated preview of the same tree yields the identical plan.
    expect((await runGenerateJson(["--dry-run"])).data?.plan).toEqual(expectedPlan);
    expect(await fileExists(join(testDir, ".claude", "rules", "detail.md"))).toBe(true);

    const check = await runGenerateJson(["--check"]);
    expect(check.success).toBe(false);
    expect(check.error?.details?.plan).toEqual(expectedPlan);

    const apply = await runGenerateJson([]);
    expect(apply.success).toBe(true);
    expect(apply.data?.plan).toEqual(expectedPlan);
    expect(await fileExists(join(testDir, ".claude", "rules", "detail.md"))).toBe(false);

    const settled = await runGenerateJson(["--check"]);
    expect(settled.success).toBe(true);
    expect(settled.data?.plan).toEqual({ version: 2, operations: [] });
  });

  it("should report removing the last managed MCP server as a key deletion in a shared config", async () => {
    const testDir = getTestDir();
    const configPath = join(testDir, ".codex", "config.toml");
    const mcpSourcePath = join(testDir, RULESYNC_MCP_RELATIVE_FILE_PATH);
    const run = (extraArgs: string[]) =>
      runGenerateJson(extraArgs, { target: "codexcli", feature: "mcp" });

    await writeFileContent(configPath, 'model = "gpt-5"\n');
    await writeFileContent(
      mcpSourcePath,
      JSON.stringify({ mcpServers: { foo: { type: "stdio", command: "foo" } } }),
    );
    const firstRun = await run([]);
    expect(firstRun.success).toBe(true);
    expect(firstRun.data?.plan).toEqual({
      version: 2,
      operations: [
        { action: "write", kind: "file", feature: "mcp", path: ".codex/config.toml" },
        {
          action: "write",
          kind: "key",
          feature: "mcp",
          path: ".codex/config.toml",
          key: "mcp_servers",
        },
      ],
    });

    await writeFileContent(mcpSourcePath, JSON.stringify({ mcpServers: {} }));
    const expectedPlan = {
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
      ],
    };

    const preview = await run(["--dry-run"]);
    expect(preview.data?.plan).toEqual(expectedPlan);
    expect((await run(["--dry-run"])).data?.plan).toEqual(expectedPlan);
    expect((await run(["--check"])).error?.details?.plan).toEqual(expectedPlan);

    const apply = await run([]);
    expect(apply.success).toBe(true);
    expect(apply.data?.plan).toEqual(expectedPlan);
    // The key is gone and the user's own setting is kept; the file stays.
    expect(await readFileContent(configPath)).toBe('model = "gpt-5"\n');

    const settled = await run(["--check"]);
    expect(settled.success).toBe(true);
    expect(settled.data?.plan).toEqual({ version: 2, operations: [] });
  });
});
