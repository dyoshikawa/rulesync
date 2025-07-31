---
root: false
targets: ["*"]
description: "OpenAI Codex CLI MCP (Model Context Protocol) server configuration specification"
globs: ["**/*.json", "**/*.toml", "**/*.yaml", "**/*.yml", "**/*.js", "**/*.ts"]
---

# OpenAI Codex CLI MCP (Model Context Protocol) Configuration Specification

## Overview
OpenAI Codex CLI supports Model Context Protocol (MCP) integration through third-party MCP servers that wrap the Codex CLI functionality. MCP enables standardized communication between AI tools and external services, allowing Codex CLI to be exposed as a tool to other MCP-compatible clients.

## Architecture Pattern

### MCP Server Wrapper
Since OpenAI Codex CLI doesn't natively implement MCP server functionality, integration requires a wrapper server that:
1. Exposes Codex CLI functionality through MCP protocol
2. Handles JSON-RPC communication with MCP clients
3. Manages Codex CLI process lifecycle and communication
4. Translates MCP requests to Codex CLI commands

### Communication Flow
```
MCP Client (Claude Code, IDE) 
    ↓ JSON-RPC over stdio/HTTP
MCP Server (Wrapper)
    ↓ Command execution
OpenAI Codex CLI
    ↓ OpenAI API calls
OpenAI Models (GPT-4, o1-mini, etc.)
```

## MCP Server Implementation Options

### 1. Python-based MCP Server
**Repository**: `agency-ai-solutions/openai-codex-mcp`

#### Installation and Setup
```bash
# Clone the repository
git clone https://github.com/agency-ai-solutions/openai-codex-mcp.git
cd openai-codex-mcp

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # Windows: .\.venv\Scripts\activate

# Install dependencies
pip install -U pip wheel
pip install -e .  # or use uv: uv pip install .
```

#### Configuration File (.env)
```bash
# Required environment variables
OPENAI_API_KEY=sk-...
CODEX_DEFAULT_MODEL=gpt-4o-mini
PORT=8000

# Optional configurations
CODEX_APPROVAL_MODE=suggest
CODEX_FULL_AUTO_ERROR_MODE=ask-user
CODEX_NOTIFY=true
DEBUG=false
```

#### Server Startup
```bash
# Using helper script
./setup_and_run.sh

# Manual startup
codex_server
# or
uvicorn codex_server:app --port 8000 --host 127.0.0.1
```

### 2. Node.js/TypeScript MCP Server
**Repository**: `rmulligan/mcp-openai-codex`

#### Installation and Setup
```bash
# Clone the repository  
git clone https://github.com/rmulligan/mcp-openai-codex.git
cd mcp-openai-codex

# Install dependencies
npm install
# or
pnpm install

# Build TypeScript
npm run build
```

#### Configuration
```json
{
  "openai": {
    "apiKey": "sk-...",
    "defaultModel": "gpt-4o-mini"
  },
  "codex": {
    "approvalMode": "suggest",
    "fullAutoErrorMode": "ask-user",
    "notify": true
  },
  "server": {
    "port": 8000,
    "host": "127.0.0.1"
  }
}
```

#### Server Startup
```bash
# Development mode
npm run dev

# Production mode
npm start
# or
node dist/index.js
```

## MCP Client Configuration

### Claude Code Integration

#### Method 1: CLI Configuration
```bash
# Add MCP server to Claude Code
claude mcp add codex-cli '{"type":"stdio","command":"codex_server"}'

# Or specify full path configuration
claude mcp add codex-cli '{
  "type": "stdio",
  "command": "/path/to/.venv/bin/codex_server",
  "env": {
    "OPENAI_API_KEY": "sk-...",
    "CODEX_DEFAULT_MODEL": "gpt-4o-mini"
  }
}'
```

#### Method 2: Configuration File
Create or update `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "codex-cli": {
      "command": "codex_server",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "CODEX_DEFAULT_MODEL": "gpt-4o-mini"
      }
    }
  }
}
```

### Other MCP Clients

#### Generic MCP Client Configuration
```json
{
  "servers": {
    "openai-codex": {
      "transport": "stdio",
      "command": "codex_server",
      "args": [],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "CODEX_DEFAULT_MODEL": "gpt-4o-mini"
      },
      "timeout": 30000
    }
  }
}
```

#### HTTP/SSE Transport Configuration
```json
{
  "servers": {
    "openai-codex": {
      "transport": "http",
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  }
}
```

## MCP Tool Manifest

### Available Tools
The MCP server exposes the following tools wrapping Codex CLI functionality:

#### 1. `write_code`
Generate code based on natural language description.

**Parameters**:
```json
{
  "task": "string",        // Required: Description of the code to generate
  "language": "string",    // Optional: Target programming language
  "model": "string",       // Optional: Override default model
  "context": "string"      // Optional: Additional context/constraints
}
```

**Example**:
```json
{
  "task": "Create a REST API endpoint for user authentication",
  "language": "typescript",
  "model": "gpt-4o",
  "context": "Using Express.js and JWT tokens"
}
```

#### 2. `explain_code`
Explain existing code functionality and structure.

**Parameters**:
```json
{
  "code": "string",        // Required: Code to explain
  "language": "string",    // Optional: Programming language
  "focus": "string"        // Optional: Specific aspect to focus on
}
```

#### 3. `debug_code`
Debug and fix issues in provided code.

