import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { ToolTargets } from "../types/tool-targets.js";
import { CopilotRule, type CopilotRuleFrontmatter } from "./copilot-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("CopilotRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("constructor", () => {
    it("should create an instance with valid frontmatter", () => {
      const frontmatter: CopilotRuleFrontmatter = {
        description: "Test rule for GitHub Copilot",
        applyTo: "**",
      };

      const rule = new CopilotRule({
        relativeDirPath: ".github/instructions",
        relativeFilePath: "test.instructions.md",
        frontmatter,
        body: "This is a test rule for GitHub Copilot",
        fileContent: matter.stringify("This is a test rule for GitHub Copilot", frontmatter),
      });

      expect(rule).toBeInstanceOf(CopilotRule);
      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe("This is a test rule for GitHub Copilot");
    });

    it("should create an instance with default applyTo", () => {
      const frontmatter: CopilotRuleFrontmatter = {
        description: "Test rule without applyTo",
      };

      const rule = new CopilotRule({
        relativeDirPath: ".github/instructions",
        relativeFilePath: "default-apply.instructions.md",
        frontmatter,
        body: "This rule should apply to all files",
        fileContent: matter.stringify("This rule should apply to all files", frontmatter),
      });

      expect(rule.getFrontmatter().applyTo).toBe("**");
    });

    it("should throw error for invalid frontmatter when validation enabled", () => {
      const invalidFrontmatter = {
        // missing required description
        applyTo: "**",
      } as CopilotRuleFrontmatter;

      expect(() => {
        const rule = new CopilotRule({
          relativeDirPath: ".github/instructions",
          relativeFilePath: "invalid.instructions.md",
          frontmatter: invalidFrontmatter,
          body: "Invalid rule",
          fileContent: matter.stringify("Invalid rule", invalidFrontmatter),
        });
        return rule;
      }).toThrow();
    });

    it("should not throw error for invalid frontmatter when validation disabled", () => {
      const invalidFrontmatter = {
        // missing required description
        applyTo: "**",
      } as CopilotRuleFrontmatter;

      expect(() => {
        const rule = new CopilotRule({
          relativeDirPath: ".github/instructions",
          relativeFilePath: "invalid.instructions.md",
          frontmatter: invalidFrontmatter,
          body: "Invalid rule",
          fileContent: matter.stringify("Invalid rule", invalidFrontmatter),
          validate: false,
        });
        return rule;
      }).not.toThrow();
    });
  });

  describe("fromFilePath", () => {
    it("should create rule from valid non-root file", async () => {
      const frontmatter: CopilotRuleFrontmatter = {
        description: "GitHub Copilot coding standards",
        applyTo: "**/*.ts",
      };

      const body = "Use TypeScript strict mode and meaningful variable names";
      const fileContent = matter.stringify(body, frontmatter);
      const filePath = join(testDir, "coding-standards.instructions.md");
      await writeFile(filePath, fileContent);

      const rule = await CopilotRule.fromFilePath({
        relativeDirPath: ".github/instructions",
        relativeFilePath: "coding-standards.instructions.md",
        filePath,
      });

      expect(rule.getFrontmatter()).toEqual(frontmatter);
      expect(rule.getBody()).toBe(body);
      expect(rule.isRoot()).toBe(false);
    });

    it("should create rule from root file", async () => {
      const body = "This is the root Copilot instructions file content";
      const filePath = join(testDir, "copilot-instructions.md");
      await writeFile(filePath, body);

      const rule = await CopilotRule.fromFilePath({
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        filePath,
      });

      expect(rule.getBody()).toBe(body);
      expect(rule.isRoot()).toBe(true);
      expect(rule.getFrontmatter().description).toBe("");
      expect(rule.getFrontmatter().applyTo).toBe("**");
    });

    it("should handle file with minimal frontmatter", async () => {
      const frontmatter: CopilotRuleFrontmatter = {
        description: "Basic rule",
      };

      const body = "Basic coding guideline";
      const fileContent = matter.stringify(body, frontmatter);
      const filePath = join(testDir, "basic.instructions.md");
      await writeFile(filePath, fileContent);

      const rule = await CopilotRule.fromFilePath({
        relativeDirPath: ".github/instructions",
        relativeFilePath: "basic.instructions.md",
        filePath,
      });

      expect(rule.getFrontmatter().description).toBe("Basic rule");
      expect(rule.getFrontmatter().applyTo).toBe("**"); // default value
      expect(rule.getBody()).toBe(body);
    });

    it("should throw error for invalid frontmatter", async () => {
      const invalidFrontmatter = {
        // missing required description
        applyTo: "**/*.js",
      };

      const body = "Invalid rule";
      const fileContent = matter.stringify(body, invalidFrontmatter);
      const filePath = join(testDir, "invalid.instructions.md");
      await writeFile(filePath, fileContent);

      await expect(
        CopilotRule.fromFilePath({
          relativeDirPath: ".github/instructions",
          relativeFilePath: "invalid.instructions.md",
          filePath,
        }),
      ).rejects.toThrow();
    });

    it("should handle files with no frontmatter", async () => {
      const body = "Just content without frontmatter";
      const filePath = join(testDir, "no-frontmatter.instructions.md");
      await writeFile(filePath, body);

      await expect(
        CopilotRule.fromFilePath({
          relativeDirPath: ".github/instructions",
          relativeFilePath: "no-frontmatter.instructions.md",
          filePath,
        }),
      ).rejects.toThrow();
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert non-root rule to RulesyncRule with proper targets", () => {
      const frontmatter: CopilotRuleFrontmatter = {
        description: "TypeScript coding standards",
        applyTo: "**/*.ts",
      };

      const rule = new CopilotRule({
        relativeDirPath: ".github/instructions",
        relativeFilePath: "typescript.instructions.md",
        frontmatter,
        body: "Use TypeScript features properly",
        fileContent: matter.stringify("Use TypeScript features properly", frontmatter),
        root: false,
      });

      const rulesyncRule = rule.toRulesyncRule();
      const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

      expect(rulesyncFrontmatter.targets).toEqual(["copilot"]);
      expect(rulesyncFrontmatter.description).toBe("TypeScript coding standards");
      expect(rulesyncFrontmatter.globs).toEqual(["**/*.ts"]);
      expect(rulesyncFrontmatter.root).toBe(false);
      expect(rulesyncRule.getBody()).toBe("Use TypeScript features properly");
    });

    it("should convert root rule to RulesyncRule with root flag", () => {
      const frontmatter: CopilotRuleFrontmatter = {
        description: "Root Copilot instructions",
        applyTo: "**",
      };

      const rule = new CopilotRule({
        relativeDirPath: ".github",
        relativeFilePath: "copilot-instructions.md",
        frontmatter,
        body: "Main Copilot configuration",
        fileContent: "Main Copilot configuration",
        root: true,
      });

      const rulesyncRule = rule.toRulesyncRule();
      const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

      expect(rulesyncFrontmatter.targets).toEqual(["copilot"]);
      expect(rulesyncFrontmatter.description).toBe("Root Copilot instructions");
      expect(rulesyncFrontmatter.globs).toEqual(["**"]);
      expect(rulesyncFrontmatter.root).toBe(true);
      expect(rulesyncRule.getBody()).toBe("Main Copilot configuration");
    });

    it("should handle default applyTo pattern", () => {
      const frontmatter: CopilotRuleFrontmatter = {
        description: "General coding standards",
      };

      const rule = new CopilotRule({
        relativeDirPath: ".github/instructions",
        relativeFilePath: "general.instructions.md",
        frontmatter,
        body: "General guidelines",
        fileContent: matter.stringify("General guidelines", frontmatter),
      });

      const rulesyncRule = rule.toRulesyncRule();
      const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

      expect(rulesyncFrontmatter.globs).toEqual(["**"]);
    });

    it("should handle empty applyTo pattern", () => {
      const frontmatter: CopilotRuleFrontmatter = {
        description: "Rule with empty applyTo",
        applyTo: "",
      };

      const rule = new CopilotRule({
        relativeDirPath: ".github/instructions",
        relativeFilePath: "empty-apply.instructions.md",
        frontmatter,
        body: "Empty applyTo rule",
        fileContent: matter.stringify("Empty applyTo rule", frontmatter),
      });

      const rulesyncRule = rule.toRulesyncRule();
      const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

      expect(rulesyncFrontmatter.globs).toEqual(["**"]);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert from RulesyncRule with copilot target (non-root)", () => {
      const targets: ToolTargets = ["copilot"];
      const rulesyncFrontmatter = {
        targets,
        root: false,
        description: "Copilot rule from Rulesync",
        globs: ["**/*.tsx", "**/*.jsx"],
      };

      const rulesyncRule = new RulesyncRule({
        frontmatter: rulesyncFrontmatter,
        body: "React component guidelines",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "react-components.md",
        fileContent: matter.stringify("React component guidelines", rulesyncFrontmatter),
      });

      const copilotRule = CopilotRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".github/instructions",
      });

      const frontmatter = copilotRule.getFrontmatter();
      expect(frontmatter.description).toBe("Copilot rule from Rulesync");
      expect(frontmatter.applyTo).toBe("**/*.tsx,**/*.jsx");
      expect(copilotRule.getBody()).toBe("React component guidelines");
      expect(copilotRule.isRoot()).toBe(false);
      expect(copilotRule.getRelativeDirPath()).toBe(".github/instructions");
      expect(copilotRule.getRelativeFilePath()).toBe("react-components.instructions.md");
    });

    it("should convert from RulesyncRule with root flag", () => {
      const targets: ToolTargets = ["copilot"];
      const rulesyncFrontmatter = {
        targets,
        root: true,
        description: "Root Copilot rule",
        globs: ["**"],
      };

      const rulesyncRule = new RulesyncRule({
        frontmatter: rulesyncFrontmatter,
        body: "This is the main Copilot instructions",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "root-rule.md",
        fileContent: matter.stringify("This is the main Copilot instructions", rulesyncFrontmatter),
      });

      const copilotRule = CopilotRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".github",
      });

      expect(copilotRule.getBody()).toBe("This is the main Copilot instructions");
      expect(copilotRule.isRoot()).toBe(true);
      expect(copilotRule.getRelativeDirPath()).toBe(".github");
      expect(copilotRule.getRelativeFilePath()).toBe("copilot-instructions.md");
    });

    it("should handle single glob pattern", () => {
      const targets: ToolTargets = ["copilot"];
      const rulesyncFrontmatter = {
        targets,
        root: false,
        description: "Single pattern rule",
        globs: ["**/*.py"],
      };

      const rulesyncRule = new RulesyncRule({
        frontmatter: rulesyncFrontmatter,
        body: "Python guidelines",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "python.md",
        fileContent: matter.stringify("Python guidelines", rulesyncFrontmatter),
      });

      const copilotRule = CopilotRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".github/instructions",
      });

      expect(copilotRule.getFrontmatter().applyTo).toBe("**/*.py");
    });

    it("should handle empty globs array", () => {
      const targets: ToolTargets = ["copilot"];
      const rulesyncFrontmatter = {
        targets,
        root: false,
        description: "Rule with no globs",
        globs: [],
      };

      const rulesyncRule = new RulesyncRule({
        frontmatter: rulesyncFrontmatter,
        body: "No specific files",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "general.md",
        fileContent: matter.stringify("No specific files", rulesyncFrontmatter),
      });

      const copilotRule = CopilotRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".github/instructions",
      });

      expect(copilotRule.getFrontmatter().applyTo).toBe("**");
    });

    it("should generate proper filename with .instructions.md extension", () => {
      const targets: ToolTargets = ["copilot"];
      const rulesyncFrontmatter = {
        targets,
        root: false,
        description: "Filename test",
        globs: ["**"],
      };

      const rulesyncRule = new RulesyncRule({
        frontmatter: rulesyncFrontmatter,
        body: "Content",
        relativeDirPath: ".rulesync/rules",
        relativeFilePath: "my-rule.md",
        fileContent: matter.stringify("Content", rulesyncFrontmatter),
      });

      const copilotRule = CopilotRule.fromRulesyncRule({
        rulesyncRule,
        relativeDirPath: ".github/instructions",
      });

      expect(copilotRule.getRelativeFilePath()).toBe("my-rule.instructions.md");
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: CopilotRuleFrontmatter = {
        description: "Valid rule",
        applyTo: "**/*.ts",
      };

      const rule = new CopilotRule({
        relativeDirPath: ".github/instructions",
        relativeFilePath: "valid.instructions.md",
        frontmatter,
        body: "Valid content",
        fileContent: matter.stringify("Valid content", frontmatter),
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return error for invalid frontmatter", () => {
      const invalidFrontmatter = {
        // missing required description
        applyTo: "**",
      } as CopilotRuleFrontmatter;

      const rule = new CopilotRule({
        relativeDirPath: ".github/instructions",
        relativeFilePath: "invalid.instructions.md",
        frontmatter: invalidFrontmatter,
        body: "Invalid content",
        fileContent: matter.stringify("Invalid content", invalidFrontmatter),
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should return success when frontmatter is undefined", () => {
      // Create a rule instance that bypasses validation
      const rule = new CopilotRule({
        relativeDirPath: ".github/instructions",
        relativeFilePath: "undefined.instructions.md",
        frontmatter: undefined as any,
        body: "Content",
        fileContent: "Content",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });
  });

  describe("getFrontmatter", () => {
    it("should return the frontmatter object", () => {
      const frontmatter: CopilotRuleFrontmatter = {
        description: "Test frontmatter",
        applyTo: "**/*.md",
      };

      const rule = new CopilotRule({
        relativeDirPath: ".github/instructions",
        relativeFilePath: "test.instructions.md",
        frontmatter,
        body: "Test body",
        fileContent: matter.stringify("Test body", frontmatter),
      });

      expect(rule.getFrontmatter()).toEqual(frontmatter);
    });
  });

  describe("getBody", () => {
    it("should return the body content", () => {
      const frontmatter: CopilotRuleFrontmatter = {
        description: "Test body",
      };

      const body = "This is the rule body content";
      const rule = new CopilotRule({
        relativeDirPath: ".github/instructions",
        relativeFilePath: "body-test.instructions.md",
        frontmatter,
        body,
        fileContent: matter.stringify(body, frontmatter),
      });

      expect(rule.getBody()).toBe(body);
    });
  });
});
