import { basename, join } from "node:path";

import { dump, load } from "js-yaml";
import { z } from "zod/mini";

import {
  GOOSE_GLOBAL_RECIPES_SUBAGENTS_DIR_PATH,
  GOOSE_RECIPES_SUBAGENTS_DIR_PATH,
} from "../../constants/goose-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

const RECIPE_VERSION = "1.0.0";

/**
 * Goose sub-recipes are ordinary recipe files referenced from a parent recipe's
 * `sub_recipes` list to run a specialized task. rulesync maps a subagent to such
 * a recipe whose `instructions` is the subagent body, written under
 * `.goose/recipes/subagents/` (project) and `~/.config/goose/recipes/subagents/`
 * (global). Keeping them in a subdirectory makes the command-recipe and
 * subagent-recipe file sets disjoint so import/orphan-deletion never overlap.
 *
 * The whole file is a YAML recipe mapping. Beyond the canonical
 * `version`/`title`/`description`/`instructions`, any extra recipe field
 * (`parameters`, `extensions`, `sub_recipes`, …) round-trips through the
 * rulesync `goose` subagent section.
 *
 * @see https://block.github.io/goose/docs/guides/recipes/sub-recipes/
 */
export const GooseSubagentRecipeSchema = z.looseObject({
  version: z.optional(z.string()),
  title: z.optional(z.string()),
  description: z.optional(z.string()),
  instructions: z.optional(z.string()),
  prompt: z.optional(z.string()),
});

export type GooseSubagentRecipe = z.infer<typeof GooseSubagentRecipeSchema>;

export type GooseSubagentParams = {
  recipe: GooseSubagentRecipe;
} & AiFileParams;

export class GooseSubagent extends ToolSubagent {
  private readonly recipe: GooseSubagentRecipe;

  constructor({ recipe, ...rest }: GooseSubagentParams) {
    if (rest.validate !== false) {
      const result = GooseSubagentRecipeSchema.safeParse(recipe);
      if (!result.success) {
        throw new Error(
          `Invalid Goose recipe in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }
    super({ ...rest });
    this.recipe = recipe;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: global
        ? GOOSE_GLOBAL_RECIPES_SUBAGENTS_DIR_PATH
        : GOOSE_RECIPES_SUBAGENTS_DIR_PATH,
    };
  }

  getBody(): string {
    return this.recipe.instructions ?? this.recipe.prompt ?? "";
  }

  getRecipe(): GooseSubagentRecipe {
    return this.recipe;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { instructions: _instructions, title, description, ...restFields } = this.recipe;

    const gooseSection: Record<string, unknown> = { ...restFields };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name: title ?? basename(this.getRelativeFilePath()).replace(/\.ya?ml$/, ""),
      description: description ?? "",
      ...(Object.keys(gooseSection).length > 0 && { goose: gooseSection }),
    };

    return new RulesyncSubagent({
      outputRoot: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath().replace(/\.ya?ml$/, ".md"),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): GooseSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const gooseSection: Record<string, unknown> = {
      ...this.filterToolSpecificSection(rulesyncFrontmatter.goose ?? {}, ["name", "description"]),
    };

    const relativeFilePath = rulesyncSubagent.getRelativeFilePath().replace(/\.md$/, ".yaml");
    const title =
      typeof gooseSection.title === "string"
        ? gooseSection.title
        : rulesyncFrontmatter.name || basename(relativeFilePath).replace(/\.ya?ml$/, "");
    const description =
      typeof gooseSection.description === "string"
        ? gooseSection.description
        : (rulesyncFrontmatter.description ?? title);
    const version =
      typeof gooseSection.version === "string" ? gooseSection.version : RECIPE_VERSION;
    const instructions =
      typeof gooseSection.instructions === "string"
        ? gooseSection.instructions
        : rulesyncSubagent.getBody();

    const {
      title: _t,
      description: _d,
      version: _v,
      instructions: _i,
      ...extraFields
    } = gooseSection;
    const recipe: GooseSubagentRecipe = {
      version,
      title,
      description,
      instructions,
      ...extraFields,
    };

    const paths = this.getSettablePaths({ global });

    return new GooseSubagent({
      outputRoot,
      recipe,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent: dump(recipe),
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    const result = GooseSubagentRecipeSchema.safeParse(this.recipe);
    if (result.success) {
      return { success: true, error: null };
    }
    return {
      success: false,
      error: new Error(
        `Invalid Goose recipe in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "goose",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<GooseSubagent> {
    const dirPath = relativeDirPath ?? this.getSettablePaths({ global }).relativeDirPath;
    const filePath = join(outputRoot, dirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);

    let parsed: unknown;
    try {
      parsed = load(fileContent);
    } catch (error) {
      throw new Error(`Failed to parse Goose recipe (${filePath}): ${formatError(error)}`, {
        cause: error,
      });
    }
    const candidate = parsed === undefined || parsed === null ? {} : parsed;
    const result = GooseSubagentRecipeSchema.safeParse(candidate);
    if (!result.success) {
      throw new Error(`Invalid Goose recipe in ${filePath}: ${formatError(result.error)}`);
    }

    return new GooseSubagent({
      outputRoot,
      recipe: result.data,
      relativeDirPath: dirPath,
      relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): GooseSubagent {
    return new GooseSubagent({
      outputRoot,
      recipe: { version: RECIPE_VERSION, title: "", description: "", instructions: "" },
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