**Parameters**:
```json
{
  "code": "string",        // Required: Code with issues
  "error": "string",       // Optional: Error message or description
  "language": "string",    // Optional: Programming language
  "context": "string"      // Optional: Additional debugging context
}
```

#### 4. `refactor_code`
Refactor code for better structure, performance, or maintainability.

**Parameters**:
```json
{
  "code": "string",        // Required: Code to refactor
  "goals": "string",       // Required: Refactoring objectives
  "language": "string",    // Optional: Programming language
  "constraints": "string"  // Optional: Refactoring constraints
}
```

### Tool Response Format
All tools return responses in the following format:
```json
{
  "success": true,
  "result": "Generated/processed code",
  "explanation": "Description of changes made",
  "model_used": "gpt-4o-mini",
  "tokens_used": 1250
}
```

## Advanced Configuration

### Custom Model Configuration
```bash
# Environment variable
export CODEX_DEFAULT_MODEL=gpt-4o

# In .env file
CODEX_DEFAULT_MODEL=gpt-4o

# Per-request override
{
  "task": "Generate unit tests",
  "model": "o1-mini"
}
```

### Approval Mode Configuration
```bash
# Suggest mode (default) - requires confirmation
CODEX_APPROVAL_MODE=suggest

# Auto-edit mode - automatically applies changes
CODEX_APPROVAL_MODE=auto-edit

# Full-auto mode - runs without prompting
CODEX_APPROVAL_MODE=full-auto
```

### Error Handling Configuration
```bash
# Ask user on errors (default)
CODEX_FULL_AUTO_ERROR_MODE=ask-user

# Ignore errors and continue
CODEX_FULL_AUTO_ERROR_MODE=ignore-and-continue
```

### Safe Commands Configuration
Configure commands that can run without confirmation:
```bash
# In Codex CLI config (~/.codex/config.yaml)
safeCommands:
  - npm test
  - yarn lint
  - git status
  - git log
```

## Docker Integration

### Docker-based MCP Server
```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install Codex CLI dependencies
RUN apt-get update && apt-get install -y \
    nodejs npm git \
    && rm -rf /var/lib/apt/lists/*

# Install Codex CLI
RUN npm install -g @openai/codex

# Copy MCP server code
COPY . .
RUN pip install -e .

# Expose MCP server port
EXPOSE 8000

# Start MCP server
CMD ["codex_server"]
```

### Docker Compose Configuration
```yaml
version: '3.8'

services:
  codex-mcp:
    build: .
    ports:
      - "8000:8000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - CODEX_DEFAULT_MODEL=gpt-4o-mini
      - PORT=8000
    volumes:
      - ./workspace:/workspace
    working_dir: /workspace
```

### Running with Docker
```bash
# Build and run
docker-compose up -d

# Connect from MCP client
{
  "servers": {
    "codex-docker": {
      "transport": "http",
      "url": "http://localhost:8000/mcp"
    }
  }
}
```

## Security Considerations

### API Key Management
- Store API keys in environment variables, never in configuration files
- Use separate API keys for different environments (dev/staging/prod)
- Implement key rotation policies
- Monitor API usage and costs

### Network Security
- Run MCP server on localhost by default
- Use HTTPS for remote deployments
- Implement authentication for multi-user environments
- Configure firewall rules appropriately

### Code Execution Safety
- Review generated code before execution
- Use approval modes to control automation level
- Implement safe command allowlists
- Sandbox execution environments when possible

## Monitoring and Logging

### Server Monitoring
```python
# Example logging configuration
import logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Log MCP requests
logger.info(f"MCP request: {method} with params: {params}")
logger.info(f"Codex CLI command: {command}")
logger.info(f"Response: {response}")
```

### Performance Metrics
- Track request/response latency
- Monitor token usage and costs
- Log error rates and types
- Measure tool usage patterns

## Troubleshooting

### Common Issues

#### 1. Codex CLI Not Found
**Error**: `codex: command not found`
**Solution**: 
```bash
# Install Codex CLI globally
npm install -g @openai/codex

# Verify installation
codex --version
```

#### 2. API Key Issues
**Error**: `401 Unauthorized`
**Solution**:
```bash
# Verify API key is set
echo $OPENAI_API_KEY

# Test manually
codex -m gpt-4o-mini "Hello world"
```

#### 3. MCP Connection Issues
**Error**: Server not responding to MCP requests
**Solution**:
- Check server startup logs
- Verify port configuration
- Test with curl: `curl -X POST http://localhost:8000/health`

#### 4. Permission Errors
**Error**: File permission denied
**Solution**:
```bash
# Ensure proper permissions
chmod +x ./setup_and_run.sh
chmod 755 /path/to/codex_server
```

### Debug Mode
Enable debug logging:
```bash
# Environment variable
export DEBUG=true

# In MCP server
CODEX_DEBUG_CONFIG=1 codex_server
```

## Best Practices

### Development
1. Start with suggest mode for safety
2. Test tools individually before integration
3. Implement comprehensive error handling
4. Use version control for configurations
5. Document custom tool implementations

### Production Deployment
1. Use containerization for consistency
2. Implement health checks and monitoring
3. Configure log aggregation
4. Set up alerting for failures
5. Plan for scaling and load balancing

### Team Collaboration
1. Share MCP server configurations via version control
2. Document tool usage patterns and examples
3. Establish code review processes for AI-generated code
4. Train team members on MCP tool capabilities

This specification provides comprehensive guidance for integrating OpenAI Codex CLI with MCP-compatible clients, enabling powerful AI-assisted development workflows through standardized protocol communication.