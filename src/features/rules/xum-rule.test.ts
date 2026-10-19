import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import type { RulesyncTargets } from "../../types/tool-targets.js";
import { fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { RulesProcessor } from "./rules-processor.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ensureXumSectionBoundary, XumRule } from "./xum-rule.js";

const logger = createMockLogger();

describe("XumRule", () => {
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

  const buildRulesyncRule = ({
    relativeFilePath,
    root,
    body,
    localRoot,
  }: {
    relativeFilePath: string;
    root: boolean;
    body: string;
    localRoot?: boolean;
  }): RulesyncRule =>
    new RulesyncRule({
      outputRoot: testDir,
      relativeDirPath: "rules",
      relativeFilePath,
      frontmatter: { root, localRoot, targets: ["*"], description: "", globs: [] },
      body,
      validate: false,
    });

  describe("getSettablePaths", () => {
    it("should return .xum/AGENTS.md for both scopes with no non-root location", () => {
      for (const global of [false, true]) {
        const paths = XumRule.getSettablePaths({ global });
        expect(paths.root.relativeDirPath).toBe(".xum");
        expect(paths.root.relativeFilePath).toBe("AGENTS.md");
        expect(paths.nonRoot).toBeUndefined();
      }
    });
  });

  describe("fromFile", () => {
    it("should load the root rule from .xum/AGENTS.md", async () => {
      const content = "# Xum Instructions\n\n## Mode: plan\n\nPlan first.";
      await writeFileContent(join(testDir, ".xum", "AGENTS.md"), content);

      const rule = await XumRule.fromFile({
        outputRoot: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.getFileContent()).toBe(content);
      expect(rule.getRelativeDirPath()).toBe(".xum");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(true);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should write a root rule to .xum/AGENTS.md", () => {
      const rule = XumRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: buildRulesyncRule({
          relativeFilePath: "root.md",
          root: true,
          body: "Root rule body content",
        }),
      });

      expect(rule.getRelativeDirPath()).toBe(".xum");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.getFileContent()).toBe("Root rule body content");
      expect(rule.isRoot()).toBe(true);
    });

    it("should keep non-root rules targeted at the root file (folded by the processor)", () => {
      const rule = XumRule.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: buildRulesyncRule({
          relativeFilePath: "topic.md",
          root: false,
          body: "Topic rule body content",
        }),
      });

      expect(rule.getRelativeDirPath()).toBe(".xum");
      expect(rule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(rule.isRoot()).toBe(false);
    });
  });

  describe("toRulesyncRule", () => {
    it("should round-trip the body back to a rulesync rule", async () => {
      const content = "# Xum Rule";
      await writeFileContent(join(testDir, ".xum", "AGENTS.md"), content);

      const rule = await XumRule.fromFile({ outputRoot: testDir, relativeFilePath: "AGENTS.md" });

      expect(rule.toRulesyncRule().getBody()).toBe(content);
    });
  });

  describe("forDeletion", () => {
    it("should mark .xum/AGENTS.md as root", () => {
      const rule = XumRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".xum",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(true);
    });

    it("should not mark the project-root AGENTS.md as root", () => {
      const rule = XumRule.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      });

      expect(rule.isRoot()).toBe(false);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    const buildRule = (targets: RulesyncTargets): RulesyncRule =>
      new RulesyncRule({
        outputRoot: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: { targets },
        body: "Test content",
        validate: false,
      });

    it("should target xum and wildcard rules only", () => {
      expect(XumRule.isTargetedByRulesyncRule(buildRule(["xum"]))).toBe(true);
      expect(XumRule.isTargetedByRulesyncRule(buildRule(["*"]))).toBe(true);
      expect(XumRule.isTargetedByRulesyncRule(buildRule(["cursor"]))).toBe(false);
    });
  });

  describe("ensureXumSectionBoundary", () => {
    it("should prefix a body that does not open with an H1", () => {
      expect(ensureXumSectionBoundary({ body: "Plain text", heading: "topic" })).toBe(
        "# topic\n\nPlain text",
      );
      expect(ensureXumSectionBoundary({ body: "## Sub heading\n\nText", heading: "topic" })).toBe(
        "# topic\n\n## Sub heading\n\nText",
      );
    });

    it("should leave a body that already opens with an H1 unchanged", () => {
      expect(ensureXumSectionBoundary({ body: "\n# Own title\n\nText", heading: "topic" })).toBe(
        "\n# Own title\n\nText",
      );
      expect(ensureXumSectionBoundary({ body: "# Mode: exec\n\nText", heading: "topic" })).toBe(
        "# Mode: exec\n\nText",
      );
    });

    it("should never derive a scoped heading from the heading text", () => {
      expect(ensureXumSectionBoundary({ body: "Text", heading: "Mode: plan" })).toBe(
        "# Mode  plan\n\nText",
      );
    });
  });

  describe("RulesProcessor integration", () => {
    it("should fold non-root rules into .xum/AGENTS.md after the root rule", async () => {
      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "xum" });
      const toolFiles = await processor.convertRulesyncFilesToToolFiles([
        buildRulesyncRule({ relativeFilePath: "topic.md", root: false, body: "Topic body" }),
        buildRulesyncRule({ relativeFilePath: "overview.md", root: true, body: "Root body" }),
      ]);

      expect(toolFiles).toHaveLength(1);
      const [file] = toolFiles;
      expect(file?.getRelativeDirPath()).toBe(".xum");
      expect(file?.getRelativeFilePath()).toBe("AGENTS.md");
      expect(file?.getFileContent()).toBe("Root body\n\n# topic\n\nTopic body");
    });

    it("should close a scoped section the root rule ends with before a folded rule", async () => {
      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "xum" });
      const toolFiles = await processor.convertRulesyncFilesToToolFiles([
        buildRulesyncRule({
          relativeFilePath: "overview.md",
          root: true,
          body: "# Project\n\n## Mode: plan\nOnly plan, never edit.",
        }),
        buildRulesyncRule({
          relativeFilePath: "testing.md",
          root: false,
          body: "Always run pnpm test before finishing.",
        }),
        buildRulesyncRule({
          relativeFilePath: "style.md",
          root: false,
          body: "# Style\n\nUse two-space indentation.",
        }),
      ]);

      expect(toolFiles).toHaveLength(1);
      expect(toolFiles[0]?.getFileContent()).toBe(
        "# Project\n\n## Mode: plan\nOnly plan, never edit.\n\n" +
          "# testing\n\nAlways run pnpm test before finishing.\n\n" +
          "# Style\n\nUse two-space indentation.",
      );
    });

    it("should regenerate the same file from an imported .xum/AGENTS.md", async () => {
      const generate = async (rules: RulesyncRule[]) => {
        const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "xum" });
        const [file] = await processor.convertRulesyncFilesToToolFiles(rules);
        return file?.getFileContent() ?? "";
      };
      const first = await generate([
        buildRulesyncRule({
          relativeFilePath: "overview.md",
          root: true,
          body: "## Mode: plan\nPlan.",
        }),
        buildRulesyncRule({ relativeFilePath: "topic.md", root: false, body: "Topic body" }),
      ]);
      await writeFileContent(join(testDir, ".xum", "AGENTS.md"), first);

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "xum" });
      const imported = await processor.convertToolFilesToRulesyncFiles(
        await processor.loadToolFiles(),
      );

      expect(await generate(imported as RulesyncRule[])).toBe(first);
    });

    it("should write a localRoot rule to .xum/AGENTS.local.md", async () => {
      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "xum" });
      const toolFiles = await processor.convertRulesyncFilesToToolFiles([
        buildRulesyncRule({ relativeFilePath: "overview.md", root: true, body: "Root body" }),
        buildRulesyncRule({
          relativeFilePath: "local.md",
          root: false,
          localRoot: true,
          body: "Local body",
        }),
      ]);

      const paths = toolFiles.map((file) =>
        join(file.getRelativeDirPath(), file.getRelativeFilePath()),
      );
      expect(paths).toEqual([join(".xum", "AGENTS.md"), join(".xum", "AGENTS.local.md")]);
      const localFile = toolFiles.find((file) => file.getRelativeFilePath() === "AGENTS.local.md");
      expect(localFile?.getFileContent()).toBe("# Local instructions\n\nLocal body");
    });

    it("should import .xum/AGENTS.md back as a root rulesync rule", async () => {
      await writeFileContent(join(testDir, ".xum", "AGENTS.md"), "Imported body");

      const processor = new RulesProcessor({ logger, outputRoot: testDir, toolTarget: "xum" });
      const toolFiles = await processor.loadToolFiles();
      const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(toolFiles);

      expect(rulesyncFiles).toHaveLength(1);
      const [rulesyncRule] = rulesyncFiles;
      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect((rulesyncRule as RulesyncRule).getFrontmatter().root).toBe(true);
      expect((rulesyncRule as RulesyncRule).getBody()).toBe("Imported body");
      expect(await fileExists(join(testDir, ".xum", "AGENTS.md"))).toBe(true);
      expect(await readFileContent(join(testDir, ".xum", "AGENTS.md"))).toBe("Imported body");
    });
  });
});
