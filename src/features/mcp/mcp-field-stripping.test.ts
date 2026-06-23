import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { CursorMcp } from "./cursor-mcp.js";
import { toolMcpFactories } from "./mcp-processor.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

/**
 * Cross-generator contract tests (issue #1659) hardening the MCP export paths:
 * `RulesyncMcp.getMcpServers()` omits the rulesync-source-only fields
 * (`targets`, `description`, `exposed`) plus the codex-only `envVars` field, so
 * every NON-codex tool MCP generator (which builds its output from
 * `getMcpServers()`) must never leak those fields into its emitted config.
 *
 * Codex is the deliberate exception: it reads `envVars` directly to emit
 * `env_vars` under `[mcp_servers.<name>]`, so it is excluded.
 *
 * Several generators read-or-initialize their target file on disk, so writes are
 * isolated to a per-test directory: `process.cwd()` is mocked to the test dir
 * (project scope) and `getHomeDirectory()` is mocked to the same dir (global
 * scope), per the testing guidelines.
 */

// `getHomeDirectory()` must be mocked so global-only tools (e.g. augmentcode)
// resolve their config under the test directory instead of the real home dir.
const { getHomeDirectoryMock } = vi.hoisted(() => {
  return { getHomeDirectoryMock: vi.fn() };
});
vi.mock("../../utils/file.js", async () => {
  const actual = await vi.importActual<typeof import("../../utils/file.js")>("../../utils/file.js");
  return {
    ...actual,
    getHomeDirectory: getHomeDirectoryMock,
  };
});

// Field-name / canary-value probes. A probe appearing in emitted output means
// the corresponding rulesync-only field (or its value) leaked through.
const LEAK_PROBES: ReadonlyArray<{ field: string; probe: string }> = [
  { field: "targets (key)", probe: "targets" },
  { field: "description (key)", probe: "description" },
  { field: "description (value)", probe: "RULESYNC_ONLY_DESCRIPTION" },
  { field: "exposed (key)", probe: "exposed" },
  { field: "envVars (key)", probe: "envVars" },
  { field: "envVars (value)", probe: "RULESYNC_ENVVAR_CANARY" },
];

function buildRulesyncMcp(): RulesyncMcp {
  return new RulesyncMcp({
    relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
    relativeFilePath: ".mcp.json",
    fileContent: JSON.stringify({
      mcpServers: {
        "test-server": {
          command: "node",
          args: ["server.js"],
          env: { FOO: "bar" },
          // rulesync-source-only / codex-only fields that must be stripped on emit:
          targets: ["claudecode", "cursor"],
          description: "RULESYNC_ONLY_DESCRIPTION",
          exposed: true,
          envVars: ["RULESYNC_ENVVAR_CANARY"],
        },
      },
    }),
  });
}

const nonCodexFactories = [...toolMcpFactories.entries()].filter(
  ([target]) => target !== "codexcli",
);

describe("MCP field-stripping contract (non-codex generators)", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory({ home: true }));
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
    getHomeDirectoryMock.mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    getHomeDirectoryMock.mockClear();
  });

  it.each(nonCodexFactories)(
    "%s does not leak rulesync-only fields into emitted MCP config",
    async (target, factory) => {
      const rulesyncMcp = buildRulesyncMcp();
      // Global-only MCP tools (e.g. augmentcode) require global mode to emit.
      const global = !factory.meta.supportsProject;
      const toolMcp = await factory.class.fromRulesyncMcp({
        outputRoot: testDir,
        rulesyncMcp,
        validate: false,
        global,
      });
      const content = toolMcp.getFileContent();
      for (const { field, probe } of LEAK_PROBES) {
        expect(content.includes(probe), `${target} leaked ${field}`).toBe(false);
      }
    },
  );
});

describe("Cursor MCP source preservation vs emit stripping (#1659)", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("keeps rulesync-only fields in the source but strips them from cursor output", async () => {
    const rulesyncMcp = buildRulesyncMcp();

    // The rulesync source retains every field verbatim (round-trip fidelity).
    const sourceServer = (
      rulesyncMcp.getJson().mcpServers as Record<string, Record<string, unknown>>
    )["test-server"];
    expect(sourceServer?.targets).toEqual(["claudecode", "cursor"]);
    expect(sourceServer?.description).toBe("RULESYNC_ONLY_DESCRIPTION");
    expect(sourceServer?.exposed).toBe(true);
    expect(sourceServer?.envVars).toEqual(["RULESYNC_ENVVAR_CANARY"]);

    // The cursor emit strips all rulesync-only fields, keeping only the real
    // MCP server config.
    const cursorMcp = await CursorMcp.fromRulesyncMcp({
      outputRoot: testDir,
      rulesyncMcp,
      validate: false,
    });
    const emitted = (cursorMcp.getJson().mcpServers as Record<string, Record<string, unknown>>)[
      "test-server"
    ];
    expect(emitted).toEqual({
      command: "node",
      args: ["server.js"],
      env: { FOO: "bar" },
    });
    expect(emitted?.targets).toBeUndefined();
    expect(emitted?.description).toBeUndefined();
    expect(emitted?.exposed).toBeUndefined();
    expect(emitted?.envVars).toBeUndefined();
  });
});
