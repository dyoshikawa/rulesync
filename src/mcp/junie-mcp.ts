import { readFile } from "node:fs/promises";
import { z } from "zod/mini";
import type { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import type { RulesyncMcp } from "./rulesync-mcp.js";
import { ToolMcp } from "./tool-mcp.js";

export const JunieServerConfigSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.optional(z.array(z.string())),
  env: z.optional(z.record(z.string(), z.string())),
  workingDirectory: z.optional(z.string()),
  transport: z.optional(z.literal("stdio")),
});

export const JunieConfigSchema = z.object({
  mcpServers: z.record(z.string(), JunieServerConfigSchema),
});

export type JunieServerConfig = z.infer<typeof JunieServerConfigSchema>;
export type JunieConfig = z.infer<typeof JunieConfigSchema>;

interface JunieMcpParams {
  baseDir: string;
  relativeDirPath: string;
  relativeFilePath: string;
  fileContent: string;
  config: JunieConfig;
  validate?: boolean;
}

export class JunieMcp extends ToolMcp {
  readonly toolName = "junie" as const;
  private readonly config: JunieConfig;

  constructor({ config, ...rest }: JunieMcpParams) {
    if (rest.validate !== false) {
      const result = JunieConfigSchema.safeParse(config);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
    });

    this.config = config;
  }

  getFileName(): string {
    return ".junie/mcp_settings.json";
  }

  async generateContent(): Promise<string> {
    return this.serializeToJson(this.config, 2);
  }

  getConfig(): JunieConfig {
    return this.config;
  }

  static fromRulesyncMcp(
    rulesyncMcp: RulesyncMcp,
    baseDir: string = ".",
    relativeDirPath: string = ".",
  ): JunieMcp {
    const rulesyncConfig = rulesyncMcp.toMcpConfig();
    const junieConfig: JunieConfig = { mcpServers: {} };

    for (const [serverName, rulesyncServer] of Object.entries(rulesyncConfig.mcpServers)) {
      if (!rulesyncMcp.shouldIncludeServerForTarget(serverName, "junie")) {
        continue;
      }

      const junieServer: JunieServerConfig = {
        name: serverName,
        command: "",
        transport: "stdio" as const,
      };

      if (rulesyncServer.command !== undefined) {
        if (Array.isArray(rulesyncServer.command)) {
          junieServer.command = rulesyncServer.command[0] || "";
          const restArgs = rulesyncServer.command.slice(1);
          if (restArgs.length > 0) {
            junieServer.args = [...restArgs, ...(rulesyncServer.args || [])];
          } else if (rulesyncServer.args !== undefined) {
            junieServer.args = rulesyncServer.args;
          }
        } else {
          junieServer.command = rulesyncServer.command;
          if (rulesyncServer.args !== undefined) {
            junieServer.args = rulesyncServer.args;
          }
        }
      } else {
        throw new Error(
          `Server "${serverName}": Junie only supports STDIO transport with 'command' field`,
        );
      }

      if (rulesyncServer.env !== undefined) {
        junieServer.env = rulesyncServer.env;
      }

      if (rulesyncServer.cwd !== undefined) {
        junieServer.workingDirectory = rulesyncServer.cwd;
      }

      junieConfig.mcpServers[serverName] = junieServer;
    }

    const fileContent = JSON.stringify(junieConfig, null, 2);

    return new JunieMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".junie/mcp_settings.json",
      fileContent,
      config: junieConfig,
    });
  }

  validate(): ValidationResult {
    try {
      const baseResult = super.validate();
      if (!baseResult.success) {
        return baseResult;
      }

      if (!this.config) {
        return { success: true, error: undefined };
      }

      const result = JunieConfigSchema.safeParse(this.config);
      if (result.success) {
        const serverCount = Object.keys(this.config.mcpServers).length;
        if (serverCount === 0) {
          return {
            success: false,
            error: new Error("At least one MCP server must be defined"),
          };
        }

        for (const [serverName, serverConfig] of Object.entries(this.config.mcpServers)) {
          if (!serverConfig.command) {
            return {
              success: false,
              error: new Error(`Server "${serverName}" must have a 'command' field`),
            };
          }

          if (serverConfig.transport && serverConfig.transport !== "stdio") {
            return {
              success: false,
              error: new Error(`Server "${serverName}": Junie only supports 'stdio' transport`),
            };
          }
        }

        return { success: true, error: undefined };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<JunieMcp> {
    const rawConfig = await this.loadJsonConfig(filePath);

    if (validate) {
      const result = JunieConfigSchema.safeParse(rawConfig);
      if (!result.success) {
        throw new Error(`Invalid Junie MCP configuration in ${filePath}: ${result.error.message}`);
      }
    }

    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const config = rawConfig as JunieConfig;
    const fileContent = await readFile(filePath, "utf-8");

    return new JunieMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent,
      config,
      validate,
    });
  }

  protected getManagementNotes(): string {
    return `JetBrains Junie MCP Server Configuration

## Access Configuration
- Settings/Preferences → Tools → AI Assistant → Model Context Protocol (MCP)
- Alternative: Through Junie settings (same interface)

## Server Management  
- Click "+" → New MCP Server for GUI configuration
- Use "As JSON" option for advanced configuration
- Select Level: Global or Project
- Manual editing not recommended; use IDE settings interface

## Server Operations
- Start/Stop: Manual server control through IDE interface
- Restart: Reload server configuration via IDE
- Status: Green (running), Red (failed), Yellow (starting)
- Logs: Help → Show Log in Explorer → "mcp" subfolder

## Best Practices
- Use Project level for team-shared configurations
- Store secrets in environment variables
- Test configurations in development first
- Document server purposes and requirements`;
  }

  protected getSecurityConsiderations(): string {
    return `JetBrains Junie MCP Security Guidelines

## Environment Variables
- Store sensitive data (API keys, tokens) in environment variables
- Never hardcode secrets in configuration files
- Use IDE's secure storage when available
- Follow \${VAR_NAME} format for variable references

## Command Execution Safety
- Validate command paths and arguments before deployment
- Use absolute paths for executables when possible
- Restrict working directory access appropriately
- Only grant necessary permissions

## Network Security
- Junie currently supports only STDIO transport (local servers)
- Future HTTP/SSE support will require additional security measures
- Configure appropriate firewall rules for external connections

## Access Control
- Review server permissions carefully
- Monitor tool usage patterns
- Implement server-side access controls
- Use logging for audit trails`;
  }
}
