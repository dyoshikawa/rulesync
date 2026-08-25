// cspell:ignore cursorr rulez somethingelse -- deliberate typos used as fixtures
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_CONFIG_SCHEMA_URL,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { CLIError } from "../../types/json-output.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import {
  collectConfigFileDiagnostics,
  collectMergedConfigDiagnostics,
  doctorCommand,
  levenshteinDistance,
  offsetToPosition,
  suggestNearest,
} from "./doctor.js";

const FILE = "rulesync.jsonc";

function codesOf(diagnostics: ReturnType<typeof collectConfigFileDiagnostics>): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance({ a: "targets", b: "targets" })).toBe(0);
  });

  it("counts insertions, deletions and substitutions", () => {
    expect(levenshteinDistance({ a: "target", b: "targets" })).toBe(1);
    expect(levenshteinDistance({ a: "cursor", b: "cursorr" })).toBe(1);
    expect(levenshteinDistance({ a: "kitten", b: "sitting" })).toBe(3);
    expect(levenshteinDistance({ a: "", b: "abc" })).toBe(3);
  });
});

describe("suggestNearest", () => {
  it("suggests the closest candidate for a plausible typo", () => {
    expect(suggestNearest({ input: "target", candidates: ["targets", "features"] })).toBe(
      "targets",
    );
    expect(suggestNearest({ input: "cursorr", candidates: ["cursor", "copilot"] })).toBe("cursor");
  });

  it("returns undefined when nothing is close enough", () => {
    expect(
      suggestNearest({ input: "somethingelse", candidates: ["targets", "features"] }),
    ).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(suggestNearest({ input: "Targets", candidates: ["targets"] })).toBe("targets");
  });
});

describe("offsetToPosition", () => {
  it("computes 1-based line and column", () => {
    const content = '{\n  "a": 1,\n  "b": }\n';
    expect(offsetToPosition({ content, offset: 0 })).toEqual({ line: 1, column: 1 });
    expect(offsetToPosition({ content, offset: content.indexOf('"b"') })).toEqual({
      line: 3,
      column: 3,
    });
  });

  it("clamps offsets beyond the content length", () => {
    expect(offsetToPosition({ content: "ab", offset: 100 })).toEqual({ line: 1, column: 3 });
  });
});

