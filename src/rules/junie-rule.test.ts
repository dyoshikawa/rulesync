import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import type { RuleFrontmatter } from "../types/rules.js";
import { JunieRule } from "./junie-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("JunieRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("fromFilePath", () => {
    it("should create JunieRule from file path with plain markdown", async () => {
      const filePath = join(testDir, "junie-rule.md");
      const fileContent = `# Project Guidelines

## Tech Stack
- TypeScript
- React 18

## Coding Standards
- Use functional components
- Write comprehensive tests`;

      await writeFile(filePath, fileContent);

      const rule = await JunieRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "junie-rule.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(JunieRule);
      expect(rule.getRelativeFilePath()).toBe("junie-rule.md");
    });

    it("should handle file without title", async () => {
      const filePath = join(testDir, "simple-rule.md");
      const fileContent = `Use TypeScript strict mode
Always write tests`;

      await writeFile(filePath, fileContent);

      const rule = await JunieRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "simple-rule.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(JunieRule);
      expect(rule.getRelativeFilePath()).toBe("simple-rule.md");
    });

    it("should extract description from title line", async () => {
      const filePath = join(testDir, "titled-rule.md");
      const fileContent = `# Project Coding Guidelines

Use TypeScript strict mode
Always write tests`;

      await writeFile(filePath, fileContent);

      const rule = await JunieRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "titled-rule.md",
        filePath,
        validate: false,
      });

      const guidelines = rule.generateGuidelinesFile();
      expect(guidelines).toContain("# Project Coding Guidelines");
      expect(guidelines).toContain("Use TypeScript strict mode");
    });

    it("should handle empty file", async () => {
      const filePath = join(testDir, "empty-rule.md");
      const fileContent = "";

      await writeFile(filePath, fileContent);

      const rule = await JunieRule.fromFilePath({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "empty-rule.md",
        filePath,
        validate: false,
      });

      expect(rule).toBeInstanceOf(JunieRule);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create JunieRule from RulesyncRule", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: false,
        targets: ["junie"],
        description: "Test description",
        globs: ["**/*.ts"],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: rulesyncFrontmatter,
        body: "Test content",
        fileContent: "---\ndescription: Test description\n---\nTest content",
      });

      const rule = JunieRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        rulesyncRule,
        validate: false,
      });

      expect(rule).toBeInstanceOf(JunieRule);
      expect(rule.getRelativeFilePath()).toBe("test.md");
    });

    it("should handle RulesyncRule without description", () => {
      const rulesyncFrontmatter: RuleFrontmatter = {
        root: false,
        targets: ["junie"],
        description: "",
        globs: ["**/*.ts"],
      };

      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        frontmatter: rulesyncFrontmatter,
        body: "Test content",
        fileContent: "---\ntargets: [junie]\n---\nTest content",
      });

      const rule = JunieRule.fromRulesyncRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        rulesyncRule,
        validate: false,
      });

      expect(rule).toBeInstanceOf(JunieRule);
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert JunieRule to RulesyncRule", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "# Test Guidelines\n\nContent",
        body: "Content",
        description: "Test Guidelines",
        validate: false,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["junie"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("Test Guidelines");
    });

    it("should handle JunieRule without description", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "Content only",
        body: "Content only",
        validate: false,
      });

      const rulesyncRule = rule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["junie"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("");
    });
  });

  describe("validate", () => {
    it("should always validate successfully", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "# Test\n\nContent",
        body: "Content",
        description: "Test",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });

    it("should validate empty content successfully", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "",
        body: "",
        validate: false,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBe(null);
    });
  });

  describe("generateGuidelinesFile", () => {
    it("should generate guidelines file with description and content", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "# Project Guidelines\n\nCoding standards here",
        body: "## Tech Stack\n- TypeScript\n- React\n\n## Standards\n- Use hooks",
        description: "Project Guidelines",
        validate: false,
      });

      const guidelines = rule.generateGuidelinesFile();

      expect(guidelines).toContain("# Project Guidelines");
      expect(guidelines).toContain("## Tech Stack");
      expect(guidelines).toContain("- TypeScript");
      expect(guidelines).toContain("## Standards");
      expect(guidelines).toContain("- Use hooks");
    });

    it("should handle content without description", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "Just content without title",
        body: "Just content without title",
        validate: false,
      });

      const guidelines = rule.generateGuidelinesFile();

      expect(guidelines).toBe("Just content without title");
      expect(guidelines).not.toContain("#");
    });

    it("should handle empty body", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "# Test Guidelines\n\n",
        body: "",
        description: "Test Guidelines",
        validate: false,
      });

      const guidelines = rule.generateGuidelinesFile();

      expect(guidelines).toBe("# Test Guidelines");
    });

    it("should handle whitespace-only body", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "# Test Guidelines\n\n   \n  \n",
        body: "   \n  \n",
        description: "Test Guidelines",
        validate: false,
      });

      const guidelines = rule.generateGuidelinesFile();

      expect(guidelines).toBe("# Test Guidelines");
    });
  });

  describe("getOutputFilePath", () => {
    it("should return .junie/guidelines.md as output file path", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "Content",
        body: "Content",
        validate: false,
      });

      expect(rule.getOutputFilePath()).toBe(".junie/guidelines.md");
    });
  });

  describe("getOutputContent", () => {
    it("should return the same content as generateGuidelinesFile", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "# Test\n\nContent",
        body: "Content",
        description: "Test",
        validate: false,
      });

      const guidelines = rule.generateGuidelinesFile();
      const outputContent = rule.getOutputContent();

      expect(outputContent).toBe(guidelines);
    });
  });

  describe("inheritance", () => {
    it("should inherit from ToolRule", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "test.md",
        fileContent: "Content",
        body: "Content",
        validate: false,
      });

      expect(rule.getRelativeFilePath()).toBe("test.md");
      expect(rule.getRelativeDirPath()).toBe("rules");
      expect(rule.getFilePath()).toBe(join(testDir, "rules", "test.md"));
    });
  });

  describe("complex scenarios", () => {
    it("should handle multiline content with complex markdown formatting", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "complex.md",
        fileContent: `# JetBrains Junie Guidelines

## Tech Stack
- Language: TypeScript
- Framework: React 18
- Testing: Jest + Testing Library

## Coding Standards
1. Use functional components with hooks
2. Prefer TypeScript interfaces over types
3. Write meaningful variable names
4. Always include error handling

### Security Guidelines
- Never commit secrets or API keys
- Validate all user inputs
- Use environment variables for configuration

## Code Examples
\`\`\`typescript
interface UserProfileProps {
  userId: string;
  onUpdate: (user: User) => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ userId, onUpdate }) => {
  // Implementation here
};
\`\`\``,
        body: `## Tech Stack
- Language: TypeScript
- Framework: React 18
- Testing: Jest + Testing Library

## Coding Standards
1. Use functional components with hooks
2. Prefer TypeScript interfaces over types
3. Write meaningful variable names
4. Always include error handling

### Security Guidelines
- Never commit secrets or API keys
- Validate all user inputs
- Use environment variables for configuration

## Code Examples
\`\`\`typescript
interface UserProfileProps {
  userId: string;
  onUpdate: (user: User) => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ userId, onUpdate }) => {
  // Implementation here
};
\`\`\``,
        description: "JetBrains Junie Guidelines",
        validate: false,
      });

      const guidelines = rule.generateGuidelinesFile();

      expect(guidelines).toContain("# JetBrains Junie Guidelines");
      expect(guidelines).toContain("## Tech Stack");
      expect(guidelines).toContain("- Language: TypeScript");
      expect(guidelines).toContain("## Coding Standards");
      expect(guidelines).toContain("### Security Guidelines");
      expect(guidelines).toContain("## Code Examples");
      expect(guidelines).toContain("```typescript");
      expect(guidelines).toContain("interface UserProfileProps");
    });

    it("should handle rule with special characters in content", () => {
      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "special-rules",
        relativeFilePath: "special-chars.md",
        fileContent: `# Special Characters Test

Content with unicode and symbols

- Bullet with emoji: 🚀 ✨ 💡
- Code with symbols: \`const test = { key: "value" };\`
- Links: [Example](https://example.com)`,
        body: `Content with unicode and symbols

- Bullet with emoji: 🚀 ✨ 💡
- Code with symbols: \`const test = { key: "value" };\`
- Links: [Example](https://example.com)`,
        description: "Special Characters Test",
        validate: false,
      });

      const guidelines = rule.generateGuidelinesFile();

      expect(guidelines).toContain("Content with unicode and symbols");
      expect(guidelines).toContain("🚀 ✨ 💡");
      expect(guidelines).toContain('`const test = { key: "value" };`');
      expect(guidelines).toContain("[Example](https://example.com)");
    });

    it("should handle very long content", () => {
      const longContent = Array(10).fill("This is a long line of content that repeats. ").join("");

      const rule = new JunieRule({
        baseDir: testDir,
        relativeDirPath: "rules",
        relativeFilePath: "long-content.md",
        fileContent: `# Long Content Rule\n\n${longContent}`,
        body: longContent,
        description: "Long Content Rule",
        validate: false,
      });

      const guidelines = rule.generateGuidelinesFile();

      expect(guidelines).toContain("# Long Content Rule");
      expect(guidelines).toContain("This is a long line of content that repeats.");
      expect(guidelines.length).toBeGreaterThan(100);
    });
  });
});
