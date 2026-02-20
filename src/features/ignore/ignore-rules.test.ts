import { describe, expect, it } from "vitest";

import {
  buildIgnoreYamlContent,
  convertIgnoreRulesToClaudeDenyPatterns,
  convertIgnoreRulesToPathPatterns,
  parseIgnoreRulesFromText,
  parseIgnoreRulesFromYaml,
} from "./ignore-rules.js";

describe("ignore-rules", () => {
  describe("parseIgnoreRulesFromText", () => {
    it("should parse plain paths as read rules", () => {
      const parsed = parseIgnoreRulesFromText("tmp/\nsecrets/**");
      expect(parsed.warnings).toEqual([]);
      expect(parsed.rules).toEqual([
        { path: "secrets/**", actions: ["read"] },
        { path: "tmp/", actions: ["read"] },
      ]);
    });

    it("should parse Read/Write/Edit wrappers", () => {
      const parsed = parseIgnoreRulesFromText("Read(tmp/**)\nWrite(tmp/**)\nEdit(tmp/**)");
      expect(parsed.warnings).toEqual([]);
      expect(parsed.rules).toEqual([{ path: "tmp/**", actions: ["read", "write", "edit"] }]);
    });

    it("should warn and skip unsupported wrappers", () => {
      const parsed = parseIgnoreRulesFromText("Delete(secret/**)\nRead(tmp/**)");
      expect(parsed.warnings).toHaveLength(1);
      expect(parsed.rules).toEqual([{ path: "tmp/**", actions: ["read"] }]);
    });
  });

  describe("parseIgnoreRulesFromYaml", () => {
    it("should parse valid ignore.yaml content", () => {
      const parsed = parseIgnoreRulesFromYaml(`version: 1
rules:
  - path: tmp/
    actions: [read]
  - path: secrets/**
    actions: [read, write]
`);
      expect(parsed.warnings).toEqual([]);
      expect(parsed.rules).toEqual([
        { path: "secrets/**", actions: ["read", "write"] },
        { path: "tmp/", actions: ["read"] },
      ]);
    });

    it("should default missing actions to read with warning", () => {
      const parsed = parseIgnoreRulesFromYaml(`version: 1
rules:
  - path: tmp/
`);
      expect(parsed.warnings).toHaveLength(1);
      expect(parsed.rules).toEqual([{ path: "tmp/", actions: ["read"] }]);
    });
  });

  describe("converters", () => {
    it("should convert rules to Claude deny patterns", () => {
      const patterns = convertIgnoreRulesToClaudeDenyPatterns([
        { path: "tmp/**", actions: ["read", "write"] },
      ]);
      expect(patterns).toEqual(["Read(tmp/**)", "Write(tmp/**)"]);
    });

    it("should project rules to path-only patterns with warnings for non-read actions", () => {
      const projected = convertIgnoreRulesToPathPatterns([
        { path: "tmp/**", actions: ["read", "write"] },
      ]);
      expect(projected.patterns).toEqual(["tmp/**"]);
      expect(projected.warnings).toHaveLength(1);
    });

    it("should build YAML content from rules", () => {
      const yamlContent = buildIgnoreYamlContent([{ path: "tmp/**", actions: ["read", "write"] }]);
      expect(yamlContent).toContain("version: 1");
      expect(yamlContent).toContain("path: tmp/**");
      expect(yamlContent).toContain("- read");
      expect(yamlContent).toContain("- write");
    });
  });
});
