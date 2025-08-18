/**
 * Generator registry for configuration-driven rule generation
 * This makes adding new AI tools much easier by eliminating boilerplate code
 */

import { join } from "node:path";
import type { Config, GeneratedOutput, ParsedRule, ToolTarget } from "../../types/index.js";
import {
  type EnhancedRuleGeneratorConfig,
  generateComplexRules,
  generateRulesConfig,
  type RuleGeneratorConfig,
} from "./shared-helpers.js";

/**
 * Determine Cursor rule type
 * Order of checking: 1. always → 2. manual → 3. specificFiles → 4. intelligently
 * If cursorRuleType is explicitly specified, use that; otherwise use fallback logic
 */
function determineCursorRuleType(
  frontmatter: import("../../types/index.js").RuleFrontmatter,
): string {
  // If cursorRuleType is explicitly specified, use it
  if (frontmatter.cursorRuleType) {
    return frontmatter.cursorRuleType;
  }

  // Fallback logic when cursorRuleType is not specified (section 5 of specification)
  const isDescriptionEmpty = !frontmatter.description || frontmatter.description.trim() === "";
  const isGlobsEmpty = frontmatter.globs.length === 0;
  const isGlobsExactlyAllFiles = frontmatter.globs.length === 1 && frontmatter.globs[0] === "**/*";

  // 1. always: globs is exactly ["**/*"]
  if (isGlobsExactlyAllFiles) {
    return "always";
  }

  // 2. manual: description is empty/undefined AND globs is empty/undefined
  if (isDescriptionEmpty && isGlobsEmpty) {
    return "manual";
  }

  // 3. specificFiles: description is empty/undefined AND globs is non-empty (but not ["**/*"])
  if (isDescriptionEmpty && !isGlobsEmpty) {
    return "specificFiles";
  }

  // 4. intelligently: description is non-empty AND globs is empty/undefined
  if (!isDescriptionEmpty && isGlobsEmpty) {
    return "intelligently";
  }

  // Edge case: description is non-empty AND globs is non-empty (but not ["**/*"])
  // According to specification order, this should be treated as "intelligently"
  // because it doesn't match 1, 2, or 3, so it falls to 4
  return "intelligently";
}

/**
 * Simple generator configuration for tools that generate individual rule files
 */
export interface SimpleGeneratorConfig {
  type: "simple";
  tool: ToolTarget;
  fileExtension: string;
  ignoreFileName: string;
  generateContent: (rule: ParsedRule) => string;
  pathResolver?: (rule: ParsedRule, outputDir: string) => string;
}

/**
 * Complex generator configuration for tools with root + detail file patterns
 */
export interface ComplexGeneratorConfig {
  type: "complex";
  tool: ToolTarget;
  fileExtension: string;
  ignoreFileName?: string;
  generateContent: (rule: ParsedRule) => string;
  generateRootContent?: (
    rootRule: ParsedRule | undefined,
    detailRules: ParsedRule[],
    baseDir?: string,
  ) => string;
  rootFilePath?: string;
  generateDetailContent?: (rule: ParsedRule) => string;
  detailSubDir?: string;
  updateAdditionalConfig?: (
    ignorePatterns: string[],
    baseDir?: string,
  ) => Promise<GeneratedOutput[]>;
}

export type GeneratorConfig = SimpleGeneratorConfig | ComplexGeneratorConfig;

/**
 * Registry of all generator configurations
 */
