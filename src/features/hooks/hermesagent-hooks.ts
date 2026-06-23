import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_GLOBAL_DIR,
} from "../../constants/hermesagent-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { mergeHermesConfig, parseHermesConfig, stringifyHermesConfig } from "../hermes-config.js";
import { RulesyncHooks } from "./rulesync-hooks.js";
import { ToolHooks, type ToolHooksFromRulesyncHooksParams } from "./tool-hooks.js";

type HermesagentHooksParams = Omit<AiFileParams, "relativeDirPath" | "relativeFilePath">;

export class HermesagentHooks extends ToolHooks {
  static getSettablePaths() {
    return {
      relativeDirPath: HERMESAGENT_GLOBAL_DIR,
      relativeFilePath: HERMESAGENT_CONFIG_FILE_NAME,
    };
  }

  constructor(params: HermesagentHooksParams) {
    super({
      ...params,
      ...HermesagentHooks.getSettablePaths(),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  setFileContent(fileContent: string): void {
    this.fileContent = mergeHermesConfig(this.fileContent, parseHermesConfig(fileContent));
  }

  toRulesyncHooks(): RulesyncHooks {
    const config = parseHermesConfig(this.getFileContent());
    const hooks =
      config.hooks && typeof config.hooks === "object"
        ? (config.hooks as Record<string, unknown>).rulesync
        : {};
    return new RulesyncHooks({
      relativeDirPath: "",
      relativeFilePath: ".rulesync/hooks.json",
      fileContent: JSON.stringify(hooks ?? {}, null, 2),
    });
  }

  static fromRulesyncHooks({
    outputRoot,
    rulesyncHooks,
  }: ToolHooksFromRulesyncHooksParams): HermesagentHooks {
    return new HermesagentHooks({
      outputRoot,
      fileContent: stringifyHermesConfig({
        hooks: {
          rulesync: rulesyncHooks.getJson(),
        },
      }),
    });
  }
}
