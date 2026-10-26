import { z } from "zod/mini";

import {
  CORTEXCODE_AGENTS_DIR_PATH,
  CORTEXCODE_GLOBAL_AGENTS_DIR_PATH,
} from "../../constants/cortexcode-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolSubagent } from "./frontmatter-markdown-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

// Snowflake Cortex Code subagent frontmatter. `name` is required; the
// remaining keys are the documented optional fields. Unknown keys pass through
// so newer Cortex Code releases keep round-tripping.
// @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
const CortexcodeSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
  /** Tool names the subagent may use; omitted = every tool. */
  tools: z.optional(z.array(z.string())),
  model: z.optional(z.string()),
});

type CortexcodeSubagentFrontmatter = z.infer<typeof CortexcodeSubagentFrontmatterSchema>;

/**
 * Snowflake Cortex Code subagent: a Markdown file with YAML frontmatter under
 * `.cortex/agents/` (project) or `~/.snowflake/cortex/agents/` (user).
 */
export class CortexcodeSubagent extends FrontmatterMarkdownToolSubagent<CortexcodeSubagentFrontmatter> {
  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: global ? CORTEXCODE_GLOBAL_AGENTS_DIR_PATH : CORTEXCODE_AGENTS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "cortexcode";
  }

  protected static override getFrontmatterSchema() {
    return CortexcodeSubagentFrontmatterSchema;
  }
}
