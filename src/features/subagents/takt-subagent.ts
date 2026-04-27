import { join } from "node:path";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { assertSafeTaktName } from "../takt-shared.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

const DEFAULT_TAKT_SUBAGENT_DIR = "personas";

export type TaktSubagentParams = {
  body: string;
} & AiFileParams;

/**
 * Subagent generator for TAKT.
 *
 * Subagents are emitted as plain Markdown files under `.takt/facets/personas/`.
 * The original frontmatter is dropped; the body is written verbatim. The
 * filename stem is preserved unless overridden via `takt.name`. The facet
 * directory is fixed — no `takt.facet` override is supported.
 */
export class TaktSubagent extends ToolSubagent {
  private readonly body: string;

  constructor({ body, ...rest }: TaktSubagentParams) {
    super({
      ...rest,
    });
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".takt", "facets", DEFAULT_TAKT_SUBAGENT_DIR),
    };
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const stem = this.getRelativeFilePath().replace(/\.md$/u, "");
    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name: stem,
    };
    return new RulesyncSubagent({
      outputRoot: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): TaktSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const taktSection = rulesyncFrontmatter.takt;
    const sourceLabel = rulesyncSubagent.getRelativeFilePath();

    const overrideName = typeof taktSection?.name === "string" ? taktSection.name : undefined;
    const sourceStem = rulesyncSubagent.getRelativeFilePath().replace(/\.md$/u, "");
    const stem = overrideName ?? sourceStem;
    assertSafeTaktName({ name: stem, featureLabel: "subagent", sourceLabel });
    const relativeFilePath = `${stem}.md`;

    const paths = this.getSettablePaths({ global });
    const body = rulesyncSubagent.getBody();

    return new TaktSubagent({
      outputRoot,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent: body,
      validate,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "takt",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<TaktSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { body } = parseFrontmatter(fileContent, filePath);

    return new TaktSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      body: body.trim(),
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): TaktSubagent {
    return new TaktSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
