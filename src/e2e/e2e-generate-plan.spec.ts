import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { fileExists, removeFile, writeFileContent } from "../utils/file.js";
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

async function runGenerateJson(extraArgs: string[]): Promise<GenerateJsonDocument> {
  const args = [
    ...rulesyncArgs,
    "generate",
    "--json",
    "--targets",
    "claudecode",
    "--features",
    "rules",
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
      version: 1,
      operations: [
        { action: "write", kind: "file", feature: "rules", path: ".claude/rules/detail.md" },
        { action: "write", kind: "file", feature: "rules", path: "CLAUDE.md" },
      ],
    });

    // Retiring a source leaves its generated file as an orphan for `--delete`.
    await removeFile(join(rulesDir, "detail.md"));
    const expectedPlan = {
      version: 1,
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
    expect(settled.data?.plan).toEqual({ version: 1, operations: [] });
  });
});
