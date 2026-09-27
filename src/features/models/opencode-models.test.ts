import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, readFileContent, writeFileContent } from "../../utils/file.js";
import {
  OpencodeModels,
  toOpencodeApiKey,
  toOpencodeDefault,
  toOpencodeProviders,
} from "./opencode-models.js";
import { RulesyncModels } from "./rulesync-models.js";

const SOURCE = {
  providers: {
    local: {
      name: "Local models",
      npm: "@ai-sdk/openai-compatible",
      api: "http://127.0.0.1:5678/v1",
      env: ["LOCAL_MODELS_KEY"],
      models: {
        "ollama/qwen3-coder:30b": {
          id: "ollama/qwen3-coder:30b",
          name: "Qwen3 Coder 30B",
          limit: { context: 131072, output: 16384 },
          tool_call: true,
          reasoning: false,
          modalities: { input: ["text"], output: ["text"] },
        },
      },
    },
  },
  default: { provider: "local", model: "ollama/qwen3-coder:30b" },
};

function rulesyncModels(outputRoot: string): RulesyncModels {
  return new RulesyncModels({
    outputRoot,
    relativeDirPath: ".rulesync",
    relativeFilePath: "models.jsonc",
    fileContent: JSON.stringify(SOURCE),
  });
}

describe("OpencodeModels", () => {
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

  describe("getSettablePaths", () => {
    it("writes opencode.json at the project root and in global mode", () => {
      expect(OpencodeModels.getSettablePaths().relativeFilePath).toBe("opencode.json");
      expect(OpencodeModels.getSettablePaths({ global: true }).relativeDirPath).toBe(
        join(".config", "opencode"),
      );
    });
  });

  it("maps providers with the {env:VAR} key spelling and never a literal key", () => {
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
  });

  it("patches only provider/model keys and keeps every other key", async () => {
    const existing = { $schema: "https://opencode.ai/config.json", mcp: {}, model: "old/x" };
    await writeFileContent(join(testDir, "opencode.json"), JSON.stringify(existing));

    const toolModels = await OpencodeModels.fromRulesyncModels({
      outputRoot: testDir,
      rulesyncModels: rulesyncModels(testDir),
      logger: createMockLogger(),
    });
    const written = JSON.parse(toolModels.getFileContent());
    expect(written.mcp).toEqual({});
    expect(written.model).toBe("local/ollama/qwen3-coder:30b");
    expect(written.provider.local.options.apiKey).toBe("{env:LOCAL_MODELS_KEY}");
  });

  it("round-trips opencode.json back into the canonical source", async () => {
    await ensureDir(testDir);
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        provider: {
          local: {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: "http://127.0.0.1:5678/v1", apiKey: "{env:LOCAL_MODELS_KEY}" },
            models: {
              "ollama/qwen3-coder:30b": {
                name: "Qwen3 Coder 30B",
                limit: { context: 131072, output: 16384 },
                tool_call: true,
              },
            },
          },
        },
        model: "local/ollama/qwen3-coder:30b",
      }),
    );

    const toolModels = await OpencodeModels.fromFile({ outputRoot: testDir });
    const rulesync = toolModels.toRulesyncModels();
    const json = rulesync.getJson();
    expect(json.providers.local?.api).toBe("http://127.0.0.1:5678/v1");
    expect(json.providers.local?.env).toEqual(["LOCAL_MODELS_KEY"]);
    expect(json.providers.local?.models?.["ollama/qwen3-coder:30b"]?.limit).toEqual({
      context: 131072,
      output: 16384,
    });
    expect(json.default).toEqual({ provider: "local", model: "ollama/qwen3-coder:30b" });
  });

  it("drops prototype-pollution keys on import instead of writing them", async () => {
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        provider: {
          local: { models: { m: {} } },
          __proto__: { models: {} },
        },
      }),
    );

    const toolModels = await OpencodeModels.fromFile({ outputRoot: testDir });
    expect(Object.keys(toolModels.toRulesyncModels().getProviders())).toEqual(["local"]);
  });

  it("is never deletable because opencode.json holds other settings", () => {
    expect(
      OpencodeModels.forDeletion({
        outputRoot: testDir,
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
      }).isDeletable(),
    ).toBe(false);
  });

  it("reads the written file back from disk", async () => {
    await writeFileContent(join(testDir, "opencode.json"), JSON.stringify({ provider: {} }));
    const toolModels = await OpencodeModels.fromRulesyncModels({
      outputRoot: testDir,
      rulesyncModels: rulesyncModels(testDir),
      logger: createMockLogger(),
    });
    await writeFileContent(join(testDir, "opencode.json"), toolModels.getFileContent());
    expect(JSON.parse(await readFileContent(join(testDir, "opencode.json"))).model).toBe(
      "local/ollama/qwen3-coder:30b",
    );
  });
});
