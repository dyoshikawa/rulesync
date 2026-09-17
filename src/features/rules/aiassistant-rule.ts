import { join } from "node:path";

import { AIASSISTANT_RULES_DIR_PATH } from "../../constants/aiassistant-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type AiassistantRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  nonRoot: {
    relativeDirPath: string;
  };
};

/**
 * Rule types AI Assistant recognizes on the `apply:` metadata line. The values
 * are matched case-sensitively by the plugin, so they are emitted verbatim.
 */
const AIASSISTANT_APPLY_VALUES = [
  "always",
  "manually",
  "by model decision",
  "by file patterns",
  "off",
] as const;

type AiassistantApply = (typeof AIASSISTANT_APPLY_VALUES)[number];

const isAiassistantApply = (value: string): value is AiassistantApply =>
  (AIASSISTANT_APPLY_VALUES as readonly string[]).includes(value);

/**
 * Globs that match the whole project and so say nothing beyond "always".
 */
const UNIVERSAL_GLOBS = new Set(["**/*", "*"]);

/**
 * The plugin's own `metadataRegex`: a leading `---` block, read with
 * `find` (so the file may start with blank lines) and stripped from the body.
 */
const METADATA_BLOCK_REGEX = /^---\s*([\s\S]*?)---\s*/;

export type AiassistantRuleMetadata = {
  apply: AiassistantApply;
  /** Condition for `by model decision`. */
  instructions?: string | undefined;
  /** Comma-separated globs for `by file patterns`. */
  patterns?: string[] | undefined;
};

export type AiassistantRuleParams = Omit<ToolRuleParams, "fileContent"> & {
  body: string;
  /** Omitted when the file carried no recognizable `apply:` line. */
  metadata?: AiassistantRuleMetadata | undefined;
};

/**
 * Rule generator for JetBrains AI Assistant.
 *
 * AI Assistant reads project rules as flat Markdown files in
 * `.aiassistant/rules/*.md` (one file per rule, identified by filename). There
 * is no special root file (unlike Junie's `guidelines.md`), so every rule —
 * root or non-root — is written as its own file under `rules/`.
 *
 * The rule type (Always / Manually / By model decision / By file patterns /
 * Off) is stored in the file itself as a leading `---` metadata block that the
 * IDE's "Rule type" selector edits in place. The block is not YAML: each line
 * is `<field>: <value>` split on the first colon, and `patterns` is a
 * comma-separated glob list, so it is written and parsed by hand here. A file
 * without an `apply:` line is treated as Off at retrieval time (it is never
 * attached automatically), which is why every generated file carries one.
 *
 * Field names and values come from the plugin (`AiRulesService`,
 * `AiRulesLLMBundle.properties`; verified on build 262.10968.75) — the docs
 * page describes the rule type only as an IDE setting.
 *
 * AI Assistant and Junie are different JetBrains products (real-time assistance
 * vs. autonomous agent) with different layouts, so this is a separate target.
 *
 * @see https://www.jetbrains.com/help/ai-assistant/configure-project-rules.html
 */
export class AiassistantRule extends ToolRule {
  private readonly body: string;
  private readonly metadata: AiassistantRuleMetadata | undefined;

