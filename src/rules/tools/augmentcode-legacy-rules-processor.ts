import { join } from "node:path";
import { ToolRulesProcessor } from "../../types/rules-processor.js";
import { fileExists } from "../../utils/file.js";
import { ToolRuleConstructor } from "../types.js";
import { AugmentcodeLegacyRule } from "./augmentcode-legacy-rule.js";
import { BaseToolRulesProcessor } from "./base-tool-rules-processor.js";

export class AugmentcodeLegacyRulesProcessor extends BaseToolRulesProcessor {
  static build(params: { baseDir: string }): ToolRulesProcessor {
    return new AugmentcodeLegacyRulesProcessor(params);
  }

  protected getRuleClass(): ToolRuleConstructor {
    return AugmentcodeLegacyRule as unknown as ToolRuleConstructor;
  }

  protected async getRuleFilePaths(): Promise<string[]> {
    const paths: string[] = [];

    // .augment-guidelines (legacy file)
    const legacyFile = join(this.baseDir, ".augment-guidelines");
    if (await fileExists(legacyFile)) {
      paths.push(legacyFile);
    }

    return paths;
  }
}
