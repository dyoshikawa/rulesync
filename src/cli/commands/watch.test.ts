import type { FSWatcher } from "chokidar";
import { watch } from "chokidar";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockConfig } from "../../test-utils/index.js";
import { getDefaultConfig } from "../../utils/index.js";
import { generateCommand } from "./generate.js";
import { watchCommand } from "./watch.js";

type MockWatcher = {
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} & Partial<FSWatcher>;

vi.mock("chokidar", () => ({
  watch: vi.fn(),
}));
vi.mock("../../utils/index.js");
vi.mock("./generate.js");

const mockWatch = vi.mocked(watch);
const mockGetDefaultConfig = vi.mocked(getDefaultConfig);
const mockGenerateCommand = vi.mocked(generateCommand);

const mockConfig = createMockConfig();

// Mock watcher instance
const mockWatcher: MockWatcher = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn(),
};

describe("watchCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultConfig.mockReturnValue(mockConfig);
    mockGenerateCommand.mockResolvedValue();
    mockWatch.mockReturnValue(mockWatcher as FSWatcher);

    // Mock console methods
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(process, "on").mockImplementation(() => process);
  });

  it("should start watching and do initial generation", async () => {
    const _watchPromise = watchCommand();

    // Wait a bit for the async operations to start
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(console.log).toHaveBeenCalledWith("👀 Watching for changes in .rulesync directory...");
    expect(console.log).toHaveBeenCalledWith("Press Ctrl+C to stop watching");
    expect(mockGenerateCommand).toHaveBeenCalledWith({ verbose: false });
    expect(mockWatch).toHaveBeenCalledWith(".rulesync/**/*.md", {
      ignoreInitial: true,
      persistent: true,
    });
  });

  it("should set up event handlers", async () => {
    const _watchPromise = watchCommand();

    // Wait a bit for the async operations to start
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockWatcher.on).toHaveBeenCalledWith("change", expect.any(Function));
    expect(mockWatcher.on).toHaveBeenCalledWith("add", expect.any(Function));
    expect(mockWatcher.on).toHaveBeenCalledWith("unlink", expect.any(Function));
    expect(mockWatcher.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("should handle file changes", async () => {
    let changeHandler: (path: string) => void;
    mockWatcher.on.mockImplementation((event, handler) => {
      if (event === "change") {
        changeHandler = handler;
      }
      return mockWatcher;
    });

    const _watchPromise = watchCommand();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate file change
    await changeHandler!("test.md");

    expect(console.log).toHaveBeenCalledWith("\n📝 Detected change in test.md");
    expect(mockGenerateCommand).toHaveBeenCalledTimes(2); // Initial + change
    expect(console.log).toHaveBeenCalledWith("✅ Regenerated configuration files");
  });

  it("should handle file additions", async () => {
    let addHandler: (path: string) => void;
    mockWatcher.on.mockImplementation((event, handler) => {
      if (event === "add") {
        addHandler = handler;
      }
      return mockWatcher;
    });

    const _watchPromise = watchCommand();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate file addition
    await addHandler!("new-rule.md");

    expect(console.log).toHaveBeenCalledWith("\n📝 Detected change in new-rule.md");
    expect(mockGenerateCommand).toHaveBeenCalledTimes(2); // Initial + add
  });

  it("should handle file deletions", async () => {
    let unlinkHandler: (path: string) => void;
    mockWatcher.on.mockImplementation((event, handler) => {
      if (event === "unlink") {
        unlinkHandler = handler;
      }
      return mockWatcher;
    });

    const _watchPromise = watchCommand();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate file deletion
    await unlinkHandler!("deleted-rule.md");

    expect(console.log).toHaveBeenCalledWith("\n🗑️  Removed deleted-rule.md");
    expect(mockGenerateCommand).toHaveBeenCalledTimes(2); // Initial + unlink
  });

  it("should handle generation errors", async () => {
    const error = new Error("Generation failed");
    mockGenerateCommand.mockResolvedValueOnce(undefined); // Initial succeeds
    mockGenerateCommand.mockRejectedValueOnce(error); // Change fails

    let changeHandler: (path: string) => void;
    mockWatcher.on.mockImplementation((event, handler) => {
      if (event === "change") {
        changeHandler = handler;
      }
      return mockWatcher;
    });

    // Start watchCommand but don't await it (it runs indefinitely)
    const _watchPromise = watchCommand();

    // Give time for initial setup
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Simulate file change with error
    await changeHandler!("test.md");

    expect(console.error).toHaveBeenCalledWith("❌ Failed to regenerate:", error);
  });

  it("should handle watcher errors", async () => {
    const error = new Error("Watcher error");
    let errorHandler: (error: Error) => void;
    mockWatcher.on.mockImplementation((event, handler) => {
      if (event === "error") {
        errorHandler = handler;
      }
      return mockWatcher;
    });

    // Start watchCommand but don't await it (it runs indefinitely)
    const _watchPromise = watchCommand();

    // Give time for initial setup
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Simulate watcher error
    errorHandler!(error);

    expect(console.error).toHaveBeenCalledWith("❌ Watcher error:", error);
  });

  it("should call generateCommand for initial generation", async () => {
    // Start watchCommand but don't await it (it runs indefinitely)
    const _watchPromise = watchCommand();

    // Give time for initial setup
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should call generateCommand for initial generation
    expect(mockGenerateCommand).toHaveBeenCalledWith({ verbose: false });
  });

  it("should setup SIGINT handler", async () => {
    // Start watchCommand but don't await it (it runs indefinitely)
    const _watchPromise = watchCommand();

    // Give time for initial setup
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(process.on).toHaveBeenCalledWith("SIGINT", expect.any(Function));
  });
});
