import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { ChecksProcessor } from "../features/checks/checks-processor.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import {
  assertGenerateMatrixCoversTargets,
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

const checksGenerateTargets = [
  {
    target: "amp",
    outputPath: join(".agents", "checks", "security.md"),
  },
  {
    // Bugbot reads one aggregated instruction file rather than per-check files.
    target: "cursor",
    outputPath: join(".cursor", "BUGBOT.md"),
  },
  {
    target: "hermesagent",
    outputPath: join(".hermes", "plugins", "rulesync-checks", "checks", "security.json"),
  },
  {
    // Takt's gates live in the shared config rather than in per-check files.
    target: "takt",
    outputPath: join(".takt", "config.yaml"),
  },
] as const;

const checksGlobalTargets = [
  {
    target: "amp",
    outputPath: join(".config", "amp", "checks", "security.md"),
  },
  {
    target: "takt",
    outputPath: join(".takt", "config.yaml"),
  },
] as const;

describe("E2E: checks", () => {
  const { getTestDir } = useTestDirectory();

  it("generate matrix must cover every native checks tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: ChecksProcessor,
      testedTargets: checksGenerateTargets.map((e) => e.target),
    });
  });

  it.each(checksGenerateTargets)(
    "should generate $target checks",
    async ({ target, outputPath }) => {
      const testDir = getTestDir();

      const checkContent = `---
targets: ["*"]
description: "Flags security issues"
severity: high
tools: ["Read", "Grep"]
---
Look for injection vulnerabilities.
`;
      await writeFileContent(
        join(testDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH, "security.md"),
        checkContent,
      );

      const homeDir = join(testDir, "home");
      await runGenerate({
        target,
        features: "checks",
        env: { HOME_DIR: homeDir },
      });

      const generatedContent = await readFileContent(join(testDir, outputPath));
      if (target === "takt") {
        // One quality gate per check, in the shared config's owned block.
        expect(generatedContent).toContain("workflow_overrides:");
        expect(generatedContent).toContain("quality_gates:");
        expect(generatedContent).toContain("Look for injection vulnerabilities.");
        return;
      }
      if (target === "cursor") {
        // One marked-up section per check, keyed by the source file basename.
        expect(generatedContent).toContain("<!-- rulesync:check:security -->");
        expect(generatedContent).toContain("## security");
        expect(generatedContent).toContain("Look for injection vulnerabilities.");
        return;
      }
      if (target === "amp") {
        // Amp requires the `name` field, derived from the source file basename.
        expect(generatedContent).toContain("name: security");
        expect(generatedContent).toContain("severity-default: high");
      } else {
        expect(JSON.parse(generatedContent)).toMatchObject({
          slug: "security",
          severity: "high",
          tools: ["Read", "Grep"],
        });
        const plugin = await readFileContent(
          join(testDir, ".hermes", "plugins", "rulesync-checks", "__init__.py"),
        );
        expect(plugin).toContain('ctx.register_hook("pre_verify", require_rulesync_checks)');
        expect(await readFileContent(join(homeDir, ".hermes", "config.yaml"))).toContain(
          "rulesync-checks",
        );
        expect(await fileExists(join(homeDir, ".hermes", ".env"))).toBe(false);
      }
      expect(generatedContent).toContain("Look for injection vulnerabilities.");
    },
  );

  it("should round-trip checks through import", async () => {
    const testDir = getTestDir();

    const ampCheckContent = `---
name: security
description: Flags security issues
severity-default: critical
---
Look for injection vulnerabilities.
`;
    await writeFileContent(join(testDir, ".agents", "checks", "security.md"), ampCheckContent);

    await runImport({ target: "amp", features: "checks" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH, "security.md"),
    );
    // `severity-default` maps back to the generic `severity` field, and the
    // Amp-required `name` field is dropped (re-derived from the basename).
    expect(importedContent).toContain("severity: critical");
    expect(importedContent).not.toContain("name:");
    expect(importedContent).toContain("Look for injection vulnerabilities.");
  });
});

describe("E2E: checks (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();

  it("global matrix must cover every native global checks tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: ChecksProcessor,
      testedTargets: checksGlobalTargets.map((e) => e.target),
      global: true,
    });
  });

  it.each(checksGlobalTargets)(
    "should generate $target checks in home directory",
    async ({ target, outputPath }) => {
      const projectDir = getProjectDir();
      const homeDir = getHomeDir();

      const checkContent = `---
targets: ["*"]
description: "Flags security issues"
severity: high
---
Look for injection vulnerabilities.
`;
      await writeFileContent(
        join(projectDir, RULESYNC_CHECKS_RELATIVE_DIR_PATH, "security.md"),
        checkContent,
      );

      await runGenerate({
        target,
        features: "checks",
        global: true,
        env: { HOME_DIR: homeDir },
      });

      const generatedContent = await readFileContent(join(homeDir, outputPath));
      if (target === "takt") {
        expect(generatedContent).toContain("workflow_overrides:");
      } else {
        expect(generatedContent).toContain("name: security");
      }
      expect(generatedContent).toContain("Look for injection vulnerabilities.");
    },
  );
});
