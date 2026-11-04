import { join } from "node:path";

import { z } from "zod/mini";

import { PI_LAYOUT, type PiLayout } from "../../constants/pi-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { FrontmatterMarkdownToolCommand } from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

/**
 * Frontmatter schema for Pi Coding Agent commands.
 *
 * Pi reads Markdown commands from `.pi/prompts/` with an optional minimal
 * frontmatter. Unknown keys are preserved via `looseObject` so the schema
 * stays tolerant to Pi's evolving command metadata.
 */
export const PiCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
});

export type PiCommandFrontmatter = z.infer<typeof PiCommandFrontmatterSchema>;

/**
 * Command generator for Pi Coding Agent.
 *
 * - Project scope: `.pi/prompts/<name>.md`
 * - Global scope: `~/.pi/agent/prompts/<name>.md`
 *
 * Pi's argument placeholders (`$1`, `$2`, `$@`, `$ARGUMENTS`) are compatible
 * with rulesync command bodies, so the body is passed through verbatim.
 */
export class PiCommand extends FrontmatterMarkdownToolCommand<PiCommandFrontmatter> {
  /** Directory layout; Pi forks (oh-my-pi) override it. */
  protected static readonly layout: PiLayout = PI_LAYOUT;

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolCommandSettablePaths {
    const root = global ? this.layout.globalDir : this.layout.dir;
    return {
      relativeDirPath: join(root, this.layout.commandsDirName),
    };
  }

  /** Also the tool-scoped section (`pi:` / `omp:`) of the Rulesync frontmatter. */
  protected static override getToolTarget(): ToolTarget {
    return this.layout.toolTarget;
  }

  protected static override getFrontmatterSchema() {
    return PiCommandFrontmatterSchema;
  }

  protected static override stringifyFileContent({
    body,
    frontmatter,
  }: {
    body: string;
    frontmatter: Record<string, unknown>;
  }): string {
    // Emit frontmatter only when there is at least one defined field.
    const hasContent = Object.values(frontmatter).some((value) => value !== undefined);
    if (!hasContent) {
      return body;
    }
    return stringifyFrontmatter(body, frontmatter);
  }

  protected static override toToolFrontmatter(
    rulesyncFrontmatter: RulesyncCommandFrontmatter,
  ): PiCommandFrontmatter {
    const piFields = rulesyncFrontmatter[this.getToolTarget()] ?? {};
    return {
      ...(rulesyncFrontmatter.description !== undefined && {
        description: rulesyncFrontmatter.description,
      }),
      ...piFields,
    };
  }

  protected static override getDeletionFrontmatter(): PiCommandFrontmatter {
    return {};
  }
}
