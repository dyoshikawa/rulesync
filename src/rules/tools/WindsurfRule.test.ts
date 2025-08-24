import { promises as fs } from "node:fs";
import path, { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../RulesyncRule.js";
import { WindsurfRule } from "./WindsurfRule.js";

describe("WindsurfRule", () => {
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
      const filePath = join(testDir, ".windsurf", "rules", "coding-standards.md");
      const fileContent = `# Coding Standards for Windsurf

## General Principles
- Always use TypeScript for new projects
- Follow semantic versioning
- Write comprehensive tests

## Security Requirements
- Never commit API keys or secrets
- Use environment variables for configuration
- Validate all user inputs

## Testing Strategy
- Unit tests for all utility functions
- Component tests for complex UI logic
- Minimum 80% code coverage`;

      const rule = WindsurfRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a rule from file", async () => {
      const filePath = join(testDir, ".windsurf", "rules", "project-rules.md");
      const fileContent = `# Project-Specific Rules for Windsurf

## Tech Stack
- React 18 with TypeScript
- Vite for build tooling
- Vitest for testing
- Tailwind CSS for styling

## Architecture
- Use custom hooks for business logic
- Components in src/components/
- Utilities in src/utils/
- Types in src/types/

## Security Guidelines
- Input validation on all user data
- Rate limiting on public endpoints
- Proper authentication handling`;

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await WindsurfRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert from RulesyncRule to WindsurfRule for coding standards", () => {
      const rulesyncPath = join(testDir, "windsurf-coding-standards.md");
      const rulesyncContent = `---
target: windsurf
description: "Windsurf coding standards and style guidelines"
ruleType: coding-standards
---

# Coding Standards

## General Principles
- Always use TypeScript for new projects
- Follow semantic versioning
- Write comprehensive tests

## Code Style
- Use Prettier with project config
- Follow ESLint configuration
- Use meaningful variable names

## Quality Requirements
- Write unit tests for all business logic
- Maintain 80% code coverage
- Include error handling in all functions`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule(rulesyncRule);

      expect(windsurfRule.getFilePath()).toBe(
        join(testDir, ".windsurf", "rules", "coding-standards.md"),
      );
      expect(windsurfRule.getFileContent()).toBe(`# Coding Standards

## General Principles
- Always use TypeScript for new projects
- Follow semantic versioning
- Write comprehensive tests

## Code Style
- Use Prettier with project config
- Follow ESLint configuration
- Use meaningful variable names

## Quality Requirements
- Write unit tests for all business logic
- Maintain 80% code coverage
- Include error handling in all functions`);
    });

    it("should convert from RulesyncRule to WindsurfRule for security rules", () => {
      const rulesyncPath = join(testDir, "windsurf-security.md");
      const rulesyncContent = `---
target: windsurf
description: "Windsurf security requirements"
---

# Security Guidelines

## Authentication Requirements
- Multi-factor authentication required
- JWT tokens with short expiration
- Proper session management

## Data Protection
- Encrypt sensitive data at rest
- Use HTTPS for all communications
- Input validation on all endpoints

## Best Practices
- Regular security audits
- Dependency vulnerability scanning
- Secure coding practices`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule(rulesyncRule);

      expect(windsurfRule.getFilePath()).toBe(join(testDir, ".windsurf", "rules", "security.md"));
      expect(windsurfRule.getFileContent()).toContain("Security Guidelines");
      expect(windsurfRule.getFileContent()).toContain("Authentication Requirements");
      expect(windsurfRule.getFileContent()).not.toContain("---");
    });

    it("should convert from RulesyncRule to WindsurfRule for testing guidelines", () => {
      const rulesyncPath = join(testDir, "windsurf-testing-guidelines.md");
      const rulesyncContent = `---
target: windsurf
description: "Windsurf testing strategy"
---

# Testing Strategy

## Unit Testing
- Test all business logic functions
- Use Jest or Vitest as test runner
- Aim for 80% code coverage minimum

## Integration Testing
- Test API endpoints
- Test database interactions
- Test external service integrations

## E2E Testing
- Test critical user flows
- Use Cypress or Playwright
- Run in CI/CD pipeline

## Test Organization
- Co-locate tests with source files
- Use descriptive test names
- Group related tests in describe blocks`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule(rulesyncRule);

      expect(windsurfRule.getFilePath()).toBe(
        join(testDir, ".windsurf", "rules", "testing-guidelines.md"),
      );
      expect(windsurfRule.getFileContent()).toContain("Testing Strategy");
      expect(windsurfRule.getFileContent()).toContain("Unit Testing");
      expect(windsurfRule.getFileContent()).toContain("E2E Testing");
    });

    it("should handle custom rule types", () => {
      const rulesyncPath = join(testDir, "windsurf-deployment.md");
      const rulesyncContent = `---
target: windsurf
description: "Windsurf deployment guidelines"
---

# Deployment Guidelines

## Environment Setup
- Use Docker for containerization
- Configure environment variables
- Set up proper logging

## CI/CD Pipeline
- Automated builds on all PRs
- Staging deployment for review
- Production deployment with approval

## Monitoring
- Application performance monitoring
- Error tracking and alerting
- Log aggregation and analysis`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const windsurfRule = WindsurfRule.fromRulesyncRule(rulesyncRule);

      expect(windsurfRule.getFilePath()).toBe(join(testDir, ".windsurf", "rules", "deployment.md"));
      expect(windsurfRule.getFileContent()).toContain("Deployment Guidelines");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert coding standards rule to RulesyncRule format", () => {
      const windsurfRule = WindsurfRule.build({
        filePath: join(testDir, ".windsurf", "rules", "coding-standards.md"),
        fileContent: `# Coding Standards

## Language and Framework
- TypeScript strict mode required
- React 18 with functional components
- Node.js 18+ for backend

## Code Quality
- ESLint with company configuration
- Prettier for code formatting
- Husky for pre-commit hooks

## Documentation
- JSDoc for all public functions
- README for each package
- Architecture decision records`,
      });

      const rulesyncRule = windsurfRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "windsurf-coding-standards.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "windsurf",
        description: "Windsurf coding standards and style guidelines",
        ruleType: "coding-standards",
      });
      expect(rulesyncRule.getContent()).toContain("Coding Standards");
      expect(rulesyncRule.getContent()).toContain("Language and Framework");
      expect(rulesyncRule.getContent()).toContain("Documentation");
    });

    it("should convert security rules to RulesyncRule format", () => {
      const windsurfRule = WindsurfRule.build({
        filePath: join(testDir, ".windsurf", "rules", "security-rules.md"),
        fileContent: `# Security Requirements

## Authentication
- OAuth 2.0 with PKCE flow
- Multi-factor authentication
- Session timeout policies

## Data Protection
- Encryption at rest and in transit
- PII data classification
- Data retention policies

## Vulnerability Management
- Regular dependency updates
- Security scanning in CI/CD
- Penetration testing quarterly`,
      });

      const rulesyncRule = windsurfRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "windsurf-security-rules.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "windsurf",
        description: "Windsurf security requirements and best practices",
        ruleType: "security-rules",
      });
      expect(rulesyncRule.getContent()).toContain("Security Requirements");
      expect(rulesyncRule.getContent()).toContain("Authentication");
    });

    it("should convert testing guidelines to RulesyncRule format", () => {
      const windsurfRule = WindsurfRule.build({
        filePath: join(testDir, ".windsurf", "rules", "testing-guidelines.md"),
        fileContent: `# Testing Guidelines

## Test Strategy
- Pyramid approach: more unit tests, fewer E2E
- Test-driven development encouraged
- Behavior-driven development for complex flows

## Tools and Frameworks
- Jest for unit testing
- Testing Library for component tests
- Cypress for end-to-end testing

## Coverage Requirements
- Minimum 80% line coverage
- 100% coverage for critical paths
- Regular coverage reports in CI`,
      });

      const rulesyncRule = windsurfRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "windsurf-testing-guidelines.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "windsurf",
        description: "Windsurf testing strategy and requirements",
        ruleType: "testing-guidelines",
      });
    });
  });

  describe("writeFile", () => {
    it("should write rule to file system", async () => {
      const filePath = join(testDir, ".windsurf", "rules", "project-rules.md");
      const fileContent = `# Project Rules

## Standards
- Follow company coding guidelines
- Use approved third-party libraries`;

      const rule = WindsurfRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they don't exist", async () => {
      const filePath = join(testDir, "nested", "deep", ".windsurf", "rules", "architecture.md");
      const fileContent = `# Architecture Guidelines

## Design Patterns
- Use SOLID principles
- Apply clean architecture`;

      const rule = WindsurfRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate correct Windsurf rule", () => {
      const rule = WindsurfRule.build({
        filePath: join(testDir, ".windsurf", "rules", "coding-standards.md"),
        fileContent: `# Valid Windsurf Rule

## Project Overview
This is a valid Windsurf rule file.

## Tech Stack
- Language: TypeScript
- Framework: React 18`,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject invalid file path", () => {
      const rule = WindsurfRule.build({
        filePath: join(testDir, "invalid.txt"),
        fileContent: "Valid content",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(
        "Windsurf rule file must be global_rules.md, .windsurf-rules, or in .windsurf/rules/ directory",
      );
    });

    it("should validate file path with subdirectories", () => {
      const rule = WindsurfRule.build({
        filePath: join(testDir, ".windsurf", "rules", "subdir", "valid.md"),
        fileContent: "Valid content",
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject empty content", () => {
      const rule = WindsurfRule.build({
        filePath: join(testDir, ".windsurf", "rules", "coding-standards.md"),
        fileContent: "",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Windsurf rule content cannot be empty");
    });

    it("should reject whitespace-only content", () => {
      const rule = WindsurfRule.build({
        filePath: join(testDir, ".windsurf", "rules", "coding-standards.md"),
        fileContent: "   \n   \t   ",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Windsurf rule content cannot be only whitespace");
    });
  });

  describe("getFilePath", () => {
    it("should return the file path", () => {
      const filePath = join(testDir, ".windsurf", "rules", "coding-standards.md");
      const rule = WindsurfRule.build({
        filePath,
        fileContent: "# Rules",
      });

      expect(rule.getFilePath()).toBe(filePath);
    });
  });

  describe("getFileContent", () => {
    it("should return the file content", () => {
      const content = `# Project Rules

## Standards
- Follow conventions`;
      const rule = WindsurfRule.build({
        filePath: join(testDir, ".windsurf", "rules", "project-rules.md"),
        fileContent: content,
      });

      expect(rule.getFileContent()).toBe(content);
    });
  });
});
