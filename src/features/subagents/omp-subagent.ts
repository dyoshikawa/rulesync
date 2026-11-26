import { join } from "node:path";

import { z } from "zod/mini";

import { OMP_AGENTS_DIR_NAME, OMP_LAYOUT, type OmpLayout } from "../../constants/omp-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolSubagent } from "./frontmatter-markdown-subagent.js";
import type {
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Frontmatter of an oh-my-pi agent definition (`parseAgentFields` in
 * `packages/coding-agent/src/discovery/helpers.ts`). oh-my-pi skips a file
 * without both `name` and `description`; the other keys (`tools`, `model`,
 * `spawns`, `thinkingLevel`, `blocking`, ...) pass through unchanged.
 */
const OmpSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

type OmpSubagentFrontmatter = z.infer<typeof OmpSubagentFrontmatterSchema>;

/**
 * Subagent generator for oh-my-pi (`omp`): `.omp/agents/*.md` (project) and
 * `~/.omp/agent/agents/*.md` (global, default profile). Keys under the `omp:`
 * section of a rulesync subagent are copied into the frontmatter verbatim.
 *
 * Descendants of oh-my-pi with the same agent discovery (Gajae-Code) subclass
 * this and override only {@link OmpSubagent.layout}.
 *
 * @see https://github.com/can1357/oh-my-pi/blob/main/docs/task-agent-discovery.md
 */
export class OmpSubagent extends FrontmatterMarkdownToolSubagent<OmpSubagentFrontmatter> {
  /** Directory layout; oh-my-pi descendants (Gajae-Code) override it. */
  protected static readonly layout: OmpLayout = OMP_LAYOUT;

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(global ? this.layout.globalDir : this.layout.dir, OMP_AGENTS_DIR_NAME),
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return this.layout.toolTarget;
  }

  protected static override getFrontmatterSchema() {
    return OmpSubagentFrontmatterSchema;
  }

  protected static override toToolFrontmatter({
    rulesyncSubagent,
  }: Pick<
    ToolSubagentFromRulesyncSubagentParams,
    "rulesyncSubagent" | "logger"
  >): OmpSubagentFrontmatter {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const ompSection = rulesyncFrontmatter[this.layout.toolTarget] ?? {};

    return {
      name: rulesyncFrontmatter.name,
      // oh-my-pi ignores an agent without a description, so fall back to the
      // name rather than emit a file that is never loaded.
      description: rulesyncFrontmatter.description ?? rulesyncFrontmatter.name,
      ...ompSection,
    };
  }
}
