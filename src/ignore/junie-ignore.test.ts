import { describe, expect, it } from "vitest";
import { JunieIgnore } from "./junie-ignore.js";

describe("JunieIgnore", () => {
  it("should have correct tool identification", () => {
    expect(JunieIgnore.toolName).toBe("junie");
    expect(JunieIgnore.fileName).toBe(".aiignore");
  });

  it("should generate comprehensive ignore content", () => {
    const content = JunieIgnore.generateDefaultContent();

    // Check for essential security patterns
    expect(content).toContain("*.pem");
    expect(content).toContain("*.key");
    expect(content).toContain(".env");
    expect(content).toContain("!.env.example");

    // Check for build artifacts
    expect(content).toContain("node_modules/");
    expect(content).toContain("build/");
    expect(content).toContain("dist/");

    // Check for IDE files
    expect(content).toContain(".idea/");
    expect(content).toContain(".vscode/settings.json");

    // Check for AWS patterns
    expect(content).toContain(".aws/");
    expect(content).toContain("**/.aws/**");

    // Check for generic secret patterns
    expect(content).toContain("**/*secret*.json");
    expect(content).toContain("**/*secrets*.yml");

    // Verify it's a valid ignore file with header comment
    expect(content).toContain("# JetBrains Junie AI ignore file");
    expect(content).toContain("# Controls which files the AI can access automatically");
    expect(content).toContain("# Syntax identical to .gitignore");
  });

  it("should follow Junie ignore file specifications", () => {
    const content = JunieIgnore.generateDefaultContent();

    // Check for Junie-specific patterns based on specification
    expect(content).toContain("*.iml");
    expect(content).toContain("terraform.tfstate*");
    expect(content).toContain("cdk.out/");
    expect(content).toContain("internal-docs/");
    expect(content).toContain("confidential/");

    // Check for data and media exclusions
    expect(content).toContain("*.csv");
    expect(content).toContain("*.xlsx");
    expect(content).toContain("*.mp4");
    expect(content).toContain("*.png");

    // Check for system files
    expect(content).toContain(".DS_Store");
    expect(content).toContain("Thumbs.db");
  });

  it("should include security-focused patterns for enterprise environments", () => {
    const content = JunieIgnore.generateDefaultContent();

    // Security credentials
    expect(content).toContain("id_rsa*");
    expect(content).toContain("id_dsa*");
    expect(content).toContain("*.p12");
    expect(content).toContain("*.pfx");

    // Infrastructure secrets
    expect(content).toContain("**/*secret*.json");
    expect(content).toContain("**/config/**/prod*.yaml");

    // Test fixtures that might confuse AI
    expect(content).toContain("test/fixtures/large-*.json");
    expect(content).toContain("benchmark-results/");
  });

  it("should generate content with proper line endings", () => {
    const content = JunieIgnore.generateDefaultContent();

    // Should end with a newline
    expect(content).toMatch(/\n$/);

    // Should have proper line structure
    const lines = content.split("\n");
    expect(lines.length).toBeGreaterThan(10);

    // Should have comment lines
    const commentLines = lines.filter((line) => line.startsWith("#"));
    expect(commentLines.length).toBeGreaterThan(5);
  });

  describe("toRulesyncIgnore", () => {
    it("should convert to RulesyncIgnore with correct paths and content", () => {
      const patterns = ["*.log", "node_modules/", "!important.log"];
      const junieIgnore = new JunieIgnore({
        baseDir: ".",
        relativeDirPath: ".",
        relativeFilePath: ".aiignore",
        patterns,
        fileContent: patterns.join("\n"),
      });

      const rulesyncIgnore = junieIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
      expect(rulesyncIgnore.getBody()).toBe(patterns.join("\n"));
    });

    it("should convert empty patterns correctly", () => {
      const junieIgnore = new JunieIgnore({
        baseDir: ".",
        patterns: [],
      });

      const rulesyncIgnore = junieIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");
      expect(rulesyncIgnore.getBody()).toBe("");
    });

    it("should convert default patterns correctly", () => {
      const junieIgnore = JunieIgnore.createWithDefaultPatterns();

      const rulesyncIgnore = junieIgnore.toRulesyncIgnore();

      expect(rulesyncIgnore.getRelativeDirPath()).toBe(".");
      expect(rulesyncIgnore.getRelativeFilePath()).toBe(".rulesyncignore");

      const body = rulesyncIgnore.getBody();
      expect(body).toContain("*.pem");
      expect(body).toContain("*.key");
      expect(body).toContain(".env");
      expect(body).toContain("node_modules/");
    });

    it("should convert and round-trip correctly", () => {
      const patterns = ["*.log", ".env", "node_modules/", "!.env.example"];
      const original = new JunieIgnore({
        baseDir: ".",
        patterns,
      });

      const rulesyncIgnore = original.toRulesyncIgnore();
      const converted = JunieIgnore.fromRulesyncIgnore({
        baseDir: ".",
        relativeDirPath: ".",
        rulesyncIgnore,
      });

      expect(converted.getPatterns()).toEqual(patterns);
    });
  });
});
