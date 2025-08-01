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
  ignoreFileName: string;
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
    fileExtension: ".md",
    ignoreFileName: ".cursorignore",
    generateContent: (rule) => rule.content.trim(),
  },

  codexcli: {
    type: "simple",
    tool: "codexcli",
    fileExtension: ".md",
    ignoreFileName: ".codexignore",
    generateContent: (rule) => rule.content.trim(),
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
      ignoreFileName: generatorConfig.ignoreFileName,
      generateContent: generatorConfig.generateContent,
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

/**
 * Get the configuration for a specific tool
 */
export function getGeneratorConfig(tool: ToolTarget): GeneratorConfig | undefined {
  return GENERATOR_REGISTRY[tool];
}

/**
 * Get all available tool targets from the registry
 */
export function getAvailableTools(): ToolTarget[] {
  return Object.keys(GENERATOR_REGISTRY).filter(
    (key): key is ToolTarget => key in GENERATOR_REGISTRY,
  );
}

/**
 * Add a new generator configuration to the registry
 */
export function registerGenerator(tool: ToolTarget, config: GeneratorConfig): void {
  GENERATOR_REGISTRY[tool] = config;
}
