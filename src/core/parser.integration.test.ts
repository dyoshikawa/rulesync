import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { setupTestDirectory } from "../test-utils/index.js";
import { parseRulesFromDirectory } from "./parser.js";

describe("parseRulesFromDirectory with new rules directory structure", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should parse rules from new location (.rulesync/rules/*.md)", async () => {
    const rulesDir = join(testDir, "rules");
    await mkdir(rulesDir, { recursive: true });
    
    const rule1Content = `---
root: false
targets: ["copilot"]
description: "Test rule 1"
---

# Test Rule 1
This is a test rule in the new location.`;

    const rule2Content = `---
root: false
targets: ["cursor"]
description: "Test rule 2"
---

# Test Rule 2
This is another test rule in the new location.`;

    await writeFile(join(rulesDir, "test1.md"), rule1Content);
    await writeFile(join(rulesDir, "test2.md"), rule2Content);

    const rules = await parseRulesFromDirectory(testDir);

    expect(rules).toHaveLength(2);
    expect(rules[0].filename).toBe("test1");
    expect(rules[0].frontmatter.targets).toEqual(["copilot"]);
    expect(rules[1].filename).toBe("test2");
    expect(rules[1].frontmatter.targets).toEqual(["cursor"]);
  });

  it("should parse rules from legacy location (.rulesync/*.md) when no new location exists", async () => {
    const rule1Content = `---
root: false
targets: ["copilot"]
description: "Legacy test rule 1"
---

# Legacy Test Rule 1
This is a test rule in the legacy location.`;

    await writeFile(join(testDir, "legacy1.md"), rule1Content);

    const rules = await parseRulesFromDirectory(testDir);

    expect(rules).toHaveLength(1);
    expect(rules[0].filename).toBe("legacy1");
    expect(rules[0].frontmatter.description).toBe("Legacy test rule 1");
  });

  it("should prioritize new location over legacy location for same-named files", async () => {
    const rulesDir = join(testDir, "rules");
    await mkdir(rulesDir, { recursive: true });

    // Create files with same name in both locations
    const newRuleContent = `---
root: false
targets: ["copilot"]
description: "New rule version"
---

# New Rule Version
This is the new version of the rule.`;

    const legacyRuleContent = `---
root: false
targets: ["cursor"]
description: "Legacy rule version"
---

# Legacy Rule Version
This is the legacy version of the rule.`;

    await writeFile(join(rulesDir, "duplicate.md"), newRuleContent);
    await writeFile(join(testDir, "duplicate.md"), legacyRuleContent);

    // Also create a unique file in legacy location
    await writeFile(join(testDir, "legacy-only.md"), legacyRuleContent);

    const rules = await parseRulesFromDirectory(testDir);

    expect(rules).toHaveLength(2);
    
    // Find the duplicate rule and verify it comes from the new location
    const duplicateRule = rules.find(rule => rule.filename === "duplicate");
    expect(duplicateRule).toBeDefined();
    if (duplicateRule) {
      expect(duplicateRule.frontmatter.description).toBe("New rule version");
      expect(duplicateRule.frontmatter.targets).toEqual(["copilot"]);
    }

    // Verify the legacy-only file is still included
    const legacyOnlyRule = rules.find(rule => rule.filename === "legacy-only");
    expect(legacyOnlyRule).toBeDefined();
    if (legacyOnlyRule) {
      expect(legacyOnlyRule.frontmatter.description).toBe("Legacy rule version");
    }
  });

  it("should handle mixed file locations correctly", async () => {
    const rulesDir = join(testDir, "rules");
    await mkdir(rulesDir, { recursive: true });

    // Create rule in new location
    const newRuleContent = `---
root: false
targets: ["copilot"]
description: "New location rule"
---

# New Location Rule`;

    // Create rule in legacy location
    const legacyRuleContent = `---
root: false
targets: ["cursor"]
description: "Legacy location rule"
---

# Legacy Location Rule`;

    await writeFile(join(rulesDir, "new-rule.md"), newRuleContent);
    await writeFile(join(testDir, "legacy-rule.md"), legacyRuleContent);

    const rules = await parseRulesFromDirectory(testDir);

    expect(rules).toHaveLength(2);
    
    const ruleFilenames = rules.map(r => r.filename).sort();
    expect(ruleFilenames).toEqual(["legacy-rule", "new-rule"]);
  });

  it("should return empty array when no rule files exist in either location", async () => {
    const rulesDir = join(testDir, "rules");
    await mkdir(rulesDir, { recursive: true });

    const rules = await parseRulesFromDirectory(testDir);

    expect(rules).toHaveLength(0);
  });
});