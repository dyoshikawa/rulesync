import { join } from "node:path";
import matter from "gray-matter";
import {
  parseClaudeConfiguration,
  parseClineConfiguration,
  parseCopilotConfiguration,
  parseCursorConfiguration,
  parseGeminiConfiguration,
  parseRooConfiguration,
} from "../parsers/index.js";
import type { ParsedRule, ToolTarget } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { fileExists, writeFileContent } from "../utils/index.js";

export interface ImportOptions {
  tool: ToolTarget;
  baseDir?: string;
  rulesDir?: string;
  verbose?: boolean;
}

export interface ImportResult {
  success: boolean;
  rulesCreated: number;
  errors: string[];
  ignoreFileCreated?: boolean;
  mcpFileCreated?: boolean;
}

export async function importConfiguration(options: ImportOptions): Promise<ImportResult> {
  const { tool, baseDir = process.cwd(), rulesDir = ".rulesync", verbose = false } = options;
  const errors: string[] = [];
  let rules: ParsedRule[] = [];
  let ignorePatterns: string[] | undefined;
  let mcpServers: Record<string, RulesyncMcpServer> | undefined;

  if (verbose) {
    console.log(`Importing ${tool} configuration from ${baseDir}...`);
  }

  // Parse configuration based on tool
  try {
    switch (tool) {
      case "claudecode": {
        const claudeResult = await parseClaudeConfiguration(baseDir);
        rules = claudeResult.rules;
        errors.push(...claudeResult.errors);
        ignorePatterns = claudeResult.ignorePatterns;
        mcpServers = claudeResult.mcpServers;
        break;
      }
      case "cursor": {
        const cursorResult = await parseCursorConfiguration(baseDir);
        rules = cursorResult.rules;
        errors.push(...cursorResult.errors);
        ignorePatterns = cursorResult.ignorePatterns;
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
        ignorePatterns = geminiResult.ignorePatterns;
        mcpServers = geminiResult.mcpServers;
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

  if (rules.length === 0 && !ignorePatterns && !mcpServers) {
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

  // Write rule files
  let rulesCreated = 0;
  for (const rule of rules) {
    try {
      const baseFilename = `${tool}__${rule.filename}`;
      const filename = await generateUniqueFilename(rulesDirPath, baseFilename);
      const filePath = join(rulesDirPath, `${filename}.md`);
      const content = generateRuleFileContent(rule);

      await writeFileContent(filePath, content);
      rulesCreated++;

      if (verbose) {
        console.log(`✅ Created rule file: ${filePath}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to create rule file for ${rule.filename}: ${errorMessage}`);
    }
  }

  // Create .rulesyncignore file if ignore patterns exist
  let ignoreFileCreated = false;
  if (ignorePatterns && ignorePatterns.length > 0) {
    try {
      const rulesyncignorePath = join(baseDir, ".rulesyncignore");
      const ignoreContent = `${ignorePatterns.join("\n")}\n`;
      await writeFileContent(rulesyncignorePath, ignoreContent);
      ignoreFileCreated = true;
      if (verbose) {
        console.log(`✅ Created .rulesyncignore with ${ignorePatterns.length} patterns`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to create .rulesyncignore: ${errorMessage}`);
    }
  }

  // Create .mcp.json file if MCP servers exist
  let mcpFileCreated = false;
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    try {
      const mcpPath = join(baseDir, rulesDir, ".mcp.json");
      const mcpContent = `${JSON.stringify({ mcpServers }, null, 2)}\n`;
      await writeFileContent(mcpPath, mcpContent);
      mcpFileCreated = true;
      if (verbose) {
        console.log(`✅ Created .mcp.json with ${Object.keys(mcpServers).length} servers`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to create .mcp.json: ${errorMessage}`);
    }
  }

  return {
    success: errors.length === 0 && (rulesCreated > 0 || ignoreFileCreated || mcpFileCreated),
    rulesCreated,
    errors,
    ignoreFileCreated,
    mcpFileCreated,
  };
}

function generateRuleFileContent(rule: ParsedRule): string {
  const frontmatter = matter.stringify("", rule.frontmatter);
  return frontmatter + rule.content;
}

async function generateUniqueFilename(rulesDir: string, baseFilename: string): Promise<string> {
  let filename = baseFilename;
  let counter = 1;

  while (await fileExists(join(rulesDir, `${filename}.md`))) {
    filename = `${baseFilename}-${counter}`;
    counter++;
  }

  return filename;
}
