import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import {
  forTargetModelConfig,
  RulesyncModels,
  RulesyncModelsFileSchema,
} from "./rulesync-models.js";

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
    "opencode-go": {
      name: "OpenCode Go",
      api: "https://opencode.ai/zen/go/v1",
      env: ["OPENCODE_API_KEY"],
      models: {},
    },
  },
  default: { provider: "local", model: "ollama/qwen3-coder:30b" },
  opencode: { default: { provider: "opencode-go", model: "glm-5.3" } },
};

describe("RulesyncModels", () => {
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

  it("accepts a models.dev-shaped source file", () => {
    expect(RulesyncModelsFileSchema.safeParse(SOURCE).success).toBe(true);
  });

  it("rejects a provider without models.dev field shapes", () => {
    const parsed = RulesyncModelsFileSchema.safeParse({
      providers: { local: { models: { m: { limit: { context: "lots" } } } } },
    });
    expect(parsed.success).toBe(false);
  });

  it("loads from the recommended models.jsonc path", async () => {
    await ensureDir(join(testDir, ".rulesync"));
    await writeFileContent(join(testDir, ".rulesync", "models.jsonc"), JSON.stringify(SOURCE));
    const models = await RulesyncModels.fromRoots({
      inputRoots: [join(testDir, ".rulesync")],
      logger: createMockLogger(),
    });
    expect(Object.keys(models.getProviders())).toEqual(["local", "opencode-go"]);
    expect(models.getDefault()).toEqual({ provider: "local", model: "ollama/qwen3-coder:30b" });
  });

  it("raises a not-found error when no source exists", async () => {
    await expect(
      RulesyncModels.fromRoots({
        inputRoots: [join(testDir, ".rulesync")],
        logger: createMockLogger(),
      }),
    ).rejects.toThrow(/No .*models\.jsonc found/);
  });

  it("resolves the tool-scoped default over the shared default", () => {
    const config = RulesyncModelsFileSchema.parse(SOURCE);
    expect(forTargetModelConfig({ config, toolTarget: "opencode" }).default).toEqual({
      provider: "opencode-go",
      model: "glm-5.3",
    });
    expect(forTargetModelConfig({ config, toolTarget: "hermesagent" }).default).toEqual({
      provider: "local",
      model: "ollama/qwen3-coder:30b",
    });
  });
});
