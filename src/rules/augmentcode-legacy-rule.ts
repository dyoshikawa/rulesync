import { join } from "node:path";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
} from "./tool-rule.js";

export type AugmentcodeLegacyRuleParams = ToolRuleParams;

export class AugmentcodeLegacyRule extends ToolRule {
  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      root: this.isRoot(),
      targets: ["*"],
      description: "",
      globs: this.isRoot() ? ["**/*"] : [],
    };

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    return new AugmentcodeLegacyRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: { relativeDirPath: ".", relativeFilePath: ".augment-guidelines" },
        nonRootPath: { relativeDirPath: ".augment/rules" },
      }),
    );
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<AugmentcodeLegacyRule> {
    // Determine if it's a root file
    const isRoot = relativeFilePath === ".augment-guidelines";
    const relativePath = isRoot ? ".augment-guidelines" : join(".augment/rules", relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new AugmentcodeLegacyRule({
      baseDir: baseDir,
      relativeDirPath: isRoot ? "." : ".augment/rules",
      relativeFilePath: isRoot ? ".augment-guidelines" : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }
}
