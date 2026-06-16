import { basename, join } from "node:path";

import { dump, load } from "js-yaml";
import { z } from "zod/mini";

import {
  GOOSE_GLOBAL_RECIPES_DIR_PATH,
  GOOSE_RECIPES_DIR_PATH,
} from "../../constants/goose-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

const RECIPE_VERSION = "1.0.0";

/**
 * Goose recipe files are reusable YAML workflow documents. A recipe requires
 * `version`, `title`, and `description`, plus at least one of `instructions` /
 * `prompt`; it may also carry `extensions`, `parameters`, `sub_recipes`,
 * `settings`, `activities`, `author`, `response`, and `retry`. rulesync maps a
 * command to a top-level recipe whose `prompt` is the command body; all other
 * recipe fields round-trip through the rulesync `goose` command section.
 *
 * The whole file is a YAML mapping (not frontmatter + markdown body), so the
 * class stores the parsed recipe object rather than a frontmatter/body split.
 *
 * @see https://block.github.io/goose/docs/guides/recipes/recipe-reference/
 */
export const GooseCommandRecipeSchema = z.looseObject({
  version: z.optional(z.string()),
  title: z.optional(z.string()),
  description: z.optional(z.string()),
  instructions: z.optional(z.string()),
  prompt: z.optional(z.string()),
});

export type GooseCommandRecipe = z.infer<typeof GooseCommandRecipeSchema>;

export class GooseCommand extends ToolCommand {
  private readonly recipe: GooseCommandRecipe;

  constructor(params: AiFileParams) {
    super(params);
    // When validation is disabled (e.g. forDeletion with placeholder content),
    // never throw on malformed YAML — fall back to an empty recipe.
    if (params.validate === false) {
      try {
        this.recipe = this.parseRecipeContent(this.fileContent);
      } catch {
        this.recipe = {};
      }
    } else {
      this.recipe = this.parseRecipeContent(this.fileContent);
    }
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: global ? GOOSE_GLOBAL_RECIPES_DIR_PATH : GOOSE_RECIPES_DIR_PATH,
    };
  }

  private parseRecipeContent(content: string): GooseCommandRecipe {
    const where = join(this.relativeDirPath, this.relativeFilePath);
    let parsed: unknown;
    try {
      parsed = load(content);
    } catch (error) {
      throw new Error(`Failed to parse Goose recipe (${where}): ${formatError(error)}`, {
        cause: error,
      });
    }
    // An empty file parses to undefined/null; treat it as an empty recipe.
    const candidate = parsed === undefined || parsed === null ? {} : parsed;
    const result = GooseCommandRecipeSchema.safeParse(candidate);
    if (!result.success) {
      throw new Error(`Invalid Goose recipe in ${where}: ${formatError(result.error)}`);
    }
    return result.data;
  }

  getBody(): string {
    return this.recipe.prompt ?? this.recipe.instructions ?? "";
  }

  getFrontmatter(): GooseCommandRecipe {
    return this.recipe;
  }

  toRulesyncCommand(): RulesyncCommand {
    // The body source (`prompt`, falling back to `instructions`) becomes the
    // rulesync body; everything else is preserved in the goose section. Both
    // body fields are excluded from the section so the body is never duplicated
    // back into the recipe on regeneration.
    const {
      prompt: _prompt,
      instructions: _instructions,
      description,
      ...restFields
    } = this.recipe;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["goose"],
      description,
      ...(Object.keys(restFields).length > 0 && { goose: restFields }),
    };

    const body = this.getBody();
    const fileContent = stringifyFrontmatter(body, rulesyncFrontmatter);

    return new RulesyncCommand({
      outputRoot: process.cwd(),
      frontmatter: rulesyncFrontmatter,
      body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath.replace(/\.ya?ml$/, ".md"),
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): GooseCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const gooseFields: Record<string, unknown> = { ...rulesyncFrontmatter.goose };

    const relativeFilePath = rulesyncCommand.getRelativeFilePath().replace(/\.md$/, ".yaml");
    // Recipes require a non-empty title and description. Derive sensible
    // defaults from the command name / description when the user has not set
    // them explicitly via the goose section.
    const derivedTitle = basename(relativeFilePath).replace(/\.ya?ml$/, "");
    const title = typeof gooseFields.title === "string" ? gooseFields.title : derivedTitle;
    const description =
      typeof gooseFields.description === "string"
        ? gooseFields.description
        : (rulesyncFrontmatter.description ?? title);
    const version = typeof gooseFields.version === "string" ? gooseFields.version : RECIPE_VERSION;
    const prompt =
      typeof gooseFields.prompt === "string" ? gooseFields.prompt : rulesyncCommand.getBody();

    // Build the recipe with the canonical key order first, then layer any
    // remaining goose-section fields (parameters, extensions, sub_recipes, …).
    const { title: _t, description: _d, version: _v, prompt: _p, ...extraFields } = gooseFields;
    const recipe: Record<string, unknown> = {
      version,
      title,
      description,
      prompt,
      ...extraFields,
    };

    const paths = this.getSettablePaths({ global });

    return new GooseCommand({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent: dump(recipe, { lineWidth: -1, noRefs: true }),
      validate,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<GooseCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);

    return new GooseCommand({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    try {
      this.parseRecipeContent(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "goose",
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): GooseCommand {
    // Minimal valid recipe YAML so the constructor's parser succeeds.
    const placeholder = dump(
      { version: RECIPE_VERSION, title: "", description: "", prompt: "" },
      { lineWidth: -1, noRefs: true },
    );
    return new GooseCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: placeholder,
      validate: false,
    });
  }
}
