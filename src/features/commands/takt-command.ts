import { join } from "node:path";

import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { assertSafeTaktName, resolveTaktFacetDir } from "../takt-shared.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

/**
 * Allowed `facet` values for TAKT command files. Commands are always
 * placed in the `instructions/` directory; no override is permitted.
 */
export const TAKT_COMMAND_FACET_VALUES = ["instruction"] as const;
export type TaktCommandFacet = (typeof TAKT_COMMAND_FACET_VALUES)[number];

const DEFAULT_TAKT_COMMAND_DIR = "instructions";

const TAKT_COMMAND_FACET_TO_DIR: Record<TaktCommandFacet, string> = {
  instruction: DEFAULT_TAKT_COMMAND_DIR,
};

/**
 * Validate the optional `takt.facet` value supplied on a command and return
 * the corresponding directory name.
 *
 * @throws when an explicit `takt.facet` value is not allowed for commands
 */
export function resolveTaktCommandFacetDir(facetValue: unknown, sourceLabel: string): string {
  return resolveTaktFacetDir({
    value: facetValue,
    allowed: TAKT_COMMAND_FACET_VALUES,
    defaultDir: DEFAULT_TAKT_COMMAND_DIR,
    dirMap: TAKT_COMMAND_FACET_TO_DIR,
    featureLabel: "command",
    sourceLabel,
  });
}

export type TaktCommandParams = {
  body: string;
} & Omit<AiFileParams, "fileContent">;

/**
 * Command generator for TAKT.
 *
 * Commands are emitted as plain Markdown files under `.takt/facets/instructions/`.
 * The original frontmatter is dropped; the body is written verbatim. The
 * filename stem is preserved unless overridden via `takt.name`.
 */
export class TaktCommand extends ToolCommand {
  private readonly body: string;

  constructor({ body, ...rest }: TaktCommandParams) {
    super({
      ...rest,
      fileContent: body,
    });
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: join(".takt", "facets", DEFAULT_TAKT_COMMAND_DIR),
    };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return {};
  }

  toRulesyncCommand(): RulesyncCommand {
    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
    };
    return new RulesyncCommand({
      baseDir: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: this.body,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): TaktCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const taktSection = rulesyncFrontmatter.takt;
    const sourceLabel = rulesyncCommand.getRelativeFilePath();

    // Validate facet (only `instruction` is allowed; default is also `instruction`)
    resolveTaktCommandFacetDir(taktSection?.facet, sourceLabel);

    const overrideName = typeof taktSection?.name === "string" ? taktSection.name : undefined;
    const sourceStem = rulesyncCommand.getRelativeFilePath().replace(/\.md$/u, "");
    const stem = overrideName ?? sourceStem;
    assertSafeTaktName({ name: stem, featureLabel: "command", sourceLabel });
    const relativeFilePath = `${stem}.md`;

    const paths = this.getSettablePaths({ global });

    return new TaktCommand({
      baseDir,
      body: rulesyncCommand.getBody(),
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      validate,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "takt",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<TaktCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { body } = parseFrontmatter(fileContent, filePath);

    return new TaktCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      body: body.trim(),
      validate,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): TaktCommand {
    return new TaktCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      body: "",
      validate: false,
    });
  }
}
