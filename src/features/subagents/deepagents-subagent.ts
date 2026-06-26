import { basename, dirname, extname, join } from "node:path";

import { z } from "zod/mini";

import {
  DEEPAGENTS_AGENTS_DIR_PATH,
  DEEPAGENTS_GLOBAL_AGENTS_DIR_PATH,
} from "../../constants/deepagents-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

const DeepagentsSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  model: z.optional(z.string()),
});

export type DeepagentsSubagentFrontmatter = z.infer<typeof DeepagentsSubagentFrontmatterSchema>;

export type DeepagentsSubagentParams = {
  frontmatter: DeepagentsSubagentFrontmatter;
  body: string;
} & AiFileParams;

/**
 * Filename for each subagent definition.
 *
 * deepagents (dcode) discovers a subagent as a directory under the agents dir
 * that contains an `AGENTS.md` file. Flat `.md` files placed directly in the
 * agents root are explicitly skipped by the loader, so each subagent must live
 * at `.deepagents/agents/<name>/AGENTS.md`.
 *
 * @see https://github.com/langchain-ai/deepagents/blob/main/libs/code/deepagents_code/subagents.py
 */
const DEEPAGENTS_SUBAGENT_FILE_NAME = "AGENTS.md";

export class DeepagentsSubagent extends ToolSubagent {
  private readonly frontmatter: DeepagentsSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: DeepagentsSubagentParams) {
    if (rest.validate !== false) {
      const result = DeepagentsSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({ ...rest });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // dcode discovers user-level subagents in `~/.deepagents/<agent_name>/agents/`
    // (default agent_name `deepagents`); the home directory is resolved by the
    // processor through outputRoot in global mode.
    return {
      relativeDirPath: global ? DEEPAGENTS_GLOBAL_AGENTS_DIR_PATH : DEEPAGENTS_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): DeepagentsSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, model } = this.frontmatter;

    const deepagentsSection: Record<string, unknown> = {};
    if (model) deepagentsSection.model = model;

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      ...(Object.keys(deepagentsSection).length > 0 && { deepagents: deepagentsSection }),
    };

    return new RulesyncSubagent({
      outputRoot: this.getOutputRoot(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      // The tool-side path is `<name>/AGENTS.md`; the rulesync file is a flat
      // `<name>.md`, so the subagent name comes from the parent directory.
      relativeFilePath: `${this.getSubagentName()}.md`,
      validate: true,
    });
  }

  /**
   * Derive the subagent name from this instance's relative file path.
   *
   * The tool-side layout is `<name>/AGENTS.md`, so the name is the parent
   * directory of the file. If the path is unexpectedly flat (e.g. a legacy
   * `<name>.md`), fall back to the basename without extension.
   */
  private getSubagentName(): string {
    const relativeFilePath = this.getRelativeFilePath();
    const dir = dirname(relativeFilePath);
    if (dir && dir !== ".") {
      return basename(dir);
    }
    return basename(relativeFilePath, extname(relativeFilePath));
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const deepagentsSection = this.filterToolSpecificSection(rulesyncFrontmatter.deepagents ?? {}, [
      "name",
      "description",
    ]);

    const rawFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...deepagentsSection,
    };

    const result = DeepagentsSubagentFrontmatterSchema.safeParse(rawFrontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid deepagents subagent frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(result.error)}`,
      );
    }

    const deepagentsFrontmatter = result.data;
    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, deepagentsFrontmatter);

    const paths = this.getSettablePaths({ global });

    // The rulesync subagent is a flat `<name>.md`; deepagents requires a
    // directory-per-agent layout, so emit `<name>/AGENTS.md`.
    const subagentName = basename(
      rulesyncSubagent.getRelativeFilePath(),
      extname(rulesyncSubagent.getRelativeFilePath()),
    );

    return new DeepagentsSubagent({
      outputRoot,
      frontmatter: deepagentsFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: join(subagentName, DEEPAGENTS_SUBAGENT_FILE_NAME),
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = DeepagentsSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "deepagents",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<DeepagentsSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = DeepagentsSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new DeepagentsSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): DeepagentsSubagent {
    return new DeepagentsSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
