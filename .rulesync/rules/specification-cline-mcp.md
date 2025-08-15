---
root: false
targets: ["*"]
description: Cline MCP (Model Context Protocol) configuration specification
globs: []
---

# Cline MCP (Model Context Protocol) Configuration Specification

## File Placement

### Global Configuration (applies to all VS Code workspaces)
- **macOS**: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Windows**: `%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Linux**: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **VS Code Server**: `~/.vscode-server/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

### Per-Project Configuration (overrides/adds to global)
- `.cursor/mcp.json` or `.cline/mcp.json` in workspace root

## File Format

### STDIO (Local) Server Configuration
```json
{
  "mcpServers": {
    "my-local-server": {
      "command": "python",
      "args": ["server.py"],
      "env": { "API_KEY": "..." },
      "alwaysAllow": ["tool1", "tool2"],
      "disabled": false
    }
  }
}
```

### SSE (Remote) Server Configuration
```json
{
  "mcpServers": {
    "remote-server": {
      "url": "https://mcp-example.com/endpoint",
      "headers": { "Authorization": "Bearer ..." },
      "alwaysAllow": [],
      "disabled": false
    }
  }
}
```

## Configuration Fields
- **command**: Executable for STDIO transport
- **args**: Command line arguments array
- **url**: SSE endpoint for remote servers
- **env**: Environment variables merged into child process
- **headers**: HTTP headers sent with SSE requests
- **alwaysAllow**: Array of tool names to auto-approve (skip permission prompt)
- **disabled**: Boolean to disable server without removing config
- **networkTimeout**: Timeout setting (30s - 1h, configurable per server)

## Transport Options
1. **STDIO**: Child process with no network (local servers)
2. **SSE**: Server-Sent Events over HTTP/HTTPS (remote servers)

## Protocol Specification
- **Message format**: JSON-RPC 2.0
- **Required field**: `"jsonrpc": "2.0"` in all messages

### Core Methods
- `tools/list`: Discover available tools
- `tools/call`: Execute a tool with parameters
- `resources/list`: List static context resources (optional)
- `resources/read`: Read resource content (optional)
- `notifications/tools/list_changed`: Server notification when tool list changes

### Tool Object Structure
```json
{
  "name": "tool_name",
  "description": "Tool description",
  "inputSchema": {
    "type": "object",
    "properties": {
      "param1": { "type": "string" }
    },
    "required": ["param1"]
  }
}
```

## Management
- **Access**: Cline → "☰ MCP Servers → Installed → Configure MCP Servers"
- **Reload**: Restart VS Code or use "Restart" in MCP Servers panel
- **Global mode**: Settings → Cline>Mcp:Mode to enable/disable all MCP servers

## Setup Workflow
1. Install/clone MCP server code
2. Test server runs locally
3. Add configuration entry to `cline_mcp_settings.json`
4. Reload VS Code
5. Verify tools appear in MCP Servers panel
6. Use tools in Cline (approve when prompted unless auto-approved)

## Sample Server Implementation (TypeScript)
```typescript
import { Server, ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/server";

const server = new Server({ name: "demo", version: "0.1" });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "say_hello",
    description: "Return 'hello <name>'",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"]
    }
  }]
}));

server.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === "say_hello") {
    return {
      content: [{
        type: "text",
        text: `hello ${req.params.arguments.name}`
      }]
    };
  }
  throw new Error("unknown tool");
});

server.listenStdIO();
```