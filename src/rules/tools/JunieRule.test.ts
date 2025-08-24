import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../RulesyncRule.js";
import { JunieRule } from "./JunieRule.js";

describe("JunieRule", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("build", () => {
    it("should build a rule from file path and content", () => {
      const filePath = join(testDir, ".junie", "guidelines.md");
      const fileContent = `# Project Guidelines for Junie

## Tech Stack
- Framework: React 18 with TypeScript
- State Management: Redux Toolkit
- Styling: Tailwind CSS
- Testing: Jest + React Testing Library

## Coding Standards
1. Use functional components with hooks
2. Prefer TypeScript interfaces over types for object shapes
3. Use meaningful variable names
4. Always write unit tests for business logic

## Architecture Patterns
- Follow clean architecture principles
- Separate concerns with clear module boundaries
- Use dependency injection for external services`;

      const rule = JunieRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, ".junie", "guidelines.md");
      const fileContent = `# Project Guidelines for Junie

## Essential Sections

### Tech Stack
- Framework versions: React 18, Next.js 14
- Core libraries: TypeScript, Tailwind CSS, Jest
- Architecture choices: Clean Architecture, SOLID principles

### Coding Standards
- Style rules: Use Prettier with project config
- Naming conventions: camelCase for variables, PascalCase for components
- Quality requirements: 80% test coverage minimum

### Testing Strategy
- Testing frameworks: Jest for unit tests, Cypress for E2E
- Coverage requirements: Minimum 80% line coverage
- Test patterns: AAA pattern (Arrange, Act, Assert)

### Code Examples
\`\`\`typescript
// Preferred component structure
interface UserProfileProps {
  userId: string;
  onUpdate: (user: User) => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ userId, onUpdate }) => {
  // Implementation here
};
\`\`\`

## Advanced Sections

### Security Guidelines
- Security requirements: All inputs must be validated
- Sensitive data handling: Use environment variables for secrets
- Authentication: Implement proper JWT handling

### Performance Considerations
- Optimization guidelines: Use React.memo for expensive components
- Performance budgets: Page load time < 2 seconds
- Resource management: Cleanup subscriptions in useEffect`;

      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await JunieRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert from RulesyncRule to JunieRule", () => {
      const rulesyncPath = join(testDir, "junie-guidelines.md");
      const rulesyncContent = `---
target: junie
description: "JetBrains Junie guidelines"
---

# Project Guidelines for Junie

## Tech Stack
- Framework: React 18 with TypeScript
- State Management: Redux Toolkit
- Styling: Tailwind CSS

## Coding Standards
1. Use functional components with hooks
2. Prefer TypeScript interfaces over types
3. Write meaningful variable names
4. Always write unit tests for business logic

## Architecture Patterns
- Follow clean architecture principles
- Separate concerns with clear module boundaries

## Security Guidelines
- Never commit secrets or API keys
- Use environment variables for configuration
- Validate all user inputs

## Code Examples
\`\`\`typescript
interface UserProfileProps {
  userId: string;
  onUpdate: (user: User) => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ userId, onUpdate }) => {
  // Implementation here
};
\`\`\``;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const junieRule = JunieRule.fromRulesyncRule(rulesyncRule);

      expect(junieRule.getFilePath()).toBe(join(testDir, ".junie", "guidelines.md"));
      expect(junieRule.getFileContent()).toBe(`# Project Guidelines for Junie

## Tech Stack
- Framework: React 18 with TypeScript
- State Management: Redux Toolkit
- Styling: Tailwind CSS

## Coding Standards
1. Use functional components with hooks
2. Prefer TypeScript interfaces over types
3. Write meaningful variable names
4. Always write unit tests for business logic

## Architecture Patterns
- Follow clean architecture principles
- Separate concerns with clear module boundaries

## Security Guidelines
- Never commit secrets or API keys
- Use environment variables for configuration
- Validate all user inputs

## Code Examples
\`\`\`typescript
interface UserProfileProps {
  userId: string;
  onUpdate: (user: User) => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ userId, onUpdate }) => {
  // Implementation here
};
\`\`\``);
    });

    it("should handle complex Junie guidelines with multiple sections", () => {
      const rulesyncPath = join(testDir, "junie-complex.md");
      const rulesyncContent = `---
target: junie
description: "Complex Junie guidelines"
---

# Comprehensive Project Guidelines

## Essential Sections

### Tech Stack
- Primary language: TypeScript
- Framework: Next.js 14
- Package manager: pnpm

### Coding Standards
- Use TypeScript strict mode
- Follow ESLint configuration
- Write comprehensive tests

### Testing Strategy
- Unit tests for all business logic
- Integration tests for API endpoints
- E2E tests for critical user flows

### Code Examples
Preferred patterns and implementations

### Antipatterns
What to avoid and deprecated practices

## Advanced Sections

### Security Guidelines
- Authentication requirements
- Data protection measures
- API security standards

### Performance Considerations
- Optimization guidelines
- Performance budgets
- Resource management

### Documentation Standards
- Comment styles
- README requirements
- API documentation

### Git Workflow
- Branch naming conventions
- Commit message format
- PR guidelines

### Dependencies
- Approved libraries
- Version management policies
- Security updates`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const junieRule = JunieRule.fromRulesyncRule(rulesyncRule);

      expect(junieRule.getFileContent()).toContain("Comprehensive Project Guidelines");
      expect(junieRule.getFileContent()).toContain("Essential Sections");
      expect(junieRule.getFileContent()).toContain("Advanced Sections");
      expect(junieRule.getFileContent()).toContain("Security Guidelines");
      expect(junieRule.getFileContent()).not.toContain("---");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert to RulesyncRule format", () => {
      const junieRule = JunieRule.build({
        filePath: join(testDir, ".junie", "guidelines.md"),
        fileContent: `# Project Guidelines for Junie

## Tech Stack
- Framework: React 18 with TypeScript
- Testing: Jest + React Testing Library
- Styling: Tailwind CSS

## Coding Standards
1. Use functional components with hooks
2. Prefer TypeScript interfaces over types
3. Write meaningful variable names

## Architecture Patterns
- Follow clean architecture principles
- Use dependency injection for services

## Security Guidelines
- Never commit API keys
- Validate all user inputs
- Use environment variables for secrets

## Performance Considerations
- Use React.memo for expensive components
- Implement proper loading states
- Optimize bundle size`,
      });

      const rulesyncRule = junieRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "junie-guidelines.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "junie",
        description: "JetBrains Junie guidelines and rules configuration",
      });
      expect(rulesyncRule.getContent()).toContain("Project Guidelines for Junie");
      expect(rulesyncRule.getContent()).toContain("Tech Stack");
      expect(rulesyncRule.getContent()).toContain("Security Guidelines");
      expect(rulesyncRule.getContent()).toContain("Performance Considerations");
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, ".junie", "guidelines.md");
      const fileContent = `# Junie Project Guidelines

## Standards
- Follow TypeScript conventions
- Write comprehensive tests`;

      const rule = JunieRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they don't exist", async () => {
      const filePath = join(testDir, "nested", "deep", ".junie", "guidelines.md");
      const fileContent = `# Nested Junie Guidelines`;

      const rule = JunieRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate correct Junie guidelines", () => {
      const rule = JunieRule.build({
        filePath: join(testDir, ".junie", "guidelines.md"),
        fileContent: `# Valid Junie Guidelines

## Project Overview
This is a valid JetBrains Junie guidelines file.

## Tech Stack
- Language: TypeScript
- Framework: React 18`,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject invalid file path", () => {
      const rule = JunieRule.build({
        filePath: join(testDir, "invalid.txt"),
        fileContent: "Valid content",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Junie rule file must be .junie/guidelines.md");
    });

    it("should reject file path without .junie directory", () => {
      const rule = JunieRule.build({
        filePath: join(testDir, "guidelines.md"),
        fileContent: "Valid content",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Junie rule file must be .junie/guidelines.md");
    });

    it("should reject empty content", () => {
      const rule = JunieRule.build({
        filePath: join(testDir, ".junie", "guidelines.md"),
        fileContent: "",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Junie rule content cannot be empty");
    });

    it("should reject whitespace-only content", () => {
      const rule = JunieRule.build({
        filePath: join(testDir, ".junie", "guidelines.md"),
        fileContent: "   \n   \t   ",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Junie rule content cannot be only whitespace");
    });
  });

  describe("getFilePath", () => {
    it("should return the file path", () => {
      const filePath = join(testDir, ".junie", "guidelines.md");
      const rule = JunieRule.build({
        filePath,
        fileContent: "# Guidelines",
      });

      expect(rule.getFilePath()).toBe(filePath);
    });
  });

  describe("getFileContent", () => {
    it("should return the file content", () => {
      const content = `# Project Guidelines

## Standards
- Follow conventions`;
      const rule = JunieRule.build({
        filePath: join(testDir, ".junie", "guidelines.md"),
        fileContent: content,
      });

      expect(rule.getFileContent()).toBe(content);
    });
  });
});
