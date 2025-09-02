import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

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

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<AugmentcodeLegacyRule> {
    // Read file content
    const fileContent = await readFileContent(filePath);

    // Determine if it's a root file
    const isRoot = relativeFilePath === ".augment-guidelines";

    return new AugmentcodeLegacyRule({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }
}