const GENERATOR_REGISTRY: Record<ToolTarget, GeneratorConfig> = {
  // Simple generators - generate one file per rule
  amazonqcli: {
    type: "complex",
    tool: "amazonqcli",
    fileExtension: ".md",
    // ignoreFileName omitted - Amazon Q CLI doesn't have native ignore file support yet
    generateContent: (rule) => {
      const lines: string[] = [];
      if (rule.frontmatter.description) {
        lines.push(`# ${rule.frontmatter.description}\n`);
      }
      lines.push(rule.content.trim());
      return lines.join("\n");
    },
    // Complex generation handled by existing generator
  },

  cline: {
    type: "simple",
    tool: "cline",
    fileExtension: ".md",
    ignoreFileName: ".clineignore",
    generateContent: (rule) => rule.content.trim(),
  },

  roo: {
    type: "simple",
    tool: "roo",
    fileExtension: ".md",
    ignoreFileName: ".rooignore",
    generateContent: (rule) => rule.content.trim(),
  },

  kiro: {
    type: "simple",
    tool: "kiro",
    fileExtension: ".md",
    ignoreFileName: ".kiroignore",
    generateContent: (rule) => rule.content.trim(),
  },

  augmentcode: {
    type: "simple",
    tool: "augmentcode",
    fileExtension: ".md",
    ignoreFileName: ".aiignore",
    generateContent: (rule) => rule.content.trim(),
  },

  "augmentcode-legacy": {
    type: "simple",
    tool: "augmentcode-legacy",
    fileExtension: ".md",
    ignoreFileName: ".aiignore",
    generateContent: (rule) => rule.content.trim(),
  },

  // Complex generators with custom content formatting
  copilot: {
    type: "simple",
    tool: "copilot",
    fileExtension: ".instructions.md",
    ignoreFileName: ".copilotignore",
    generateContent: (rule) => {
      const lines: string[] = [];
      // Add Front Matter for GitHub Copilot
      lines.push("---");
      lines.push(`description: "${rule.frontmatter.description}"`);
      if (rule.frontmatter.globs.length > 0) {
        lines.push(`applyTo: "${rule.frontmatter.globs.join(", ")}"`);
      } else {
        lines.push('applyTo: "**"');
      }
      lines.push("---");
      lines.push(rule.content);
      return lines.join("\n");
    },
    pathResolver: (rule, outputDir) => {
      const baseFilename = rule.filename.replace(/\.md$/, "");
      return join(outputDir, `${baseFilename}.instructions.md`);
    },
  },

  cursor: {
    type: "simple",
    tool: "cursor",
    fileExtension: ".mdc",
    ignoreFileName: ".cursorignore",
    generateContent: (rule) => {
      const lines: string[] = [];

      // Determine rule type based on four kinds of .mdc files
      const ruleType = determineCursorRuleType(rule.frontmatter);

      // Add MDC header for Cursor
      lines.push("---");

      switch (ruleType) {
        case "always":
          // 1. always: description and globs are empty, alwaysApply: true
          lines.push("description:");
          lines.push("globs:");
          lines.push("alwaysApply: true");
          break;

        case "manual":
          // 2. manual: keep original empty values, alwaysApply: false
          lines.push("description:");
          lines.push("globs:");
          lines.push("alwaysApply: false");
          break;

        case "specificFiles":
          // 3. specificFiles: empty description, globs from original (comma-separated), alwaysApply: false
          lines.push("description:");
          lines.push(`globs: ${rule.frontmatter.globs.join(",")}`);
          lines.push("alwaysApply: false");
          break;

        case "intelligently":
          // 4. intelligently: description from original, empty globs, alwaysApply: false
          lines.push(`description: ${rule.frontmatter.description}`);
          lines.push("globs:");
          lines.push("alwaysApply: false");
          break;
      }

      lines.push("---");
      lines.push("");
      lines.push(rule.content);

      return lines.join("\n");
    },
    pathResolver: (rule, outputDir) => {
      return join(outputDir, `${rule.filename}.mdc`);
    },
  },

  codexcli: {
    type: "simple",
    tool: "codexcli",
    fileExtension: ".md",
    ignoreFileName: ".codexignore",
    generateContent: (rule) => rule.content.trim(),
  },

  windsurf: {
    type: "simple",
    tool: "windsurf",
    fileExtension: ".md",
    ignoreFileName: ".codeiumignore",
    generateContent: (rule) => {
      const lines: string[] = [];

      // Add YAML frontmatter if activation mode is specified
      const activationMode = rule.frontmatter.windsurfActivationMode;
      const globPattern = rule.frontmatter.globs?.[0];

      if (activationMode || globPattern) {
        lines.push("---");

        if (activationMode) {
          lines.push(`activation: ${activationMode}`);
        }

        if (globPattern && activationMode === "glob") {
          lines.push(`pattern: "${globPattern}"`);
        }

        lines.push("---");
        lines.push("");
      }

      lines.push(rule.content.trim());
      return lines.join("\n");
    },
    pathResolver: (rule, outputDir) => {
      // Based on the specification, we support two variants:
      // A. Single-File Variant: .windsurf-rules in project root
      // B. Directory Variant: .windsurf/rules/ directory with multiple .md files

      // Check if rule specifies a specific output format
      const outputFormat = rule.frontmatter.windsurfOutputFormat || "directory";

      if (outputFormat === "single-file") {
        // Single-file variant: output to .windsurf-rules
        return join(outputDir, ".windsurf-rules");
      } else {
        // Directory variant (recommended): output to .windsurf/rules/
        const rulesDir = join(outputDir, ".windsurf", "rules");
        return join(rulesDir, `${rule.filename}.md`);
      }
    },
  },

  // Complex generators with root + detail pattern
  claudecode: {
    type: "complex",
    tool: "claudecode",
    fileExtension: ".md",
    ignoreFileName: ".aiignore",
    generateContent: (rule) => {
      const lines: string[] = [];
      if (rule.frontmatter.description) {
        lines.push(`# ${rule.frontmatter.description}\n`);
      }
      lines.push(rule.content.trim());
      return lines.join("\n");
    },
    // NOTE: Claude Code specific logic is handled in the actual generator file
    // due to complex settings.json manipulation requirements
  },

  geminicli: {
    type: "complex",
    tool: "geminicli",
    fileExtension: ".md",
    ignoreFileName: ".aiexclude",
    generateContent: (rule) => {
      const lines: string[] = [];
      if (rule.frontmatter.description) {
        lines.push(`# ${rule.frontmatter.description}\n`);
      }
      lines.push(rule.content.trim());
      return lines.join("\n");
    },
    // Complex generation handled by existing generator
  },

  opencode: {
    type: "complex",
    tool: "opencode",
    fileExtension: ".md",
    // ignoreFileName omitted - OpenCode doesn't use dedicated ignore files
    generateContent: (rule) => {
      const lines: string[] = [];
      if (rule.frontmatter.description) {
        lines.push(`# ${rule.frontmatter.description}\n`);
      }
      lines.push(rule.content.trim());
      return lines.join("\n");
    },
    // Complex generation handled by existing generator
  },

  junie: {
    type: "complex",
    tool: "junie",
    fileExtension: ".md",
    ignoreFileName: ".aiignore",
    generateContent: (rule) => {
      const lines: string[] = [];
      if (rule.frontmatter.description) {
        lines.push(`# ${rule.frontmatter.description}\n`);
      }
      lines.push(rule.content.trim());
      return lines.join("\n");
    },
    // Complex generation handled by existing generator
  },
};

