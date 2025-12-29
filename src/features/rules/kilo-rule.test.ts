import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { KiloRule } from "./kilo-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("KiloRule", () => {
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

  describe("fromFile", () => {
    it("should read rule content from the .kilocode/rules directory", async () => {
      const rulesDir = join(testDir, ".kilocode/rules");
      await ensureDir(rulesDir);
      const filePath = join(rulesDir, "test-rule.md");
      await writeFileContent(filePath, "# Kilo Rule\n\nBody");

      const kiloRule = await KiloRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-rule.md",
      });

      expect(kiloRule.getRelativeDirPath()).toBe(".kilocode/rules");
      expect(kiloRule.getRelativeFilePath()).toBe("test-rule.md");
      expect(kiloRule.getFileContent()).toBe("# Kilo Rule\n\nBody");
      expect(kiloRule.getFilePath()).toBe(filePath);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should build rule parameters from a Rulesync rule", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "kilo.md",
        frontmatter: { targets: ["kilo"] },
        body: "# From Rulesync",
      });

      const kiloRule = KiloRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule,
      });

      expect(kiloRule.getRelativeDirPath()).toBe(".kilocode/rules");
      expect(kiloRule.getRelativeFilePath()).toBe("kilo.md");
      expect(kiloRule.getFileContent()).toBe("# From Rulesync");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert back to a RulesyncRule", () => {
      const kiloRule = new KiloRule({
        baseDir: testDir,
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "team.md",
        fileContent: "# Team Rules",
      });

      const rulesyncRule = kiloRule.toRulesyncRule();

      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("team.md");
      expect(rulesyncRule.getBody()).toBe("# Team Rules");
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["*"]);
    });
  });

  describe("forDeletion", () => {
    it("should create a non-validated rule for cleanup", () => {
      const rule = KiloRule.forDeletion({
        baseDir: testDir,
        relativeDirPath: ".kilocode/rules",
        relativeFilePath: "obsolete.md",
      });

      expect(rule.isDeletable()).toBe(true);
      expect(rule.getFilePath()).toBe(join(testDir, ".kilocode/rules/obsolete.md"));
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should detect rulesync frontmatter targeting Kilo Code", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "kilo.md",
        frontmatter: { targets: ["kilo"] },
        body: "# Targeted",
      });

      expect(KiloRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });
});
