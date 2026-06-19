import { join } from "node:path";

import { z } from "zod/mini";

import { GROKCLI_AGENTS_DIR_PATH } from "../../constants/grokcli-paths.js";
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

// Grok Build agent profiles use `name` + `description` plus optional tuning keys
// (`prompt_mode`, `model`, `permission_mode`, `agents_md`, ...). looseObject
// preserves those extra keys verbatim on round-trip.
const GrokcliSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
});

type GrokcliSubagentFrontmatter = z.infer<typeof GrokcliSubagentFrontmatterSchema>;

type GrokcliSubagentParams = {
  frontmatter: GrokcliSubagentFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & { fileContent?: string };

/**
 * Subagent (agent profile) generator for xAI Grok Build CLI.
 *
 * Grok Build discovers agent definitions from `.grok/agents/*.md` (project) and
 * `~/.grok/agents/*.md` (global), each a Markdown file with YAML frontmatter
 * (`name`, optional `description`, plus tuning keys such as `prompt_mode`,
 * `model`, `permission_mode`, `agents_md`) followed by the agent's system
 * prompt. Verified via `grok inspect` (grok 0.2.54): a `.grok/agents/<name>.md`
 * file appears under `agents` with `source.type: "project"`. Mirrors the Gemini
 * CLI subagent adapter, which uses the same Markdown + frontmatter convention.
 *
 * @see https://docs.x.ai/build/overview
 */
export class GrokcliSubagent extends ToolSubagent {
  private readonly frontmatter: GrokcliSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: GrokcliSubagentParams) {
    if (rest.validate !== false) {
      const result = GrokcliSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: fileContent ?? stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Project (`.grok/agents/`) and global (`~/.grok/agents/`) share the same
    // relative directory; global mode resolves it against the home directory.
    return {
      relativeDirPath: GROKCLI_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): GrokcliSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, ...rest } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      grokcli: {
        ...rest,
      },
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
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const grokcliSection = rulesyncFrontmatter.grokcli ?? {};

    const grokcliSubagentFrontmatter: GrokcliSubagentFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...grokcliSection,
    };

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, grokcliSubagentFrontmatter, {
      avoidBlockScalars: true,
    });
    const paths = this.getSettablePaths({ global });

    return new GrokcliSubagent({
      outputRoot,
      frontmatter: grokcliSubagentFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = GrokcliSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "grokcli",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<GrokcliSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = GrokcliSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new GrokcliSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): GrokcliSubagent {
    return new GrokcliSubagent({
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
