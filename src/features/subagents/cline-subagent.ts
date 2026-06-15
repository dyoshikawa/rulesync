import { join } from "node:path";

import { z } from "zod/mini";

import { CLINE_AGENTS_DIR_PATH } from "../../constants/cline-paths.js";
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

// Cline agent config files are YAML documents (`.yaml`/`.yml`) made of a YAML
// frontmatter block (`name` required, `description` required) followed by the
// system prompt body. Cline's loaders parse the frontmatter and treat the body
// after the closing `---` as the agent system prompt.
// Confirmed against the Cline source:
//   - apps/vscode/src/core/task/tools/subagent/AgentConfigLoader.ts
//     (`isYamlFile`, `parseAgentConfigFromYaml` → body becomes `systemPrompt`)
//   - sdk/packages/shared/src/storage/paths.ts
//     (`resolveAgentConfigSearchPaths` → `.cline/agents` project +
//      `~/.cline/agents` global)
// looseObject preserves unknown keys so future fields round-trip cleanly.
const ClineSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
});

type ClineSubagentFrontmatter = z.infer<typeof ClineSubagentFrontmatterSchema>;

type ClineSubagentParams = {
  frontmatter: ClineSubagentFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & { fileContent?: string };

/**
 * Cline subagents (file-based agent definitions).
 *
 * Agents live under `.cline/agents/` (workspace/project) and `~/.cline/agents/`
 * (user/global). Both scopes use the same relative path; the global variant is
 * resolved against the home directory by the caller. Each agent is a YAML file
 * (`<name>.yaml`) with a YAML frontmatter block and a system prompt body.
 *
 * @see https://github.com/cline/cline/blob/main/apps/vscode/src/core/task/tools/subagent/AgentConfigLoader.ts
 * @see https://github.com/cline/cline/blob/main/sdk/packages/shared/src/storage/paths.ts
 */
export class ClineSubagent extends ToolSubagent {
  private readonly frontmatter: ClineSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: ClineSubagentParams) {
    if (rest.validate !== false) {
      const result = ClineSubagentFrontmatterSchema.safeParse(frontmatter);
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
    return {
      relativeDirPath: CLINE_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): ClineSubagentFrontmatter {
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
      // Round-trip any tool-specific/future fields through a cline section.
      ...(Object.keys(rest).length > 0 && { cline: rest }),
    };

    return new RulesyncSubagent({
      outputRoot: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      // Cline agents use a `.yaml` extension; rulesync subagents are `.md`.
      relativeFilePath: this.getRelativeFilePath().replace(/\.ya?ml$/, ".md"),
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
    const clineSection = rulesyncFrontmatter.cline ?? {};

    const clineFrontmatter: ClineSubagentFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...clineSection,
    };

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, clineFrontmatter, {
      avoidBlockScalars: true,
    });
    const paths = this.getSettablePaths({ global });

    return new ClineSubagent({
      outputRoot,
      frontmatter: clineFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      // rulesync subagents are `.md`; Cline agents must be `.yaml`.
      relativeFilePath: rulesyncSubagent.getRelativeFilePath().replace(/\.md$/, ".yaml"),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = ClineSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "cline",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<ClineSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = ClineSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new ClineSubagent({
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
  }: ToolSubagentForDeletionParams): ClineSubagent {
    return new ClineSubagent({
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
