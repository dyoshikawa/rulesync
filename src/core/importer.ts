import { join } from "node:path";
import matter from "gray-matter";
import { IgnoreProcessor } from "../ignore/ignore-processor.js";
import { CommandsProcessor } from "../commands/commands-processor.js";
import {
  parseAgentsMdConfiguration,
  parseAmazonqcliConfiguration,
  parseAugmentcodeConfiguration,
  parseAugmentcodeLegacyConfiguration,
  parseClaudeConfiguration,
  parseClineConfiguration,
  parseCopilotConfiguration,
  parseCursorConfiguration,
  parseGeminiConfiguration,
  parseJunieConfiguration,
  parseOpenCodeConfiguration,
  parseQwenConfiguration,
  parseRooConfiguration,
} from "../parsers/index.js";
import { SubagentsProcessor } from "../subagents/subagents-processor.js";
import type { FeatureType } from "../types/config-options.js";
import type { ParsedRule, ToolTarget } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import type { ParsedSubagent } from "../types/subagent.js";
import { writeFileContent } from "../utils/index.js";
import { logger } from "../utils/logger.js";

export interface ImportOptions {
  tool: ToolTarget;
  features?: FeatureType[];
  baseDir?: string;
  rulesDir?: string;
  verbose?: boolean;
  useLegacyLocation?: boolean;
}

export interface ImportResult {
  success: boolean;
  rulesCreated: number;
  errors: string[];
  ignoreFileCreated?: boolean;
  mcpFileCreated?: boolean;
  subagentsCreated?: number | undefined;
  commandsCreated?: number | undefined;
}

