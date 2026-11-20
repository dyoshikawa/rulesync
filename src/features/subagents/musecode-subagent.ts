import { isDeepStrictEqual } from "node:util";

import {
  MUSECODE_GLOBAL_SUBAGENTS_DIR_PATH,
  MUSECODE_SUBAGENTS_DIR_PATH,
} from "../../constants/musecode-paths.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { isPlainObject } from "../../utils/type-guards.js";
import {
  ANTIGRAVITY_SHARED_SUBAGENT_SECTION_KEYS,
  AntigravitySharedSubagent,
} from "./antigravity-shared-subagent.js";
import type {
  ToolSubagent,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Muse Code agent names are lowercase words joined by single hyphens
 * (`test-writer`).
 *
 * @see https://dev.meta.ai/docs/muse-code/agents
 */
const MUSECODE_AGENT_NAME_PATTERN = /^[a-z]+(?:-[a-z]+)*$/;

/**
 * The frontmatter keys the Muse Code agents page documents.
 *
 * @see https://dev.meta.ai/docs/muse-code/agents
 */
const MUSECODE_DOCUMENTED_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  "name",
  "description",
  "model",
  "effort",
  "tools",
  "disallowedTools",
]);

/**
 * Meta Muse Code custom agent (subagent): a Markdown file with YAML
 * frontmatter (`name`, `description`, and optionally `model`, `effort`,
 * `tools`, `disallowedTools`) whose body is the agent's prompt.
 *
 * Project agents load from `.agents/agents/`, the directory the Antigravity
 * targets and the simulated `agentsmd` writer already generate into, so the
 * project file is rendered exactly like theirs (the `musecode` section is part
 * of the merge every writer of that file performs) and the file on disk does
 * not depend on which target ran last. User agents load from
 * `~/.config/muse/agents/`, which only this target writes, so only the
 * `musecode` section is merged there.
 *
 * @see https://dev.meta.ai/docs/muse-code/agents
 */
export class MusecodeSubagent extends AntigravitySharedSubagent {
  protected static override getToolTarget(): ToolTarget {
    return "musecode";
  }

  protected static override getReadSectionKeys({
    global = false,
  }: { global?: boolean } = {}): ToolTarget[] {
    return global ? ["musecode"] : super.getReadSectionKeys({ global });
  }

  static override getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: global ? MUSECODE_GLOBAL_SUBAGENTS_DIR_PATH : MUSECODE_SUBAGENTS_DIR_PATH,
    };
  }

  static override fromRulesyncSubagent(
    params: ToolSubagentFromRulesyncSubagentParams,
  ): ToolSubagent {
    const name = params.rulesyncSubagent.getFrontmatter().name;
    if (!MUSECODE_AGENT_NAME_PATTERN.test(name)) {
      params.logger?.warn(
        `Muse Code subagent name '${name}' in ${params.rulesyncSubagent.getRelativeFilePath()} ` +
          "is not lowercase words joined by single hyphens (e.g. 'test-writer'); " +
          "Muse Code may not load it.",
      );
    }
    const subagent = super.fromRulesyncSubagent(params);
    if (!params.global && subagent instanceof AntigravitySharedSubagent) {
      this.warnAboutSharedProjectFile({ params, subagent });
    }
    return subagent;
  }

  /**
   * The project file is shared with the Antigravity writers, so its content
   * cannot be narrowed to what Muse Code documents. Say so instead when the
   * merged file differs from what the `musecode` block alone would produce.
   */
  private static warnAboutSharedProjectFile({
    params,
    subagent,
  }: {
    params: ToolSubagentFromRulesyncSubagentParams;
    subagent: AntigravitySharedSubagent;
  }): void {
    const { logger, rulesyncSubagent } = params;
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath();

    const undocumentedKeys = Object.keys(subagent.getFrontmatter()).filter(
      (key) => !MUSECODE_DOCUMENTED_FRONTMATTER_KEYS.has(key),
    );
    if (undocumentedKeys.length > 0) {
      logger?.warn(
        `Muse Code subagent ${relativeFilePath}: the shared .agents/agents/ file carries ` +
          `keys Muse Code does not document (${undocumentedKeys.join(", ")}), set in an ` +
          "antigravity-* block; Muse Code may refuse to load the agent.",
      );
    }

    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const musecodeSection = rulesyncFrontmatter.musecode;
    if (!isPlainObject(musecodeSection)) {
      return;
    }
    for (const key of Object.keys(musecodeSection)) {
      if (key === "name" || key === "description") {
        continue;
      }
      const overridingSection = [...ANTIGRAVITY_SHARED_SUBAGENT_SECTION_KEYS]
        .reverse()
        .find((sectionKey) => {
          const section = rulesyncFrontmatter[sectionKey];
          return isPlainObject(section) && section[key] !== undefined;
        });
      if (overridingSection === undefined) {
        continue;
      }
      const overridingValue = (rulesyncFrontmatter[overridingSection] as Record<string, unknown>)[
        key
      ];
      if (!isDeepStrictEqual(overridingValue, musecodeSection[key])) {
        logger?.warn(
          `Muse Code subagent ${relativeFilePath}: '${key}' from the musecode block is ` +
            `overridden by the ${overridingSection} block in the shared .agents/agents/ file.`,
        );
      }
    }
  }
}
