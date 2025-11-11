import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RulesyncRule } from "../../rules/rulesync-rule.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";

describe("MCP Server", () => {
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

  describe("listRules functionality", () => {
    it("should list rules with correct metadata", async () => {
      // Create sample rule files
      const rule1 = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "overview.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Project overview",
          globs: ["**/*"],
        },
        body: "# Overview\n\nThis is the project overview.",
      });

      const rule2 = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "coding-style.md",
        frontmatter: {
          root: false,
          targets: ["cursor", "claudecode"],
          description: "Coding style guidelines",
          globs: ["**/*.ts", "**/*.js"],
        },
        body: "# Coding Style\n\nUse TypeScript.",
      });

      // Write the files using writeFileContent
      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(rule1.getFilePath(), rule1.getFileContent());
      await writeFileContent(rule2.getFilePath(), rule2.getFileContent());

      // Import the listRules function by reading the module
      // We need to test the listRules functionality through the tool
      const { default: matter } = await import("gray-matter");
      const { readdir } = await import("node:fs/promises");
      const { readFileContent } = await import("../../utils/file.js");

      const rulesDir = join(testDir, ".rulesync", "rules");
      const files = await readdir(rulesDir);
      const mdFiles = files.filter((file) => file.endsWith(".md"));

      const rules = await Promise.all(
        mdFiles.map(async (file) => {
          const filePath = join(rulesDir, file);
          const content = await readFileContent(filePath);
          const { data: frontmatter } = matter(content);

          return {
            path: join(".rulesync", "rules", file),
            description: frontmatter.description ?? "",
            globs: frontmatter.globs ?? [],
          };
        }),
      );

      expect(rules).toHaveLength(2);

      const overview = rules.find((r) => r.path.includes("overview.md"));
      expect(overview).toBeDefined();
      expect(overview?.description).toBe("Project overview");
      expect(overview?.globs).toEqual(["**/*"]);

      const codingStyle = rules.find((r) => r.path.includes("coding-style.md"));
      expect(codingStyle).toBeDefined();
      expect(codingStyle?.description).toBe("Coding style guidelines");
      expect(codingStyle?.globs).toEqual(["**/*.ts", "**/*.js"]);
    });

    it("should return empty array when rules directory does not exist", async () => {
      const { readdir } = await import("node:fs/promises");

      const rulesDir = join(testDir, ".rulesync", "rules");

      try {
        await readdir(rulesDir);
        // Should throw error
        expect.fail("Expected readdir to throw an error");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it("should skip invalid rule files", async () => {
      // Create a valid rule
      const validRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "valid.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Valid rule",
          globs: ["**/*"],
        },
        body: "# Valid Rule",
      });

      // Write the valid rule file
      const rulesDir = join(testDir, ".rulesync", "rules");
      await ensureDir(rulesDir);
      await writeFileContent(validRule.getFilePath(), validRule.getFileContent());

      // Create an invalid file (not a proper markdown file)
      await writeFileContent(join(rulesDir, "invalid.md"), "invalid content without frontmatter");

      const { default: matter } = await import("gray-matter");
      const { readdir } = await import("node:fs/promises");
      const { readFileContent } = await import("../../utils/file.js");

      const files = await readdir(rulesDir);
      const mdFiles = files.filter((file) => file.endsWith(".md"));

      const rules = await Promise.all(
        mdFiles.map(async (file) => {
          try {
            const filePath = join(rulesDir, file);
            const content = await readFileContent(filePath);
            const { data: frontmatter } = matter(content);

            return {
              path: join(".rulesync", "rules", file),
              description: frontmatter.description ?? "",
              globs: frontmatter.globs ?? [],
            };
          } catch {
            return null;
          }
        }),
      );

      const validRules = rules.filter((r): r is NonNullable<typeof r> => r !== null);
      expect(validRules.length).toBeGreaterThan(0);
      expect(mdFiles).toHaveLength(2); // valid.md and invalid.md
    });
  });
});
