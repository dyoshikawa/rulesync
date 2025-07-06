import * as fs from "node:fs";
import * as path from "node:path";
import { type RulesyncMcpConfig, RulesyncMcpConfigSchema } from "../types/mcp.js";

export function parseMcpConfig(projectRoot: string): RulesyncMcpConfig | null {
  const mcpPath = path.join(projectRoot, ".rulesync", ".mcp.json");

  if (!fs.existsSync(mcpPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(mcpPath, "utf-8");
    const rawConfig = JSON.parse(content);

    // Handle legacy 'servers' field and migrate to 'mcpServers'
    if (rawConfig.servers && !rawConfig.mcpServers) {
      rawConfig.mcpServers = rawConfig.servers;
      delete rawConfig.servers;
    }

    // Remove deprecated 'tools' field if present
    if (rawConfig.tools) {
      delete rawConfig.tools;
    }

    // Validate using zod schema
    const validatedConfig = RulesyncMcpConfigSchema.parse(rawConfig);
    return validatedConfig;
  } catch (error) {
    throw new Error(
      `Failed to parse mcp.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
