import { join } from "node:path";
import type { Config, GeneratedOutput, ParsedRule, ToolTarget } from "../../types/index.js";
import { resolvePath } from "../../utils/file.js";
import { loadIgnorePatterns } from "../../utils/ignore.js";

/**
 * Resolve output directory for a given tool and base directory
 */
export function resolveOutputDir(config: Config, tool: ToolTarget, baseDir?: string): string {
  return resolvePath(config.outputPaths[tool], baseDir);
}

/**
 * Base generator function signature for consistency
 */
export type BaseGeneratorFunction = (
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
) => Promise<GeneratedOutput[]>;

/**
 * Helper to create outputs array and common processing pattern
 */
export function createOutputsArray(): GeneratedOutput[] {
  return [];
}

/**
 * Helper to add output with resolved directory path
 */
export function addOutput(
  outputs: GeneratedOutput[],
  tool: ToolTarget,
  config: Config,
  baseDir: string | undefined,
  relativePath: string,
  content: string,
): void {
  const outputDir = resolveOutputDir(config, tool, baseDir);
  outputs.push({
    tool,
    filepath: join(outputDir, relativePath),
    content,
  });
}

/**
 * Enhanced generator configuration for handling complex rule generation patterns
 */
export interface EnhancedRuleGeneratorConfig {
  tool: ToolTarget;
  fileExtension: string;
  ignoreFileName?: string;
  generateContent: (rule: ParsedRule) => string;
  pathResolver?: (rule: ParsedRule, outputDir: string) => string;
  /** Generate root document content */
  generateRootContent?: (
    rootRule: ParsedRule | undefined,
    detailRules: ParsedRule[],
    baseDir?: string,
  ) => string;
  /** Custom root file path (relative to baseDir) */
  rootFilePath?: string;
  /** Generate memory/detail file content */
  generateDetailContent?: (rule: ParsedRule) => string;
  /** Memory/detail file directory (relative to output dir) */
  detailSubDir?: string;
  /** Update additional configuration files */
  updateAdditionalConfig?: (
    ignorePatterns: string[],
    baseDir?: string,
  ) => Promise<GeneratedOutput[]>;
}

/**
 * Unified configuration interface that supports both simple and complex generation patterns
 */
export interface UnifiedRuleGeneratorConfig {
  tool: ToolTarget;
  fileExtension?: string;
  fileName?: string;
  ignoreFileName?: string;
  generateContent: (rule: ParsedRule) => string;
  pathResolver?: (rule: ParsedRule, outputDir: string) => string;
  /** Generate combined content from all rules */
  generateCombinedContent?: (rules: ParsedRule[]) => string;
  /** Use single file mode instead of per-rule files */
  singleFileMode?: boolean;
}

/**
 * Unified generator for rule files that handles both simple and complex path generation
 * Replaces both generateRulesConfig and generateBaseRulesConfig for consistency
 */
export async function generateRulesConfig(
  rules: ParsedRule[],
  config: Config,
  generatorConfig: UnifiedRuleGeneratorConfig,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];

  // Filter out empty rules
  const nonEmptyRules = rules.filter((rule) => rule.content.trim().length > 0);

  if (nonEmptyRules.length === 0) {
    return outputs;
  }

  if (
    generatorConfig.singleFileMode &&
    generatorConfig.fileName &&
    generatorConfig.generateCombinedContent
  ) {
    // Single file mode (like old generateBaseRulesConfig)
    const filepath = resolvePath(generatorConfig.fileName, baseDir);
    const content = generatorConfig.generateCombinedContent(nonEmptyRules);

    outputs.push({
      tool: generatorConfig.tool,
      filepath,
      content,
    });
  } else if (generatorConfig.fileExtension) {
    // Multiple files mode (like old generateRulesConfig)
    for (const rule of nonEmptyRules) {
      const content = generatorConfig.generateContent(rule);
      const outputDir = resolveOutputDir(config, generatorConfig.tool, baseDir);

      const filepath = generatorConfig.pathResolver
        ? generatorConfig.pathResolver(rule, outputDir)
        : join(outputDir, `${rule.filename}${generatorConfig.fileExtension}`);

      outputs.push({
        tool: generatorConfig.tool,
        filepath,
        content,
      });
    }
  }

  // Generate ignore file if .rulesyncignore exists
  const ignorePatterns = await loadIgnorePatterns(baseDir);
  if (ignorePatterns.patterns.length > 0 && generatorConfig.ignoreFileName) {
    const ignorePath = resolvePath(generatorConfig.ignoreFileName, baseDir);
    const ignoreContent = generateIgnoreFile(ignorePatterns.patterns, generatorConfig.tool);

    outputs.push({
      tool: generatorConfig.tool,
      filepath: ignorePath,
      content: ignoreContent,
    });
  }

  return outputs;
}

