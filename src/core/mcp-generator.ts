import * as path from "node:path";
import {
  generateAugmentcodeMcp,
  generateClaudeMcp,
  generateClineMcp,
  generateCopilotMcp,
  generateCursorMcp,
  generateGeminiCliMcp,
  generateKiroMcp,
  generateRooMcp,
} from "../generators/mcp/index.js";
import { isToolTarget, type ToolTarget, type ToolTargets } from "../types/index.js";
import type { RulesyncMcpConfig, RulesyncMcpServer } from "../types/mcp.js";
import { writeFileContent } from "../utils/file.js";
import { parseMcpConfig } from "./mcp-parser.js";

export interface McpGenerationResult {
  tool: string;
  path: string;
  status: "success" | "skipped" | "error";
  error?: string;
}

export async function generateMcpConfigs(
  projectRoot: string,
  baseDir?: string,
  targetTools?: ToolTargets,
): Promise<McpGenerationResult[]> {
  const results: McpGenerationResult[] = [];
  const targetRoot = baseDir || projectRoot;

  const config = parseMcpConfig(projectRoot);
  if (!config) {
    return results;
  }

  const generators = [
    {
      tool: "augmentcode-project",
      path: path.join(targetRoot, ".mcp.json"),
      generate: () => generateAugmentcodeMcp(config),
    },
    {
      tool: "augmentcode-legacy-project",
      path: path.join(targetRoot, ".mcp.json"),
      generate: () => generateAugmentcodeMcp(config),
    },
    {
      tool: "claude-project",
      path: path.join(targetRoot, ".mcp.json"),
      generate: () => generateClaudeMcp(config),
    },
    {
      tool: "copilot-editor",
      path: path.join(targetRoot, ".vscode", "mcp.json"),
      generate: () => generateCopilotMcp(config, "editor"),
    },
    {
      tool: "cursor-project",
      path: path.join(targetRoot, ".cursor", "mcp.json"),
      generate: () => generateCursorMcp(config),
    },
    {
      tool: "cline-project",
      path: path.join(targetRoot, ".cline", "mcp.json"),
      generate: () => generateClineMcp(config),
    },
    {
      tool: "gemini-project",
      path: path.join(targetRoot, ".gemini", "settings.json"),
      generate: () => generateGeminiCliMcp(config),
    },
    {
      tool: "kiro-project",
      path: path.join(targetRoot, ".kiro", "mcp.json"),
      generate: () => generateKiroMcp(config),
    },
    {
      tool: "roo-project",
      path: path.join(targetRoot, ".roo", "mcp.json"),
      generate: () => generateRooMcp(config),
    },
  ];

  const filteredGenerators = targetTools
    ? generators.filter((g) => {
        const baseTool = g.tool.split("-")[0];

        if (!isToolTarget(baseTool)) {
          return false;
        }

        // Special case: augmentcode and augmentcode-legacy both map to their respective targets
        if (baseTool === "augmentcode") {
          return targetTools.includes("augmentcode") || targetTools.includes("augmentcode-legacy");
        }

        return targetTools.includes(baseTool);
      })
    : generators;

  for (const generator of filteredGenerators) {
    try {
      const content = generator.generate();
      const parsed = JSON.parse(content);

      if (
        generator.tool.includes("augmentcode") ||
        generator.tool.includes("claude") ||
        generator.tool.includes("cline") ||
        generator.tool.includes("cursor") ||
        generator.tool.includes("gemini") ||
        generator.tool.includes("kiro") ||
        generator.tool.includes("roo")
      ) {
        if (!parsed.mcpServers || Object.keys(parsed.mcpServers).length === 0) {
          results.push({
            tool: generator.tool,
            path: generator.path,
            status: "skipped",
          });
          continue;
        }
      } else if (generator.tool.includes("copilot")) {
        const key = generator.tool.includes("codingAgent") ? "mcpServers" : "servers";
        if (!parsed[key] || Object.keys(parsed[key]).length === 0) {
          results.push({
            tool: generator.tool,
            path: generator.path,
            status: "skipped",
          });
          continue;
        }
      }

      await writeFileContent(generator.path, content);
      results.push({
        tool: generator.tool,
        path: generator.path,
        status: "success",
      });
    } catch (error) {
      results.push({
        tool: generator.tool,
        path: generator.path,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export async function generateMcpConfigurations(
  mcpConfig: RulesyncMcpConfig,
  baseDir: string,
  targetTools?: ToolTargets,
): Promise<Array<{ filepath: string; content: string; tool: string }>> {
  const outputs: Array<{ filepath: string; content: string; tool: string }> = [];

  const toolMap: Record<
    ToolTarget,
    (
      servers: Record<string, RulesyncMcpServer>,
      dir: string,
    ) => Promise<Array<{ filepath: string; content: string }>>
  > = {
    augmentcode: async (servers, dir) =>
      (await import("../generators/mcp/augmentcode.js")).generateAugmentcodeMcpConfiguration(
        servers,
        dir,
      ),
    "augmentcode-legacy": async (servers, dir) =>
      (await import("../generators/mcp/augmentcode.js")).generateAugmentcodeMcpConfiguration(
        servers,
        dir,
      ),
    claudecode: async (servers, dir) =>
      (await import("../generators/mcp/claudecode.js")).generateClaudeMcpConfiguration(
        servers,
        dir,
      ),
    copilot: async (servers, dir) =>
      (await import("../generators/mcp/copilot.js")).generateCopilotMcpConfiguration(servers, dir),
    cursor: async (servers, dir) =>
      (await import("../generators/mcp/cursor.js")).generateCursorMcpConfiguration(servers, dir),
    cline: async (servers, dir) =>
      (await import("../generators/mcp/cline.js")).generateClineMcpConfiguration(servers, dir),
    roo: async (servers, dir) =>
      (await import("../generators/mcp/roo.js")).generateRooMcpConfiguration(servers, dir),
    geminicli: async (servers, dir) =>
      (await import("../generators/mcp/geminicli.js")).generateGeminiCliMcpConfiguration(
        servers,
        dir,
      ),
    kiro: async (servers, dir) =>
      (await import("../generators/mcp/kiro.js")).generateKiroMcpConfiguration(servers, dir),
  };

  const tools = targetTools || Object.keys(toolMap).filter(isToolTarget);

  const seenPaths = new Set<string>();

  for (const tool of tools) {
    if (tool in toolMap) {
      const results = await toolMap[tool](mcpConfig.mcpServers || {}, baseDir);
      for (const result of results) {
        // Skip duplicate file paths (e.g., augmentcode and augmentcode-legacy both generate .mcp.json)
        if (!seenPaths.has(result.filepath)) {
          seenPaths.add(result.filepath);
          outputs.push({ ...result, tool });
        }
      }
    }
  }

  return outputs;
}
