import { join } from "node:path";

import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { assertSafeTaktName } from "../takt-shared.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

const DEFAULT_TAKT_COMMAND_DIR = "instructions";

export type TaktCommandParams = {
  body: string;
} & Omit<AiFileParams, "fileContent">;

/**
 * Command generator for TAKT.
 *
 * Commands are emitted as plain Markdown files under `.takt/facets/instructions/`.
 * The original frontmatter is dropped; the body is written verbatim. The
 * filename stem is preserved unless overridden via `takt.name`. The facet
 * directory is fixed — no `takt.facet` override is supported.
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
      outputRoot: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: this.body,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): TaktCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const taktSection = rulesyncFrontmatter.takt;
    const sourceLabel = rulesyncCommand.getRelativeFilePath();

    const overrideName = typeof taktSection?.name === "string" ? taktSection.name : undefined;
    const sourceStem = rulesyncCommand.getRelativeFilePath().replace(/\.md$/u, "");
    const stem = overrideName ?? sourceStem;
    assertSafeTaktName({ name: stem, featureLabel: "command", sourceLabel });
    const relativeFilePath = `${stem}.md`;

    const paths = this.getSettablePaths({ global });

    return new TaktCommand({
      outputRoot,
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
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<TaktCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { body } = parseFrontmatter(fileContent, filePath);

    return new TaktCommand({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      body: body.trim(),
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): TaktCommand {
    return new TaktCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      body: "",
      validate: false,
    });
  }
}
