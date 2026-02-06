## Modular MCP (Deprecated)

Rulesync supports compressing tokens consumed by MCP servers [d-kimuson/modular-mcp](https://github.com/d-kimuson/modular-mcp) for context saving. When enabled with `--modular-mcp`, it additionally generates `modular-mcp.json`.

```bash
# Enable modular-mcp via CLI
npx rulesync generate --targets claudecode --features mcp --modular-mcp

# Or via configuration file
{
  "modularMcp": true
}
```

When enabling modular-mcp, each MCP server must have a `description` field. Example:

```diff
// .rulesync/mcp.json
{
  "mcpServers": {
    "context7": {
+     "description": "Up-to-date documentation and code examples for libraries",
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-mcp"
      ],
      "env": {}
    }
}
```

You can also configure `exposed` to exclude specific MCP servers from modular-mcp. It is optional and default to `false`. If you specify `exposed: true`, the MCP server is always loaded in the initial context.

```diff
// .rulesync/mcp.json
{
  "mcpServers": {
    "context7": {
+     "exposed": true,
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-mcp"
      ],
      "env": {}
    }
}
```

To demonstrate the effect of modular-mcp, please see the following example:

<details>
<summary>Example of effect</summary>

Please see examples using Claude Code.

When using following mcp servers:

```json
// .rulesync/mcp.json

{
  "mcpServers": {
    "serena": {
      "description": "Semantic coding tools for intelligent codebase exploration and manipulation",
      "type": "stdio",
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--context",
        "ide-assistant",
        "--enable-web-dashboard",
        "false",
        "--project",
        "."
      ],
      "env": {}
    },
    "context7": {
      "description": "Up-to-date documentation and code examples for libraries",
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "env": {}
    },
    "fetch": {
      "description": "This server enables LLMs to retrieve and process content from web pages, converting HTML to markdown for easier consumption.",
      "type": "stdio",
      "command": "uvx",
      "args": ["mcp-server-fetch"],
      "env": {}
    }
  }
}
```

Once run `rulesync generate --targets claudecode --features mcp`, `/context` result on Claude Code is as follows:

```
      Context Usage
     ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁   claude-sonnet-4-5-20250929 · 82k/200k tokens (41%)
     ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛀ ⛀
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ System prompt: 2.5k tokens (1.3%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ System tools: 13.9k tokens (6.9%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ MCP tools: 15.7k tokens (7.9%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ Memory files: 5.2k tokens (2.6%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ Messages: 8 tokens (0.0%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛝ ⛝ ⛝   ⛶ Free space: 118k (58.8%)
     ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝   ⛝ Autocompact buffer: 45.0k tokens (22.5%)
     ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝
```

On the other hand, once run `rulesync generate --targets claudecode --features mcp --modular-mcp`, `/context` result on Claude Code is as follows:

```
      Context Usage
     ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛀ ⛁   claude-sonnet-4-5-20250929 · 68k/200k tokens (34%)
     ⛁ ⛀ ⛀ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ System prompt: 2.5k tokens (1.3%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ System tools: 13.5k tokens (6.8%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ MCP tools: 1.3k tokens (0.6%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ Memory files: 5.2k tokens (2.6%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶   ⛁ Messages: 8 tokens (0.0%)
     ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛝ ⛝ ⛝   ⛶ Free space: 132k (66.2%)
     ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝   ⛝ Autocompact buffer: 45.0k tokens (22.5%)
     ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝
```

Focus on the difference of MCP tools usage.

|                      | Context Usage       |
| -------------------- | ------------------- |
| Disabled Modular MCP | 15.7k tokens (7.9%) |
| Enabled Modular MCP  | 1.3k tokens (0.6%)  |

So, in this case, approximately 92% reduction in MCP tools consumption!

</details>
