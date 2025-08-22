import { describe, expect, it } from "vitest";
import { ALL_TOOL_TARGETS } from "../../types/index.js";
import {
  checkDeprecatedFlags,
  getDeprecationWarning,
  mergeAndDeduplicateTools,
  parseTargets,
  validateToolsNotEmpty,
} from "./targets-parser.js";

describe("parseTargets", () => {
  it("should parse comma-separated string", () => {
    const result = parseTargets("copilot,cursor,cline");
    expect(result).toEqual(["copilot", "cursor", "cline"]);
  });

  it("should parse single tool", () => {
    const result = parseTargets("copilot");
    expect(result).toEqual(["copilot"]);
  });

  it("should handle 'all' keyword", () => {
    const result = parseTargets("all");
    expect(result).toEqual([...ALL_TOOL_TARGETS]);
  });

  it("should handle array input", () => {
    const result = parseTargets(["copilot", "cursor"]);
    expect(result).toEqual(["copilot", "cursor"]);
  });

  it("should trim whitespace", () => {
    const result = parseTargets(" copilot , cursor , cline ");
    expect(result).toEqual(["copilot", "cursor", "cline"]);
  });

  it("should remove duplicates", () => {
    const result = parseTargets("copilot,cursor,copilot");
    expect(result).toEqual(["copilot", "cursor"]);
  });

  it("should handle mix of tools and 'all'", () => {
    const result = parseTargets("copilot,all,cursor");
    // When 'all' is included, it should return all tools (order may vary due to Set)
    expect(result).toHaveLength(ALL_TOOL_TARGETS.length);
    expect(result).toEqual(expect.arrayContaining([...ALL_TOOL_TARGETS]));
  });

  it("should return empty array for empty input", () => {
    expect(parseTargets("")).toEqual([]);
    expect(parseTargets([])).toEqual([]);
  });

  it("should throw error for invalid tool", () => {
    expect(() => parseTargets("invalid-tool")).toThrow("Invalid tool targets: invalid-tool");
  });

  it("should throw error for mixed valid and invalid tools", () => {
    expect(() => parseTargets("copilot,invalid-tool,cursor")).toThrow(
      "Invalid tool targets: invalid-tool",
    );
  });

  it("should filter empty strings", () => {
    const result = parseTargets("copilot,,cursor");
    expect(result).toEqual(["copilot", "cursor"]);
  });
});

describe("checkDeprecatedFlags", () => {
  it("should return empty array when no deprecated flags", () => {
    const options = { targets: "copilot,cursor", all: false };
    const result = checkDeprecatedFlags(options);
    expect(result).toEqual([]);
  });

  it("should detect single deprecated flag", () => {
    const options = { copilot: true };
    const result = checkDeprecatedFlags(options);
    expect(result).toEqual(["copilot"]);
  });

  it("should detect multiple deprecated flags", () => {
    const options = { copilot: true, cursor: true, cline: true };
    const result = checkDeprecatedFlags(options);
    expect(result).toContain("copilot");
    expect(result).toContain("cursor");
    expect(result).toContain("cline");
    expect(result).toHaveLength(3);
  });

  it("should handle augmentcode-legacy flag", () => {
    const options = { "augmentcode-legacy": true };
    const result = checkDeprecatedFlags(options);
    expect(result).toEqual(["augmentcode-legacy"]);
  });

  it("should ignore false flags", () => {
    const options = { copilot: false, cursor: true };
    const result = checkDeprecatedFlags(options);
    expect(result).toEqual(["cursor"]);
  });

  it("should handle all available tool flags", () => {
    // Set up options for all available tools
    const options: Record<string, boolean> = {
      agentsmd: true,
      amazonqcli: true,
      augmentcode: true,
      "augmentcode-legacy": true,
      copilot: true,
      cursor: true,
      cline: true,
      codexcli: true,
      claudecode: true,
      roo: true,
      geminicli: true,
      junie: true,
      qwencode: true,
      kiro: true,
      opencode: true,
      windsurf: true,
    };

    const result = checkDeprecatedFlags(options);
    expect(result).toHaveLength(16); // All tools have individual flags
    expect(result).toEqual(
      expect.arrayContaining([
        "agentsmd",
        "amazonqcli",
        "augmentcode",
        "augmentcode-legacy",
        "copilot",
        "cursor",
        "cline",
        "codexcli",
        "claudecode",
        "roo",
        "geminicli",
        "junie",
        "qwencode",
        "kiro",
        "opencode",
        "windsurf",
      ]),
    );
  });
});

