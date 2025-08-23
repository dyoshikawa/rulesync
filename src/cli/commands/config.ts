import { writeFileSync } from "node:fs";
import path from "node:path";
import type { ConfigOptions, ToolTarget } from "../../types/index.js";
import { ALL_TOOL_TARGETS, ToolTargetSchema } from "../../types/index.js";
import { generateMinimalConfig, generateSampleConfig, loadConfig } from "../../utils/index.js";
import { logger } from "../../utils/logger.js";

export interface ConfigCommandOptions {
  init?: boolean;
  format?: ConfigFormat;
  targets?: string;
  exclude?: string;
  aiRulesDir?: string;
  baseDir?: string;
  verbose?: boolean;
  delete?: boolean;
}

export async function configCommand(options: ConfigCommandOptions = {}): Promise<void> {
  if (options.init) {
    await initConfig(options);
    return;
  }

  await showConfig();
}

async function showConfig(): Promise<void> {
  logger.log("Loading configuration...\n");

  try {
    const result = await loadConfig();

    if (result.isEmpty) {
      logger.log("No configuration file found. Using default configuration.\n");
    } else {
      logger.log(`Configuration loaded from: ${result.filepath}\n`);
    }

    logger.log("Current configuration:");
    logger.log("=====================");

    const config = result.config;

    logger.log(`\nAI Rules Directory: ${config.aiRulesDir}`);
    logger.log(`\nDefault Targets: ${config.defaultTargets.join(", ")}`);

    if (config.exclude && config.exclude.length > 0) {
      logger.log(`Excluded Targets: ${config.exclude.join(", ")}`);
    }

    if (config.features) {
      const featuresDisplay =
        config.features === "*"
          ? "*"
          : Array.isArray(config.features)
            ? config.features.join(", ")
            : String(config.features);
      logger.log(`\nFeatures: ${featuresDisplay}`);
    }

    logger.log("\nOutput Paths:");
    for (const [tool, outputPath] of Object.entries(config.outputPaths)) {
      logger.log(`  ${tool}: ${outputPath}`);
    }

    if (config.baseDir) {
      const dirs = Array.isArray(config.baseDir) ? config.baseDir : [config.baseDir];
      logger.log(`\nBase Directories: ${dirs.join(", ")}`);
    }

    logger.log(`\nVerbose: ${config.verbose || false}`);
    logger.log(`Delete before generate: ${config.delete || false}`);

    if (config.watch) {
      logger.log("\nWatch Configuration:");
      logger.log(`  Enabled: ${config.watch.enabled || false}`);
      if (config.watch.interval) {
        logger.log(`  Interval: ${config.watch.interval}ms`);
      }
      if (config.watch.ignore && config.watch.ignore.length > 0) {
        logger.log(`  Ignore patterns: ${config.watch.ignore.join(", ")}`);
      }
    }

    logger.log("\nTip: Use 'rulesync config init' to create a configuration file.");
  } catch (error) {
    logger.error(
      "❌ Failed to load configuration:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

/**
 * Format-specific configuration for file generation
 */
const FORMAT_CONFIG = {
  jsonc: {
    filename: "rulesync.jsonc",
    generator: generateJsoncConfig,
  },
  ts: {
    filename: "rulesync.ts",
    generator: generateTsConfig,
  },
} as const;
type ConfigFormat = keyof typeof FORMAT_CONFIG;

async function initConfig(options: ConfigCommandOptions): Promise<void> {
  const validFormats = Object.keys(FORMAT_CONFIG);
  const selectedFormat = options.format || "jsonc";

  if (!validFormats.includes(selectedFormat)) {
    logger.error(
      `❌ Invalid format: ${selectedFormat}. Valid formats are: ${validFormats.join(", ")}`,
    );
    process.exit(1);
  }

  const formatConfig = FORMAT_CONFIG[selectedFormat];
  const filename = formatConfig.filename;

  const configOptions: Partial<ConfigOptions> = {};

  if (options.targets) {
    const targets = options.targets.split(",").map((t) => t.trim());
    const validTargets: ToolTarget[] = [];
    for (const target of targets) {
      const result = ToolTargetSchema.safeParse(target);
      if (result.success) {
        validTargets.push(result.data);
      } else {
        logger.error(`❌ Invalid target: ${target}`);
        process.exit(1);
      }
    }
    configOptions.targets = validTargets;
  }

  if (options.exclude) {
    const excludes = options.exclude.split(",").map((t) => t.trim());
    const validExcludes: ToolTarget[] = [];
    for (const exclude of excludes) {
      const result = ToolTargetSchema.safeParse(exclude);
      if (result.success) {
        validExcludes.push(result.data);
      } else {
        logger.error(`❌ Invalid exclude target: ${exclude}`);
        process.exit(1);
      }
    }
    configOptions.exclude = validExcludes;
  }

  if (options.aiRulesDir) {
    configOptions.aiRulesDir = options.aiRulesDir;
  }

  if (options.baseDir) {
    configOptions.baseDir = options.baseDir;
  }

  if (options.verbose !== undefined) {
    configOptions.verbose = options.verbose;
  }

  if (options.delete !== undefined) {
    configOptions.delete = options.delete;
  }

  const content = formatConfig.generator(configOptions);
  const filepath = path.join(process.cwd(), filename);

  try {
    const fs = await import("node:fs/promises");
    await fs.access(filepath);
    logger.error(`❌ Configuration file already exists: ${filepath}`);
    logger.log("Remove the existing file or choose a different format.");
    process.exit(1);
  } catch {
    // File doesn't exist, we can create it
  }

  try {
    writeFileSync(filepath, content, "utf-8");
    logger.success(`Created configuration file: ${filepath}`);
    logger.log("\nYou can now customize the configuration to fit your needs.");
    logger.log("Run 'rulesync generate' to use the new configuration.");
  } catch (error) {
    logger.error(
      `❌ Failed to create configuration file: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

function generateJsoncConfig(options?: Partial<ConfigOptions>): string {
  // If options were provided via CLI, generate minimal config
  if (options && Object.keys(options).length > 0) {
    return generateMinimalConfig(options);
  }

  return generateSampleConfig(options);
}

function generateTsConfig(options?: Partial<ConfigOptions>): string {
  if (!options || Object.keys(options).length === 0) {
    return `import type { ConfigOptions } from "rulesync";

const config: ConfigOptions = {
  // List of tools to generate configurations for
  // Available: ${ALL_TOOL_TARGETS.join(", ")}
  targets: ${JSON.stringify(ALL_TOOL_TARGETS)},
  
  // Features to generate (rules, commands, mcp, ignore, subagents)
  // Use "*" to generate all features, or specify an array of features
  features: ["rules", "commands", "mcp", "ignore", "subagents"],
  
  // Custom output paths for specific tools
  // outputPaths: {
  //   copilot: ".github/copilot-instructions.md",
  // },
  
  // Delete existing files before generating
  // delete: false,
  
  // Enable verbose output
  verbose: true,
};

export default config;`;
  }

  const configLines: string[] = [];

  if (options.targets) {
    configLines.push(`  targets: ${JSON.stringify(options.targets)}`);
  }

  if (options.exclude) {
    configLines.push(`  exclude: ${JSON.stringify(options.exclude)}`);
  }

  if (options.features) {
    configLines.push(`  features: ${JSON.stringify(options.features)}`);
  }

  if (options.aiRulesDir) {
    configLines.push(`  aiRulesDir: "${options.aiRulesDir}"`);
  }

  if (options.outputPaths) {
    const pathsStr = JSON.stringify(options.outputPaths, null, 4)
      .split("\n")
      .map((line, i) => (i === 0 ? line : `  ${line}`))
      .join("\n");
    configLines.push(`  outputPaths: ${pathsStr}`);
  }

  if (options.baseDir) {
    configLines.push(`  baseDir: ${JSON.stringify(options.baseDir)}`);
  }

  if (options.delete !== undefined) {
    configLines.push(`  delete: ${options.delete}`);
  }

  if (options.verbose !== undefined) {
    configLines.push(`  verbose: ${options.verbose}`);
  }

  if (options.watch) {
    const watchStr = JSON.stringify(options.watch, null, 4)
      .split("\n")
      .map((line, i) => (i === 0 ? line : `  ${line}`))
      .join("\n");
    configLines.push(`  watch: ${watchStr}`);
  }

  const configContent = `import type { ConfigOptions } from "rulesync";

const config: ConfigOptions = {
${configLines.join(",\n")},
};

export default config;
`;

  return configContent;
}