export async function importConfiguration(options: ImportOptions): Promise<ImportResult> {
  const {
    tool,
    features = ["rules", "commands", "mcp", "ignore", "subagents"], // Default to all features for backward compatibility
    baseDir = process.cwd(),
    rulesDir = ".rulesync",
    verbose = false,
    useLegacyLocation = false,
  } = options;
  const errors: string[] = [];
  let rules: ParsedRule[] = [];
  let mcpServers: Record<string, RulesyncMcpServer> | undefined;
  let subagents: ParsedSubagent[] | undefined;

  if (verbose) {
    logger.log(`Importing ${tool} configuration from ${baseDir}...`);
  }

  // Parse configuration based on tool
  try {
    switch (tool) {
      case "agentsmd": {
        const agentsmdResult = await parseAgentsMdConfiguration(baseDir);
        rules = agentsmdResult.rules;
        errors.push(...agentsmdResult.errors);
        break;
      }
      case "amazonqcli": {
        const amazonqResult = await parseAmazonqcliConfiguration(baseDir);
        rules = amazonqResult.rules;
        errors.push(...amazonqResult.errors);
        mcpServers = amazonqResult.mcpServers;
        break;
      }
      case "augmentcode": {
        const augmentResult = await parseAugmentcodeConfiguration(baseDir);
        rules = augmentResult.rules;
        errors.push(...augmentResult.errors);
        break;
      }
      case "augmentcode-legacy": {
        const augmentLegacyResult = await parseAugmentcodeLegacyConfiguration(baseDir);
        rules = augmentLegacyResult.rules;
        errors.push(...augmentLegacyResult.errors);
        break;
      }
      case "claudecode": {
        const claudeResult = await parseClaudeConfiguration(baseDir);
        rules = claudeResult.rules;
        errors.push(...claudeResult.errors);
        mcpServers = claudeResult.mcpServers;
        subagents = claudeResult.subagents;
        break;
      }
      case "cursor": {
        const cursorResult = await parseCursorConfiguration(baseDir);
        rules = cursorResult.rules;
        errors.push(...cursorResult.errors);
        mcpServers = cursorResult.mcpServers;
        break;
      }
      case "copilot": {
        const copilotResult = await parseCopilotConfiguration(baseDir);
        rules = copilotResult.rules;
        errors.push(...copilotResult.errors);
        break;
      }
      case "cline": {
        const clineResult = await parseClineConfiguration(baseDir);
        rules = clineResult.rules;
        errors.push(...clineResult.errors);
        break;
      }
      case "roo": {
        const rooResult = await parseRooConfiguration(baseDir);
        rules = rooResult.rules;
        errors.push(...rooResult.errors);
        break;
      }
      case "geminicli": {
        const geminiResult = await parseGeminiConfiguration(baseDir);
        rules = geminiResult.rules;
        errors.push(...geminiResult.errors);
        mcpServers = geminiResult.mcpServers;
        break;
      }
      case "junie": {
        const junieResult = await parseJunieConfiguration(baseDir);
        rules = junieResult.rules;
        errors.push(...junieResult.errors);
        break;
      }
      case "opencode": {
        const opencodeResult = await parseOpenCodeConfiguration(baseDir);
        rules = opencodeResult.rules;
        errors.push(...opencodeResult.errors);
        mcpServers = opencodeResult.mcpServers;
        break;
      }
      case "qwencode": {
        const qwenResult = await parseQwenConfiguration(baseDir);
        rules = qwenResult.rules;
        errors.push(...qwenResult.errors);
        mcpServers = qwenResult.mcpServers;
        break;
      }
      default:
        errors.push(`Unsupported tool: ${tool}`);
        return { success: false, rulesCreated: 0, errors };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to parse ${tool} configuration: ${errorMessage}`);
    return { success: false, rulesCreated: 0, errors };
  }

  // Check if no relevant features are enabled
  const rulesEnabled = features.includes("rules") || features.includes("commands");
  const ignoreEnabled = features.includes("ignore");
  const mcpEnabled = features.includes("mcp");
  const subagentsEnabled = features.includes("subagents");

  if (!rulesEnabled && !ignoreEnabled && !mcpEnabled && !subagentsEnabled) {
    if (verbose) {
      logger.log("No relevant features enabled for import");
    }
    return { success: false, rulesCreated: 0, errors: ["No features enabled for import"] };
  }

  // Early return if no data found and ignore feature is not enabled
  if (rules.length === 0 && !mcpServers && !subagents && !ignoreEnabled) {
    return { success: false, rulesCreated: 0, errors };
  }

  // Ensure .rulesync directory exists
  const rulesDirPath = join(baseDir, rulesDir);
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(rulesDirPath, { recursive: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to create rules directory: ${errorMessage}`);
    return { success: false, rulesCreated: 0, errors };
  }

  // Write rule files (only if rules feature is enabled, commands handled separately by CommandsProcessor)
  let rulesCreated = 0;
  if (features.includes("rules")) {
    // Filter out commands as they are now handled by CommandsProcessor
    const regularRules = rules.filter((rule) => rule.type !== "command");

    for (const rule of regularRules) {
      try {
        const baseFilename = rule.filename;
        let targetDir = rulesDirPath;

        // For regular rules, use legacy location or new location based on option
        if (!useLegacyLocation) {
          targetDir = join(rulesDirPath, "rules");
          const { mkdir } = await import("node:fs/promises");
          await mkdir(targetDir, { recursive: true });
        }

        const filePath = join(targetDir, `${baseFilename}.md`);
        const content = generateRuleFileContent(rule);

        await writeFileContent(filePath, content);
        rulesCreated++;

        if (verbose) {
          logger.success(`Created rule file: ${filePath}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to create rule file for ${rule.filename}: ${errorMessage}`);
      }
    }
  } else {
    if (verbose && rules.filter((rule) => rule.type !== "command").length > 0) {
      logger.log(
        `Skipping ${rules.filter((rule) => rule.type !== "command").length} rule(s) (rules feature not enabled)`,
      );
    }
  }

  // Process ignore files if ignore feature is enabled
  let ignoreFileCreated = false;
  if (ignoreEnabled) {
    try {
      // Use IgnoreProcessor for supported tools
      if (IgnoreProcessor.getToolTargets().includes(tool)) {
        const ignoreProcessor = new IgnoreProcessor({
          baseDir,
          toolTarget: tool,
        });

        const toolFiles = await ignoreProcessor.loadToolFiles();
        if (toolFiles.length > 0) {
          const rulesyncFiles = await ignoreProcessor.convertToolFilesToRulesyncFiles(toolFiles);
          await ignoreProcessor.writeAiFiles(rulesyncFiles);
          ignoreFileCreated = true;
          if (verbose) {
            logger.success(
              `Created ignore files from ${toolFiles.length} tool ignore configurations`,
            );
          }
        }
      } else if (verbose) {
        logger.log(`Tool ${tool} does not support ignore file processing`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to process ignore files: ${errorMessage}`);
    }
  }

  // Create .mcp.json file if MCP servers exist and mcp feature is enabled
  let mcpFileCreated = false;
  if (mcpEnabled && mcpServers && Object.keys(mcpServers).length > 0) {
    try {
      const mcpPath = join(baseDir, rulesDir, ".mcp.json");
      const mcpContent = `${JSON.stringify({ mcpServers }, null, 2)}\n`;
      await writeFileContent(mcpPath, mcpContent);
      mcpFileCreated = true;
      if (verbose) {
        logger.success(`Created .mcp.json with ${Object.keys(mcpServers).length} servers`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to create .mcp.json: ${errorMessage}`);
    }
  } else if (verbose && mcpServers && Object.keys(mcpServers).length > 0 && !mcpEnabled) {
    logger.log(`Skipping MCP configuration (mcp feature not enabled)`);
  }

  // Create subagent files if subagents feature is enabled
  let subagentsCreated = 0;
  if (subagentsEnabled) {
    try {
      // Use SubagentsProcessor for supported tools
      if (SubagentsProcessor.getToolTargets().includes(tool)) {
        const subagentsProcessor = new SubagentsProcessor({
          baseDir,
          toolTarget: tool,
        });

        const toolFiles = await subagentsProcessor.loadToolFiles();
        if (toolFiles.length > 0) {
          const rulesyncFiles = await subagentsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
          const writtenCount = await subagentsProcessor.writeAiFiles(rulesyncFiles);
          subagentsCreated += writtenCount;
        }
      }

      if (verbose && subagentsCreated > 0) {
        logger.success(`Created ${subagentsCreated} subagent files`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to create subagents directory: ${errorMessage}`);
    }
  } else if (verbose && subagents && subagents.length > 0) {
    logger.log(`Skipping subagents (subagents feature not enabled)`);
  }

  // Create command files using CommandsProcessor if commands feature is enabled
  let commandsCreated = 0;
  if (features.includes("commands")) {
    try {
      // Use CommandsProcessor for supported tools
      if (CommandsProcessor.getToolTargets().includes(tool)) {
        const commandsProcessor = new CommandsProcessor({
          baseDir,
          toolTarget: tool,
        });

        const toolFiles = await commandsProcessor.loadToolFiles();
        if (toolFiles.length > 0) {
          const rulesyncFiles = await commandsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
          const writtenCount = await commandsProcessor.writeAiFiles(rulesyncFiles);
          commandsCreated = writtenCount;
        }
      }

      if (verbose && commandsCreated > 0) {
        logger.success(`Created ${commandsCreated} command files`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to create commands directory: ${errorMessage}`);
    }
  }

  const result: ImportResult = {
    success:
      errors.length === 0 &&
      (rulesCreated > 0 ||
        ignoreFileCreated ||
        mcpFileCreated ||
        subagentsCreated > 0 ||
        commandsCreated > 0),
    rulesCreated,
    errors,
    ignoreFileCreated,
    mcpFileCreated,
    subagentsCreated: subagentsCreated > 0 ? subagentsCreated : undefined,
    commandsCreated: commandsCreated > 0 ? commandsCreated : undefined,
  };

  return result;
}

function generateRuleFileContent(rule: ParsedRule): string {
  // Commands are now handled by CommandsProcessor, this function only handles regular rules
  const frontmatter = matter.stringify("", rule.frontmatter);
  return frontmatter + rule.content;
}
