import { z } from "zod/mini";

import { TABNINE_AGENTS_DIR_PATH } from "../../constants/tabnine-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolSubagent } from "./frontmatter-markdown-subagent.js";
import type {
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

// Tabnine CLI subagent frontmatter. `name` and `description` are required by
// the tool; the remaining keys are the documented optional fields. Unknown keys
// pass through so newer Tabnine releases keep round-tripping.
// @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/subagents
const TabnineSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  /** "local" (default) runs inside the CLI; "remote" delegates to a Tabnine cloud agent. */
  kind: z.optional(z.string()),
  /** Built-in tool names the subagent may use; omitted = every tool. */
  tools: z.optional(z.array(z.string())),
  model: z.optional(z.string()),
  /** Sampling temperature, 0.0-2.0. */
  temperature: z.optional(z.number()),
  /** Maximum agent turns (Tabnine default: 15). */
  max_turns: z.optional(z.number()),
  /** Wall-clock budget in minutes (Tabnine default: 5). */
  timeout_mins: z.optional(z.number()),
});

type TabnineSubagentFrontmatter = z.infer<typeof TabnineSubagentFrontmatterSchema>;

/**
 * Tabnine CLI subagent: a Markdown file with YAML frontmatter under
 * `.tabnine/agent/agents/` (project) or `~/.tabnine/agent/agents/` (user).
 * Tabnine only loads these when `experimental.enableAgents` is `true` in its
 * settings; rulesync writes the files and leaves that flag to the user.
 */
export class TabnineSubagent extends FrontmatterMarkdownToolSubagent<TabnineSubagentFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: TABNINE_AGENTS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "tabnine";
  }

  protected static override getFrontmatterSchema() {
    return TabnineSubagentFrontmatterSchema;
  }

  protected static override toToolFrontmatter({
    rulesyncSubagent,
    logger,
  }: Pick<
    ToolSubagentFromRulesyncSubagentParams,
    "rulesyncSubagent" | "logger"
  >): TabnineSubagentFrontmatter {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const tabnineSection = rulesyncFrontmatter.tabnine ?? {};

    // Tabnine refuses to load an agent without a non-empty description, so a
    // canonical subagent that omits one gets a minimal fallback (the way the
    // Cline adapter does) rather than a file the tool would not load or an
    // error that aborts every other target's generation.
    const merged = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...tabnineSection,
    };
    // Only a missing or empty description is filled in; a value of the wrong
    // type is left for the constructor's schema check to report as invalid.
    let description = merged.description;
    if (description === undefined || description === "") {
      description = rulesyncFrontmatter.name ? `${rulesyncFrontmatter.name} subagent` : "subagent";
      logger?.warn(
        `Tabnine CLI subagent ${rulesyncSubagent.getRelativeFilePath()} has no description, ` +
          `which Tabnine requires; wrote ${JSON.stringify(description)} as a placeholder.`,
      );
    }
    const tabnineSubagentFrontmatter = { ...merged, description } as TabnineSubagentFrontmatter;
    return tabnineSubagentFrontmatter;
  }
}
