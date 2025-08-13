import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTestDirectory } from "../test-utils/index.js";
import { parseMcpConfig } from "./mcp-parser.js";

describe("parseMcpConfig", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let mcpPath: string;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    mcpPath = path.join(testDir, ".rulesync", ".mcp.json");
    fs.mkdirSync(path.join(testDir, ".rulesync"), { recursive: true });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return null when mcp.json does not exist", () => {
    const result = parseMcpConfig(testDir);
    expect(result).toBeNull();
  });

  it("should parse valid mcp.json", () => {
    const mcpConfig = {
      servers: {
        "test-server": {
          command: "node",
          args: ["server.js"],
          env: { API_KEY: "test-key" },
        },
      },
    };

    fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2));

    const result = parseMcpConfig(testDir);
    expect(result).toEqual({
      mcpServers: mcpConfig.servers,
    });
  });

  it("should parse mcp.json with tools configuration", () => {
    const mcpConfig = {
      servers: {
        "test-server": {
          command: "node",
          args: ["server.js"],
        },
      },
      tools: {
        claude: { global: true, project: false },
        cursor: { global: false, project: true },
      },
    };

    fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2));

    const result = parseMcpConfig(testDir);
    expect(result).toEqual({
      mcpServers: mcpConfig.servers,
    });
  });

  it("should throw error for invalid JSON", () => {
    fs.writeFileSync(mcpPath, "{ invalid json }");

    expect(() => parseMcpConfig(testDir)).toThrow("Failed to parse mcp.json");
  });

  it("should throw error when servers field is missing", () => {
    const mcpConfig = { notServers: {} };
    fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig));

    expect(() => parseMcpConfig(testDir)).toThrow("Failed to parse mcp.json:");
  });

  it("should throw error when servers field is not an object", () => {
    const mcpConfig = { mcpServers: "not-an-object" };
    fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig));

    expect(() => parseMcpConfig(testDir)).toThrow("Failed to parse mcp.json:");
  });
});
