import { afterEach, describe, expect, it, vi } from "vitest";

import { init } from "../lib/init.js";
import { executeInit } from "./init.js";

// `init` writes relative to the real working directory, which a mocked
// `process.cwd()` does not move, so it is mocked here; its own behavior is
// covered by `src/lib/init.test.ts`.
vi.mock("../lib/init.js");
vi.mock("../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../utils/file.js")>("../utils/file.js");
  return { ...actual, ensureDir: vi.fn() };
});

describe("executeInit", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the created and skipped files", async () => {
    vi.mocked(init).mockResolvedValue({
      sampleFiles: [
        { created: true, path: ".rulesync/rules/overview.md" },
        { created: false, path: ".rulesync/mcp.json" },
      ],
      configFile: { created: true, path: "rulesync.jsonc", seededFrom: "CLAUDE.md" },
    });

    const result = await executeInit();

    expect(result).toEqual({
      success: true,
      result: {
        created: [".rulesync/rules/overview.md", "rulesync.jsonc"],
        skipped: [".rulesync/mcp.json"],
        seededFrom: "CLAUDE.md",
      },
    });
  });

  it("returns the error when init fails", async () => {
    vi.mocked(init).mockRejectedValue(new Error("EACCES"));

    const result = await executeInit();

    expect(result.success).toBe(false);
    expect(result.error).toContain("EACCES");
  });
});
