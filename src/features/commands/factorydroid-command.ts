import { z } from "zod/mini";

import { FACTORYDROID_COMMANDS_DIR_PATH } from "../../constants/factorydroid-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import {
  FrontmatterMarkdownToolCommand,
  type FrontmatterMarkdownToolCommandParams,
} from "./frontmatter-markdown-command.js";
import type { RulesyncCommandFrontmatter } from "./rulesync-command.js";
import type { ToolCommandSettablePaths } from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3).
// Factory Droid custom slash commands are native Markdown files with frontmatter.
// See https://docs.factory.ai/cli/configuration/custom-slash-commands
//   - `description`: optional human-readable summary.
//   - `argument-hint`: optional hint shown for `$ARGUMENTS` usage.
// Those two are the only documented fields. The docs state verbatim: "Tool
// scoping is not available for custom commands. Use Skills or Custom Droids for
// tool policy." — so `allowed-tools` is dropped on generate rather than written
// as frontmatter Droid ignores.
export const FactorydroidCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
});

/** Not a Droid command surface; see the schema comment above. */
const FACTORYDROID_UNSUPPORTED_COMMAND_FIELDS = ["allowed-tools"] as const;

export type FactorydroidCommandFrontmatter = z.infer<typeof FactorydroidCommandFrontmatterSchema>;

export type FactorydroidCommandParams =
  FrontmatterMarkdownToolCommandParams<FactorydroidCommandFrontmatter>;

export class FactorydroidCommand extends FrontmatterMarkdownToolCommand<FactorydroidCommandFrontmatter> {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Factory Droid commands use the same relative path for both project and global modes.
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.factory/commands/
    // - Global mode: {getHomeDirectory()}/.factory/commands/
    return {
      relativeDirPath: FACTORYDROID_COMMANDS_DIR_PATH,
    };
  }

  protected static override getToolTarget(): ToolTarget {
    return "factorydroid";
  }

  protected static override getFrontmatterSchema() {
    return FactorydroidCommandFrontmatterSchema;
  }

  protected static override toToolFrontmatter(
    rulesyncFrontmatter: RulesyncCommandFrontmatter,
  ): FactorydroidCommandFrontmatter {
    const factorydroidFrontmatter = super.toToolFrontmatter(rulesyncFrontmatter);
    for (const field of FACTORYDROID_UNSUPPORTED_COMMAND_FIELDS) {
      delete factorydroidFrontmatter[field];
    }
    return factorydroidFrontmatter;
  }

  protected override toRulesyncFrontmatter(): RulesyncCommandFrontmatter {
    const { description, ...restFields } = this.frontmatter;
    // Symmetric with generation: a field Droid does not honor is not lifted
    // into the override either, so a round trip does not reintroduce it.
    for (const field of FACTORYDROID_UNSUPPORTED_COMMAND_FIELDS) {
      delete restFields[field];
    }

    return {
      targets: ["*"],
      description,
      // Preserve the remaining extra fields (e.g. argument-hint) in the
      // factorydroid section.
      ...(Object.keys(restFields).length > 0 && { factorydroid: restFields }),
    };
  }
}
