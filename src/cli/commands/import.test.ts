import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockLogger } from "../../test-utils/index.js";

vi.mock("../../core/importer");
vi.mock("../../utils/logger.js", () => ({
  logger: mockLogger,
}));

import * as importer from "../../core/importer.js";
import { importCommand } from "./import.js";

describe("import command", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should require exactly one tool to be specified", async () => {
    await expect(importCommand({})).rejects.toThrow("process.exit");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "❌ Please specify a tool to import from using --targets <tool>.",
    );
  });

  // Single target validation tests
  it("should reject multiple tools being specified via legacy flags", async () => {
    await expect(importCommand({ claudecode: true, cursor: true })).rejects.toThrow("process.exit");

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("❌ Import command only supports a single target"),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("You specified: claudecode, cursor"),
    );
  });

  it("should reject multiple targets specified via --targets", async () => {
    await expect(importCommand({ targets: ["cursor", "copilot", "cline"] })).rejects.toThrow(
      "process.exit",
    );

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("❌ Import command only supports a single target"),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("You specified: cursor, copilot, cline"),
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
      features: ["rules", "commands", "mcp", "ignore", "subagents"],
      verbose: false,
      useLegacyLocation: false,
    });
    expect(mockLogger.log).toHaveBeenCalledWith("Importing configuration files from claudecode...");
    expect(mockLogger.success).toHaveBeenCalledWith("✅ Imported 3 rule(s) from claudecode");
    expect(mockLogger.success).toHaveBeenCalledWith("\n🎉 Successfully imported from claudecode");
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

    expect(mockLogger.success).toHaveBeenCalledWith(
      "  Created .rulesyncignore file from ignore patterns",
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

    expect(mockLogger.success).toHaveBeenCalledWith(
      "  Created .rulesync/.mcp.json file from MCP configuration",
    );
  });

  it("should handle import errors", async () => {
    const mockResult = {
      success: false,
      rulesCreated: 0,
      errors: ["Failed to parse configuration"],
    };
    vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

    await expect(importCommand({ copilot: true })).rejects.toThrow("process.exit");

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "⚠️  Failed to import from copilot: Failed to parse configuration",
    );
    expect(mockLogger.error).toHaveBeenCalledWith("\n❌ Failed to import from copilot.");
  });

  it("should show verbose errors when verbose flag is set", async () => {
    const mockResult = {
      success: false,
      rulesCreated: 0,
      errors: ["Error 1", "Error 2", "Error 3"],
    };
    vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

    await expect(importCommand({ cline: true, verbose: true })).rejects.toThrow("process.exit");

    expect(mockLogger.info).toHaveBeenCalledWith("  Detailed errors:");
    expect(mockLogger.info).toHaveBeenCalledWith("    - Error 1");
    expect(mockLogger.info).toHaveBeenCalledWith("    - Error 2");
    expect(mockLogger.info).toHaveBeenCalledWith("    - Error 3");
  });

  it("should handle exceptions during import", async () => {
    vi.spyOn(importer, "importConfiguration").mockRejectedValueOnce(new Error("Unexpected error"));

    await expect(importCommand({ roo: true })).rejects.toThrow("process.exit");
    expect(mockLogger.error).toHaveBeenCalledWith("❌ Error importing from roo: Unexpected error");
  });

  it("should support all tool types", async () => {
    const tools = ["augmentcode", "claudecode", "cursor", "copilot", "cline", "roo", "geminicli"];

    for (const tool of tools) {
      vi.resetAllMocks();
      // Logger is already mocked globally

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
        features: ["rules", "commands", "mcp", "ignore", "subagents"],
        verbose: false,
        useLegacyLocation: false,
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
      features: ["rules", "commands", "mcp", "ignore", "subagents"],
      verbose: true,
      useLegacyLocation: false,
    });
  });

  it("should pass legacy flag to import configuration", async () => {
    const mockResult = {
      success: true,
      rulesCreated: 1,
      errors: [],
    };
    vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

    await importCommand({ geminicli: true, legacy: true });

    expect(importer.importConfiguration).toHaveBeenCalledWith({
      tool: "geminicli",
      features: ["rules", "commands", "mcp", "ignore", "subagents"],
      verbose: false,
      useLegacyLocation: true,
    });
  });

  // New --targets option tests
  describe("--targets option", () => {
    it("should import from a single tool using targets", async () => {
      const mockResult = {
        success: true,
        rulesCreated: 2,
        errors: [],
      };
      vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

      await importCommand({ targets: ["cursor"] });

      expect(importer.importConfiguration).toHaveBeenCalledWith({
        tool: "cursor",
        features: ["rules", "commands", "mcp", "ignore", "subagents"],
        verbose: false,
        useLegacyLocation: false,
      });
      expect(mockLogger.success).toHaveBeenCalledWith("✅ Imported 2 rule(s) from cursor");
    });

    it("should reject multiple tools using targets", async () => {
      await expect(importCommand({ targets: ["cursor", "copilot", "cline"] })).rejects.toThrow(
        "process.exit",
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("❌ Import command only supports a single target"),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("You specified: cursor, copilot, cline"),
      );
    });

    it("should show success summary for single tool", async () => {
      const mockResult = {
        success: true,
        rulesCreated: 1,
        errors: [],
      };
      vi.spyOn(importer, "importConfiguration").mockResolvedValue(mockResult);

      await importCommand({ targets: ["cursor"] });

      expect(mockLogger.success).toHaveBeenCalledWith("\n🎉 Successfully imported from cursor");
    });

    it("should handle import failure correctly", async () => {
      const failureResult = {
        success: false,
        rulesCreated: 0,
        errors: ["Failed to parse configuration"],
      };

      vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(failureResult);

      await expect(importCommand({ targets: ["cursor"] })).rejects.toThrow("process.exit");

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "⚠️  Failed to import from cursor: Failed to parse configuration",
      );
      expect(mockLogger.error).toHaveBeenCalledWith("\n❌ Failed to import from cursor.");
    });

    it("should handle exceptions during import", async () => {
      vi.spyOn(importer, "importConfiguration").mockRejectedValueOnce(
        new Error("Unexpected error"),
      );

      await expect(importCommand({ targets: ["cursor"] })).rejects.toThrow("process.exit");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "❌ Error importing from cursor: Unexpected error",
      );
    });

    it("should prioritize targets over legacy flags", async () => {
      const mockResult = {
        success: true,
        rulesCreated: 1,
        errors: [],
      };
      vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

      // Both targets and legacy flags provided - should use targets
      await importCommand({ targets: ["cursor"], copilot: true });

      expect(importer.importConfiguration).toHaveBeenCalledTimes(1);
      expect(importer.importConfiguration).toHaveBeenCalledWith({
        tool: "cursor",
        features: ["rules", "commands", "mcp", "ignore", "subagents"],
        verbose: false,
        useLegacyLocation: false,
      });
    });
  });

  // Features option tests
  describe("--features option", () => {
    it("should pass features array to import configuration", async () => {
      const mockResult = {
        success: true,
        rulesCreated: 1,
        errors: [],
      };
      vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

      await importCommand({ targets: ["cursor"], features: ["rules", "mcp"] });

      expect(importer.importConfiguration).toHaveBeenCalledWith({
        tool: "cursor",
        features: ["rules", "mcp"],
        verbose: false,
        useLegacyLocation: false,
      });
    });

    it("should pass wildcard features to import configuration", async () => {
      const mockResult = {
        success: true,
        rulesCreated: 1,
        errors: [],
      };
      vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

      await importCommand({ targets: ["cursor"], features: "*" });

      expect(importer.importConfiguration).toHaveBeenCalledWith({
        tool: "cursor",
        features: ["rules", "commands", "mcp", "ignore", "subagents"],
        verbose: false,
        useLegacyLocation: false,
      });
    });

    it("should show backward compatibility warning when no features specified", async () => {
      const mockResult = {
        success: true,
        rulesCreated: 1,
        errors: [],
      };
      vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

      await importCommand({ targets: ["cursor"] });

      // Should show warning and default to all features
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("⚠️  Warning: No --features option specified"),
      );
      expect(importer.importConfiguration).toHaveBeenCalledWith({
        tool: "cursor",
        features: ["rules", "commands", "mcp", "ignore", "subagents"],
        verbose: false,
        useLegacyLocation: false,
      });
    });

    it("should not show warning when features are explicitly specified", async () => {
      const mockResult = {
        success: true,
        rulesCreated: 1,
        errors: [],
      };
      vi.spyOn(importer, "importConfiguration").mockResolvedValueOnce(mockResult);

      await importCommand({ targets: ["cursor"], features: ["rules"] });

      // Should not show warning
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("⚠️  Warning: No --features option specified"),
      );
      expect(importer.importConfiguration).toHaveBeenCalledWith({
        tool: "cursor",
        features: ["rules"],
        verbose: false,
        useLegacyLocation: false,
      });
    });
  });
});
