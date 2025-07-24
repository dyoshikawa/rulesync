import { loadConfig as loadC12Config } from "c12";
import { $ZodError } from "zod/v4/core";
import type { ConfigOptions, MergedConfig, ToolTarget } from "../types/index.js";
import { ALL_TOOL_TARGETS, ConfigOptionsSchema } from "../types/index.js";
import { getDefaultConfig } from "./config.js";

const MODULE_NAME = "rulesync";

export interface ConfigLoaderOptions {
  configPath?: string;
  noConfig?: boolean;
  cwd?: string;
}

export interface ConfigLoadResult {
  config: MergedConfig;
  filepath?: string;
  isEmpty: boolean;
}

export async function loadConfig(options: ConfigLoaderOptions = {}): Promise<ConfigLoadResult> {
  const defaultConfig = getDefaultConfig();

  if (options.noConfig) {
    return {
      config: defaultConfig,
      isEmpty: true,
    };
  }

  try {
    const loadOptions: Parameters<typeof loadC12Config>[0] = {
      name: MODULE_NAME,
      cwd: options.cwd || process.cwd(),
      rcFile: false, // Disable rc file lookup
      configFile: "rulesync", // Will look for rulesync.jsonc, rulesync.ts, etc.

      defaults: defaultConfig,
    };

    if (options.configPath) {
      loadOptions.configFile = options.configPath;
    }

    // @ts-expect-error - c12 type definitions are not fully compatible with our config structure
    const { config, configFile } = await loadC12Config<MergedConfig>(loadOptions);

    if (!config || Object.keys(config).length === 0) {
      return {
        config: defaultConfig,
        isEmpty: true,
      };
    }

    try {
      ConfigOptionsSchema.parse(config);
    } catch (error) {
      if (error instanceof $ZodError) {
        const issues = error.issues
          .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
          .join("\n");
        throw new Error(`Invalid configuration in ${configFile}:\n${issues}`);
      }
      throw error;
    }

    const processedConfig = postProcessConfig(config);

    const result: ConfigLoadResult = {
      config: processedConfig,
      isEmpty: false,
    };

    if (configFile) {
      result.filepath = configFile;
    }

    return result;
  } catch (error) {
    throw new Error(
      `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function postProcessConfig(config: MergedConfig): MergedConfig {
  const processed = { ...config };

  if (processed.baseDir && !Array.isArray(processed.baseDir)) {
    processed.baseDir = [processed.baseDir];
  }

  if (config.targets || config.exclude) {
    const baseTargets = config.targets || processed.defaultTargets;
    if (config.exclude && config.exclude.length > 0) {
      processed.defaultTargets = baseTargets.filter(
        (target) => config.exclude && !config.exclude.includes(target),
      );
    } else {
      processed.defaultTargets = baseTargets;
    }
  }

  return processed;
}

export function generateMinimalConfig(options?: Partial<ConfigOptions>): string {
  if (!options || Object.keys(options).length === 0) {
    return generateSampleConfig();
  }

  const lines: string[] = ["{"];

  if (options.targets || options.exclude) {
    lines.push(`  // Available tools: ${ALL_TOOL_TARGETS.join(", ")}`);
  }

  if (options.targets) {
    lines.push(`  "targets": ${JSON.stringify(options.targets)}`);
  }

  if (options.exclude) {
    const comma = lines.length > 1 ? "," : "";
    if (comma) lines[lines.length - 1] += comma;
    lines.push(`  "exclude": ${JSON.stringify(options.exclude)}`);
  }

  if (options.aiRulesDir) {
    const comma = lines.length > 1 ? "," : "";
    if (comma) lines[lines.length - 1] += comma;
    lines.push(`  "aiRulesDir": "${options.aiRulesDir}"`);
  }

  if (options.outputPaths) {
    const comma = lines.length > 1 ? "," : "";
    if (comma) lines[lines.length - 1] += comma;
    lines.push(
      `  "outputPaths": ${JSON.stringify(options.outputPaths, null, 4)
        .split("\n")
        .map((line, i) => (i === 0 ? line : `  ${line}`))
        .join("\n")}`,
    );
  }

  if (options.baseDir) {
    const comma = lines.length > 1 ? "," : "";
    if (comma) lines[lines.length - 1] += comma;
    lines.push(`  "baseDir": ${JSON.stringify(options.baseDir)}`);
  }

  if (options.delete !== undefined) {
    const comma = lines.length > 1 ? "," : "";
    if (comma) lines[lines.length - 1] += comma;
    lines.push(`  "delete": ${options.delete}`);
  }

  if (options.verbose !== undefined) {
    const comma = lines.length > 1 ? "," : "";
    if (comma) lines[lines.length - 1] += comma;
    lines.push(`  "verbose": ${options.verbose}`);
  }

  if (options.watch) {
    const comma = lines.length > 1 ? "," : "";
    if (comma) lines[lines.length - 1] += comma;
    lines.push(
      `  "watch": ${JSON.stringify(options.watch, null, 4)
        .split("\n")
        .map((line, i) => (i === 0 ? line : `  ${line}`))
        .join("\n")}`,
    );
  }

  lines.push("}");
  return lines.join("\n");
}

export function generateSampleConfig(options?: Partial<ConfigOptions>): string {
  const targets = options?.targets || ALL_TOOL_TARGETS;
  const excludeValue = options?.exclude ? JSON.stringify(options.exclude) : null;
  const aiRulesDir = options?.aiRulesDir || null;
  const baseDir = options?.baseDir || null;
  const deleteFlag = options?.delete || false;
  const verbose = options?.verbose !== undefined ? options.verbose : true;

  return `{
  // List of tools to generate configurations for
  // Available: ${ALL_TOOL_TARGETS.join(", ")}
  "targets": ${JSON.stringify(targets)},
  
  // Tools to exclude from generation (overrides targets)
  ${excludeValue ? `"exclude": ${excludeValue},` : '// "exclude": ["roo"],'}
  ${
    aiRulesDir
      ? `
  // Directory containing AI rule files
  "aiRulesDir": "${aiRulesDir}",`
      : ""
  }
  
  // Custom output paths for specific tools
  "outputPaths": {
    "copilot": ".github/copilot-instructions.md"
  },
  ${
    baseDir
      ? `
  // Base directory for generation
  "baseDir": "${baseDir}",`
      : `
  // Base directory or directories for generation
  // "baseDir": "./packages",
  // "baseDir": ["./packages/frontend", "./packages/backend"],`
  }
  
  // Delete existing files before generating
  "delete": ${deleteFlag},
  
  // Enable verbose output
  "verbose": ${verbose},
  
  // Watch configuration
  "watch": {
    "enabled": false,
    "interval": 1000,
    "ignore": ["node_modules/**", "dist/**"]
  }
}
`;
}

export function mergeWithCliOptions(
  config: MergedConfig,
  cliOptions: {
    tools?: ToolTarget[];
    verbose?: boolean;
    delete?: boolean;
    baseDirs?: string[];
  },
): MergedConfig {
  const merged: MergedConfig = { ...config };

  if (cliOptions.verbose !== undefined) {
    merged.verbose = cliOptions.verbose;
  }

  if (cliOptions.delete !== undefined) {
    merged.delete = cliOptions.delete;
  }

  if (cliOptions.baseDirs && cliOptions.baseDirs.length > 0) {
    merged.baseDir = cliOptions.baseDirs;
  }

  if (cliOptions.tools && cliOptions.tools.length > 0) {
    merged.defaultTargets = cliOptions.tools;
    merged.exclude = undefined;
  }

  return merged;
}
