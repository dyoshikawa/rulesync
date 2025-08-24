import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../../test-utils/index.js";
import { RulesyncRule } from "../RulesyncRule.js";
import { KiroRule } from "./KiroRule.js";

describe("KiroRule", () => {
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
      const filePath = join(testDir, ".kiro", "steering", "product.md");
      const fileContent = `# Product Vision & UX Rules

## Target Users and Personas
- Primary: Software developers using AI coding assistants
- Secondary: Development teams adopting AI workflows

## Non-functional Requirements
- Response time: < 2 seconds for basic operations
- Availability: 99.9% uptime
- Security: Enterprise-grade authentication

## Release Criteria and Quality Standards
- All tests pass with 90%+ coverage
- Security audit completed
- Performance benchmarks met`;

      const rule = KiroRule.build({ filePath, fileContent });

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromFilePath", () => {
    it("should load a product steering document from file", async () => {
      const filePath = join(testDir, ".kiro", "steering", "product.md");
      const fileContent = `# Product Vision

## Target Users
- Software developers
- Development teams
- Engineering managers

## User Experience Guidelines
- Minimize cognitive load
- Provide clear feedback
- Support keyboard shortcuts

## Release Criteria
- Feature complete
- Performance tested
- Security reviewed`;

      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await KiroRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });

    it("should load a structure steering document from file", async () => {
      const filePath = join(testDir, ".kiro", "steering", "structure.md");
      const fileContent = `# Repository Structure

## Module Boundaries
- \`src/core/\` - Core business logic
- \`src/ui/\` - User interface components
- \`src/integrations/\` - Third-party integrations

## Naming Conventions
- Use kebab-case for file names
- Use PascalCase for component names
- Use camelCase for variable names

## Directory Organization Principles
- Group by feature, not by file type
- Keep related files close together
- Separate concerns clearly`;

      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await KiroRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });

    it("should load a tech steering document from file", async () => {
      const filePath = join(testDir, ".kiro", "steering", "tech.md");
      const fileContent = `# Technology Stack

## Language Versions and Runtimes
- TypeScript: 5.0+
- Node.js: 18.0+
- Python: 3.11+

## Framework Choices and Libraries
- Frontend: React 18 with Vite
- Backend: Express.js with TypeScript
- Database: PostgreSQL with Prisma

## Coding Standards and Style Guides
- Use TypeScript strict mode
- Follow ESLint recommended config
- Use Prettier for code formatting
- Write JSDoc comments for public APIs

## Build and Deployment Tooling
- Package manager: pnpm
- Build tool: Vite
- CI/CD: GitHub Actions
- Deployment: Docker containers`;

      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, fileContent, "utf-8");

      const rule = await KiroRule.fromFilePath(filePath);

      expect(rule.getFilePath()).toBe(filePath);
      expect(rule.getFileContent()).toBe(fileContent);
    });
  });

  describe("fromRulesyncRule", () => {
    it("should convert from RulesyncRule to KiroRule for product steering", () => {
      const rulesyncPath = join(testDir, "kiro-product.md");
      const rulesyncContent = `---
target: kiro
description: "Kiro product steering document"
steeringType: product
---

# Product Vision

## Target Users and Personas
- Software developers using AI tools
- Development teams adopting AI workflows

## Non-functional Requirements
- High performance and reliability
- Enterprise security standards
- Intuitive user experience

## Release Criteria
- Feature complete with tests
- Security audit passed
- Performance benchmarks met`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const kiroRule = KiroRule.fromRulesyncRule(rulesyncRule);

      expect(kiroRule.getFilePath()).toBe(join(testDir, ".kiro", "steering", "product.md"));
      expect(kiroRule.getFileContent()).toBe(`# Product Vision

## Target Users and Personas
- Software developers using AI tools
- Development teams adopting AI workflows

## Non-functional Requirements
- High performance and reliability
- Enterprise security standards
- Intuitive user experience

## Release Criteria
- Feature complete with tests
- Security audit passed
- Performance benchmarks met`);
    });

    it("should convert from RulesyncRule to KiroRule for structure steering", () => {
      const rulesyncPath = join(testDir, "kiro-structure.md");
      const rulesyncContent = `---
target: kiro
description: "Kiro structure steering document"
steeringType: structure
---

# Repository Layout

## Module Boundaries and Dependencies
- Core modules are dependency-free
- UI modules depend only on core
- Integration modules are isolated

## Directory Organization
- \`src/core/\` - Business logic
- \`src/ui/\` - User interface
- \`src/integrations/\` - External services`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const kiroRule = KiroRule.fromRulesyncRule(rulesyncRule);

      expect(kiroRule.getFilePath()).toBe(join(testDir, ".kiro", "steering", "structure.md"));
      expect(kiroRule.getFileContent()).toContain("Repository Layout");
      expect(kiroRule.getFileContent()).toContain("Module Boundaries");
      expect(kiroRule.getFileContent()).not.toContain("---");
    });

    it("should convert from RulesyncRule to KiroRule for tech steering", () => {
      const rulesyncPath = join(testDir, "kiro-technology.md");
      const rulesyncContent = `---
target: kiro
description: "Kiro tech steering document"
---

# Technology Standards

## Language Versions
- TypeScript 5.0+
- Node.js 18+

## Framework Choices
- Frontend: React 18
- Backend: Express.js
- Database: PostgreSQL

## Coding Standards
- Use TypeScript strict mode
- Follow ESLint configuration
- Write comprehensive tests`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const kiroRule = KiroRule.fromRulesyncRule(rulesyncRule);

      expect(kiroRule.getFilePath()).toBe(join(testDir, ".kiro", "steering", "tech.md"));
      expect(kiroRule.getFileContent()).toContain("Technology Standards");
      expect(kiroRule.getFileContent()).toContain("Language Versions");
    });

    it("should handle custom steering document types", () => {
      const rulesyncPath = join(testDir, "kiro-security.md");
      const rulesyncContent = `---
target: kiro
description: "Kiro security steering document"
---

# Security Guidelines

## Authentication Requirements
- Multi-factor authentication required
- JWT tokens with short expiration

## Data Protection
- Encrypt sensitive data at rest
- Use HTTPS for all communications`;

      const rulesyncRule = RulesyncRule.build({
        filePath: rulesyncPath,
        fileContent: rulesyncContent,
      });

      const kiroRule = KiroRule.fromRulesyncRule(rulesyncRule);

      expect(kiroRule.getFilePath()).toBe(join(testDir, ".kiro", "steering", "security.md"));
      expect(kiroRule.getFileContent()).toContain("Security Guidelines");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert product steering document to RulesyncRule format", () => {
      const kiroRule = KiroRule.build({
        filePath: join(testDir, ".kiro", "steering", "product.md"),
        fileContent: `# Product Vision & UX

## Target Users
- Software developers
- Development teams

## Release Criteria
- All features tested
- Performance benchmarks met
- Security audit completed`,
      });

      const rulesyncRule = kiroRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "kiro-product.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "kiro",
        description: "Kiro product steering document - target users, UX rules, release criteria",
        steeringType: "product",
      });
      expect(rulesyncRule.getContent()).toContain("Product Vision & UX");
      expect(rulesyncRule.getContent()).toContain("Target Users");
    });

    it("should convert structure steering document to RulesyncRule format", () => {
      const kiroRule = KiroRule.build({
        filePath: join(testDir, ".kiro", "steering", "structure.md"),
        fileContent: `# Repository Structure

## Module Organization
- Core business logic in src/core/
- UI components in src/ui/
- Integrations in src/integrations/

## Naming Conventions
- Use descriptive names
- Follow established patterns`,
      });

      const rulesyncRule = kiroRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "kiro-structure.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "kiro",
        description: "Kiro structure steering document - repository layout, module boundaries",
        steeringType: "structure",
      });
    });

    it("should convert tech steering document to RulesyncRule format", () => {
      const kiroRule = KiroRule.build({
        filePath: join(testDir, ".kiro", "steering", "tech.md"),
        fileContent: `# Technology Stack

## Languages and Frameworks
- TypeScript 5.0+
- React 18 with Vite
- Node.js 18+

## Coding Standards
- Use strict TypeScript mode
- Follow ESLint configuration
- Write comprehensive tests`,
      });

      const rulesyncRule = kiroRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(join(testDir, "kiro-tech.md"));
      expect(rulesyncRule.getFrontmatter()).toEqual({
        target: "kiro",
        description:
          "Kiro tech steering document - language versions, frameworks, coding standards",
        steeringType: "tech",
      });
    });
  });

  describe("writeFile", () => {
    it("should write steering document to file system", async () => {
      const filePath = join(testDir, ".kiro", "steering", "product.md");
      const fileContent = `# Product Steering

## Standards
- Follow user experience guidelines`;

      const rule = KiroRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });

    it("should create directories if they don't exist", async () => {
      const filePath = join(testDir, ".kiro", "steering", "custom.md");
      const fileContent = `# Custom Steering Document`;

      const rule = KiroRule.build({ filePath, fileContent });
      await rule.writeFile();

      const writtenContent = await fs.readFile(filePath, "utf-8");
      expect(writtenContent).toBe(fileContent);
    });
  });

  describe("validate", () => {
    it("should validate correct Kiro steering document", () => {
      const rule = KiroRule.build({
        filePath: join(testDir, ".kiro", "steering", "product.md"),
        fileContent: `# Valid Kiro Steering Document

## Product Vision
This is a valid Kiro steering document.`,
      });

      const result = rule.validate();
      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should reject invalid file path", () => {
      const rule = KiroRule.build({
        filePath: join(testDir, "invalid.txt"),
        fileContent: "Valid content",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(
        "Kiro rule file must be in .kiro/steering/ directory and have .md extension",
      );
    });

    it("should reject file path with subdirectories", () => {
      const rule = KiroRule.build({
        filePath: join(testDir, ".kiro", "steering", "subdir", "invalid.md"),
        fileContent: "Valid content",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain(
        "Kiro rule file must be in .kiro/steering/ directory and have .md extension",
      );
    });

    it("should reject empty content", () => {
      const rule = KiroRule.build({
        filePath: join(testDir, ".kiro", "steering", "product.md"),
        fileContent: "",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Kiro rule content cannot be empty");
    });

    it("should reject whitespace-only content", () => {
      const rule = KiroRule.build({
        filePath: join(testDir, ".kiro", "steering", "product.md"),
        fileContent: "   \n   \t   ",
      });

      const result = rule.validate();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Kiro rule content cannot be only whitespace");
    });
  });

  describe("getFilePath", () => {
    it("should return the file path", () => {
      const filePath = join(testDir, ".kiro", "steering", "product.md");
      const rule = KiroRule.build({
        filePath,
        fileContent: "# Steering",
      });

      expect(rule.getFilePath()).toBe(filePath);
    });
  });

  describe("getFileContent", () => {
    it("should return the file content", () => {
      const content = `# Steering Document

## Standards
- Follow conventions`;
      const rule = KiroRule.build({
        filePath: join(testDir, ".kiro", "steering", "product.md"),
        fileContent: content,
      });

      expect(rule.getFileContent()).toBe(content);
    });
  });
});
