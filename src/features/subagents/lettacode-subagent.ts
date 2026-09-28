import { join } from "node:path";

import { dump } from "js-yaml";
import { z } from "zod/mini";

import { LETTACODE_AGENTS_DIR_PATH } from "../../constants/lettacode-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import type { Logger } from "../../utils/logger.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

// Letta Code custom subagent frontmatter. `name` and `description` are
// required; `tools` (a comma-separated list or `all`), `model`,
// `memoryBlocks` and `skills` are the documented optional fields. Unknown keys
// pass through so newer Letta Code releases keep round-tripping.
// @see https://docs.letta.com/configuration/subagents/index.md
const LettacodeSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
});

type LettacodeSubagentFrontmatter = z.infer<typeof LettacodeSubagentFrontmatterSchema>;

/**
 * Letta Code's own subagent names rule (`isValidName` in
 * `src/agent/subagents/index.ts`): a file whose `name` fails it is skipped.
 */
const LETTACODE_AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Names Letta Code keeps for its external-agent launchers: a custom subagent
 * by one of these names is skipped when agents are loaded
 * (`RESERVED_EXTERNAL_SUBAGENT_NAMES` in `src/agent/subagents/index.ts`).
 */
const LETTACODE_RESERVED_AGENT_NAMES: ReadonlySet<string> = new Set(["claude-code", "codex"]);

/**
 * The subagent is still generated as authored — the name is the user's to
 * change, and a rename here would make it diverge from the other targets —
 * but Letta Code would skip it, so say so now.
 */
function warnAboutRejectedAgentName({
  name,
  relativeFilePath,
  logger,
}: {
  name: string;
  relativeFilePath: string;
  logger: Logger | undefined;
}): void {
  if (!LETTACODE_AGENT_NAME_PATTERN.test(name)) {
    logger?.warn(
      `Letta Code subagent ${relativeFilePath}: the name ${quoteValueForWarning(name)} must start ` +
        `with a lowercase letter and contain only lowercase letters, digits and hyphens, so ` +
        `Letta Code skips this subagent. Rename it for it to be available in Letta Code.`,
    );
    return;
  }
  if (LETTACODE_RESERVED_AGENT_NAMES.has(name)) {
    logger?.warn(
      `Letta Code subagent ${relativeFilePath}: the name ${quoteValueForWarning(name)} is ` +
        `reserved by Letta Code, which skips a custom subagent by that name. Rename it for it ` +
        `to be available in Letta Code.`,
    );
  }
}

/**
 * Serialize the frontmatter for Letta Code's simplified frontmatter parser
 * (`src/utils/frontmatter.ts`), which takes a scalar verbatim after the first
 * colon and never unquotes it. A string YAML would have to quote is therefore
 * written as a literal block scalar, which Letta Code does parse; every other
 * value is written the way YAML would write it, except a list: Letta Code reads
 * `tools` and `skills` only as comma-separated strings and treats a YAML list
 * as absent (which for `tools` means every tool), so a list is joined with
 * `, ` instead.
 */
function stringifyLettacodeFrontmatter(body: string, frontmatter: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, rawValue] of Object.entries(frontmatter)) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    const value = Array.isArray(rawValue) ? rawValue.map(String).join(", ") : rawValue;
    const dumped = dump({ [key]: value }, { lineWidth: -1 }).trimEnd();
    const needsBlockScalar =
      typeof value === "string" &&
      dumped !== `${key}: ${value}` &&
      value.trim() !== "" &&
      value === value.trimStart();
    if (needsBlockScalar) {
      lines.push(`${key}: |-`, ...value.split("\n").map((line) => (line ? `  ${line}` : "")));
    } else {
      lines.push(dumped);
    }
  }
  return `---\n${lines.join("\n")}\n---\n${body}${body.endsWith("\n") ? "" : "\n"}`;
}

type LettacodeSubagentParams = {
  frontmatter: LettacodeSubagentFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & { fileContent?: string };

/**
 * Letta Code custom subagent: a Markdown file with YAML frontmatter under
 * `.letta/agents/` (project) or `~/.letta/agents/` (user); the body is the
 * subagent's system prompt. A project subagent overrides a user one by the
 * same name.
 *
 * @see https://docs.letta.com/configuration/subagents/index.md
 */
export class LettacodeSubagent extends ToolSubagent {
  private readonly frontmatter: LettacodeSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: LettacodeSubagentParams) {
    if (rest.validate !== false) {
      const result = LettacodeSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: fileContent ?? stringifyLettacodeFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the generate pipeline in global mode.
    return {
      relativeDirPath: LETTACODE_AGENTS_DIR_PATH,
    };
  }

  getFrontmatter(): LettacodeSubagentFrontmatter {
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
      lettacode: {
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
    logger,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const lettacodeSection = rulesyncFrontmatter.lettacode ?? {};

    const lettacodeSubagentFrontmatter: LettacodeSubagentFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...lettacodeSection,
    };
    warnAboutRejectedAgentName({
      name: lettacodeSubagentFrontmatter.name,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      logger,
    });

    const body = rulesyncSubagent.getBody();
    // A subagent with an empty body only overlays a built-in subagent by the
    // same name, which Letta Code loads without a description.
    if (!lettacodeSubagentFrontmatter.description && body.trim() !== "") {
      logger?.warn(
        `Letta Code subagent ${rulesyncSubagent.getRelativeFilePath()}: Letta Code requires a ` +
          `description and skips a subagent without one. Add a description for it to be ` +
          `available in Letta Code.`,
      );
    }

    const fileContent = stringifyLettacodeFrontmatter(body, lettacodeSubagentFrontmatter);
    const paths = this.getSettablePaths({ global });

    return new LettacodeSubagent({
      outputRoot,
      frontmatter: lettacodeSubagentFrontmatter,
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

    const result = LettacodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "lettacode",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<LettacodeSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = LettacodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new LettacodeSubagent({
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
  }: ToolSubagentForDeletionParams): LettacodeSubagent {
    return new LettacodeSubagent({
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
