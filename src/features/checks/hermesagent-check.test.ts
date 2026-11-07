import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { ChecksProcessor } from "./checks-processor.js";
import { HermesagentCheck } from "./hermesagent-check.js";
import { RulesyncCheck } from "./rulesync-check.js";

function rulesyncCheck(): RulesyncCheck {
  return new RulesyncCheck({
    relativeDirPath: ".rulesync/checks",
    relativeFilePath: "security.md",
    frontmatter: {
      targets: ["hermesagent"],
      description: "Review security boundaries",
      severity: "high",
      tools: ["terminal"],
    },
    body: "Inspect changed authentication code.",
  });
}

describe("HermesagentCheck", () => {
  it("generates a JSON check spec and one-shot pre-verify plugin", async () => {
    const check = HermesagentCheck.fromRulesyncCheck({
      relativeDirPath: ".rulesync/checks",
      rulesyncCheck: rulesyncCheck(),
    });
    const auxiliaryFiles = await HermesagentCheck.getAuxiliaryFiles({ toolChecks: [check] });
    const init = auxiliaryFiles.find((file) => file.getRelativeFilePath() === "__init__.py");

    expect(check.getRelativePathFromCwd()).toBe(
      ".hermes/plugins/rulesync-checks/checks/security.json",
    );
    expect(JSON.parse(check.getFileContent())).toEqual({
      slug: "security",
      description: "Review security boundaries",
      severity: "high",
      tools: ["terminal"],
      body: "Inspect changed authentication code.",
    });
    expect(init?.getFileContent()).toContain("if not coding or attempt or not changed_paths:");
    expect(init?.getFileContent()).toContain(
      'ctx.register_hook("pre_verify", require_rulesync_checks)',
    );
  });

  it.each([
    { slug: "../../notes/OPERATOR", expected: "notes-operator.md" },
    { slug: "..", expected: "evil.md" },
    { slug: "a\\b", expected: "a-b.md" },
    { slug: "ok\u001b[2K", expected: "ok-2k.md" },
  ])("keeps an imported slug $slug inside .rulesync/checks", ({ slug, expected }) => {
    const check = new HermesagentCheck({
      relativeDirPath: ".hermes/plugins/rulesync-checks/checks",
      relativeFilePath: "evil.json",
      fileContent: JSON.stringify({ slug, body: "Body" }),
    });

    const result = check.toRulesyncCheck();

    expect(result.getRelativeDirPath()).toBe(".rulesync/checks");
    expect(result.getRelativeFilePath()).toBe(expected);
  });

  it("keeps a plain slug as written on import", () => {
    const check = new HermesagentCheck({
      relativeDirPath: ".hermes/plugins/rulesync-checks/checks",
      relativeFilePath: "x.json",
      fileContent: JSON.stringify({ slug: "My Check", body: "Body" }),
    });

    expect(check.toRulesyncCheck().getRelativeFilePath()).toBe("My Check.md");
  });

  it("round-trips a Hermes check spec", () => {
    const check = new HermesagentCheck({
      relativeDirPath: ".hermes/plugins/rulesync-checks/checks",
      relativeFilePath: "security.json",
      fileContent: JSON.stringify({
        slug: "security",
        description: "Review security boundaries",
        severity: "high",
        tools: ["terminal"],
        body: "Inspect changed authentication code.",
      }),
    });

    const result = check.toRulesyncCheck();
    expect(result.getRelativeFilePath()).toBe("security.md");
    expect(result.getFrontmatter()).toMatchObject({
      description: "Review security boundaries",
      severity: "high",
      tools: ["terminal"],
    });
    expect(result.getBody()).toBe("Inspect changed authentication code.");
  });

  it("cleans auxiliary plugin files only when the ownership marker matches", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const markerPath = join(testDir, ".hermes", "plugins", "rulesync-checks", ".rulesync-owned");
      await writeFileContent(markerPath, "user-managed\n");
      expect(await HermesagentCheck.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(false);
      await writeFileContent(markerPath, "Generated and owned by RuleSync.\n");
      expect(await HermesagentCheck.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("protects primary plugin data when the ownership marker does not match", async () => {
    const { testDir, cleanup } = await setupTestDirectory();
    try {
      const pluginDir = join(testDir, ".hermes", "plugins", "rulesync-checks");
      await writeFileContent(
        join(pluginDir, "checks", "custom.json"),
        '{"slug":"custom","body":"User-managed"}\n',
      );
      await writeFileContent(join(pluginDir, ".rulesync-owned"), "user-managed\n");
      const processor = new ChecksProcessor({
        outputRoot: testDir,
        toolTarget: "hermesagent",
        logger: createMockLogger(),
      });

      expect(await processor.loadToolFiles({ forDeletion: true })).toEqual([]);
    } finally {
      await cleanup();
    }
  });
});
