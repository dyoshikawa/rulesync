import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { readFileContent, writeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { loadYaml } from "../../utils/yaml.js";
import { AugmentcodeCheck } from "./augmentcode-check.js";
import { RulesyncCheck } from "./rulesync-check.js";

const GUIDELINES_PATH = join(".augment", "code_review_guidelines.yaml");

function createCheck({
  name,
  body = "Never store PII data in BigQuery tables.",
  frontmatter = {},
}: {
  name: string;
  body?: string;
  frontmatter?: Record<string, unknown>;
}) {
  return new RulesyncCheck({
    relativeDirPath: ".rulesync/checks",
    relativeFilePath: `${name}.md`,
    frontmatter: { targets: ["*"], ...frontmatter },
    body,
  });
}

async function generate({
  outputRoot,
  rulesyncChecks,
  logger,
}: {
  outputRoot: string;
  rulesyncChecks: RulesyncCheck[];
  logger?: Logger;
}) {
  return await AugmentcodeCheck.fromRulesyncChecks({
    outputRoot,
    relativeDirPath: ".augment",
    rulesyncChecks,
    logger,
  });
}

describe("AugmentcodeCheck", () => {
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

  describe("getSettablePaths", () => {
    it("should name the single guidelines file it writes", () => {
      const paths = AugmentcodeCheck.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".augment");
      expect(paths.relativeFilePath).toBe("code_review_guidelines.yaml");
    });
  });

  describe("fromRulesyncCheck", () => {
    it("should refuse the per-check entry point", () => {
      expect(() =>
        AugmentcodeCheck.fromRulesyncCheck({
          relativeDirPath: ".augment",
          rulesyncCheck: createCheck({ name: "security" }),
        }),
      ).toThrow(/fromRulesyncChecks/);
    });
  });

  describe("fromRulesyncChecks", () => {
    it("should emit one area per check with every required field", async () => {
      const [generated] = await generate({
        outputRoot: testDir,
        rulesyncChecks: [
          createCheck({
            name: "no-pii-in-bigquery",
            frontmatter: { description: "Data and Database related rules", severity: "high" },
          }),
        ],
      });

      const yaml = loadYaml(generated!.getFileContent()) as Record<string, any>;
      expect(yaml.areas["no-pii-in-bigquery"]).toEqual({
        description: "Data and Database related rules",
        globs: ["**"],
        rules: [
          {
            id: "no-pii-in-bigquery",
            description: "Never store PII data in BigQuery tables.",
            severity: "high",
          },
        ],
      });
    });

    it("should fold canonical critical onto Augment's high", async () => {
      const [generated] = await generate({
        outputRoot: testDir,
        rulesyncChecks: [createCheck({ name: "secrets", frontmatter: { severity: "critical" } })],
      });

      const yaml = loadYaml(generated!.getFileContent()) as Record<string, any>;
      expect(yaml.areas.secrets.rules[0].severity).toBe("high");
    });

    it("should default an unannotated check to medium, since severity is required", async () => {
      const [generated] = await generate({
        outputRoot: testDir,
        rulesyncChecks: [createCheck({ name: "style" })],
      });

      const yaml = loadYaml(generated!.getFileContent()) as Record<string, any>;
      expect(yaml.areas.style.rules[0].severity).toBe("medium");
    });

    it("should group checks sharing an augmentcode.area into one area", async () => {
      const [generated] = await generate({
        outputRoot: testDir,
        rulesyncChecks: [
          createCheck({
            name: "no-pii",
            body: "No PII in BigQuery.",
            frontmatter: {
              augmentcode: {
                area: "databases",
                areaDescription: "Data and Database related rules",
                globs: ["db/**"],
              },
            },
          }),
          createCheck({
            name: "no-raw-sql",
            body: "No raw SQL outside the repository layer.",
            frontmatter: { augmentcode: { area: "databases" } },
          }),
        ],
      });

      const yaml = loadYaml(generated!.getFileContent()) as Record<string, any>;
      expect(Object.keys(yaml.areas)).toEqual(["databases"]);
      expect(yaml.areas.databases.description).toBe("Data and Database related rules");
      expect(yaml.areas.databases.globs).toEqual(["db/**"]);
      expect(yaml.areas.databases.rules.map((rule: any) => rule.id)).toEqual([
        "no-pii",
        "no-raw-sql",
      ]);
    });

    it("should preserve unclaimed areas, file_paths_to_ignore and unknown keys", async () => {
      await writeFileContent(
        join(testDir, GUIDELINES_PATH),
        [
          "areas:",
          "  handwritten:",
          '    description: "Written by a human"',
          '    globs: ["**"]',
          "    rules:",
          '      - id: "keep_me"',
          '        description: "Do not lose this."',
          '        severity: "low"',
          "file_paths_to_ignore:",
          '  - "**/vendor/**"',
          "some_future_key: true",
        ].join("\n"),
      );

      const [generated] = await generate({
        outputRoot: testDir,
        rulesyncChecks: [createCheck({ name: "security" })],
      });

      const yaml = loadYaml(generated!.getFileContent()) as Record<string, any>;
      expect(yaml.areas.handwritten.rules[0].id).toBe("keep_me");
      expect(yaml.areas.security).toBeDefined();
      expect(yaml.file_paths_to_ignore).toEqual(["**/vendor/**"]);
      expect(yaml.some_future_key).toBe(true);
    });

    it("should rewrite an area whose key the current check set claims", async () => {
      await writeFileContent(
        join(testDir, GUIDELINES_PATH),
        [
          "areas:",
          "  security:",
          '    description: "Stale"',
          '    globs: ["old/**"]',
          "    rules:",
          '      - id: "stale_rule"',
          '        description: "Gone on regenerate."',
          '        severity: "low"',
        ].join("\n"),
      );

      const [generated] = await generate({
        outputRoot: testDir,
        rulesyncChecks: [createCheck({ name: "security", body: "Fresh instruction." })],
      });

      const yaml = loadYaml(generated!.getFileContent()) as Record<string, any>;
      expect(yaml.areas.security.rules).toEqual([
        { id: "security", description: "Fresh instruction.", severity: "medium" },
      ]);
      expect(yaml.areas.security.globs).toEqual(["**"]);
    });

    it("should leave existing areas alone and warn when no check targets AugmentCode", async () => {
      await writeFileContent(
        join(testDir, GUIDELINES_PATH),
        ['areas:\n  handwritten:\n    description: "x"\n    globs: ["**"]\n    rules: []'].join(""),
      );
      const logger = { warn: vi.fn() } as unknown as Logger;

      const generated = await generate({ outputRoot: testDir, rulesyncChecks: [], logger });

      expect(generated).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("left in place"));
      // Nothing was rewritten.
      expect(await readFileContent(join(testDir, GUIDELINES_PATH))).toContain("handwritten");
    });

    it("should not warn when there are no checks and no existing areas", async () => {
      const logger = { warn: vi.fn() } as unknown as Logger;

      const generated = await generate({ outputRoot: testDir, rulesyncChecks: [], logger });

      expect(generated).toEqual([]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should reject an augmentcode block that is not a mapping without failing", async () => {
      const logger = { warn: vi.fn() } as unknown as Logger;

      const [generated] = await generate({
        outputRoot: testDir,
        rulesyncChecks: [createCheck({ name: "security", frontmatter: { augmentcode: "nope" } })],
        logger,
      });

      const yaml = loadYaml(generated!.getFileContent()) as Record<string, any>;
      expect(yaml.areas.security).toBeDefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("expected a mapping"));
    });
  });

  describe("canDeleteAuxiliaryFiles", () => {
    it("should allow deletion only when no guidelines file exists", async () => {
      expect(await AugmentcodeCheck.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(true);

      await writeFileContent(join(testDir, GUIDELINES_PATH), "areas: {}\n");

      expect(await AugmentcodeCheck.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(false);
    });
  });

  describe("toRulesyncChecks", () => {
    it("should import one check per rule, carrying the area back in the block", async () => {
      await writeFileContent(
        join(testDir, GUIDELINES_PATH),
        [
          "areas:",
          "  databases:",
          '    description: "Data and Database related rules"',
          '    globs: ["db/**"]',
          "    rules:",
          '      - id: "no_pii_in_bigquery"',
          '        description: "Never store PII data in BigQuery tables."',
          '        severity: "high"',
          '      - id: "no_raw_sql"',
          '        description: "No raw SQL outside the repository layer."',
          '        severity: "low"',
        ].join("\n"),
      );

      const imported = await AugmentcodeCheck.fromFile({
        outputRoot: testDir,
        relativeFilePath: "code_review_guidelines.yaml",
      });
      const checks = imported.toRulesyncChecks();

      expect(checks.map((check) => check.getRelativeFilePath())).toEqual([
        "no-pii-in-bigquery.md",
        "no-raw-sql.md",
      ]);
      expect(checks[0]!.getBody()).toBe("Never store PII data in BigQuery tables.");
      expect(checks[0]!.getFrontmatter()).toMatchObject({
        severity: "high",
        augmentcode: {
          area: "databases",
          areaDescription: "Data and Database related rules",
          globs: ["db/**"],
          id: "no_pii_in_bigquery",
        },
      });
    });

    it("should round-trip a two-rule area back into the same shape", async () => {
      const original = [
        "areas:",
        "  databases:",
        '    description: "Data and Database related rules"',
        '    globs: ["db/**"]',
        "    rules:",
        '      - id: "no_pii_in_bigquery"',
        '        description: "Never store PII data in BigQuery tables."',
        '        severity: "high"',
        '      - id: "no_raw_sql"',
        '        description: "No raw SQL outside the repository layer."',
        '        severity: "low"',
      ].join("\n");
      await writeFileContent(join(testDir, GUIDELINES_PATH), original);

      const imported = await AugmentcodeCheck.fromFile({
        outputRoot: testDir,
        relativeFilePath: "code_review_guidelines.yaml",
      });
      const checks = imported.toRulesyncChecks();
      const [regenerated] = await generate({ outputRoot: testDir, rulesyncChecks: checks });

      expect(loadYaml(regenerated!.getFileContent())).toEqual(loadYaml(original));
    });

    it("should not recover canonical critical, which generated as high", async () => {
      const [generated] = await generate({
        outputRoot: testDir,
        rulesyncChecks: [createCheck({ name: "secrets", frontmatter: { severity: "critical" } })],
      });
      await writeFileContent(join(testDir, GUIDELINES_PATH), generated!.getFileContent());

      const imported = await AugmentcodeCheck.fromFile({
        outputRoot: testDir,
        relativeFilePath: "code_review_guidelines.yaml",
      });

      // Documented one-way fold: Augment has no band above `high`.
      expect(imported.toRulesyncChecks()[0]!.getFrontmatter().severity).toBe("high");
    });

    it("should skip a rule missing a required field rather than invent a check", async () => {
      await writeFileContent(
        join(testDir, GUIDELINES_PATH),
        [
          "areas:",
          "  partial:",
          '    description: "x"',
          '    globs: ["**"]',
          "    rules:",
          '      - id: "no_description"',
          '      - description: "no id"',
          '      - id: "ok"',
          '        description: "Kept."',
        ].join("\n"),
      );

      const imported = await AugmentcodeCheck.fromFile({
        outputRoot: testDir,
        relativeFilePath: "code_review_guidelines.yaml",
      });
      const checks = imported.toRulesyncChecks();

      expect(checks.map((check) => check.getRelativeFilePath())).toEqual(["ok.md"]);
      // No severity in the source, so none is invented on the way back.
      expect(checks[0]!.getFrontmatter().severity).toBeUndefined();
    });

    it("should disambiguate a rule id repeated across areas", async () => {
      await writeFileContent(
        join(testDir, GUIDELINES_PATH),
        [
          "areas:",
          "  first:",
          '    description: "x"',
          '    globs: ["**"]',
          '    rules: [{ id: "shared", description: "One." }]',
          "  second:",
          '    description: "y"',
          '    globs: ["**"]',
          '    rules: [{ id: "shared", description: "Two." }]',
        ].join("\n"),
      );

      const imported = await AugmentcodeCheck.fromFile({
        outputRoot: testDir,
        relativeFilePath: "code_review_guidelines.yaml",
      });

      expect(imported.toRulesyncChecks().map((check) => check.getRelativeFilePath())).toEqual([
        "shared.md",
        "shared-2.md",
      ]);
    });

    it("should return no checks for a missing file", async () => {
      const imported = await AugmentcodeCheck.fromFile({
        outputRoot: testDir,
        relativeFilePath: "code_review_guidelines.yaml",
      });

      expect(imported.toRulesyncChecks()).toEqual([]);
      expect(() => imported.toRulesyncCheck()).toThrow(/No review areas/);
    });

    it("should fail loudly on a guidelines file that is not a mapping", async () => {
      await writeFileContent(join(testDir, GUIDELINES_PATH), "- just\n- a list\n");

      const imported = await AugmentcodeCheck.fromFile({
        outputRoot: testDir,
        relativeFilePath: "code_review_guidelines.yaml",
      });

      expect(() => imported.toRulesyncChecks()).toThrow(/expected a mapping at the document root/);
    });
  });
});
