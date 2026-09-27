import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import { ModelsProcessor } from "./models-processor.js";
import {
  OpencodeModels,
  toOpencodeApiKey,
  toOpencodeDefault,
  toOpencodeProviders,
} from "./opencode-models.js";
import {
  forTargetModelConfig,
  RulesyncModels,
  RulesyncModelsFileSchema,
} from "./rulesync-models.js";

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
  opencode: { default: { provider: "opencode-go", model: "glm-5.3" } },
};

function rulesyncModels(outputRoot: string): RulesyncModels {
  return new RulesyncModels({
    outputRoot,
    relativeDirPath: ".rulesync",
    relativeFilePath: "models.jsonc",
    fileContent: JSON.stringify(SOURCE),
  });
}

describe("models", () => {
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

  it("accepts a models.dev-shaped source file and rejects bad shapes", () => {
    expect(RulesyncModelsFileSchema.safeParse(SOURCE).success).toBe(true);
    expect(
      RulesyncModelsFileSchema.safeParse({
        providers: { local: { models: { m: { limit: { context: "lots" } } } } },
      }).success,
    ).toBe(false);
  });

  it("loads from models.jsonc and resolves the tool-scoped default", async () => {
    await ensureDir(join(testDir, ".rulesync"));
    await writeFileContent(join(testDir, ".rulesync", "models.jsonc"), JSON.stringify(SOURCE));
    const models = await RulesyncModels.fromRoots({
      inputRoots: [join(testDir, ".rulesync")],
      logger: createMockLogger(),
    });
    expect(Object.keys(models.getJson().providers)).toEqual(["local"]);
    const config = RulesyncModelsFileSchema.parse(SOURCE);
    expect(forTargetModelConfig({ config, toolTarget: "opencode" }).default).toEqual({
      provider: "opencode-go",
      model: "glm-5.3",
    });
    expect(forTargetModelConfig({ config, toolTarget: "hermesagent" }).default).toEqual(
      SOURCE.default,
    );
  });

  it("reports absence as not-found and loads nothing without a source", async () => {
    await expect(
      RulesyncModels.fromRoots({
        inputRoots: [join(testDir, ".rulesync")],
        logger: createMockLogger(),
      }),
    ).rejects.toThrow(/No .*models\.jsonc found/);
    const processor = new ModelsProcessor({
      outputRoot: testDir,
      inputRoots: [join(testDir, ".rulesync")],
      toolTarget: "opencode",
      logger: createMockLogger(),
    });
    expect(await processor.loadRulesyncFiles()).toEqual([]);
  });

  it("maps providers with {env:VAR} keys and never a literal key", () => {
    const out = toOpencodeProviders(JSON.parse(JSON.stringify(SOURCE.providers)));
    expect(out.local?.options).toEqual({
      baseURL: "http://127.0.0.1:5678/v1",
      apiKey: "{env:LOCAL_MODELS_KEY}",
    });
    expect(out.local?.models["ollama/qwen3-coder:30b"]?.limit).toEqual({
      context: 131072,
      output: 16384,
    });
    expect(toOpencodeApiKey(undefined)).toBeUndefined();
    expect(toOpencodeDefault(SOURCE.default)).toBe("local/ollama/qwen3-coder:30b");
    expect(toOpencodeDefault(undefined)).toBeUndefined();
    expect(OpencodeModels.getSettablePaths({ global: true }).relativeDirPath).toBe(
      join(".config", "opencode"),
    );
  });

  it("patches only provider/model keys and keeps every other key", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({ mcp: {}, model: "old/x" }),
    );
    const toolModels = await OpencodeModels.fromRulesyncModels({
      outputRoot: testDir,
      rulesyncModels: rulesyncModels(testDir),
      logger: createMockLogger(),
    });
    const written = JSON.parse(toolModels.getFileContent());
    expect(written.mcp).toEqual({});
    expect(written.model).toBe("opencode-go/glm-5.3");
    expect(written.provider.local.options.apiKey).toBe("{env:LOCAL_MODELS_KEY}");
    expect(
      OpencodeModels.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
      }).isDeletable(),
    ).toBe(false);
  });

  it("supports opencode and rejects other targets", () => {
    expect(ModelsProcessor.getToolTargets({ global: true })).toEqual(["opencode"]);
    expect(() => new ModelsProcessor({ toolTarget: "cursor", logger: createMockLogger() })).toThrow(
      /Invalid tool target for ModelsProcessor/,
    );
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
    const toolFiles = await processor.convertRulesyncFilesToToolFiles(
      await processor.loadRulesyncFiles(),
    );
    expect(toolFiles[0]).toBeInstanceOf(OpencodeModels);
    expect((await processor.writeAiFiles(toolFiles)).count).toBe(1);
    const written = JSON.parse(await readFileContent(toolFiles[0]!.getFilePath()));
    expect(written.model).toBe("opencode-go/glm-5.3");
  });
});
