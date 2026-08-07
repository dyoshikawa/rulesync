import { basename, join } from "node:path";

import { dump } from "js-yaml";
import { z } from "zod/mini";

import {
  GOOSE_GLOBAL_DIR,
  GOOSE_GLOBAL_RECIPES_DIR_PATH,
  GOOSE_MCP_FILE_NAME,
  GOOSE_RECIPES_DIR_PATH,
} from "../../constants/goose-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readFileContent, toPosixPath } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { isRecord } from "../../utils/type-guards.js";
import { loadYaml } from "../../utils/yaml.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

const RECIPE_VERSION = "1.0.0";

// Goose does not auto-register a recipe as a slash command: `/name` only works
// once the recipe is listed under `slash_commands` in the user config
// (`SlashCommandMapping { command, recipe_path }`, deserialized in
// `crates/goose/src/slash_commands/recipe_slash_command.rs`).
//
// Two details of that module shape the output:
// - `recipe_path` is resolved with a bare `PathBuf::from(...)` followed by
//   `.exists()` — the tilde expansion used for `goose run --recipe` is not on
//   this path, so a `~/...` registration never resolves. The absolute path is
//   written instead, exactly as Goose's own `set_recipe_slash_command` stores it.
// - `get_recipe_for_command` lowercases the *input* and compares it against the
//   stored `command` verbatim, so an entry carrying uppercase can never match.
//
// The registration surface exists at user scope only — there is no project-level
// `slash_commands` list — so it is written in global mode only.
// @see https://github.com/block/goose/blob/main/crates/goose/src/slash_commands/recipe_slash_command.rs
const SLASH_COMMANDS_KEY = "slash_commands";
const GOOSE_GLOBAL_RECIPES_POSIX_DIR = toPosixPath(GOOSE_GLOBAL_RECIPES_DIR_PATH);

type GooseSlashCommandEntry = { command: string; recipe_path: string };

function slashCommandEntry({
  outputRoot,
  relativeFilePath,
}: {
  outputRoot: string;
  relativeFilePath: string;
}): GooseSlashCommandEntry {
  const fileName = basename(toPosixPath(relativeFilePath));
  return {
    command: fileName.replace(/\.ya?ml$/, "").toLowerCase(),
    recipe_path: join(outputRoot, GOOSE_GLOBAL_RECIPES_DIR_PATH, fileName),
  };
}

/**
 * Whether an existing `slash_commands` entry points at a recipe rulesync owns:
 * a direct child of the global recipes directory. Anything else — a recipe
 * elsewhere on disk, or a sub-recipe under `recipes/subagents/` — belongs to
 * the user and is carried over untouched. A path that cannot be resolved into
 * the managed directory is preserved rather than claimed.
 */
