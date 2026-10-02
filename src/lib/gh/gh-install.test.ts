import type { ExecFileOptionsWithStringEncoding } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type GhExecOptions = ExecFileOptionsWithStringEncoding & {
  cwd: string;
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
};

type GhExecFileAsync = (
  file: string,
  args: readonly string[],
  options: GhExecOptions,
) => Promise<{ stdout: string; stderr: string }>;

const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn<GhExecFileAsync>(),
}));

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => mockExecFileAsync }));

import type { SourceEntry } from "../../config/config.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { installGh } from "./gh-install.js";

function source(overrides: SourceEntry): SourceEntry {
  return overrides;
}

describe("installGh", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  const logger = createMockLogger();

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("delegates a selected skill and explicit ref to gh without --pin", async () => {
    const result = await installGh({
      projectRoot: testDir,
      sources: [source({ source: "owner/repo", ref: "v1.2", skills: ["cleanup"] })],
      logger,
    });

    expect(result).toEqual({ sourcesProcessed: 1, failedSourceCount: 0 });
    expect(mockExecFileAsync.mock.calls.map(([, args]) => args)).toContainEqual([
      "skill",
      "install",
      "--agent",
      "github-copilot",
      "--scope",
      "project",
      "--force",
      "--",
      "https://github.com/owner/repo",
      "cleanup@v1.2",
    ]);
    expect(mockExecFileAsync.mock.calls.flatMap(([, args]) => args)).not.toContain("--pin");
  });

  it("uses gh --all when no skill filter or ref is declared", async () => {
    await installGh({ projectRoot: testDir, sources: [source({ source: "owner/repo" })], logger });

    expect(mockExecFileAsync.mock.calls.map(([, args]) => args)).toContainEqual([
      "skill",
      "install",
      "--agent",
      "github-copilot",
      "--scope",
      "project",
      "--force",
      "--all",
      "--",
      "https://github.com/owner/repo",
    ]);
  });

  it("discovers exact root skill paths for a ref, then installs each selected path", async () => {
    mockExecFileAsync.mockImplementation(async (_bin, args) => {
      if (args[0] === "api")
        return {
          stdout: JSON.stringify({
            truncated: false,
            tree: [
              { path: "skills/alpha/SKILL.md", type: "blob" },
              { path: "skills/deep/nested/SKILL.md", type: "blob" },
              { path: "docs/skills/nope/SKILL.md", type: "blob" },
              { path: "skills/beta/SKILL.md", type: "tree" },
            ],
          }),
          stderr: "",
        };
      return { stdout: "", stderr: "" };
    });

    await installGh({
      projectRoot: testDir,
      sources: [source({ source: "owner/repo", ref: "release/v2" })],
      logger,
    });

    expect(mockExecFileAsync.mock.calls.map(([, args]) => args)).toEqual([
      ["skill", "install", "--help"],
      ["api", "--hostname", "github.com", "repos/owner/repo/git/trees/release%2Fv2?recursive=1"],
      [
        "skill",
        "install",
        "--agent",
        "github-copilot",
        "--scope",
        "project",
        "--force",
        "--",
        "https://github.com/owner/repo",
        "skills/alpha/SKILL.md@release/v2",
      ],
    ]);
  });

  it("maps the Gemini alias and passes arbitrary agent IDs through with scope flags", async () => {
    await installGh({
      projectRoot: testDir,
      sources: [
        source({ source: "owner/one", agent: "gemini", scope: "user", skills: ["s"] }),
        source({ source: "owner/two", agent: "custom-agent", scope: "user", skills: ["s"] }),
      ],
      logger,
    });

    const installs = mockExecFileAsync.mock.calls.slice(1).map(([, args]) => args);
    expect(installs).toContainEqual([
      "skill",
      "install",
      "--agent",
      "gemini-cli",
      "--scope",
      "user",
      "--force",
      "--",
      "https://github.com/owner/one",
      "s",
    ]);
    expect(installs).toContainEqual([
      "skill",
      "install",
      "--agent",
      "custom-agent",
      "--scope",
      "user",
      "--force",
      "--",
      "https://github.com/owner/two",
      "s",
    ]);
    expect(
      mockExecFileAsync.mock.calls.slice(1).every(([, , options]) => options.cwd === testDir),
    ).toBe(true);
  });

  it("passes a token only through GH_TOKEN in the child environment", async () => {
    await installGh({
      projectRoot: testDir,
      sources: [source({ source: "owner/repo", skills: ["s"] })],
      options: { token: "secret-value" },
      logger,
    });

    for (const [, args, options] of mockExecFileAsync.mock.calls) {
      expect(args.join(" ")).not.toContain("secret-value");
      expect(options.env.GH_TOKEN).toBe("secret-value");
      expect(options.env.GH_PROMPT_DISABLED).toBe("1");
    }
  });

  it.each([{ frozen: true }, { update: true }])(
    "rejects unsupported options before any gh call: %o",
    async (options) => {
      await expect(
        installGh({
          projectRoot: testDir,
          sources: [source({ source: "owner/repo" })],
          options,
          logger,
        }),
      ).rejects.toThrow(options.frozen ? /--frozen is not supported/ : /--update is not supported/);
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    },
  );

  it.each([{ path: "skills" }, { skills: [""] }])(
    "validates every source before invoking gh: %o",
    async (invalid) => {
      await expect(
        installGh({
          projectRoot: testDir,
          sources: [source({ source: "owner/good" }), source({ source: "owner/bad", ...invalid })],
          logger,
        }),
      ).rejects.toThrow(/field "(path|skills)"/);
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    },
  );

  it("reports a missing gh executable with an actionable error", async () => {
    mockExecFileAsync.mockRejectedValue(
      Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }),
    );
    await expect(
      installGh({ projectRoot: testDir, sources: [source({ source: "owner/repo" })], logger }),
    ).rejects.toThrow(/requires GitHub CLI on PATH with 'gh skill install' support/);
  });

  it("counts a failed source and continues installing subsequent sources", async () => {
    mockExecFileAsync.mockImplementation(async (_bin, args) => {
      if (args.some((arg) => arg.includes("owner/bad"))) throw new Error("permission denied");
      return { stdout: "", stderr: "" };
    });

    const result = await installGh({
      projectRoot: testDir,
      sources: [
        source({ source: "owner/bad", skills: ["s"] }),
        source({ source: "owner/good", skills: ["s"] }),
      ],
      logger,
    });

    expect(result).toEqual({ sourcesProcessed: 2, failedSourceCount: 1 });
    expect(
      mockExecFileAsync.mock.calls.some(([, args]) =>
        args.some((arg) => arg.includes("owner/good")),
      ),
    ).toBe(true);
  });

  it("ignores and preserves a malformed legacy lockfile without writing a new lock", async () => {
    const lockPath = join(testDir, "rulesync-gh.lock.yaml");
    await writeFile(lockPath, "invalid: [old lock", "utf8");

    await installGh({ projectRoot: testDir, sources: [source({ source: "owner/repo" })], logger });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(await readFile(lockPath, "utf8")).toBe("invalid: [old lock");
    expect(
      mockExecFileAsync.mock.calls.some(([, args]) => args.includes("rulesync-gh.lock.yaml")),
    ).toBe(false);
  });

  it("fails a source when GitHub returns a truncated tree", async () => {
    mockExecFileAsync.mockImplementation(async (_bin, args) =>
      args[0] === "api"
        ? { stdout: JSON.stringify({ truncated: true, tree: [] }), stderr: "" }
        : { stdout: "", stderr: "" },
    );

    const result = await installGh({
      projectRoot: testDir,
      sources: [source({ source: "owner/repo", ref: "main" })],
      logger,
    });

    expect(result).toEqual({ sourcesProcessed: 1, failedSourceCount: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Repository tree is truncated"),
    );
    expect(mockExecFileAsync.mock.calls.filter(([, args]) => args[0] === "api")).toHaveLength(1);
    expect(
      mockExecFileAsync.mock.calls.filter(
        ([, args]) => args[0] === "skill" && args[1] === "install",
      ),
    ).toEqual([["gh", ["skill", "install", "--help"], expect.any(Object)]]);
  });
});
