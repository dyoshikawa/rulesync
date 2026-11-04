import { z } from "zod/mini";

import {
  CORTEXCODE_GLOBAL_SKILLS_DIR_PATH,
  CORTEXCODE_SKILLS_DIR_PATH,
} from "../../constants/cortexcode-paths.js";
import { SectionPassthroughSkill } from "./section-passthrough-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

// Snowflake Cortex Code skill frontmatter: `name` and `description` as in the
// Agent Skills spec, plus an optional `tools` allowlist.
// @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
const CortexcodeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  /** Tool names the skill may use; omitted = every tool. */
  tools: z.optional(z.array(z.string())),
});

/**
 * Represents a Snowflake Cortex Code skill directory.
 *
 * Cortex Code discovers Anthropic-style `<name>/SKILL.md` directories under
 * `<project>/.cortex/skills/` (project scope) and `~/.snowflake/cortex/skills/`
 * (user scope). The frontmatter requires `name` (matching the directory name)
 * and `description`; supporting files next to `SKILL.md` are carried along.
 *
 * The documented `tools` list and any other key beyond name/description
 * round-trip through the `cortexcode` section.
 *
 * @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
 */
export class CortexcodeSkill extends SectionPassthroughSkill {
  protected static override readonly toolTarget = "cortexcode";

  protected static override readonly sectionKey = "cortexcode";

  protected static override readonly frontmatterSchema = CortexcodeSkillFrontmatterSchema;

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolSkillSettablePaths {
    // The processor supplies the home directory as outputRoot in global mode:
    // - Project mode: {process.cwd()}/.cortex/skills/
    // - Global mode: {getHomeDirectory()}/.snowflake/cortex/skills/
    return {
      relativeDirPath: global ? CORTEXCODE_GLOBAL_SKILLS_DIR_PATH : CORTEXCODE_SKILLS_DIR_PATH,
    };
  }
}