describe("collectConfigFileDiagnostics", () => {
  it("returns no diagnostics for a clean config", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: ["claudecode", "copilot"],
      features: ["rules", "mcp"],
    });
    expect(collectConfigFileDiagnostics({ file: FILE, content })).toEqual([]);
  });

  it("reports JSONC parse errors with line and column", () => {
    const content = '{\n  "targets": [,]\n}\n';
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content });
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]).toMatchObject({
      severity: "error",
      code: "config/parse-error",
      file: FILE,
      line: 2,
    });
  });

  it("accepts comments and trailing commas (JSONC)", () => {
    const content = `{
      // comment
      "$schema": "${RULESYNC_CONFIG_SCHEMA_URL}",
      "targets": ["claudecode",],
    }`;
    expect(collectConfigFileDiagnostics({ file: FILE, content })).toEqual([]);
  });

  it("warns on an empty file", () => {
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content: "" });
    expect(codesOf(diagnostics)).toEqual(["config/empty-file"]);
  });

  it("errors when the root is not an object", () => {
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content: '["claudecode"]' });
    expect(codesOf(diagnostics)).toEqual(["config/not-an-object"]);
  });

  it("reports unknown top-level keys with a did-you-mean hint", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      target: ["claudecode"],
    });
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content });
    const unknownKey = diagnostics.find((d) => d.code === "config/unknown-key");
    expect(unknownKey).toMatchObject({
      severity: "error",
      message: expect.stringContaining("'target'"),
      hint: "Did you mean 'targets'?",
    });
  });

  it("reports unknown targets in array form with a suggestion", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: ["cursorr"],
    });
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "config/unknown-target",
        severity: "error",
        hint: "Did you mean 'cursor'?",
      }),
    ]);
  });

  it("accepts the wildcard target in array form", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: ["*"],
    });
    expect(collectConfigFileDiagnostics({ file: FILE, content })).toEqual([]);
  });

  it("rejects the wildcard key in object-form targets", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: { "*": ["rules"] },
    });
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content });
    expect(codesOf(diagnostics)).toEqual(["config/invalid-value"]);
  });

  it("reports unknown feature names inside object-form targets", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: { claudecode: ["rulez"] },
    });
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "config/unknown-feature",
        hint: "Did you mean 'rules'?",
      }),
    ]);
  });

  it("accepts per-feature object form including gitignoreDestination", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: { claudecode: { rules: true, gitignoreDestination: "gitattributes" } },
    });
    expect(collectConfigFileDiagnostics({ file: FILE, content })).toEqual([]);
  });

  it("warns on the deprecated ignore feature", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: ["claudecode"],
      features: ["rules", "ignore"],
    });
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "config/deprecated-feature",
        severity: "warning",
        hint: "Use the 'permissions' feature instead.",
      }),
    ]);
  });

  it("errors when object-form targets is combined with features", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: { claudecode: ["rules"] },
      features: ["rules"],
    });
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content });
    expect(codesOf(diagnostics)).toContain("config/targets-features-conflict");
  });

  it("errors on conflicting target pairs", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: ["claudecode", "claudecode-legacy"],
    });
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content });
    expect(codesOf(diagnostics)).toContain("config/conflicting-targets");
  });

  it("emits an info when $schema is missing", () => {
    const content = JSON.stringify({ targets: ["claudecode"] });
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "config/missing-schema", severity: "info" }),
    ]);
  });

  it("warns when $schema points elsewhere", () => {
    const content = JSON.stringify({
      $schema: "https://example.com/old-schema.json",
      targets: ["claudecode"],
    });
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "config/outdated-schema", severity: "warning" }),
    ]);
  });

  it("warns when a source tokenEnv variable is not set", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: ["claudecode"],
      sources: [
        {
          source: "org/pkg",
          transport: "npm",
          registry: "https://registry.example.com",
          tokenEnv: "MY_UNSET_TOKEN",
        },
      ],
    });
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content, env: {} });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "config/token-env-not-set", severity: "warning" }),
    ]);
  });

  it("does not warn when the tokenEnv variable is set", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: ["claudecode"],
      sources: [
        {
          source: "org/pkg",
          transport: "npm",
          registry: "https://registry.example.com",
          tokenEnv: "MY_TOKEN",
        },
      ],
    });
    const diagnostics = collectConfigFileDiagnostics({
      file: FILE,
      content,
      env: { MY_TOKEN: "secret" },
    });
    expect(diagnostics).toEqual([]);
  });

  it("surfaces schema violations on other keys as invalid-value errors", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: ["claudecode"],
      verbose: "yes",
    });
    const diagnostics = collectConfigFileDiagnostics({ file: FILE, content });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "config/invalid-value",
        message: expect.stringContaining("'verbose'"),
      }),
    ]);
  });

  it("reports source entry violations (registry without npm transport)", () => {
    const content = JSON.stringify({
      $schema: RULESYNC_CONFIG_SCHEMA_URL,
      targets: ["claudecode"],
      sources: [{ source: "org/repo", registry: "https://registry.example.com" }],
    });
    const diagnostics = collectConfigFileDiagnostics({
      file: FILE,
      content,
      env: {},
    });
    expect(codesOf(diagnostics)).toContain("config/invalid-value");
  });
});