function isManagedRecipePath(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const segments = toPosixPath(value).replace(/^~\//, "").split("/");
  const fileName = segments.pop();
  if (fileName === undefined || fileName === "") return false;
  const dirSegments = GOOSE_GLOBAL_RECIPES_POSIX_DIR.split("/");
  return (
    segments.length >= dirSegments.length &&
    segments.slice(-dirSegments.length).join("/") === GOOSE_GLOBAL_RECIPES_POSIX_DIR
  );
}

/**
 * Recompute `slash_commands` from the entries rulesync generates: user entries
 * pointing outside the managed recipes directory are carried over, entries
 * inside it are replaced (so a deleted command's registration is retracted),
 * and the key is dropped entirely when nothing is left.
 */
export function getGooseSlashCommandsConfigContent({
  currentContent,
  entries,
}: {
  currentContent: string;
  entries: GooseSlashCommandEntry[];
}): string {
  const config = parseSharedConfig({ format: "yaml", fileContent: currentContent });
  const existing = Array.isArray(config[SLASH_COMMANDS_KEY]) ? config[SLASH_COMMANDS_KEY] : [];
  const preserved = existing.filter(
    (entry) => !isRecord(entry) || !isManagedRecipePath(entry.recipe_path),
  );
  const next = [...preserved, ...entries];

  return applySharedConfigPatch({
    fileKey: sharedConfigFileKey({
      relativeDirPath: GOOSE_GLOBAL_DIR,
      relativeFilePath: GOOSE_MCP_FILE_NAME,
    }),
    feature: "commands",
    existingContent: currentContent,
    patch: { [SLASH_COMMANDS_KEY]: next.length > 0 ? next : undefined },
  });
}

/**
 * The Goose user `config.yaml`, carrying the `slash_commands` registrations for
 * the generated recipes. The file is shared with the user's own settings, so it
 * is always merged into rather than replaced.
 */
class GooseCommandConfigFile extends ToolFile {
  private readonly entries: GooseSlashCommandEntry[];

  constructor(params: AiFileParams & { entries: GooseSlashCommandEntry[] }) {
    super(params);
    this.entries = params.entries;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  shouldMergeExistingFileContent(): boolean {
    return true;
  }

  setFileContent(newFileContent: string): void {
    super.setFileContent(
      getGooseSlashCommandsConfigContent({
        currentContent: newFileContent,
        entries: this.entries,
      }),
    );
  }

  getFileContent(): string {
    return getGooseSlashCommandsConfigContent({
      currentContent: super.getFileContent(),
      entries: this.entries,
    });
  }
}

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
const GooseCommandRecipeSchema = z.looseObject({
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

  /**
   * The user `config.yaml` holding the `slash_commands` registrations. Global
   * scope only — Goose has no project-level registration surface.
   */
  static getExtraSharedWritePaths({
    global = false,
  }: { global?: boolean } = {}): SharedWritePath[] {
    if (!global) return [];
    return [{ relativeDirPath: GOOSE_GLOBAL_DIR, relativeFilePath: GOOSE_MCP_FILE_NAME }];
  }

  /**
   * Register the generated recipes as slash commands. The config file is also
   * emitted when no command is generated but the existing file still carries
   * managed registrations, so removing the last command retracts them instead of
   * leaving `/name` pointing at a deleted recipe.
   */
  static override async getAuxiliaryFiles({
    toolCommands,
    outputRoot = process.cwd(),
    global = false,
    forDeletion = false,
  }: {
    toolCommands: ToolCommand[];
    outputRoot?: string;
    global?: boolean;
    forDeletion?: boolean;
  }): Promise<ToolFile[]> {
    // The user's config.yaml is shared with their own settings and is never a
    // deletion candidate; retraction happens through the regenerated content.
    if (!global || forDeletion) return [];

    const entries = toolCommands.map((command) =>
      slashCommandEntry({ outputRoot, relativeFilePath: command.getRelativeFilePath() }),
    );
    const configPath = join(outputRoot, GOOSE_GLOBAL_DIR, GOOSE_MCP_FILE_NAME);
    const existingContent = await readFileContentOrNull(configPath);
    if (entries.length === 0) {
      const existing = parseSharedConfig({
        format: "yaml",
        fileContent: existingContent ?? "",
      })[SLASH_COMMANDS_KEY];
      const hasManagedEntries =
        Array.isArray(existing) &&
        existing.some((entry) => isRecord(entry) && isManagedRecipePath(entry.recipe_path));
      if (!hasManagedEntries) return [];
    }

    return [
      new GooseCommandConfigFile({
        outputRoot,
        relativeDirPath: GOOSE_GLOBAL_DIR,
        relativeFilePath: GOOSE_MCP_FILE_NAME,
        fileContent: existingContent ?? "",
        entries,
        global,
      }),
    ];
  }

  private parseRecipeContent(content: string): GooseCommandRecipe {
    const where = join(this.relativeDirPath, this.relativeFilePath);
    let parsed: unknown;
    try {
      parsed = loadYaml(content);
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
