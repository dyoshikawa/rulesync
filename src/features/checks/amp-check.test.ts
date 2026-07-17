import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AMP_CHECKS_GLOBAL_DIR, AMP_CHECKS_PROJECT_DIR } from "../../constants/amp-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { AmpCheck, AmpCheckFrontmatterSchema } from "./amp-check.js";
import { RulesyncCheck } from "./rulesync-check.js";

describe("AmpCheckFrontmatterSchema", () => {
  it("should require name and accept optional fields", () => {
    expect(() =>
      AmpCheckFrontmatterSchema.parse({
        name: "security",
        description: "Flags issues",
        "severity-default": "high",
        tools: ["Read"],
      }),
    ).not.toThrow();
  });

  it("should reject frontmatter without a name", () => {
    expect(() => AmpCheckFrontmatterSchema.parse({ description: "x" })).toThrow();
  });

  it("should reject an invalid severity-default value", () => {
    expect(() =>
      AmpCheckFrontmatterSchema.parse({ name: "x", "severity-default": "blocker" }),
    ).toThrow();
  });
});

describe("AmpCheck.getSettablePaths", () => {
  it("should use the project checks directory by default", () => {
    expect(AmpCheck.getSettablePaths().relativeDirPath).toBe(AMP_CHECKS_PROJECT_DIR);
  });

  it("should use the global checks directory when global", () => {
    expect(AmpCheck.getSettablePaths({ global: true }).relativeDirPath).toBe(AMP_CHECKS_GLOBAL_DIR);
  });
});

describe("AmpCheck.fromRulesyncCheck", () => {
  it("should derive name from the file basename and map severity to severity-default", () => {
    const rulesyncCheck = new RulesyncCheck({
      relativeDirPath: ".rulesync/checks",
      relativeFilePath: "security.md",
      frontmatter: {
        targets: ["*"],
        description: "Flags issues",
        severity: "critical",
        tools: ["Read", "Grep"],
      },
      body: "Look for issues.",
    });

    const ampCheck = AmpCheck.fromRulesyncCheck({
      rulesyncCheck,
      relativeDirPath: ".rulesync/checks",
    });
    const frontmatter = ampCheck.getFrontmatter();

    expect(frontmatter.name).toBe("security");
    expect(frontmatter["severity-default"]).toBe("critical");
    expect(frontmatter.description).toBe("Flags issues");
    expect(frontmatter.tools).toEqual(["Read", "Grep"]);
    // The standard targeting field must not leak into the emitted frontmatter.
    expect(frontmatter).not.toHaveProperty("targets");
    expect(ampCheck.getRelativeFilePath()).toBe("security.md");
  });

  it("should emit into the global directory when global is set", () => {
    const rulesyncCheck = new RulesyncCheck({
      relativeDirPath: ".rulesync/checks",
      relativeFilePath: "security.md",
      frontmatter: { targets: ["*"] },
      body: "body",
    });

    const ampCheck = AmpCheck.fromRulesyncCheck({
      rulesyncCheck,
      relativeDirPath: ".rulesync/checks",
      global: true,
    });
    expect(ampCheck.getRelativeDirPath()).toBe(AMP_CHECKS_GLOBAL_DIR);
  });

  it("should let the amp-specific section win and not leak tool sections", () => {
    const rulesyncCheck = new RulesyncCheck({
      relativeDirPath: ".rulesync/checks",
      relativeFilePath: "security.md",
      frontmatter: {
        targets: ["*"],
        severity: "low",
        custom: "kept",
        amp: { "severity-default": "critical", name: "ignored" },
        claudecode: { model: "opus" },
      },
      body: "Look for issues.",
    });

    const ampCheck = AmpCheck.fromRulesyncCheck({
      rulesyncCheck,
      relativeDirPath: ".rulesync/checks",
    });
    const frontmatter = ampCheck.getFrontmatter();

    // The tool-specific value takes precedence over the canonical one.
    expect(frontmatter["severity-default"]).toBe("critical");
    // The check identity is the file basename; the section cannot rename it.
    expect(frontmatter.name).toBe("security");
    // Unknown non-tool keys pass through; tool sections themselves must not leak.
    expect(frontmatter).toHaveProperty("custom", "kept");
    expect(frontmatter).not.toHaveProperty("amp");
    expect(frontmatter).not.toHaveProperty("claudecode");
  });
});

describe("AmpCheck.toRulesyncCheck", () => {
  it("should map severity-default back to severity and drop the name field", () => {
    const ampCheck = new AmpCheck({
      relativeDirPath: AMP_CHECKS_PROJECT_DIR,
      relativeFilePath: "security.md",
      frontmatter: {
        name: "security",
        description: "Flags issues",
        "severity-default": "medium",
        tools: ["Read"],
      },
      body: "Look for issues.",
    });

    const rulesyncCheck = ampCheck.toRulesyncCheck();
    const frontmatter = rulesyncCheck.getFrontmatter();

    expect(frontmatter.severity).toBe("medium");
    expect(frontmatter.description).toBe("Flags issues");
    expect(frontmatter.tools).toEqual(["Read"]);
    expect(frontmatter).not.toHaveProperty("name");
    expect(frontmatter).not.toHaveProperty("severity-default");
    expect(frontmatter.targets).toEqual(["*"]);
  });
});

describe("AmpCheck.isTargetedByRulesyncCheck", () => {
  it("should target amp for wildcard targets", () => {
    const rulesyncCheck = new RulesyncCheck({
      relativeDirPath: ".rulesync/checks",
      relativeFilePath: "security.md",
      frontmatter: { targets: ["*"] },
      body: "body",
    });
    expect(AmpCheck.isTargetedByRulesyncCheck(rulesyncCheck)).toBe(true);
  });

  it("should not target amp when targets exclude it", () => {
    const rulesyncCheck = new RulesyncCheck({
      relativeDirPath: ".rulesync/checks",
      relativeFilePath: "security.md",
      frontmatter: { targets: ["claudecode"] },
      body: "body",
    });
    expect(AmpCheck.isTargetedByRulesyncCheck(rulesyncCheck)).toBe(false);
  });
});

describe("AmpCheck.fromFile", () => {
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

  it("should read an Amp check file", async () => {
    const content = `---
name: security
description: Flags issues
severity-default: high
---
Look for issues.
`;
    await writeFileContent(join(testDir, AMP_CHECKS_PROJECT_DIR, "security.md"), content);

    const ampCheck = await AmpCheck.fromFile({
      outputRoot: testDir,
      relativeFilePath: "security.md",
    });

    expect(ampCheck.getFrontmatter().name).toBe("security");
    expect(ampCheck.getFrontmatter()["severity-default"]).toBe("high");
    expect(ampCheck.getBody()).toContain("Look for issues.");
  });
});

describe("AmpCheck.forDeletion", () => {
  it("should build a deletable instance without reading a file", () => {
    const ampCheck = AmpCheck.forDeletion({
      relativeDirPath: AMP_CHECKS_PROJECT_DIR,
      relativeFilePath: "security.md",
    });
    expect(ampCheck.getRelativeFilePath()).toBe("security.md");
  });
});
