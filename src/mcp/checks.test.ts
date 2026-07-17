import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import { checkTools } from "./checks.js";

describe("MCP Checks Tools", () => {
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

  it("should list checks with their frontmatter", async () => {
    const checksDir = join(testDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH);
    await ensureDir(checksDir);
    await writeFileContent(
      join(checksDir, "security.md"),
      `---
targets: ["*"]
description: "Flags issues"
severity: high
---
Look for issues.`,
    );

    const result = await checkTools.listChecks.execute();
    const parsed = JSON.parse(result);

    expect(parsed.checks).toHaveLength(1);
    expect(parsed.checks[0].relativePathFromCwd).toBe(".rulesync/checks/security.md");
    expect(parsed.checks[0].frontmatter.severity).toBe("high");
  });

  it("should support the put/get/delete lifecycle", async () => {
    const putResult = await checkTools.putCheck.execute({
      relativePathFromCwd: ".rulesync/checks/security.md",
      frontmatter: { targets: ["*"], severity: "medium" },
      body: "# Security check",
    });
    expect(JSON.parse(putResult).relativePathFromCwd).toBe(".rulesync/checks/security.md");

    const getResult = await checkTools.getCheck.execute({
      relativePathFromCwd: ".rulesync/checks/security.md",
    });
    expect(JSON.parse(getResult).body).toContain("# Security check");

    await checkTools.deleteCheck.execute({
      relativePathFromCwd: ".rulesync/checks/security.md",
    });

    await expect(
      checkTools.getCheck.execute({ relativePathFromCwd: ".rulesync/checks/security.md" }),
    ).rejects.toThrow();
  });

  it("should reject path traversal attempts", async () => {
    await expect(
      checkTools.getCheck.execute({ relativePathFromCwd: "../../../etc/passwd" }),
    ).rejects.toThrow(/path traversal/i);
  });
});
