## What is the problem?

GitHub Copilot CLI requires a specific MCP configuration format in `.copilot/mcp-config.json`, notably the mandatory `"type": "stdio"` field for each server. The current `rulesync` implementation did not support this target, and a naive conversion could lead to the loss of Copilot-specific fields like `tools`, `url`, or `headers` during synchronization.

## How did I fix it?

- Created a specialized `CopilotcliMcp` class to handle the unique requirements of the Copilot CLI.
- Implemented a **"Keep-and-augment"** approach: instead of reconstructing server objects from a limited schema, we now spread the original object to ensure all existing/unknown fields are preserved.
- Automatically injects `"type": "stdio"` as required by the GitHub documentation.
- Integrated `copilotcli` into the `McpProcessor` for seamless usage via `rulesync mcp sync --target copilotcli`.

## How was this tested?

- **Unit Tests**: 30 new test cases in `copilotcli-mcp.test.ts`.
- **Integration Tests**: 45 tests in `mcp-processor.test.ts`.
- **Total**: 74 tests passed.

Closes #1340
