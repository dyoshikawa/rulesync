import { z } from "zod/mini";

import { GROKCLI_AGENTS_DIR_PATH } from "../../constants/grokcli-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { FrontmatterMarkdownToolSubagent } from "./frontmatter-markdown-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

// Grok Build agent profiles use `name` + `description` plus optional tuning keys
// (`prompt_mode`, `model`, `permission_mode`, `agents_md`, ...). looseObject
// preserves those extra keys verbatim on round-trip.
const GrokcliSubagentFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.optional(z.string()),
});

type GrokcliSubagentFrontmatter = z.infer<typeof GrokcliSubagentFrontmatterSchema>;

/**
 * Subagent (agent profile) generator for xAI Grok Build CLI.
 *
 * Grok Build discovers agent definitions from `.grok/agents/*.md` (project) and
 * `~/.grok/agents/*.md` (global), each a Markdown file with YAML frontmatter
 * (`name`, optional `description`, plus tuning keys such as `prompt_mode`,
 * `model`, `permission_mode`, `agents_md`) followed by the agent's system
 * prompt. Verified via `grok inspect` (grok 0.2.54): a `.grok/agents/<name>.md`
 * file appears under `agents` with `source.type: "project"`. Mirrors the Gemini
 * CLI subagent adapter, which uses the same Markdown + frontmatter convention.
 *
 * @see https://docs.x.ai/build/overview
 */
export class GrokcliSubagent extends FrontmatterMarkdownToolSubagent<GrokcliSubagentFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    // Project (`.grok/agents/`) and global (`~/.grok/agents/`) share the same
    // relative directory; global mode resolves it against the home directory.
    return {
      relativeDirPath: GROKCLI_AGENTS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "grokcli";
  }

  protected static override getFrontmatterSchema() {
    return GrokcliSubagentFrontmatterSchema;
  }
}
