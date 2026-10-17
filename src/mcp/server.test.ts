import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../test-utils/test-directories.js";
import { createRulesyncMcpServer } from "./server.js";

describe("createRulesyncMcpServer", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let client: Client;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createRulesyncMcpServer({ version: "1.2.3" }).connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await cleanup();
    vi.restoreAllMocks();
  });

  it("advertises its name, version and instructions", () => {
    expect(client.getServerVersion()).toEqual({ name: "Rulesync MCP Server", version: "1.2.3" });
    expect(client.getInstructions()).toContain("Rulesync files");
  });

  it("lists rulesyncTool with a JSON Schema built from its zod parameters", async () => {
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(1);
    const [tool] = tools;
    expect(tool?.name).toBe("rulesyncTool");
    expect(tool?.description).toContain("Manage Rulesync files");
    expect(tool?.inputSchema.type).toBe("object");
    expect(tool?.inputSchema.required).toEqual(["feature", "operation"]);
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["feature", "operation", "targetPathFromCwd", "generateOptions"]),
    );
  });

  it("returns the tool's output as text content", async () => {
    const result = await client.callTool({
      name: "rulesyncTool",
      arguments: { feature: "rule", operation: "list" },
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.any(String) }]);
  });

  it("returns a thrown error as an isError result carrying its message", async () => {
    const result = await client.callTool({
      name: "rulesyncTool",
      arguments: { feature: "permissions", operation: "put" },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("content is required");
  });

  it("rejects arguments that do not match the schema", async () => {
    const result = await client.callTool({
      name: "rulesyncTool",
      arguments: { feature: "unknown-feature", operation: "list" },
    });

    expect(result.isError).toBe(true);
  });
});
