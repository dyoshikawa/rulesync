import { z } from "zod/mini";

import { TRAE_AGENTS_DIR_PATH } from "../../constants/trae-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolSubagent } from "./frontmatter-markdown-subagent.js";
import type {
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Trae subagent frontmatter. `name` and `description` are required; `model`
 * (a built-in model), `tools`, `disallowedTools` and `mcpServers` are the
 * documented optional fields. Unknown keys pass through so newer Trae
 * releases keep round-tripping.
 *
 * @see https://docs.trae.ai/ide/subagents?_lang=en
 */
const TraeSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  model: z.optional(z.string()),
  // A comma-separated string or a string array.
  tools: z.optional(z.union([z.string(), z.array(z.string())])),
  disallowedTools: z.optional(z.union([z.string(), z.array(z.string())])),
  mcpServers: z.optional(z.unknown()),
});

type TraeSubagentFrontmatter = z.infer<typeof TraeSubagentFrontmatterSchema>;

/**
 * Trae's rule for a subagent `name`: it starts with a letter, holds only
 * letters, digits and hyphens, ends with a letter or digit, and is at most 50
 * characters long.
 */
const TRAE_SUBAGENT_NAME_PATTERN = /^[A-Za-z](?:[A-Za-z0-9-]{0,48}[A-Za-z0-9])?$/u;

/**
 * Trae subagent: a Markdown file with YAML frontmatter under `.trae/agents/`
 * (project scope only); the body is the system prompt. Trae reads the
 * directory only while Settings > Beta > Subagents > "Enable Subagents
 * Directory" is on; rulesync writes the files and leaves that switch to the
 * user. The documented user directory is `~/.trae-cn/agents/` (the CN build),
 * so global scope is not written.
 *
 * @see https://docs.trae.ai/ide/subagents?_lang=en
 */
export class TraeSubagent extends FrontmatterMarkdownToolSubagent<TraeSubagentFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: TRAE_AGENTS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "trae";
  }

  protected static override getFrontmatterSchema() {
    return TraeSubagentFrontmatterSchema;
  }

  protected static override toToolFrontmatter({
    rulesyncSubagent,
    logger,
  }: Pick<
    ToolSubagentFromRulesyncSubagentParams,
    "rulesyncSubagent" | "logger"
  >): TraeSubagentFrontmatter {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath();
    // A `trae:` section value takes precedence over the shared one.
    const merged = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...rulesyncFrontmatter.trae,
    };

    // Trae requires a description, so a subagent that omits one gets a
    // minimal placeholder (as the Tabnine adapter does) rather than a file
    // Trae would not load or an error that aborts every other target. A value
    // of the wrong type is left for the constructor's schema check.
    let description = merged.description;
    if (description === undefined || description === "") {
      description = rulesyncFrontmatter.name ? `${rulesyncFrontmatter.name} subagent` : "subagent";
      logger?.warn(
        `Trae subagent ${relativeFilePath} has no description, which Trae requires; ` +
          `wrote ${JSON.stringify(description)} as a placeholder.`,
      );
    }

    // The name is the subagent's identity, so it is written as authored
    // rather than silently renamed; the user is told Trae will reject it.
    const name = merged.name;
    if (typeof name === "string" && !TRAE_SUBAGENT_NAME_PATTERN.test(name)) {
      logger?.warn(
        `Trae subagent ${relativeFilePath} has the name ${JSON.stringify(name)}, which Trae ` +
          `rejects: a name must start with a letter, contain only letters, digits and hyphens, ` +
          `end with a letter or digit, and be at most 50 characters long.`,
      );
    }

    const traeSubagentFrontmatter = { ...merged, description } as TraeSubagentFrontmatter;
    return traeSubagentFrontmatter;
  }
}
