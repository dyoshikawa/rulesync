import { basename, join } from "node:path";

import * as smolToml from "smol-toml";
import { z } from "zod/mini";

import { CODEWHALE_AGENTS_DIR_PATH } from "../../constants/codewhale-paths.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Keys of the rulesync `codewhale` section copied into the profile. Codewhale
 * parses agent profiles with `deny_unknown_fields`, so an unknown key would
 * make the whole profile fail to load; anything else in the section is dropped
 * with a warning. `[tools]` and `[permissions]` are left out on purpose:
 * Codewhale only accepts values there that narrow the defaults, and rejects a
 * profile that tries to widen them.
 */
const CODEWHALE_SECTION_KEYS = [
  "role_hint",
  "base_role",
  "loadout",
  "model",
  "provider",
  "reasoning_effort",
] as const;

const CodewhaleSubagentTomlSchema = z.looseObject({
  id: z.optional(z.string()),
  name: z.optional(z.string()),
  display_name: z.optional(z.string()),
  description: z.optional(z.string()),
  persona: z.optional(z.string()),
  instructions: z.optional(z.looseObject({ text: z.optional(z.string()) })),
});

type CodewhaleSubagentToml = z.infer<typeof CodewhaleSubagentTomlSchema>;

/**
 * Codewhale validates a profile id as a simple token of ASCII letters, digits,
 * `-`, `_` and `.`; any other character is replaced so the profile loads.
 */
function toProfileId(relativeFilePath: string): string {
  return basename(relativeFilePath)
    .replace(/\.(md|toml)$/, "")
    .replace(/[^A-Za-z0-9._-]/g, "_");
}

function stringifyCodewhaleSubagentToml(
  fields: Record<string, unknown>,
  instructions: string | undefined,
): string {
  const restToml = smolToml.stringify(fields).trimEnd();
  if (instructions === undefined) {
    return restToml;
  }
  // A multi-line body reads better as a TOML literal string, which cannot
  // itself contain `'''`; fall back to the escaped basic string otherwise.
  // A literal string also cannot hold control characters other than tab and
  // newline, and a trailing `'` would merge into the closing delimiter.
  const literalSafe =
    !instructions.includes("'''") &&
    !instructions.endsWith("'") &&
    // oxlint-disable-next-line no-control-regex
    !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(instructions);
  const instructionsToml =
    instructions.includes("\n") && literalSafe
      ? `[instructions]\ntext = '''\n${instructions}'''`
      : smolToml.stringify({ instructions: { text: instructions } }).trimEnd();
  return [restToml, instructionsToml].filter((value) => value.length > 0).join("\n\n");
}

export type CodewhaleSubagentParams = {
  body: string;
} & AiFileParams;

/**
 * Represents a Codewhale agent profile (`.codewhale/agents/<id>.toml`).
 *
 * Generation writes `id` (the file stem), `display_name` (the rulesync name),
 * `description`, and the body as `[instructions] text`, plus the allowlisted
 * keys of the rulesync `codewhale` section.
 *
 * @see https://github.com/Hmbown/Codewhale/blob/main/docs/SUBAGENTS.md
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/fleet/profile.rs
 */
export class CodewhaleSubagent extends ToolSubagent {
  private readonly body: string;

  constructor({ body, ...rest }: CodewhaleSubagentParams) {
    if (rest.validate !== false) {
      try {
        CodewhaleSubagentTomlSchema.parse(smolToml.parse(body));
      } catch (error) {
        throw new Error(
          `Invalid TOML in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(error)}`,
          { cause: error },
        );
      }
    }

    super({ ...rest });
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // The same relative path serves both scopes; the processor supplies the
    // home directory as outputRoot in global mode (`~/.codewhale/agents`).
    return {
      relativeDirPath: CODEWHALE_AGENTS_DIR_PATH,
    };
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    let parsed: CodewhaleSubagentToml;
    try {
      parsed = CodewhaleSubagentTomlSchema.parse(smolToml.parse(this.body));
    } catch (error) {
      throw new Error(
        `Failed to parse TOML in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const record: Record<string, unknown> = parsed;
    const codewhaleSection: Record<string, unknown> = {};
    for (const key of CODEWHALE_SECTION_KEYS) {
      if (record[key] !== undefined) {
        codewhaleSection[key] = record[key];
      }
    }

    const name =
      parsed.display_name ??
      parsed.name ??
      parsed.id ??
      basename(this.getRelativeFilePath()).replace(/\.toml$/, "");

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"],
      name,
      ...(parsed.description !== undefined && { description: parsed.description }),
      ...(Object.keys(codewhaleSection).length > 0 && { codewhale: codewhaleSection }),
    };

    return new RulesyncSubagent({
      outputRoot: ".",
      frontmatter: rulesyncFrontmatter,
      // Codewhale resolves the instructions as `[instructions] text`, falling
      // back to the legacy `persona` key.
      body: parsed.instructions?.text ?? parsed.persona ?? "",
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath().replace(/\.toml$/, ".md"),
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
    const frontmatter = rulesyncSubagent.getFrontmatter();
    const rawSection: Record<string, unknown> =
      (frontmatter.codewhale as Record<string, unknown> | undefined) ?? {};
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath().replace(/\.md$/, ".toml");

    const sectionFields: Record<string, unknown> = {};
    const droppedKeys: string[] = [];
    for (const [key, value] of Object.entries(rawSection)) {
      // Every allowlisted key is a string upstream; any other value type would
      // make Codewhale reject the whole profile.
      if (
        (CODEWHALE_SECTION_KEYS as readonly string[]).includes(key) &&
        typeof value === "string"
      ) {
        sectionFields[key] = value;
      } else {
        droppedKeys.push(key);
      }
    }
    if (droppedKeys.length > 0) {
      logger?.warn(
        `Dropping unsupported codewhale subagent keys in ${rulesyncSubagent.getRelativeFilePath()}: ${droppedKeys.join(", ")}. Codewhale rejects agent profiles with unknown fields or non-string values there; supported keys are ${CODEWHALE_SECTION_KEYS.join(", ")}, each a string.`,
      );
    }

    const fields: Record<string, unknown> = {
      id: toProfileId(relativeFilePath),
      display_name: frontmatter.name,
      ...(frontmatter.description ? { description: frontmatter.description } : {}),
      ...sectionFields,
    };
    const instructions = rulesyncSubagent.getBody() || undefined;
    const body = stringifyCodewhaleSubagentToml(fields, instructions);
    const paths = this.getSettablePaths({ global });

    return new CodewhaleSubagent({
      outputRoot,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent: body,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    try {
      CodewhaleSubagentTomlSchema.parse(smolToml.parse(this.body));
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "codewhale",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<CodewhaleSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);

    return new CodewhaleSubagent({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      body: fileContent.trim(),
      fileContent,
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): CodewhaleSubagent {
    return new CodewhaleSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