  constructor({ body, metadata, ...rest }: AiassistantRuleParams) {
    super({
      ...rest,
      fileContent: AiassistantRule.buildFileContent({ body, metadata }),
    });
    this.body = body;
    this.metadata = metadata;
  }

  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): AiassistantRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: AIASSISTANT_RULES_DIR_PATH,
      },
    };
  }

  getBody(): string {
    return this.body;
  }

  getMetadata(): AiassistantRuleMetadata | undefined {
    return this.metadata;
  }

  /**
   * Serialize the metadata block the way the IDE writes it
   * (`---\n<field>: <value>\n---`), followed by the body.
   */
  private static buildFileContent({
    body,
    metadata,
  }: {
    body: string;
    metadata: AiassistantRuleMetadata | undefined;
  }): string {
    if (metadata === undefined) {
      return body;
    }
    const lines = [`apply: ${metadata.apply}`];
    if (metadata.apply === "by model decision" && metadata.instructions) {
      lines.push(`instructions: ${metadata.instructions}`);
    }
    if (
      metadata.apply === "by file patterns" &&
      metadata.patterns &&
      metadata.patterns.length > 0
    ) {
      lines.push(`patterns: ${metadata.patterns.join(", ")}`);
    }
    return `---\n${lines.join("\n")}\n---\n\n${body}`;
  }

  /**
   * Split a rule file into its metadata block and body, mirroring the plugin:
   * the block is located with the same regex, each line is split on its first
   * colon and trimmed, and an `apply:` value outside the known set (or a
   * missing block) yields no metadata. Unknown fields are ignored.
   */
  static parseFileContent(fileContent: string): {
    metadata: AiassistantRuleMetadata | undefined;
    body: string;
  } {
    const match = METADATA_BLOCK_REGEX.exec(fileContent);
    if (match === null) {
      return { metadata: undefined, body: fileContent.trim() };
    }
    const body = fileContent.slice(match[0].length).trim();

    const fields = new Map<string, string>();
    for (const line of (match[1] ?? "").split(/\r?\n/)) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        continue;
      }
      fields.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
    }

    const apply = fields.get("apply");
    if (apply === undefined || !isAiassistantApply(apply)) {
      return { metadata: undefined, body };
    }

    const instructions = fields.get("instructions");
    const patterns = fields
      .get("patterns")
      ?.split(",")
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern.length > 0);

    return {
      metadata: {
        apply,
        ...(apply === "by model decision" && instructions && { instructions }),
        ...(apply === "by file patterns" && patterns && patterns.length > 0 && { patterns }),
      },
      body,
    };
  }

  /**
   * Derive the metadata block from the canonical frontmatter, mirroring the
   * Cursor mapping: an explicit `aiassistant.apply` wins; otherwise specific
   * `globs` become `by file patterns`, a `description` on a rule with no
   * `globs` at all becomes the `by model decision` condition, and everything
   * else — the root rule, universal globs (which already say "every file",
   * whatever the description), bare rules — is `always`.
   */
  private static buildMetadata(rulesyncRule: RulesyncRule): AiassistantRuleMetadata {
    const frontmatter = rulesyncRule.getFrontmatter();
    const globs = (frontmatter.globs ?? []).map((glob) => glob.trim()).filter(Boolean);
    const specificGlobs = globs.filter((glob) => !UNIVERSAL_GLOBS.has(glob));
    // The block is line-based, so a multi-line description is flattened.
    const instructions = frontmatter.description?.replace(/\s*\r?\n\s*/g, " ").trim();

    const explicitApply = frontmatter.aiassistant?.apply;
    const apply: AiassistantApply =
      explicitApply !== undefined && isAiassistantApply(explicitApply)
        ? explicitApply
        : frontmatter.root !== true && specificGlobs.length > 0
          ? "by file patterns"
          : frontmatter.root !== true && globs.length === 0 && instructions
            ? "by model decision"
            : "always";

    return {
      apply,
      ...(apply === "by model decision" && instructions && { instructions }),
      ...(apply === "by file patterns" && specificGlobs.length > 0 && { patterns: specificGlobs }),
    };
  }

  toRulesyncRule(): RulesyncRule {
    const metadata = this.metadata;
    const globs =
      metadata?.apply === "by file patterns"
        ? (metadata.patterns ?? [])
        : metadata?.apply === "always"
          ? ["**/*"]
          : [];
    const description = metadata?.apply === "by model decision" ? metadata.instructions : undefined;
    // `always`, `by model decision` and `by file patterns` are recovered from
    // `globs` / `description` on the next generate; only the two types with no
    // canonical counterpart need to be carried explicitly.
    const apply =
      metadata?.apply === "manually" || metadata?.apply === "off" ? metadata.apply : undefined;

    return new RulesyncRule({
      outputRoot: process.cwd(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: false,
        targets: ["*"],
        description,
        globs,
        ...(apply !== undefined && { aiassistant: { apply } }),
      },
      body: this.body,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): AiassistantRule {
    // Both root and non-root rules map to a flat file under rules/.
    return new AiassistantRule({
      outputRoot,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      body: rulesyncRule.getBody(),
      metadata: this.buildMetadata(rulesyncRule),
      validate,
      root: false,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<AiassistantRule> {
    const relativeDirPath = this.getSettablePaths().nonRoot.relativeDirPath;
    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));
    const { metadata, body } = this.parseFileContent(fileContent);

    return new AiassistantRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      body,
      metadata,
      validate,
      root: false,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): AiassistantRule {
    return new AiassistantRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      body: "",
      validate: false,
      root: false,
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "aiassistant",
    });
  }
}
