import { join } from "node:path";

import { z } from "zod/mini";

import {
  AUGMENTCODE_AGENTS_DIR_PATH,
  AUGMENTCODE_ALT_AGENTS_DIR_PATH,
} from "../../constants/augmentcode-paths.js";
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

// Auggie accepts a tool list either as a YAML list or as one comma-separated
// string ("Example with comma-separated format: `tools: view,
// codebase-retrieval`" — https://docs.augmentcode.com/cli/subagents). Both are
// accepted on import; rulesync always emits the list form.
const AugmentcodeToolListSchema = z.union([z.array(z.string()), z.string()]);

/**
 * Normalize a documented tool-list value to the list form: a string is split on
 * commas, trimmed, and emptied of blank entries; a list is returned as is. A
 * string that names no tool (`""`, `", ,"`) is treated as unset rather than as
 * an empty allowlist — the author left the value blank, not the tool set — so
 * it yields `undefined`; an authored empty list is kept as written.
 */
function normalizeAugmentcodeToolList(value: string[] | string): string[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }
  const tools = value
    .split(",")
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  return tools.length > 0 ? tools : undefined;
}

// AugmentCode (Auggie CLI) subagents are Markdown files with YAML frontmatter.
// `name` is required; `description`, `color` (ANSI color name), `model`,
// `tools` (allowlist) and `disabled_tools` (denylist; takes precedence over
// `tools`) are optional. See https://docs.augmentcode.com/cli/subagents
// looseObject preserves unknown keys so future fields round-trip cleanly.
const AugmentcodeSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  color: z.optional(z.string()),
  model: z.optional(z.string()),
  tools: z.optional(AugmentcodeToolListSchema),
  disabled_tools: z.optional(AugmentcodeToolListSchema),
});

type AugmentcodeSubagentFrontmatter = z.infer<typeof AugmentcodeSubagentFrontmatterSchema>;

type AugmentcodeSubagentParams = {
  frontmatter: AugmentcodeSubagentFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & { fileContent?: string };

/**
 * AugmentCode (Auggie CLI) subagents.
 *
 * Subagents live under `.augment/agents/` (workspace/project) and
 * `~/.augment/agents/` (user/global). Both scopes use the same relative path;
 * the global variant is resolved against the home directory by the caller.
 *
 * @see https://docs.augmentcode.com/cli/subagents
 */
export class AugmentcodeSubagent extends ToolSubagent {
  private readonly frontmatter: AugmentcodeSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, fileContent, ...rest }: AugmentcodeSubagentParams) {
    if (rest.validate !== false) {
      const result = AugmentcodeSubagentFrontmatterSchema.safeParse(frontmatter);
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
    // Auggie CLI additionally discovers subagents from the cross-tool `.agents/`
    // directory (project `.agents/` and user `~/.agents/`). That is an
    // import-only root: generation still writes to `.augment/agents/`.
    return {
      relativeDirPath: AUGMENTCODE_AGENTS_DIR_PATH,
      importDirPaths: [AUGMENTCODE_ALT_AGENTS_DIR_PATH],
    };
  }

  getFrontmatter(): AugmentcodeSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { name, description, tools, disabled_tools, ...rest } = this.frontmatter;
    // The comma-separated string form is normalized here so the round-trip
    // re-emits the list form Auggie also accepts.
    const normalizedTools = tools === undefined ? undefined : normalizeAugmentcodeToolList(tools);
    const normalizedDisabledTools =
      disabled_tools === undefined ? undefined : normalizeAugmentcodeToolList(disabled_tools);
    const toolLists = {
      ...(normalizedTools !== undefined && { tools: normalizedTools }),
      ...(normalizedDisabledTools !== undefined && { disabled_tools: normalizedDisabledTools }),
    };
    const augmentcodeSection = { ...rest, ...toolLists };

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      // Round-trip tool-specific fields (color/model/tools/disabled_tools and
      // any future keys) through a dedicated augmentcode section.
      ...(Object.keys(augmentcodeSection).length > 0 && { augmentcode: augmentcodeSection }),
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
    const augmentcodeSection = rulesyncFrontmatter.augmentcode ?? {};

    const augmentcodeFrontmatter: AugmentcodeSubagentFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...augmentcodeSection,
    };

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, augmentcodeFrontmatter, {
      avoidBlockScalars: true,
    });
    const paths = this.getSettablePaths({ global });

    return new AugmentcodeSubagent({
      outputRoot,
      frontmatter: augmentcodeFrontmatter,
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

    const result = AugmentcodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "augmentcode",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<AugmentcodeSubagent> {
    // Honor an explicit discovery root (e.g. the `.agents/` import root) when
    // provided; otherwise fall back to the canonical `.augment/agents/` location.
    const dirPath = relativeDirPath ?? this.getSettablePaths({ global }).relativeDirPath;
    const filePath = join(outputRoot, dirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = AugmentcodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new AugmentcodeSubagent({
      outputRoot,
      relativeDirPath: dirPath,
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
  }: ToolSubagentForDeletionParams): AugmentcodeSubagent {
    return new AugmentcodeSubagent({
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
