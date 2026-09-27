import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import { ModelsProcessor } from "./models-processor.js";
import { OpencodeModels } from "./opencode-models.js";
import { RulesyncModels } from "./rulesync-models.js";

const SOURCE = {
  providers: {
    local: {
      api: "http://127.0.0.1:5678/v1",
      env: ["LOCAL_MODELS_KEY"],
      models: {
        "ollama/qwen3-coder:30b": {
          id: "ollama/qwen3-coder:30b",
          limit: { context: 131072, output: 16384 },
          tool_call: true,
        },
      },
    },
  },
  default: { provider: "local", model: "ollama/qwen3-coder:30b" },
};

describe("ModelsProcessor", () => {
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

  it("supports opencode at both scopes", () => {
    expect(ModelsProcessor.getToolTargets()).toEqual(["opencode"]);
    expect(ModelsProcessor.getToolTargets({ global: true })).toEqual(["opencode"]);
  });

  it("rejects targets outside the models tuple", () => {
    expect(() => new ModelsProcessor({ toolTarget: "cursor", logger: createMockLogger() })).toThrow(
      /Invalid tool target for ModelsProcessor/,
    );
  });

  it("returns no files when the source is absent", async () => {
    const processor = new ModelsProcessor({
      outputRoot: testDir,
      inputRoots: [join(testDir, ".rulesync")],
      toolTarget: "opencode",
      logger: createMockLogger(),
    });
    expect(await processor.loadRulesyncFiles()).toEqual([]);
  });

  it("generates opencode.json from the source file", async () => {
    await ensureDir(join(testDir, ".rulesync"));
    await writeFileContent(join(testDir, ".rulesync", "models.jsonc"), JSON.stringify(SOURCE));

    const processor = new ModelsProcessor({
      outputRoot: testDir,
      inputRoots: [join(testDir, ".rulesync")],
      toolTarget: "opencode",
      logger: createMockLogger(),
    });
    const rulesyncFiles = await processor.loadRulesyncFiles();
    expect(rulesyncFiles).toHaveLength(1);

    const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
    expect(toolFiles).toHaveLength(1);
    expect(toolFiles[0]).toBeInstanceOf(OpencodeModels);

    const { count } = await processor.writeAiFiles(toolFiles);
    expect(count).toBe(1);
    const written = JSON.parse(await readFileContent(toolFiles[0]!.getFilePath()));
    expect(written.model).toBe("local/ollama/qwen3-coder:30b");
    expect(written.provider.local.options).toEqual({
      baseURL: "http://127.0.0.1:5678/v1",
      apiKey: "{env:LOCAL_MODELS_KEY}",
    });
  });

  it("imports opencode.json back into a rulesync source", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        provider: { local: { options: { baseURL: "http://x/v1" }, models: {} } },
        model: "local/m",
      }),
    );

    const processor = new ModelsProcessor({
      outputRoot: testDir,
      toolTarget: "opencode",
      logger: createMockLogger(),
    });
    const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(
      await processor.loadToolFiles(),
    );
    expect(rulesyncFiles).toHaveLength(1);
    expect(rulesyncFiles[0]).toBeInstanceOf(RulesyncModels);
  });
});