describe("collectMergedConfigDiagnostics", () => {
  const baseFile = "rulesync.jsonc";
  const localFile = "rulesync.local.jsonc";

  it("reports a conflict produced only by merging the two files", () => {
    const diagnostics = collectMergedConfigDiagnostics({
      baseConfig: { features: ["rules"] },
      localConfig: { targets: { claudecode: ["rules"] } },
      baseFile,
      localFile,
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "config/targets-features-conflict", severity: "error" }),
    ]);
  });

  it("returns nothing when either file is missing", () => {
    expect(
      collectMergedConfigDiagnostics({
        baseConfig: undefined,
        localConfig: { targets: { claudecode: ["rules"] } },
        baseFile,
        localFile,
      }),
    ).toEqual([]);
  });

  it("returns nothing when the merged state is valid", () => {
    expect(
      collectMergedConfigDiagnostics({
        baseConfig: { targets: ["claudecode"] },
        localConfig: { features: ["rules"] },
        baseFile,
        localFile,
      }),
    ).toEqual([]);
  });

  it("skips the merge diagnostic when one file already carries the conflict", () => {
    expect(
      collectMergedConfigDiagnostics({
        baseConfig: { targets: { claudecode: ["rules"] }, features: ["rules"] },
        localConfig: {},
        baseFile,
        localFile,
      }),
    ).toEqual([]);
  });
});

