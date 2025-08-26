import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { parseAugmentcodeConfiguration } from "./augmentcode.js";

describe("augmentcode parser", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("new .augment/rules/ format", () => {
    it("should parse always rule files", async () => {
      const rulesDir = join(testDir, ".augment", "rules");
      await mkdir(rulesDir, { recursive: true });

      const ruleContent = `---
type: always
description: ""
tags: ["coding", "standards"]
---

Use TypeScript for all new code.
Follow clean architecture principles.`;

      await writeFile(join(rulesDir, "coding-standards-always.md"), ruleContent);

      const result = await parseAugmentcodeConfiguration(testDir);

      expect(result.rules).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      expect(result.rules[0]).toEqual({
        frontmatter: {
          root: true, // Always rules become root rules
          targets: ["augmentcode"],
          description: "",
          globs: ["**/*"],
          tags: ["coding", "standards"],
        },
        content: "Use TypeScript for all new code.\nFollow clean architecture principles.",
        filename: "augmentcode-always-coding-standards-always",
        filepath: join(testDir, ".augment", "rules", "coding-standards-always.md"),
      });
    });

    it("should parse manual rule files", async () => {
      const rulesDir = join(testDir, ".augment", "rules");
      await mkdir(rulesDir, { recursive: true });

      const ruleContent = `---
type: manual
description: "Project-specific development guidelines and architecture patterns"
tags: ["architecture", "guidelines"]
---

## Architecture Guidelines
- Use clean architecture principles
- Separate business logic from UI components`;

      await writeFile(join(rulesDir, "project-guidelines-manual.md"), ruleContent);

      const result = await parseAugmentcodeConfiguration(testDir);

      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]).toEqual({
        frontmatter: {
          root: false, // Manual rules are not root rules
          targets: ["augmentcode"],
          description: "Project-specific development guidelines and architecture patterns",
          globs: ["**/*"],
          tags: ["architecture", "guidelines"],
        },
        content:
          "## Architecture Guidelines\n- Use clean architecture principles\n- Separate business logic from UI components",
        filename: "augmentcode-manual-project-guidelines-manual",
        filepath: join(testDir, ".augment", "rules", "project-guidelines-manual.md"),
      });
    });

    it("should parse auto rule files", async () => {
      const rulesDir = join(testDir, ".augment", "rules");
      await mkdir(rulesDir, { recursive: true });

      const ruleContent = `---
type: auto
description: |
  Attach when the user asks for "new dev", "onboarding", "project tour"
tags: [onboarding, documentation]
---

*Read the architecture overview in docs/architecture.md*
*Create a personal feature flag in config/featureFlags.ts*`;

      await writeFile(join(rulesDir, "onboarding-checklist-auto.md"), ruleContent);

      const result = await parseAugmentcodeConfiguration(testDir);

      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]).toEqual({
        frontmatter: {
          root: false,
          targets: ["augmentcode"],
          description: 'Attach when the user asks for "new dev", "onboarding", "project tour"\n',
          globs: ["**/*"],
          tags: ["onboarding", "documentation"],
        },
        content:
          "*Read the architecture overview in docs/architecture.md*\n*Create a personal feature flag in config/featureFlags.ts*",
        filename: "augmentcode-auto-onboarding-checklist-auto",
        filepath: join(testDir, ".augment", "rules", "onboarding-checklist-auto.md"),
      });
    });

    it("should parse .mdc files", async () => {
      const rulesDir = join(testDir, ".augment", "rules");
      await mkdir(rulesDir, { recursive: true });

      const ruleContent = `---
type: manual
description: "MDC rule file"
---

This is MDC content.`;

      await writeFile(join(rulesDir, "test-rule.mdc"), ruleContent);

      const result = await parseAugmentcodeConfiguration(testDir);

      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]!.filename).toBe("augmentcode-manual-test-rule");
      expect(result.rules[0]!.filepath).toBe(join(testDir, ".augment", "rules", "test-rule.mdc"));
    });

    it("should default to manual rule type when not specified", async () => {
      const rulesDir = join(testDir, ".augment", "rules");
      await mkdir(rulesDir, { recursive: true });

      const ruleContent = `---
description: "Default rule without type"
---

Default rule content.`;

      await writeFile(join(rulesDir, "default-rule.md"), ruleContent);

      const result = await parseAugmentcodeConfiguration(testDir);

      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]!.filename).toBe("augmentcode-manual-default-rule");
      expect(result.rules[0]!.frontmatter.root).toBe(false);
    });

    it("should handle rules without tags", async () => {
      const rulesDir = join(testDir, ".augment", "rules");
      await mkdir(rulesDir, { recursive: true });

      const ruleContent = `---
type: manual
description: "Simple rule without tags"
---

Simple rule content.`;

      await writeFile(join(rulesDir, "simple-rule.md"), ruleContent);

      const result = await parseAugmentcodeConfiguration(testDir);

      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]!.frontmatter.tags).toBeUndefined();
    });

    it("should handle invalid frontmatter", async () => {
      const rulesDir = join(testDir, ".augment", "rules");
      await mkdir(rulesDir, { recursive: true });

      // Create a file with invalid YAML frontmatter
      const invalidContent = `---
type: always
invalid: yaml: syntax: error
---

Rule content.`;

      await writeFile(join(rulesDir, "invalid-rule.md"), invalidContent);

      const result = await parseAugmentcodeConfiguration(testDir);

      expect(result.rules).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should handle multiple rule files", async () => {
      const rulesDir = join(testDir, ".augment", "rules");
      await mkdir(rulesDir, { recursive: true });

      const alwaysRuleContent = `---
type: always
description: ""
---

Always rule content.`;

      const manualRuleContent = `---
type: manual  
description: "Manual rule"
---

Manual rule content.`;

      await writeFile(join(rulesDir, "rule1.md"), alwaysRuleContent);
      await writeFile(join(rulesDir, "rule2.md"), manualRuleContent);
      await writeFile(join(rulesDir, "non-md-file.txt"), "This should be ignored");

      const result = await parseAugmentcodeConfiguration(testDir);

      expect(result.rules).toHaveLength(2);
      expect(result.rules.some((r) => r.frontmatter.root === true)).toBe(true);
      expect(result.rules.some((r) => r.frontmatter.root === false)).toBe(true);
    });
  });

  describe("no configuration found", () => {
    it("should return error when no configuration files exist", async () => {
      const result = await parseAugmentcodeConfiguration(testDir);

      expect(result.rules).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
