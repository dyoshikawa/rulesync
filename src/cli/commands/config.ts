import { writeFileSync } from "node:fs";
import path from "node:path";
import type { ConfigOptions, ToolTarget } from "../../types/index.js";
import { ALL_TOOL_TARGETS, ToolTargetSchema } from "../../types/index.js";
import { generateMinimalConfig, generateSampleConfig, loadConfig } from "../../utils/index.js";

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
  console.log("Loading configuration...\n");

  try {
    const result = await loadConfig();

    if (result.isEmpty) {
      console.log("No configuration file found. Using default configuration.\n");
    } else {
      console.log(`Configuration loaded from: ${result.filepath}\n`);
    }

    console.log("Current configuration:");
    console.log("=====================");

    const config = result.config;

    console.log(`\nAI Rules Directory: ${config.aiRulesDir}`);
    console.log(`\nDefault Targets: ${config.defaultTargets.join(", ")}`);

    if (config.exclude && config.exclude.length > 0) {
      console.log(`Excluded Targets: ${config.exclude.join(", ")}`);
    }

    console.log("\nOutput Paths:");
    for (const [tool, outputPath] of Object.entries(config.outputPaths)) {
      console.log(`  ${tool}: ${outputPath}`);
    }

    if (config.baseDir) {
      const dirs = Array.isArray(config.baseDir) ? config.baseDir : [config.baseDir];
      console.log(`\nBase Directories: ${dirs.join(", ")}`);
    }

    console.log(`\nVerbose: ${config.verbose || false}`);
    console.log(`Delete before generate: ${config.delete || false}`);

    if (config.watch) {
      console.log("\nWatch Configuration:");
      console.log(`  Enabled: ${config.watch.enabled || false}`);
      if (config.watch.interval) {
        console.log(`  Interval: ${config.watch.interval}ms`);
      }
      if (config.watch.ignore && config.watch.ignore.length > 0) {
        console.log(`  Ignore patterns: ${config.watch.ignore.join(", ")}`);
      }
    }

    console.log("\nTip: Use 'rulesync config init' to create a configuration file.");
  } catch (error) {
    console.error(
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
    console.error(
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
        console.error(`❌ Invalid target: ${target}`);
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
        console.error(`❌ Invalid exclude target: ${exclude}`);
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
    console.error(`❌ Configuration file already exists: ${filepath}`);
    console.log("Remove the existing file or choose a different format.");
    process.exit(1);
  } catch {
    // File doesn't exist, we can create it
  }

  try {
    writeFileSync(filepath, content, "utf-8");
    console.log(`✅ Created configuration file: ${filepath}`);
    console.log("\nYou can now customize the configuration to fit your needs.");
    console.log("Run 'rulesync generate' to use the new configuration.");
  } catch (error) {
    console.error(
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
