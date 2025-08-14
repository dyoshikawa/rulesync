import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockConfig } from "../../test-utils/index.js";
import { loadConfig } from "../../utils/config-loader.js";
import { ensureDir, fileExists, writeFileContent } from "../../utils/index.js";
import { logger } from "../../utils/logger.js";
import { initCommand } from "./init.js";

vi.mock("../../utils/index.js");
vi.mock("../../utils/config-loader.js");

const mockEnsureDir = vi.mocked(ensureDir);
const mockFileExists = vi.mocked(fileExists);
const mockWriteFileContent = vi.mocked(writeFileContent);
const mockLoadConfig = vi.mocked(loadConfig);

const mockConfig = createMockConfig();

describe("initCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue({ config: mockConfig, isEmpty: false });
    mockEnsureDir.mockResolvedValue();
    mockFileExists.mockResolvedValue(false);
    mockWriteFileContent.mockResolvedValue();

    // Mock console methods
    vi.spyOn(logger, "log").mockImplementation(() => {});
    vi.spyOn(logger, "success").mockImplementation(() => {});
  });

  it("should initialize rulesync successfully", async () => {
    await initCommand();

    expect(mockEnsureDir).toHaveBeenCalledWith(".rulesync");
    expect(mockEnsureDir).toHaveBeenCalledWith(".rulesync/rules");
    expect(logger.log).toHaveBeenCalledWith("Initializing rulesync...");
    expect(logger.success).toHaveBeenCalledWith("rulesync initialized successfully!");
    expect(logger.log).toHaveBeenCalledWith("\nNext steps:");
    expect(logger.log).toHaveBeenCalledWith("1. Edit rule files in .rulesync/rules/");
    expect(logger.log).toHaveBeenCalledWith(
      "2. Run 'rulesync generate' to create configuration files",
    );
  });

  it("should create sample files", async () => {
    await initCommand();

    expect(mockWriteFileContent).toHaveBeenCalledWith(
      join(".rulesync/rules", "overview.md"),
      expect.stringContaining("root: true"),
    );
    expect(mockWriteFileContent).toHaveBeenCalledTimes(1);

    expect(logger.success).toHaveBeenCalledWith("Created .rulesync/rules/overview.md");
  });

  it("should skip existing files", async () => {
    mockFileExists.mockImplementation(async (filepath) => {
      return filepath.includes("overview.md");
    });

    await initCommand();

    expect(mockWriteFileContent).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith("Skipped .rulesync/rules/overview.md (already exists)");
  });

  it("should handle all files existing", async () => {
    mockFileExists.mockResolvedValue(true);

    await initCommand();

    expect(mockWriteFileContent).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith("Skipped .rulesync/rules/overview.md (already exists)");
  });

  it("should create proper content for root file", async () => {
    await initCommand();

    const overviewCall = mockWriteFileContent.mock.calls.find((call) =>
      call[0].includes("overview.md"),
    );
    expect(overviewCall).toBeDefined();
    expect(overviewCall![1]).toContain("root: true");
    expect(overviewCall![1]).toContain('targets: ["*"]');
    expect(overviewCall![1]).toContain("Project overview");
  });

  it("should create proper content for overview file", async () => {
    await initCommand();

    const overviewCall = mockWriteFileContent.mock.calls.find((call) =>
      call[0].includes("overview.md"),
    );
    expect(overviewCall).toBeDefined();
    expect(overviewCall![1]).toContain("root: true");
    expect(overviewCall![1]).toContain("Project overview");
    expect(overviewCall![1]).toContain("General Guidelines");
    expect(overviewCall![1]).toContain("Code Style");
    expect(overviewCall![1]).toContain("Architecture Principles");
  });

  it("should use legacy location when --legacy option is provided", async () => {
    await initCommand({ legacy: true });

    expect(mockEnsureDir).toHaveBeenCalledWith(".rulesync");
    expect(mockEnsureDir).not.toHaveBeenCalledWith(".rulesync/rules");
    expect(mockWriteFileContent).toHaveBeenCalledWith(
      join(".rulesync", "overview.md"),
      expect.stringContaining("root: true"),
    );
    expect(logger.log).toHaveBeenCalledWith("1. Edit rule files in .rulesync/");
  });
});
