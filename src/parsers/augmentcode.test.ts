import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileExists, readFileContent } from "../utils/index.js";
import { parseAugmentcodeConfiguration } from "./augmentcode.js";

vi.mock("../utils/index.js", () => ({
  fileExists: vi.fn(),
  readFileContent: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
}));

describe("augmentcode parser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("new .augment/rules/ format", () => {
    it("should parse always rule files", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path.includes(".augment/rules");
      });
      vi.mocked(readdir).mockResolvedValue(["coding-standards-always.md"] as any);
      vi.mocked(readFileContent).mockResolvedValue(`---
type: always
description: ""
tags: ["coding", "standards"]
---

Use TypeScript for all new code.
Follow clean architecture principles.`);

      const result = await parseAugmentcodeConfiguration("/test");

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
        filepath: "/test/.augment/rules/coding-standards-always.md",
      });
    });

    it("should parse manual rule files", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path.includes(".augment/rules");
      });
      vi.mocked(readdir).mockResolvedValue(["project-guidelines-manual.md"] as any);
      vi.mocked(readFileContent).mockResolvedValue(`---
type: manual
description: "Project-specific development guidelines and architecture patterns"
tags: ["architecture", "guidelines"]
---

## Architecture Guidelines
- Use clean architecture principles
- Separate business logic from UI components`);

      const result = await parseAugmentcodeConfiguration("/test");

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
        filepath: "/test/.augment/rules/project-guidelines-manual.md",
      });
    });

    it("should parse auto rule files", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path.includes(".augment/rules");
      });
      vi.mocked(readdir).mockResolvedValue(["onboarding-checklist-auto.md"] as any);
      vi.mocked(readFileContent).mockResolvedValue(`---
type: auto
description: |
  Attach when the user asks for "new dev", "onboarding", "project tour"
tags: [onboarding, documentation]
---

*Read the architecture overview in docs/architecture.md*
*Create a personal feature flag in config/featureFlags.ts*`);

      const result = await parseAugmentcodeConfiguration("/test");

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
        filepath: "/test/.augment/rules/onboarding-checklist-auto.md",
      });
    });

    it("should parse .mdc files", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path.includes(".augment/rules");
      });
      vi.mocked(readdir).mockResolvedValue(["test-rule.mdc"] as any);
      vi.mocked(readFileContent).mockResolvedValue(`---
type: manual
description: "MDC rule file"
---

This is MDC content.`);

      const result = await parseAugmentcodeConfiguration("/test");

      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]!.filename).toBe("augmentcode-manual-test-rule");
      expect(result.rules[0]!.filepath).toBe("/test/.augment/rules/test-rule.mdc");
    });

    it("should default to manual rule type when not specified", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path.includes(".augment/rules");
      });
      vi.mocked(readdir).mockResolvedValue(["default-rule.md"] as any);
      vi.mocked(readFileContent).mockResolvedValue(`---
description: "Default rule without type"
---

Default rule content.`);

      const result = await parseAugmentcodeConfiguration("/test");

      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]!.filename).toBe("augmentcode-manual-default-rule");
      expect(result.rules[0]!.frontmatter.root).toBe(false);
    });

    it("should handle rules without tags", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path.includes(".augment/rules");
      });
      vi.mocked(readdir).mockResolvedValue(["simple-rule.md"] as any);
      vi.mocked(readFileContent).mockResolvedValue(`---
type: manual
description: "Simple rule without tags"
---

Simple rule content.`);

      const result = await parseAugmentcodeConfiguration("/test");

      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]!.frontmatter.tags).toBeUndefined();
    });

    it("should handle invalid frontmatter", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path.includes(".augment/rules");
      });
      vi.mocked(readdir).mockResolvedValue(["invalid-rule.md"] as any);
      vi.mocked(readFileContent).mockRejectedValue(new Error("Invalid YAML"));

      const result = await parseAugmentcodeConfiguration("/test");

      expect(result.rules).toHaveLength(0);
      expect(result.errors).toContain(
        "Failed to parse /test/.augment/rules/invalid-rule.md: Invalid YAML",
      );
    });

    it("should handle multiple rule files", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path.includes(".augment/rules");
      });
      vi.mocked(readdir).mockResolvedValue(["rule1.md", "rule2.md", "non-md-file.txt"] as any);
      vi.mocked(readFileContent)
        .mockResolvedValueOnce(`---
type: always
description: ""
---

Always rule content.`)
        .mockResolvedValueOnce(`---
type: manual  
description: "Manual rule"
---

Manual rule content.`);

      const result = await parseAugmentcodeConfiguration("/test");

      expect(result.rules).toHaveLength(2);
      expect(result.rules[0]!.frontmatter.root).toBe(true);
      expect(result.rules[1]!.frontmatter.root).toBe(false);
    });
  });

  describe("legacy .augment-guidelines format", () => {
    it("should parse .augment-guidelines file", async () => {
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        if (path.includes(".augment/rules")) return false;
        if (path.includes(".augment-guidelines")) return true;
        return false;
      });
      vi.mocked(readFileContent).mockResolvedValue(`Use TypeScript for all new code.
Follow clean architecture principles.
Prefer functional programming patterns.`);

      const result = await parseAugmentcodeConfiguration("/test");

      expect(result.rules).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      expect(result.rules[0]).toEqual({
        frontmatter: {
          root: true, // Legacy guidelines become root rules
          targets: ["augmentcode"],
          description: "Legacy AugmentCode guidelines",
          globs: ["**/*"],
        },
        content:
          "Use TypeScript for all new code.\nFollow clean architecture principles.\nPrefer functional programming patterns.",
        filename: "augmentcode-guidelines",
        filepath: "/test/.augment-guidelines",
      });
    });

    it("should handle empty .augment-guidelines file", async () => {
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        if (path.includes(".augment/rules")) return false;
        if (path.includes(".augment-guidelines")) return true;
        return false;
      });
      vi.mocked(readFileContent).mockResolvedValue("   \n\n   ");

      const result = await parseAugmentcodeConfiguration("/test");

      expect(result.rules).toHaveLength(0);
      expect(result.errors).toContain(
        "No AugmentCode configuration found. Expected .augment/rules/ directory or .augment-guidelines file.",
      );
    });

    it("should handle guidelines file read error", async () => {
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        if (path.includes(".augment/rules")) return false;
        if (path.includes(".augment-guidelines")) return true;
        return false;
      });
      vi.mocked(readFileContent).mockRejectedValue(new Error("File read error"));

      const result = await parseAugmentcodeConfiguration("/test");

      expect(result.rules).toHaveLength(0);
      expect(result.errors).toContain("Failed to parse .augment-guidelines: File read error");
    });
  });

  describe("both formats present", () => {
    it("should parse both new and legacy formats", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path.includes(".augment/rules") || path.includes(".augment-guidelines");
      });
      vi.mocked(readdir).mockResolvedValue(["new-rule.md"] as any);
      vi.mocked(readFileContent)
        .mockResolvedValueOnce(`---
type: manual
description: "New format rule"
---

New format content.`)
        .mockResolvedValueOnce("Legacy guidelines content.");

      const result = await parseAugmentcodeConfiguration("/test");

      expect(result.rules).toHaveLength(2);
      expect(result.rules.some((r) => r.filename === "augmentcode-manual-new-rule")).toBe(true);
      expect(result.rules.some((r) => r.filename === "augmentcode-guidelines")).toBe(true);
    });
  });

  describe("no configuration found", () => {
    it("should return error when no configuration files exist", async () => {
      vi.mocked(fileExists).mockResolvedValue(false);

      const result = await parseAugmentcodeConfiguration("/test");

      expect(result.rules).toHaveLength(0);
      expect(result.errors).toContain(
        "No AugmentCode configuration found. Expected .augment/rules/ directory or .augment-guidelines file.",
      );
    });
  });

  describe("directory reading errors", () => {
    it("should handle rules directory read error", async () => {
      const { readdir } = await import("node:fs/promises");
      vi.mocked(fileExists).mockImplementation(async (path: string) => {
        return path.includes(".augment/rules");
      });
      vi.mocked(readdir).mockRejectedValue(new Error("Directory read error"));

      const result = await parseAugmentcodeConfiguration("/test");

      expect(result.rules).toHaveLength(0);
      expect(result.errors).toContain(
        "Failed to read .augment/rules/ directory: Directory read error",
      );
    });
  });
});
