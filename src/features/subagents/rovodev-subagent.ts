import { z } from "zod/mini";

import { ROVODEV_SUBAGENTS_DIR_PATH } from "../../constants/rovodev-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolSubagent } from "./frontmatter-markdown-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

const RovodevSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
});

type RovodevSubagentFrontmatter = z.infer<typeof RovodevSubagentFrontmatterSchema>;

/**
 * Rovo Dev CLI subagents: markdown with YAML frontmatter plus body (system prompt).
 *
 * - **Project:** `.rovodev/subagents/*.md`
 * - **User:** `~/.rovodev/subagents/*.md` (same relative path under home when syncing with `--global`)
 *
 * Optional frontmatter fields such as `tools` are preserved under the rulesync `rovodev` key on round-trip.
 *
 * @see https://support.atlassian.com/rovo/docs/use-subagents-in-rovo-dev-cli/
 */
export class RovodevSubagent extends FrontmatterMarkdownToolSubagent<RovodevSubagentFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: ROVODEV_SUBAGENTS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "rovodev";
  }

  protected static override getFrontmatterSchema() {
    return RovodevSubagentFrontmatterSchema;
  }
}