describe("getDeprecationWarning", () => {
  it("should generate warning for single tool", () => {
    const warning = getDeprecationWarning(["copilot"]);
    expect(warning).toContain("DEPRECATED");
    expect(warning).toContain("--copilot");
    expect(warning).toContain("--targets copilot");
  });

  it("should generate warning for multiple tools", () => {
    const warning = getDeprecationWarning(["copilot", "cursor", "cline"]);
    expect(warning).toContain("DEPRECATED");
    expect(warning).toContain("--copilot --cursor --cline");
    expect(warning).toContain("--targets copilot,cursor,cline");
  });

  it("should include migration instructions", () => {
    const warning = getDeprecationWarning(["copilot"]);
    expect(warning).toContain("Please update your scripts");
    expect(warning).toContain("new --targets flag");
  });
});

describe("mergeAndDeduplicateTools", () => {
  it("should return all tools when allFlag is true", () => {
    const result = mergeAndDeduplicateTools(["copilot"], ["cursor"], true);
    expect(result).toEqual(ALL_TOOL_TARGETS);
  });

  it("should merge targets and deprecated tools", () => {
    const result = mergeAndDeduplicateTools(["copilot", "cursor"], ["cline", "roo"], false);
    expect(result).toEqual(["copilot", "cursor", "cline", "roo"]);
  });

  it("should deduplicate merged tools", () => {
    const result = mergeAndDeduplicateTools(["copilot", "cursor"], ["copilot", "cline"], false);
    expect(result).toEqual(["copilot", "cursor", "cline"]);
  });

  it("should handle empty targets", () => {
    const result = mergeAndDeduplicateTools([], ["copilot"], false);
    expect(result).toEqual(["copilot"]);
  });

  it("should handle empty deprecated tools", () => {
    const result = mergeAndDeduplicateTools(["copilot"], [], false);
    expect(result).toEqual(["copilot"]);
  });

  it("should handle both empty arrays", () => {
    const result = mergeAndDeduplicateTools([], [], false);
    expect(result).toEqual([]);
  });
});

describe("validateToolsNotEmpty", () => {
  it("should not throw for non-empty array", () => {
    expect(() => validateToolsNotEmpty(["copilot"])).not.toThrow();
  });

  it("should throw for empty array", () => {
    expect(() => validateToolsNotEmpty([])).toThrow(
      "No tools specified. Use --targets <tool1,tool2> or --all to specify which tools to generate for.",
    );
  });

  it("should not throw for multiple tools", () => {
    expect(() => validateToolsNotEmpty(["copilot", "cursor", "cline"])).not.toThrow();
  });
});

describe("Integration tests", () => {
  it("should handle complete workflow with new syntax", () => {
    const targetsTools = parseTargets("copilot,cursor");
    const deprecatedTools = checkDeprecatedFlags({});
    const mergedTools = mergeAndDeduplicateTools(targetsTools, deprecatedTools, false);

    expect(mergedTools).toEqual(["copilot", "cursor"]);
    expect(() => validateToolsNotEmpty(mergedTools)).not.toThrow();
  });

  it("should handle complete workflow with deprecated syntax", () => {
    const targetsTools = parseTargets("");
    const deprecatedTools = checkDeprecatedFlags({ copilot: true, cursor: true });
    const warning = getDeprecationWarning(deprecatedTools);
    const mergedTools = mergeAndDeduplicateTools(targetsTools, deprecatedTools, false);

    expect(deprecatedTools).toEqual(["copilot", "cursor"]);
    expect(warning).toContain("DEPRECATED");
    expect(mergedTools).toEqual(["copilot", "cursor"]);
    expect(() => validateToolsNotEmpty(mergedTools)).not.toThrow();
  });

  it("should handle complete workflow with mixed syntax", () => {
    const targetsTools = parseTargets("cline,roo");
    const deprecatedTools = checkDeprecatedFlags({ copilot: true, cursor: true });
    const warning = getDeprecationWarning(deprecatedTools);
    const mergedTools = mergeAndDeduplicateTools(targetsTools, deprecatedTools, false);

    expect(deprecatedTools).toEqual(["copilot", "cursor"]);
    expect(warning).toContain("DEPRECATED");
    expect(mergedTools).toEqual(["cline", "roo", "copilot", "cursor"]);
    expect(() => validateToolsNotEmpty(mergedTools)).not.toThrow();
  });

  it("should handle all flag with override", () => {
    const targetsTools = parseTargets("copilot");
    const deprecatedTools = checkDeprecatedFlags({ cursor: true });
    const mergedTools = mergeAndDeduplicateTools(targetsTools, deprecatedTools, true);

    expect(mergedTools).toEqual([...ALL_TOOL_TARGETS]);
    expect(() => validateToolsNotEmpty(mergedTools)).not.toThrow();
  });
});
