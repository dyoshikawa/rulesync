import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { RulesyncCheck, RulesyncCheckFrontmatterSchema } from "./rulesync-check.js";

describe("RulesyncCheckFrontmatterSchema", () => {
  it("should default targets to ['*'] when omitted", () => {
    const parsed = RulesyncCheckFrontmatterSchema.parse({});
    expect(parsed.targets).toEqual(["*"]);
  });

  it("should accept optional description, severity and tools", () => {
    const parsed = RulesyncCheckFrontmatterSchema.parse({
      description: "Flags security issues",
      severity: "high",
      tools: ["Read", "Grep"],
    });
    expect(parsed.severity).toBe("high");
    expect(parsed.tools).toEqual(["Read", "Grep"]);
  });

  it("should reject an invalid severity value", () => {
    expect(() => RulesyncCheckFrontmatterSchema.parse({ severity: "blocker" })).toThrow();
  });

  it("should preserve unknown keys (looseObject passthrough)", () => {
    const parsed = RulesyncCheckFrontmatterSchema.parse({ custom: "value" }) as Record<
      string,
      unknown
    >;
    expect(parsed.custom).toBe("value");
  });
});

describe("RulesyncCheck", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  it("should round-trip through fromFile", async () => {
    const content = `---
targets: ["*"]
description: "Flags security issues"
severity: high
---
Look for injection vulnerabilities.
`;
    await writeFileContent(
      join(testDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH, "security.md"),
      content,
    );

    const check = await RulesyncCheck.fromFile({
      outputRoot: testDir,
      relativeFilePath: "security.md",
    });

    expect(check.getFrontmatter().severity).toBe("high");
    expect(check.getFrontmatter().description).toBe("Flags security issues");
    expect(check.getBody()).toContain("Look for injection vulnerabilities.");
    expect(check.getRelativeFilePath()).toBe("security.md");
  });

  it("should throw when frontmatter is missing", async () => {
    await writeFileContent(
      join(testDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH, "no-frontmatter.md"),
      "Just a body\n",
    );

    await expect(
      RulesyncCheck.fromFile({ outputRoot: testDir, relativeFilePath: "no-frontmatter.md" }),
    ).rejects.toThrow(/Missing frontmatter/);
  });

  it("should expose the canonical checks directory as its settable path", () => {
    expect(RulesyncCheck.getSettablePaths().relativeDirPath).toBe(
      RULESYNC_CHECKS_RELATIVE_DIR_PATH,
    );
  });
});