describe("doctorCommand", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    mockLogger = createMockLogger();
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  it("succeeds on a clean configuration (end-to-end happy path)", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode", "copilot"],
        features: ["rules", "mcp"],
      }),
    );

    await doctorCommand(mockLogger, {});

    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.success).toHaveBeenCalledWith(expect.stringContaining("No problems found"));
  });

  it("reports defaults info when no config file exists and still succeeds", async () => {
    await doctorCommand(mockLogger, {});

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("config/no-config-file"));
    expect(mockLogger.success).toHaveBeenCalled();
  });

  it("throws a CLIError when the config contains errors", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({ target: ["claudecode"] }),
    );

    await expect(doctorCommand(mockLogger, {})).rejects.toThrow(CLIError);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("config/unknown-key"));
  });

  it("treats warnings as errors with --strict", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        features: ["ignore"],
      }),
    );

    await doctorCommand(mockLogger, {});
    await expect(doctorCommand(mockLogger, { strict: true })).rejects.toThrow(CLIError);
  });

  it("detects conflicts produced by merging base and local config files", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({ $schema: RULESYNC_CONFIG_SCHEMA_URL, features: ["rules"] }),
    );
    await writeFileContent(
      join(testDir, "rulesync.local.jsonc"),
      JSON.stringify({ $schema: RULESYNC_CONFIG_SCHEMA_URL, targets: { claudecode: ["rules"] } }),
    );

    await expect(doctorCommand(mockLogger, {})).rejects.toThrow(CLIError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("config/targets-features-conflict"),
    );
  });

  it("errors when inputRoot does not exist", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoot: join(testDir, "does-not-exist"),
      }),
    );

    await expect(doctorCommand(mockLogger, {})).rejects.toThrow(CLIError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("config/input-root-not-found"),
    );
  });

  it("accepts an existing inputRoot", async () => {
    await ensureDir(join(testDir, "central", RULESYNC_RELATIVE_DIR_PATH));
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoot: join(testDir, "central"),
      }),
    );

    await doctorCommand(mockLogger, {});
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("preserves the inputRoots field name for a one-element array", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoots: [join(testDir, "missing")],
      }),
    );

    await expect(doctorCommand(mockLogger, {})).rejects.toThrow(CLIError);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("'inputRoots' entry"));
  });

  it("uses merged-field precedence when base inputRoots and local inputRoot coexist", async () => {
    const baseRoot = join(testDir, "base");
    await ensureDir(baseRoot);
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoots: [baseRoot],
      }),
    );
    await writeFileContent(
      join(testDir, "rulesync.local.jsonc"),
      JSON.stringify({ inputRoot: join(testDir, "missing-local-parent") }),
    );

    await doctorCommand(mockLogger, {});

    expect(mockLogger.error).not.toHaveBeenCalledWith(
      expect.stringContaining("config/input-root-not-found"),
    );
  });

  it("diagnoses inputRoot and inputRoots in the same config file", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoot: join(testDir, "parent"),
        inputRoots: [join(testDir, "source")],
      }),
    );

    await expect(doctorCommand(mockLogger, {})).rejects.toThrow(CLIError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("config/input-roots-conflict"),
    );
  });

  it("accepts a missing optional overlay input root", async () => {
    await ensureDir(join(testDir, "base"));
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoots: [join(testDir, "base"), join(testDir, "missing")],
      }),
    );

    await doctorCommand(mockLogger, {});
    expect(mockLogger.error).not.toHaveBeenCalledWith(
      expect.stringContaining("config/input-root-not-found"),
    );
  });

  it("errors when the primary inputRoots entry does not exist", async () => {
    const overlay = join(testDir, "overlay");
    await ensureDir(overlay);
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoots: [join(testDir, "missing"), overlay],
      }),
    );

    await expect(doctorCommand(mockLogger, {})).rejects.toThrow(CLIError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("config/input-root-not-found"),
    );
  });

  it("errors when an optional overlay exists but is not a directory", async () => {
    const base = join(testDir, "base");
    const overlayFile = join(testDir, "overlay-file");
    await ensureDir(base);
    await writeFileContent(overlayFile, "not a directory");
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoots: [base, overlayFile],
      }),
    );

    await expect(doctorCommand(mockLogger, {})).rejects.toThrow(CLIError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("config/input-root-not-found"),
    );
  });

  it("warns on duplicate inputRoots entries", async () => {
    const shared = join(testDir, "shared");
    await ensureDir(shared);
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoots: [shared, shared],
      }),
    );

    await doctorCommand(mockLogger, {});
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("config/input-roots-duplicate"),
    );
  });

  it("reports an inputRoots entry that is not a non-empty string instead of dropping it", async () => {
    const base = join(testDir, "base");
    await ensureDir(base);
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoots: [base, 42, ""],
      }),
    );

    await expect(doctorCommand(mockLogger, {})).rejects.toThrow(CLIError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("'inputRoots[1]' must be a non-empty string"),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("'inputRoots[2]' must be a non-empty string"),
    );
  });

  it("reports an inputRoots value that is not an array", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoots: "./.rulesync",
      }),
    );

    await expect(doctorCommand(mockLogger, {})).rejects.toThrow(CLIError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("'inputRoots' must be an array of non-empty strings"),
    );
  });

  it("reports an empty inputRoots list", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoots: [],
      }),
    );

    await expect(doctorCommand(mockLogger, {})).rejects.toThrow(CLIError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("'inputRoots' is an empty list"),
    );
  });

  it("reports an inputRoot that is not a non-empty string", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoot: "",
      }),
    );

    await expect(doctorCommand(mockLogger, {})).rejects.toThrow(CLIError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("'inputRoot' must be a non-empty string"),
    );
  });

  it("accepts an inputRoots array of existing directories", async () => {
    const base = join(testDir, "base");
    const overlay = join(testDir, "overlay");
    await ensureDir(base);
    await ensureDir(overlay);
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({
        $schema: RULESYNC_CONFIG_SCHEMA_URL,
        targets: ["claudecode"],
        inputRoots: [base, overlay],
      }),
    );

    await doctorCommand(mockLogger, {});
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("config/input-roots-duplicate"),
    );
  });

  it("honors the --config option", async () => {
    await ensureDir(join(testDir, "nested"));
    await writeFileContent(
      join(testDir, "nested", "custom.jsonc"),
      JSON.stringify({ target: ["claudecode"] }),
    );

    await expect(
      doctorCommand(mockLogger, { config: join("nested", "custom.jsonc") }),
    ).rejects.toThrow(CLIError);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("config/unknown-key"));
  });

  it("captures diagnostics in JSON mode", async () => {
    const jsonLogger = { ...createMockLogger(), jsonMode: true };
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      JSON.stringify({ $schema: RULESYNC_CONFIG_SCHEMA_URL, targets: ["cursorr"] }),
    );

    await expect(doctorCommand(jsonLogger, {})).rejects.toThrow(CLIError);
    expect(jsonLogger.captureData).toHaveBeenCalledWith(
      "diagnostics",
      expect.arrayContaining([expect.objectContaining({ code: "config/unknown-target" })]),
    );
    expect(jsonLogger.captureData).toHaveBeenCalledWith(
      "summary",
      expect.objectContaining({ errors: 1 }),
    );
  });
});
