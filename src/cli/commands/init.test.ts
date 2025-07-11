import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDir, fileExists, writeFileContent } from "../../utils/index.js";
import { initCommand } from "./init.js";

vi.mock("../../utils/index.js");

const mockEnsureDir = vi.mocked(ensureDir);
const mockFileExists = vi.mocked(fileExists);
const mockWriteFileContent = vi.mocked(writeFileContent);

describe("initCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureDir.mockResolvedValue();
    mockFileExists.mockResolvedValue(false);
    mockWriteFileContent.mockResolvedValue();

    // Mock console methods
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("should initialize rulesync successfully", async () => {
    await initCommand();

    expect(mockEnsureDir).toHaveBeenCalledWith(".rulesync");
    expect(console.log).toHaveBeenCalledWith("Initializing rulesync...");
    expect(console.log).toHaveBeenCalledWith("✅ rulesync initialized successfully!");
    expect(console.log).toHaveBeenCalledWith("\nNext steps:");
    expect(console.log).toHaveBeenCalledWith("1. Edit rule files in .rulesync/");
    expect(console.log).toHaveBeenCalledWith(
      "2. Run 'rulesync generate' to create configuration files",
    );
  });

  it("should create sample files", async () => {
    await initCommand();

    expect(mockWriteFileContent).toHaveBeenCalledWith(
      join(".rulesync", "overview.md"),
      expect.stringContaining("root: true"),
    );
    expect(mockWriteFileContent).toHaveBeenCalledTimes(1);

    expect(console.log).toHaveBeenCalledWith("Created .rulesync/overview.md");
  });

  it("should skip existing files", async () => {
    mockFileExists.mockImplementation(async (filepath) => {
      return filepath.includes("overview.md");
    });

    await initCommand();

    expect(mockWriteFileContent).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith("Skipped .rulesync/overview.md (already exists)");
  });

  it("should handle all files existing", async () => {
    mockFileExists.mockResolvedValue(true);

    await initCommand();

    expect(mockWriteFileContent).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith("Skipped .rulesync/overview.md (already exists)");
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
});
