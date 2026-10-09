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
 * with a warning. The `[tools]` and `[permissions]` tables are handled
 * separately (see `CODEWHALE_NARROWING_TABLES`).
 */
const CODEWHALE_SECTION_KEYS = [
  "role_hint",
  "base_role",
  "loadout",
  "model",
  "provider",
  "reasoning_effort",
] as const;

/**
 * Alternative spellings Codewhale accepts for a section key (serde aliases on
 * `AgentProfileToml`). They are read on import and normalized to the
 * canonical key on generate; a profile may carry only one spelling of each, so
 * the canonical key is checked first.
 */
const CODEWHALE_SECTION_KEY_ALIASES: Partial<
  Record<(typeof CODEWHALE_SECTION_KEYS)[number], readonly string[]>
> = {
  model: ["model_hint", "model_id"],
  reasoning_effort: ["thinking", "reasoning"],
};

const CODEWHALE_SECTION_ALIAS_TO_KEY: ReadonlyMap<string, string> = new Map(
  Object.entries(CODEWHALE_SECTION_KEY_ALIASES).flatMap(([key, aliases]) =>
    (aliases ?? []).map((alias) => [alias, key] as const),
  ),
);

/**
 * The `[tools]` and `[permissions]` tables of an agent profile, with the only
 * values Codewhale accepts in each key. Codewhale rejects a profile that tries
 * to widen access through them (`reject_permission_expansion` in
 * `fleet/profile.rs`), and both tables deny unknown fields, so any other key
 * or value is dropped with a warning.
 */
const CODEWHALE_NARROWING_TABLES: Readonly<
  Record<string, Readonly<Record<string, (value: unknown) => boolean>>>
> = {
  tools: {
    posture: (value) =>
      typeof value === "string" && ["read-only", "readonly", "read_only"].includes(value),
  },
  permissions: {
    allow_shell: (value) => value === false,
    trust: (value) => value === false,
    approval_required: (value) => value === true,
  },
};

/**
 * Keeps the narrowing-only entries of a `[tools]` / `[permissions]` table and
 * reports every other entry by its dotted path. A non-table value is dropped
 * as a whole.
 */
function filterNarrowingTable(
  tableName: string,
  value: unknown,
): { kept: Record<string, unknown> | undefined; dropped: string[] } {
  const allowed = CODEWHALE_NARROWING_TABLES[tableName] ?? {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kept: undefined, dropped: [tableName] };
  }
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const normalized = typeof entry === "string" ? entry.trim() : entry;
    if (Object.hasOwn(allowed, key) && allowed[key]?.(normalized)) {
      kept[key] = normalized;
    } else {
      dropped.push(`${tableName}.${key}`);
    }
  }
  return { kept: Object.keys(kept).length > 0 ? kept : undefined, dropped };
}

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
 * keys of the rulesync `codewhale` section and its narrowing-only `[tools]` /
 * `[permissions]` entries.
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
      const spelling = [key, ...(CODEWHALE_SECTION_KEY_ALIASES[key] ?? [])].find(
        (candidate) => record[candidate] !== undefined,
      );
      if (spelling !== undefined) {
        codewhaleSection[key] = record[spelling];
      }
    }

    for (const tableName of Object.keys(CODEWHALE_NARROWING_TABLES)) {
      if (record[tableName] !== undefined) {
        const { kept } = filterNarrowingTable(tableName, record[tableName]);
        if (kept !== undefined) {
          codewhaleSection[tableName] = kept;
        }
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
    // Which spelling each written key came from, to name a superseded alias.
    const sectionSpellings = new Map<string, string>();
    for (const [rawKey, value] of Object.entries(rawSection)) {
      // An alias spelling is written under its canonical key, which is never
      // overridden by an alias of the same key.
      if (Object.hasOwn(CODEWHALE_NARROWING_TABLES, rawKey)) {
        const { kept, dropped } = filterNarrowingTable(rawKey, value);
        if (kept !== undefined) {
          sectionFields[rawKey] = kept;
        }
        droppedKeys.push(...dropped);
        continue;
      }
      const key = CODEWHALE_SECTION_ALIAS_TO_KEY.get(rawKey) ?? rawKey;
      // Every allowlisted key is a string upstream; any other value type would
      // make Codewhale reject the whole profile.
      if (
        (CODEWHALE_SECTION_KEYS as readonly string[]).includes(key) &&
        typeof value === "string"
      ) {
        if (key === rawKey || sectionFields[key] === undefined) {
          if (sectionFields[key] !== undefined) {
            droppedKeys.push(sectionSpellings.get(key) ?? key);
          }
          sectionFields[key] = value;
          sectionSpellings.set(key, rawKey);
        } else {
          droppedKeys.push(rawKey);
        }
      } else {
        droppedKeys.push(rawKey);
      }
    }
    if (droppedKeys.length > 0) {
      logger?.warn(
        `Dropping unsupported or duplicate codewhale subagent keys in ${rulesyncSubagent.getRelativeFilePath()}: ${droppedKeys.join(", ")}. Codewhale rejects agent profiles with unknown fields, non-string values there, [tools] / [permissions] values that would widen access, or two spellings of one key; supported keys are ${CODEWHALE_SECTION_KEYS.join(", ")}, each a string (the canonical spelling wins over an alias), plus the narrowing-only tools.posture = "read-only" and permissions.allow_shell = false, permissions.trust = false, permissions.approval_required = true.`,
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
