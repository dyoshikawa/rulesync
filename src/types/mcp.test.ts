import { describe, expect, it } from "vitest";

import { McpServerSchema, isMcpServers } from "./mcp.js";

describe("isMcpServers", () => {
  it("should return true for a plain object", () => {
    expect(isMcpServers({ foo: { command: "npx" } })).toBe(true);
    expect(isMcpServers({})).toBe(true);
  });

  it("should return false for arrays", () => {
    expect(isMcpServers([])).toBe(false);
    expect(isMcpServers([{ command: "npx" }])).toBe(false);
  });

  it("should return false for null, undefined, and non-objects", () => {
    expect(isMcpServers(null)).toBe(false);
    expect(isMcpServers(undefined)).toBe(false);
    expect(isMcpServers("x")).toBe(false);
    expect(isMcpServers(1)).toBe(false);
    expect(isMcpServers(true)).toBe(false);
  });
});

describe("McpServerSchema", () => {
  it("should accept valid uppercase envVars names", () => {
    const result = McpServerSchema.safeParse({
      command: "node",
      envVars: ["OPENAI_API_KEY", "_PRIVATE", "KEY_123"],
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid lowercase envVars names (POSIX compliant)", () => {
    const result = McpServerSchema.safeParse({
      command: "node",
      envVars: ["openai_api_key", "_private_key"],
    });
    expect(result.success).toBe(true);
  });

  it("should reject envVars names starting with a digit", () => {
    const result = McpServerSchema.safeParse({
      command: "node",
      envVars: ["1BAD"],
    });
    expect(result.success).toBe(false);
  });

  it("should reject envVars names with invalid characters like dashes", () => {
    const result = McpServerSchema.safeParse({
      command: "node",
      envVars: ["HAS-DASH"],
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty envVars names", () => {
    const result = McpServerSchema.safeParse({
      command: "node",
      envVars: [""],
    });
    expect(result.success).toBe(false);
  });

  it("should accept the WebSocket transport (type/transport: ws)", () => {
    const result = McpServerSchema.safeParse({
      type: "ws",
      transport: "ws",
      url: "wss://mcp.example.com/socket",
      headers: { Authorization: "Bearer token" },
    });
    expect(result.success).toBe(true);
  });

  it("should accept streamable-http as an alias of http (type/transport)", () => {
    const result = McpServerSchema.safeParse({
      type: "streamable-http",
      transport: "streamable-http",
      url: "https://mcp.example.com/mcp",
    });
    expect(result.success).toBe(true);
  });

  it("should still accept the existing http/stdio/sse/local transports", () => {
    for (const type of ["local", "stdio", "sse", "http"] as const) {
      expect(McpServerSchema.safeParse({ type, transport: type }).success).toBe(true);
    }
  });

  it("should reject an unknown transport value", () => {
    const result = McpServerSchema.safeParse({ type: "grpc" });
    expect(result.success).toBe(false);
  });
});