/**
 * Complex generator for tools with root + detail file patterns (Claude Code, Gemini CLI, Junie)
 */
export async function generateComplexRules(
  rules: ParsedRule[],
  config: Config,
  generatorConfig: EnhancedRuleGeneratorConfig,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];

  // Separate root and detail rules
  const rootRules = rules.filter((r) => r.frontmatter.root === true);
  const detailRules = rules.filter((r) => r.frontmatter.root === false);
  const rootRule = rootRules[0]; // Take first root rule

  // Generate detail/memory files
  if (generatorConfig.generateDetailContent && generatorConfig.detailSubDir) {
    for (const rule of detailRules) {
      const content = generatorConfig.generateDetailContent(rule);
      const filepath = resolvePath(
        join(generatorConfig.detailSubDir, `${rule.filename}.md`),
        baseDir,
      );

      outputs.push({
        tool: generatorConfig.tool,
        filepath,
        content,
      });
    }
  }

  // Generate root document
  if (generatorConfig.generateRootContent && generatorConfig.rootFilePath) {
    const rootContent = generatorConfig.generateRootContent(rootRule, detailRules, baseDir);
    const rootFilepath = resolvePath(generatorConfig.rootFilePath, baseDir);

    outputs.push({
      tool: generatorConfig.tool,
      filepath: rootFilepath,
      content: rootContent,
    });
  }

  // Handle ignore patterns
  const ignorePatterns = await loadIgnorePatterns(baseDir);
  if (ignorePatterns.patterns.length > 0) {
    // Standard ignore file (skip if ignoreFileName is undefined, e.g., for Claude Code)
    if (generatorConfig.ignoreFileName) {
      const ignorePath = resolvePath(generatorConfig.ignoreFileName, baseDir);

      const ignoreContent = generateIgnoreFile(ignorePatterns.patterns, generatorConfig.tool);

      outputs.push({
        tool: generatorConfig.tool,
        filepath: ignorePath,
        content: ignoreContent,
      });
    }

    // Additional configuration updates (e.g., Claude Code settings.json)
    if (generatorConfig.updateAdditionalConfig) {
      const additionalOutputs = await generatorConfig.updateAdditionalConfig(
        ignorePatterns.patterns,
        baseDir,
      );
      outputs.push(...additionalOutputs);
    }
  }

  return outputs;
}

/**
 * Generate ignore file content with standard header
 */
export function generateIgnoreFile(patterns: string[], tool: ToolTarget): string {
  const lines: string[] = [
    "# Generated by rulesync from .rulesyncignore",
    "# This file is automatically generated. Do not edit manually.",
  ];

  // Add tool-specific comment for unofficial support
  if (tool === "copilot") {
    lines.push("# Note: .copilotignore is not officially supported by GitHub Copilot.");
    lines.push("# This file is for use with community tools like copilotignore-vscode extension.");
  }

  lines.push("");
  lines.push(...patterns);

  return lines.join("\n");
}
