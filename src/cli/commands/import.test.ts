import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as importer from "../../core/importer.js";
import { importCommand } from "./import.js";

vi.mock("../../core/importer");

describe("import command", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should require at least one tool to be specified", async () => {
    await expect(importCommand({})).rejects.toThrow("process.exit");
    expect(console.error).toHaveBeenCalledWith(
      "❌ Please specify one tool to import from (--augmentcode, --claudecode, --cursor, --copilot, --cline, --roo, --geminicli)",
    );
  });

  it("should reject multiple tools being specified", async () => {
    await expect(importCommand({ claudecode: true, cursor: true })).rejects.toThrow("process.exit");
    expect(console.error).toHaveBeenCalledWith(
      "❌ Only one tool can be specified at a time. Please run the import command separately for each tool.",
    );
  });

  it("should import from claudecode successfully", async () => {
    const mockResult = {
      success: true,
      rulesCreated: 3,
      errors: [],
    };
    vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

    await importCommand({ claudecode: true });

    expect(importer.importConfiguration).toHaveBeenCalledWith({
      tool: "claudecode",
      verbose: false,
    });
    expect(console.log).toHaveBeenCalledWith("Importing configuration files from claudecode...");
    expect(console.log).toHaveBeenCalledWith("✅ Imported 3 rule(s) from claudecode");
  });

  it("should display ignore file creation message", async () => {
    const mockResult = {
      success: true,
      rulesCreated: 2,
      errors: [],
      ignoreFileCreated: true,
    };
    vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

    await importCommand({ cursor: true });

    expect(console.log).toHaveBeenCalledWith(
      "✅ Created .rulesyncignore file from ignore patterns",
    );
  });

  it("should display mcp file creation message", async () => {
    const mockResult = {
      success: true,
      rulesCreated: 1,
      errors: [],
      mcpFileCreated: true,
    };
    vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

    await importCommand({ claudecode: true });

    expect(console.log).toHaveBeenCalledWith(
      "✅ Created .rulesync/.mcp.json file from MCP configuration",
    );
  });

  it("should handle import errors", async () => {
    const mockResult = {
      success: false,
      rulesCreated: 0,
      errors: ["Failed to parse configuration"],
    };
    vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

    await importCommand({ copilot: true });

    expect(console.warn).toHaveBeenCalledWith(
      "⚠️  Failed to import from copilot: Failed to parse configuration",
    );
  });

  it("should show verbose errors when verbose flag is set", async () => {
    const mockResult = {
      success: false,
      rulesCreated: 0,
      errors: ["Error 1", "Error 2", "Error 3"],
    };
    vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

    await importCommand({ cline: true, verbose: true });

    expect(console.log).toHaveBeenCalledWith("\nDetailed errors:");
    expect(console.log).toHaveBeenCalledWith("  - Error 1");
    expect(console.log).toHaveBeenCalledWith("  - Error 2");
    expect(console.log).toHaveBeenCalledWith("  - Error 3");
  });

  it("should handle exceptions during import", async () => {
    vi.spyOn(importer, "importConfiguration").mockRejectedValueOnce(new Error("Unexpected error"));

    await expect(importCommand({ roo: true })).rejects.toThrow("process.exit");
    expect(console.error).toHaveBeenCalledWith("❌ Error importing from roo: Unexpected error");
  });

  it("should support all tool types", async () => {
    const tools = ["augmentcode", "claudecode", "cursor", "copilot", "cline", "roo", "geminicli"];

    for (const tool of tools) {
      vi.resetAllMocks();
      vi.spyOn(console, "log").mockImplementation(() => {});

      const mockResult = {
        success: true,
        rulesCreated: 1,
        errors: [],
      };
      vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

      const options = { [tool]: true };
      await importCommand(options);

      expect(importer.importConfiguration).toHaveBeenCalledWith({
        tool,
        verbose: false,
      });
    }
  });

  it("should pass verbose flag to import configuration", async () => {
    const mockResult = {
      success: true,
      rulesCreated: 1,
      errors: [],
    };
    vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

    await importCommand({ geminicli: true, verbose: true });

    expect(importer.importConfiguration).toHaveBeenCalledWith({
      tool: "geminicli",
      verbose: true,
    });
  });
});
