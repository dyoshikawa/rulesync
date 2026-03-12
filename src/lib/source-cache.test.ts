import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RULESYNC_SOURCES_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { setupTestDirectory } from "../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../utils/file.js";
import {
  type SourceCacheEntry,
  getOrderedSourceCaches,
  loadAndMergeJsonFeature,
  loadAndMergeTextFeature,
  loadDirItemsFromSources,
  loadFileItemsFromSources,
  sourceKeyToDirName,
} from "./source-cache.js";

vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("sourceKeyToDirName", () => {
  it("should replace slashes with double dashes", () => {
    expect(sourceKeyToDirName("owner/repo")).toBe("owner--repo");
  });

  it("should normalize the key before converting", () => {
    expect(sourceKeyToDirName("https://github.com/Owner/Repo")).toBe("owner--repo");
  });

  it("should handle git URLs", () => {
    expect(sourceKeyToDirName("https://github.com/owner/repo.git")).toBe("owner--repo");
  });

  it("should handle keys without slashes", () => {
    expect(sourceKeyToDirName("single-segment")).toBe("single-segment");
  });
});

describe("getOrderedSourceCaches", () => {
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

  it("should return entries for sources whose cache directories exist", async () => {
    const sourcesDir = join(testDir, RULESYNC_SOURCES_RELATIVE_DIR_PATH);
    await ensureDir(join(sourcesDir, "owner--repo"));
    await ensureDir(join(sourcesDir, "other--repo"));

    const result = await getOrderedSourceCaches({
      baseDir: testDir,
      sources: [{ source: "owner/repo" }, { source: "other/repo" }],
    });

    expect(result).toHaveLength(2);
    expect(result[0]!.sourceKey).toBe("owner/repo");
    expect(result[1]!.sourceKey).toBe("other/repo");
  });

  it("should skip sources whose cache directories do not exist", async () => {
    const sourcesDir = join(testDir, RULESYNC_SOURCES_RELATIVE_DIR_PATH);
    await ensureDir(join(sourcesDir, "owner--repo"));

    const result = await getOrderedSourceCaches({
      baseDir: testDir,
      sources: [{ source: "owner/repo" }, { source: "missing/repo" }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.sourceKey).toBe("owner/repo");
  });

  it("should preserve declaration order from sources array", async () => {
    const sourcesDir = join(testDir, RULESYNC_SOURCES_RELATIVE_DIR_PATH);
    await ensureDir(join(sourcesDir, "second--repo"));
    await ensureDir(join(sourcesDir, "first--repo"));

    const result = await getOrderedSourceCaches({
      baseDir: testDir,
      sources: [{ source: "first/repo" }, { source: "second/repo" }],
    });

    expect(result[0]!.sourceKey).toBe("first/repo");
    expect(result[1]!.sourceKey).toBe("second/repo");
  });
});

describe("loadDirItemsFromSources", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should load skill directories from source caches", async () => {
    const cachePath = join(testDir, "source-a");
    await ensureDir(join(cachePath, "skills", "skill-one"));
    await writeFileContent(join(cachePath, "skills", "skill-one", "SKILL.md"), "# Skill One");

    const sources: SourceCacheEntry[] = [{ sourceKey: "source-a", cachePath }];
    const result = await loadDirItemsFromSources({
      sources,
      featureDirName: "skills",
      localNames: new Set(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("skill-one");
    expect(result[0]!.sourceKey).toBe("source-a");
  });

  it("should skip items that exist locally", async () => {
    const cachePath = join(testDir, "source-a");
    await ensureDir(join(cachePath, "skills", "local-skill"));
    await ensureDir(join(cachePath, "skills", "remote-skill"));

    const sources: SourceCacheEntry[] = [{ sourceKey: "source-a", cachePath }];
    const result = await loadDirItemsFromSources({
      sources,
      featureDirName: "skills",
      localNames: new Set(["local-skill"]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("remote-skill");
  });

  it("should apply first-source-wins for duplicate names", async () => {
    const cacheA = join(testDir, "source-a");
    const cacheB = join(testDir, "source-b");
    await ensureDir(join(cacheA, "skills", "shared-skill"));
    await ensureDir(join(cacheB, "skills", "shared-skill"));

    const sources: SourceCacheEntry[] = [
      { sourceKey: "source-a", cachePath: cacheA },
      { sourceKey: "source-b", cachePath: cacheB },
    ];
    const result = await loadDirItemsFromSources({
      sources,
      featureDirName: "skills",
      localNames: new Set(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.sourceKey).toBe("source-a");
  });
});

describe("loadFileItemsFromSources", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should load rule files from source caches", async () => {
    const cachePath = join(testDir, "source-a");
    await ensureDir(join(cachePath, "rules"));
    await writeFileContent(join(cachePath, "rules", "coding.md"), "# Coding");

    const sources: SourceCacheEntry[] = [{ sourceKey: "source-a", cachePath }];
    const result = await loadFileItemsFromSources({
      sources,
      featureDirName: "rules",
      globPattern: "*.md",
      localNames: new Set(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("coding.md");
  });

  it("should skip files that exist locally", async () => {
    const cachePath = join(testDir, "source-a");
    await ensureDir(join(cachePath, "rules"));
    await writeFileContent(join(cachePath, "rules", "local.md"), "# Local");
    await writeFileContent(join(cachePath, "rules", "remote.md"), "# Remote");

    const sources: SourceCacheEntry[] = [{ sourceKey: "source-a", cachePath }];
    const result = await loadFileItemsFromSources({
      sources,
      featureDirName: "rules",
      globPattern: "*.md",
      localNames: new Set(["local.md"]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("remote.md");
  });

  it("should apply first-source-wins for duplicate file names", async () => {
    const cacheA = join(testDir, "source-a");
    const cacheB = join(testDir, "source-b");
    await ensureDir(join(cacheA, "rules"));
    await ensureDir(join(cacheB, "rules"));
    await writeFileContent(join(cacheA, "rules", "shared.md"), "# From A");
    await writeFileContent(join(cacheB, "rules", "shared.md"), "# From B");

    const sources: SourceCacheEntry[] = [
      { sourceKey: "source-a", cachePath: cacheA },
      { sourceKey: "source-b", cachePath: cacheB },
    ];
    const result = await loadFileItemsFromSources({
      sources,
      featureDirName: "rules",
      globPattern: "*.md",
      localNames: new Set(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.sourceKey).toBe("source-a");
  });
});

describe("loadAndMergeJsonFeature", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should merge JSON from multiple sources with local precedence", async () => {
    const cacheA = join(testDir, "source-a");
    const cacheB = join(testDir, "source-b");
    await ensureDir(cacheA);
    await ensureDir(cacheB);
    await writeFileContent(cacheA + "/mcp.json", JSON.stringify({ servers: { a: 1 } }));
    await writeFileContent(cacheB + "/mcp.json", JSON.stringify({ servers: { b: 2 } }));

    const localContent = { servers: { local: 0 } };
    const sources: SourceCacheEntry[] = [
      { sourceKey: "source-a", cachePath: cacheA },
      { sourceKey: "source-b", cachePath: cacheB },
    ];

    type TestJson = { servers: Record<string, number> };
    const result = await loadAndMergeJsonFeature<TestJson>({
      sources,
      fileName: "mcp.json",
      localContent,
      mergeFn: (base, overlay) => ({
        servers: { ...overlay.servers, ...base.servers },
      }),
    });

    expect(result).toEqual({ servers: { local: 0, a: 1, b: 2 } });
  });

  it("should return undefined when no sources and no local content", async () => {
    const result = await loadAndMergeJsonFeature({
      sources: [],
      fileName: "mcp.json",
      localContent: undefined,
      mergeFn: (base) => base,
    });

    expect(result).toBeUndefined();
  });

  it("should use first source as base when no local content", async () => {
    const cachePath = join(testDir, "source-a");
    await ensureDir(cachePath);
    await writeFileContent(cachePath + "/data.json", JSON.stringify({ value: 42 }));

    const result = await loadAndMergeJsonFeature<{ value: number }>({
      sources: [{ sourceKey: "source-a", cachePath }],
      fileName: "data.json",
      localContent: undefined,
      mergeFn: (base) => base,
    });

    expect(result).toEqual({ value: 42 });
  });
});

describe("loadAndMergeTextFeature", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should merge text from sources after local content", async () => {
    const cachePath = join(testDir, "source-a");
    await ensureDir(cachePath);
    await writeFileContent(join(cachePath, ".aiignore"), "*.bak\n");

    const result = await loadAndMergeTextFeature({
      sources: [{ sourceKey: "source-a", cachePath }],
      fileName: ".aiignore",
      localContent: "*.log\n",
      mergeFn: (base, overlay) => base + overlay,
    });

    expect(result).toBe("*.log\n*.bak\n");
  });

  it("should return undefined when no sources and no local content", async () => {
    const result = await loadAndMergeTextFeature({
      sources: [],
      fileName: ".aiignore",
      localContent: undefined,
      mergeFn: (base, overlay) => base + overlay,
    });

    expect(result).toBeUndefined();
  });
});
