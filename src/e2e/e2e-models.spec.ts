import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ModelsProcessor } from "../features/models/models-processor.js";
import { readFileContent, writeFileContent } from "../utils/file.js";
import {
  assertGenerateMatrixCoversTargets,
  runGenerate,
  runImport,
  useTestDirectory,
} from "./e2e-helper.js";

describe("e2e: models", () => {
  const { getTestDir } = useTestDirectory();

  it("generates opencode provider config from models.jsonc", async () => {
    const testDir = getTestDir();
    await writeFileContent(
      join(testDir, ".rulesync", "models.jsonc"),
      JSON.stringify({
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
      }),
    );

    await runGenerate({ target: "opencode", features: "models" });

    const written = JSON.parse(await readFileContent(join(testDir, "opencode.jsonc")));
    expect(written.model).toBe("local/ollama/qwen3-coder:30b");
    expect(written.provider.local.options).toEqual({
      baseURL: "http://127.0.0.1:5678/v1",
      apiKey: "{env:LOCAL_MODELS_KEY}",
    });
    expect(written.provider.local.models["ollama/qwen3-coder:30b"].limit).toEqual({
      context: 131072,
      output: 16384,
    });
  });

  it("imports opencode provider config back into models.jsonc", async () => {
    const testDir = getTestDir();
    await writeFileContent(
      join(testDir, "opencode.json"),
      JSON.stringify({
        provider: {
          local: {
            options: { baseURL: "http://127.0.0.1:5678/v1", apiKey: "{env:LOCAL_MODELS_KEY}" },
            models: {
              "ollama/qwen3-coder:30b": { limit: { context: 131072, output: 16384 } },
            },
          },
        },
        model: "local/ollama/qwen3-coder:30b",
      }),
    );

    await runImport({ target: "opencode", features: "models" });

    const imported = JSON.parse(await readFileContent(join(testDir, ".rulesync", "models.jsonc")));
    expect(imported.providers.local.api).toBe("http://127.0.0.1:5678/v1");
    expect(imported.providers.local.env).toEqual(["LOCAL_MODELS_KEY"]);
    expect(imported.default).toEqual({ provider: "local", model: "ollama/qwen3-coder:30b" });
  });

  it("covers every models target in the generate matrix", () => {
    assertGenerateMatrixCoversTargets({
      processor: ModelsProcessor,
      testedTargets: ["opencode"],
    });
  });
});
