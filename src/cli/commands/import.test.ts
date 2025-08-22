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

  it("should require at least one tool to be specified", async () => {
    await expect(importCommand({})).rejects.toThrow("process.exit");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "❌ Please specify tools to import from using --targets <tool1,tool2> or --targets * for all supported tools.",
    );
  });

  // Legacy behavior tests
  it("should reject multiple tools being specified via legacy flags", async () => {
    // This test validates that the old behavior still works for legacy flags
    // But with new implementation, multiple tools via targets should be allowed
    const mockResult = {
      success: true,
      rulesCreated: 1,
      errors: [],
    };
    vi.spyOn(importer, "importConfiguration").mockResolvedValue(mockResult);

    await importCommand({ claudecode: true, cursor: true });

    // Should now process both tools
    expect(importer.importConfiguration).toHaveBeenCalledTimes(2);
    expect(importer.importConfiguration).toHaveBeenNthCalledWith(1, {
      tool: "claudecode",
      verbose: false,
      useLegacyLocation: false,
    });
    expect(importer.importConfiguration).toHaveBeenNthCalledWith(2, {
      tool: "cursor",
      verbose: false,
      useLegacyLocation: false,
    });
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
      useLegacyLocation: false,
    });
    expect(mockLogger.log).toHaveBeenCalledWith("Importing configuration files from claudecode...");
    expect(mockLogger.success).toHaveBeenCalledWith("✅ Imported 3 rule(s) from claudecode");
    expect(mockLogger.success).toHaveBeenCalledWith(
      "\n🎉 Successfully imported from 1 tool(s): claudecode",
    );
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
    expect(mockLogger.error).toHaveBeenCalledWith("\n❌ Failed to import from all 1 tool(s).");
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
        verbose: false,
        useLegacyLocation: false,
      });
      expect(mockLogger.success).toHaveBeenCalledWith("✅ Imported 2 rule(s) from cursor");
    });

    it("should import from multiple tools using targets", async () => {
      const mockResult = {
        success: true,
        rulesCreated: 1,
        errors: [],
      };
      vi.spyOn(importer, "importConfiguration").mockResolvedValue(mockResult);

      await importCommand({ targets: ["cursor", "copilot", "cline"] });

      expect(importer.importConfiguration).toHaveBeenCalledTimes(3);
      expect(importer.importConfiguration).toHaveBeenNthCalledWith(1, {
        tool: "cursor",
        verbose: false,
        useLegacyLocation: false,
      });
      expect(importer.importConfiguration).toHaveBeenNthCalledWith(2, {
        tool: "copilot",
        verbose: false,
        useLegacyLocation: false,
      });
      expect(importer.importConfiguration).toHaveBeenNthCalledWith(3, {
        tool: "cline",
        verbose: false,
        useLegacyLocation: false,
      });
    });

    it("should show success summary when all tools succeed", async () => {
      const mockResult = {
        success: true,
        rulesCreated: 1,
        errors: [],
      };
      vi.spyOn(importer, "importConfiguration").mockResolvedValue(mockResult);

      await importCommand({ targets: ["cursor", "copilot"] });

      expect(mockLogger.success).toHaveBeenCalledWith(
        "\n🎉 Successfully imported from 2 tool(s): cursor, copilot",
      );
    });

    it("should handle partial failures gracefully", async () => {
      const successResult = {
        success: true,
        rulesCreated: 1,
        errors: [],
      };
      const failureResult = {
        success: false,
        rulesCreated: 0,
        errors: ["Failed to parse configuration"],
      };

      vi.spyOn(importer, "importConfiguration")
        .mockResolvedValueOnce(successResult)
        .mockResolvedValueOnce(failureResult);

      await importCommand({ targets: ["cursor", "copilot"] });

      expect(mockLogger.success).toHaveBeenCalledWith(
        "\n✅ Successfully imported from 1 tool(s): cursor",
      );
      expect(mockLogger.warn).toHaveBeenCalledWith("❌ Failed to import from 1 tool(s): copilot");
    });

    it("should exit with error when all tools fail", async () => {
      const failureResult = {
        success: false,
        rulesCreated: 0,
        errors: ["Failed to parse configuration"],
      };
      vi.spyOn(importer, "importConfiguration").mockResolvedValue(failureResult);

      await expect(importCommand({ targets: ["cursor", "copilot"] })).rejects.toThrow(
        "process.exit",
      );
      expect(mockLogger.error).toHaveBeenCalledWith("\n❌ Failed to import from all 2 tool(s).");
    });

    it("should handle exceptions during multi-tool import", async () => {
      const successResult = {
        success: true,
        rulesCreated: 1,
        errors: [],
      };

      vi.spyOn(importer, "importConfiguration")
        .mockResolvedValueOnce(successResult)
        .mockRejectedValueOnce(new Error("Unexpected error"));

      await importCommand({ targets: ["cursor", "copilot"] });

      expect(mockLogger.success).toHaveBeenCalledWith("✅ Imported 1 rule(s) from cursor");
      expect(mockLogger.error).toHaveBeenCalledWith(
        "❌ Error importing from copilot: Unexpected error",
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
        verbose: false,
        useLegacyLocation: false,
      });
    });
  });
});
