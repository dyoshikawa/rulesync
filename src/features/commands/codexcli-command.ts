import { z } from "zod/mini";

import { CODEXCLI_PROMPTS_DIR_PATH } from "../../constants/codexcli-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

// looseObject preserves unknown keys during parsing so future Codex frontmatter
// additions survive a round trip. https://developers.openai.com/codex/custom-prompts
const CodexcliCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
});

export type CodexcliCommandFrontmatter = z.infer<typeof CodexcliCommandFrontmatterSchema>;

/**
 * Generates Codex CLI's global-only custom prompts under `~/.codex/prompts/*.md`.
 *
 * Note: upstream Codex docs now state "Custom prompts are deprecated. Use skills for
 * reusable instructions" (https://developers.openai.com/codex/custom-prompts). No removal
 * date has been announced and custom prompts remain functional, so this class's
 * generation behavior is unchanged. Prefer rulesync's `codexcli` skills support
 * (see `src/features/skills/codexcli-skill.ts`) for new reusable instructions going
 * forward; this class is kept for users who still rely on custom prompts.
 */
export class CodexcliCommand extends FrontmatterMarkdownToolCommand<CodexcliCommandFrontmatter> {
  static getSettablePaths({ global }: { global?: boolean } = {}): ToolCommandSettablePaths {
    if (!global) {
      throw new Error("CodexcliCommand only supports global mode. Please pass { global: true }.");
    }
    return {
      relativeDirPath: CODEXCLI_PROMPTS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "codexcli";
  }

  protected static override getFrontmatterSchema() {
    return CodexcliCommandFrontmatterSchema;
  }

  protected static override stringifyFileContent({
    body,
    frontmatter,
  }: {
    body: string;
    frontmatter: Record<string, unknown>;
  }): string {
    // Only emit frontmatter when at least one field is present so prompts without
    // metadata stay as plain Markdown bodies.
    const hasFrontmatter = Object.keys(frontmatter ?? {}).length > 0;
    return hasFrontmatter ? stringifyFrontmatter(body, frontmatter) : body;
  }

  protected static override toToolFrontmatter(
    rulesyncFrontmatter: RulesyncCommandFrontmatter,
  ): CodexcliCommandFrontmatter {
    // Merge codexcli-specific fields (e.g. argument-hint) from rulesync frontmatter.
    const codexcliFields = rulesyncFrontmatter.codexcli ?? {};
    return {
      ...(rulesyncFrontmatter.description !== undefined && {
        description: rulesyncFrontmatter.description,
      }),
      ...codexcliFields,
    };
  }

  protected static override getDeletionFrontmatter(): CodexcliCommandFrontmatter {
    return {};
  }

  protected override toRulesyncFrontmatter(): RulesyncCommandFrontmatter {
    const { description, ...restFields } = this.frontmatter;

    return {
      targets: ["*"],
      ...(description !== undefined && { description }),
      // Preserve Codex-specific fields (e.g. argument-hint) in the codexcli section.
      ...(Object.keys(restFields).length > 0 && { codexcli: restFields }),
    };
  }
}
