import { join } from "node:path";

import { AIASSISTANT_RULES_DIR_PATH } from "../../constants/aiassistant-paths.js";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { expandBraceAlternations, splitBraceAwareList } from "../../utils/brace-aware-list.js";
import { readFileContent } from "../../utils/file.js";
import { warnWithFallback } from "../../utils/logger.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
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
 * Any other value is carried through untouched (the plugin treats it as Off
 * today; a future build may recognize it).
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

const METADATA_DELIMITER = "---";

/**
 * Splits text into lines that keep their own line terminator, so the body can
 * be sliced back out of the file byte-for-byte. Lone `\r` counts as a break,
 * matching Kotlin's `lines()`, which the plugin uses on the block.
 */
const LINE_SPLIT_REGEX = /(?<=\r\n|\r(?!\n)|(?<!\r)\n)/;

/**
 * The block is line-based, so a value must not carry a line break: one would
 * start a new `<field>: <value>` line and could override `apply:`.
 */
const flattenValue = (value: string): string =>
  value
    .split(/\r\n|\r|\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");

export type AiassistantRuleMetadata = {
  /** One of `AIASSISTANT_APPLY_VALUES`, or an unrecognized value kept as is. */
  apply: string;
  /** Condition for `by model decision`. */
  instructions?: string | undefined;
  /** Globs for `by file patterns` (one per entry; comma-separated in the file). */
  patterns?: string[] | undefined;
};

export type AiassistantRuleParams = Omit<
  ToolRuleParams,
  "fileContent" | "description" | "globs"
> & {
  body: string;
  /** Omitted when the file carried no `apply:` line. */
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
      lines.push(`instructions: ${flattenValue(metadata.instructions)}`);
    }
    if (
      metadata.apply === "by file patterns" &&
      metadata.patterns &&
      metadata.patterns.length > 0
    ) {
      lines.push(`patterns: ${metadata.patterns.map(flattenValue).join(", ")}`);
    }
    return `${METADATA_DELIMITER}\n${lines.join("\n")}\n${METADATA_DELIMITER}\n\n${body}`;
  }

  /**
   * Split a rule file into its metadata block and body. The plugin locates the
   * block with `^---\s*([\s\S]*?)---\s*` (anchored at the very start of the
   * file); this reads it line by line instead — a delimiter is a line that is
   * exactly `---` — which is linear on any input and tolerates a BOM or blank
   * lines before the block. Each line is split on its first colon and trimmed;
   * unknown fields are ignored; a missing block or `apply:` line yields no
   * metadata, while an unrecognized `apply:` value is kept verbatim.
   */
  static parseFileContent(fileContent: string): {
    metadata: AiassistantRuleMetadata | undefined;
    body: string;
  } {
    const content = fileContent.replace(/^\uFEFF/, "").trimStart();
    const lines = content.split(LINE_SPLIT_REGEX);
    const closingIndex =
      lines[0]?.trim() === METADATA_DELIMITER
        ? lines.findIndex((line, index) => index > 0 && line.trim() === METADATA_DELIMITER)
        : -1;
    if (closingIndex === -1) {
      return { metadata: undefined, body: content.trim() };
    }
    const body = lines
      .slice(closingIndex + 1)
      .join("")
      .trim();

    const fields = new Map<string, string>();
    for (const line of lines.slice(1, closingIndex)) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) {
        continue;
      }
      fields.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
    }

    const apply = fields.get("apply");
    if (apply === undefined || apply.length === 0) {
      return { metadata: undefined, body };
    }

    const instructions = fields.get("instructions");
    const patterns = fields.get("patterns");

    return {
      metadata: {
        apply,
        ...(apply === "by model decision" && instructions && { instructions }),
        ...(apply === "by file patterns" &&
          patterns && { patterns: splitBraceAwareList(patterns) }),
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
   *
   * The plugin splits `patterns` on every comma, so a brace alternation such
   * as `*.{ts,tsx}` is expanded into one glob per branch before it is written.
   */
  private static buildMetadata(frontmatter: RulesyncRuleFrontmatter): AiassistantRuleMetadata {
    const globs = (frontmatter.globs ?? [])
      .map((glob) => flattenValue(glob))
      .filter((glob) => glob.length > 0)
      .flatMap((glob) => expandBraceAlternations(glob));
    // A universal glob means "every file", so a list that contains one is
    // `always` however specific the others are; only an all-specific list
    // narrows the rule to `by file patterns`. This is deliberately `some`
    // rather than the `every` the Cline/CodeBuddy adapters use: those keep a
    // mixed list as conditional paths, whereas the plugin's `by file patterns`
    // and `always` are mutually exclusive, so the union is the honest choice.
    const hasUniversalGlob = globs.some((glob) => UNIVERSAL_GLOBS.has(glob));
    const instructions = frontmatter.description && flattenValue(frontmatter.description);

    const explicitApply =
      frontmatter.aiassistant?.apply && flattenValue(frontmatter.aiassistant.apply);
    const apply = explicitApply
      ? explicitApply
      : frontmatter.root !== true && globs.length > 0 && !hasUniversalGlob
        ? "by file patterns"
        : frontmatter.root !== true && globs.length === 0 && instructions
          ? "by model decision"
          : "always";
    // `patterns` carries every glob, universal ones included, so an explicit
    // `by file patterns` on a mixed list round-trips unchanged.
    const patterns = globs;

    return {
      apply,
      ...(apply === "by model decision" && instructions && { instructions }),
      ...(apply === "by file patterns" && patterns.length > 0 && { patterns }),
    };
  }

  /**
   * Warn, at generate time, about a block the plugin cannot act on as the
   * author presumably intended.
   */
  private static warnAboutMetadata({
    metadata,
    relativeFilePath,
  }: {
    metadata: AiassistantRuleMetadata;
    relativeFilePath: string;
  }): void {
    const { apply, instructions, patterns = [] } = metadata;
    if (!isAiassistantApply(apply)) {
      warnWithFallback(
        undefined,
        `${relativeFilePath}: aiassistant.apply "${apply}" is not one of ${AIASSISTANT_APPLY_VALUES.join(", ")}; it is written as is, and the current AI Assistant treats such a rule as Off.`,
      );
    }
    if (apply === "by file patterns" && patterns.length === 0) {
      warnWithFallback(
        undefined,
        `${relativeFilePath}: aiassistant.apply is "by file patterns" but the rule has no globs, so AI Assistant will never attach it.`,
      );
    }
    if (apply === "by model decision" && !instructions) {
      warnWithFallback(
        undefined,
        `${relativeFilePath}: aiassistant.apply is "by model decision" but the rule has no description, so AI Assistant has no condition to decide on.`,
      );
    }
    const commaGlob = patterns.find((glob) => glob.includes(","));
    if (commaGlob !== undefined) {
      warnWithFallback(
        undefined,
        `${relativeFilePath}: the glob "${commaGlob}" contains a comma, which AI Assistant reads as a pattern separator.`,
      );
    }
    // The plugin closes the block at the first `---` anywhere, not only on a
    // line of its own, so a value containing it is cut short in the IDE.
    if ([apply, instructions ?? "", ...patterns].some((value) => value.includes("---"))) {
      warnWithFallback(
        undefined,
        `${relativeFilePath}: a metadata value contains "---", which AI Assistant reads as the end of the metadata block.`,
      );
    }
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
    const frontmatter: RulesyncRuleFrontmatter = {
      root: false,
      targets: ["*"],
      description,
      globs,
    };
    // `aiassistant.apply` is carried only when the next generate would not
    // derive the same type from `globs` / `description` on its own: the types
    // with no canonical counterpart (`manually`, `off`, unrecognized values)
    // and the blocks whose companion field is missing or universal.
    const derivedApply =
      metadata === undefined ? undefined : AiassistantRule.buildMetadata(frontmatter).apply;
    const apply =
      metadata !== undefined && derivedApply !== metadata.apply ? metadata.apply : undefined;

    return new RulesyncRule({
      outputRoot: process.cwd(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        ...frontmatter,
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
    const metadata = this.buildMetadata(rulesyncRule.getFrontmatter());
    this.warnAboutMetadata({ metadata, relativeFilePath: rulesyncRule.getRelativeFilePath() });
    // Both root and non-root rules map to a flat file under rules/.
    return new AiassistantRule({
      outputRoot,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      body: rulesyncRule.getBody(),
      metadata,
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
