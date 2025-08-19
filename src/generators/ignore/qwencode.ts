import { join } from "node:path";
import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";

export interface QwenCodeFileFilteringConfig {
  fileFiltering?: {
    respectGitIgnore?: boolean;
    enableRecursiveFileSearch?: boolean;
  };
}

export interface QwenCodeConfig {
  fileFiltering?: QwenCodeFileFilteringConfig["fileFiltering"];
}

/**
 * Extract Qwen Code-specific file filtering configuration from rule content
 */
function extractQwenCodeFileFilteringPatterns(
  content: string,
): QwenCodeFileFilteringConfig["fileFiltering"] {
  const filtering: QwenCodeFileFilteringConfig["fileFiltering"] = {};

  // Extract fileFiltering configuration from rule content
  const configBlocks = content.match(/```(?:json|javascript)\s*\n([\s\S]*?)\n```/g);
  if (configBlocks) {
    for (const block of configBlocks) {
      try {
        const jsonContent = block.replace(/```(?:json|javascript)\s*\n/, "").replace(/\n```$/, "");
        const parsed = JSON.parse(jsonContent);

        if (parsed.fileFiltering) {
          Object.assign(filtering, parsed.fileFiltering);
        }
      } catch {
        // Ignore invalid JSON blocks
      }
    }
  }

  // Look for configuration patterns in text
  if (content.includes("respectGitIgnore")) {
    if (
      content.includes("respectGitIgnore: false") ||
      content.includes('"respectGitIgnore": false')
    ) {
      filtering.respectGitIgnore = false;
    } else {
      filtering.respectGitIgnore = true;
    }
  }

  if (content.includes("enableRecursiveFileSearch")) {
    if (
      content.includes("enableRecursiveFileSearch: false") ||
      content.includes('"enableRecursiveFileSearch": false')
    ) {
      filtering.enableRecursiveFileSearch = false;
    } else {
      filtering.enableRecursiveFileSearch = true;
    }
  }

  return Object.keys(filtering).length > 0 ? filtering : undefined;
}

/**
 * Generate Qwen Code configuration with file filtering settings
 */
function generateQwenCodeConfiguration(rules: ParsedRule[]): QwenCodeConfig {
  const config: QwenCodeConfig = {};

  // Set default file filtering configuration
  config.fileFiltering = {
    respectGitIgnore: true,
    enableRecursiveFileSearch: true,
  };

  // Extract file filtering configurations from rules
  for (const rule of rules) {
    const ruleFiltering = extractQwenCodeFileFilteringPatterns(rule.content);
    if (ruleFiltering) {
      Object.assign(config.fileFiltering, ruleFiltering);
    }
  }

  return config;
}

/**
 * Generate Qwen Code configuration file (.qwen/settings.json)
 * Qwen Code uses git-aware filtering instead of traditional ignore files
 */
export async function generateQwenCodeIgnoreFiles(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];
  const outputPath = baseDir || process.cwd();

  // Generate .qwen/settings.json with file filtering configuration
  const qwenConfig = generateQwenCodeConfiguration(rules);
  const settingsPath = join(outputPath, ".qwen", "settings.json");

  outputs.push({
    tool: "qwencode",
    filepath: settingsPath,
    content: `${JSON.stringify(qwenConfig, null, 2)}\n`,
  });

  return outputs;
}