/**
 * Generate configuration for a tool using the registry
 */
export async function generateFromRegistry(
  tool: ToolTarget,
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const generatorConfig = GENERATOR_REGISTRY[tool];

  if (!generatorConfig) {
    throw new Error(`No generator configuration found for tool: ${tool}`);
  }

  if (generatorConfig.type === "simple") {
    const ruleConfig: RuleGeneratorConfig = {
      tool: generatorConfig.tool,
      fileExtension: generatorConfig.fileExtension,
      ignoreFileName: generatorConfig.ignoreFileName,
      generateContent: generatorConfig.generateContent,
      ...(generatorConfig.pathResolver && { pathResolver: generatorConfig.pathResolver }),
    };

    return generateRulesConfig(rules, config, ruleConfig, baseDir);
  } else {
    const enhancedConfig: EnhancedRuleGeneratorConfig = {
      tool: generatorConfig.tool,
      fileExtension: generatorConfig.fileExtension,
      generateContent: generatorConfig.generateContent,
      ...(generatorConfig.ignoreFileName && { ignoreFileName: generatorConfig.ignoreFileName }),
      ...(generatorConfig.generateRootContent && {
        generateRootContent: generatorConfig.generateRootContent,
      }),
      ...(generatorConfig.rootFilePath && { rootFilePath: generatorConfig.rootFilePath }),
      ...(generatorConfig.generateDetailContent && {
        generateDetailContent: generatorConfig.generateDetailContent,
      }),
      ...(generatorConfig.detailSubDir && { detailSubDir: generatorConfig.detailSubDir }),
      ...(generatorConfig.updateAdditionalConfig && {
        updateAdditionalConfig: generatorConfig.updateAdditionalConfig,
      }),
    };

    return generateComplexRules(rules, config, enhancedConfig, baseDir);
  }
}
