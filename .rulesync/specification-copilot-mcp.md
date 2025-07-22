---
root: false
targets: ["*"]
description: GitHub Copilot MCP (Model Context Protocol) configuration specification
globs: ["**/*.json", "**/*.ts", "**/*.js"]
---

# GitHub Copilot MCP (Model Context Protocol) Configuration Specification

## Configuration Locations

### A. Copilot Coding Agent (GitHub.com)
- **Location**: Repository → Settings → Code & Automation → Copilot → Coding agent → "MCP configuration"
- **Format**: JSON pasted in UI (not checked into repo)
- **Secrets**: Settings → Environments → `copilot` → Environment secrets (prefix: `COPILOT_MCP_`)

### B. Copilot Chat (Editor)
- **Per-repository**: `.vscode/mcp.json` in repo root (shared with team)
- **Per-user**: `mcp` block in VS Code settings.json (personal)

## File Formats

### Coding Agent JSON (GitHub.com UI)
```json
{
  "mcpServers": {
    "server-name": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp/playwright"],
      "tools": ["*"],
      "type": "local",
      "env": {
        "SENTRY_AUTH_TOKEN": "COPILOT_MCP_SENTRY_AUTH_TOKEN",
        "SENTRY_HOST": "https://contoso.sentry.io"
      }
    }
  }
}
```

#### Fields (Coding Agent)
- **command**: Required executable/command to start server
- **args**: Optional command line arguments array
- **tools**: Strongly recommended tool allowlist (`["*"]` for all)
- **type**: Optional, only `"local"` supported
- **env**: Environment variables (literal values or `COPILOT_MCP_*` secret references)

### Editor/Chat JSON (.vscode/mcp.json or settings.json)
```json
{
  "inputs": [
    {
      "id": "github_token",
      "type": "promptString", 
      "description": "GitHub Personal Access Token",
      "password": true
    }
  ],
  "servers": {
    "github": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${input:github_token}"
      }
    },
    "playwright": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--init", "mcp/playwright"],
      "tools": ["*"]
    }
  }
}
```

#### Fields (Editor/Chat)
- **servers**: Main configuration object (not `mcpServers`)
- **inputs**: Optional prompt-time secrets configuration
- **command**: Executable for STDIO/Docker transport
- **args**: Command line arguments
- **url**: For HTTP/SSE transport (alternative to command)
- **env**: Environment variables with `${input:id}` substitution
- **tools**: Tool allowlist

## Transport Types
1. **STDIO/Docker**: Local processes (use `command` + `args`)
2. **HTTP/SSE**: Remote endpoints (use `url`)

## Secret Management

### Coding Agent
- Use GitHub Environment secrets with `COPILOT_MCP_` prefix
- Reference in `env` object: `"VAR_NAME": "COPILOT_MCP_SECRET_NAME"`

### Editor/Chat
- Define in `inputs` array for prompt-time secrets
- Reference with `${input:secret_id}` syntax
- Set `"password": true` for sensitive inputs

## Usage Patterns

### Docker MCP Server
```json
{
  "servers": {
    "playwright": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--init", "mcp/playwright"],
      "tools": ["*"]
    }
  }
}
```

### GitHub MCP Server with Authentication
```json
{
  "inputs": [
    {
      "id": "github_token",
      "type": "promptString",
      "description": "GitHub PAT",
      "password": true
    }
  ],
  "servers": {
    "github": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${input:github_token}"
      }
    }
  }
}
```

## Management

### Coding Agent
- Configure through GitHub.com UI
- Logs show "Start MCP Servers" step for verification
- Runs in GitHub Actions environment

### Editor/Chat
- Auto-starts when workspace opens
- Use Command Palette: `MCP: Add Server` for guided setup
- Manual editing of JSON files supported

## Best Practices
- Run servers in read-only mode unless write access required
- Store credentials in GitHub secrets or VS Code inputs, never hardcode
- Use explicit tool allowlists instead of `"*"` for security
- For coding agent, add `copilot-setup-steps.yml` in `.github/workflows` if additional binaries needed
- Version control workspace `.vscode/mcp.json` for team consistency
- Test servers locally before deploying to production

## Security Considerations
- Copilot uses MCP servers autonomously
- Explicit tool allowlisting recommended for production
- Secrets should use proper secret management systems
- Read-only access preferred unless write operations required