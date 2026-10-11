import { join } from "node:path";

import { WARP_GLOBAL_RULE_DIR, WARP_LEGACY_RULE_FILE_NAME } from "../../constants/warp-paths.js";
import { AiFileParams } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import {
  NestedAgentsmdRule,
  NestedAgentsmdRuleFamily,
  NestedAgentsmdRuleSettablePaths,
  NestedAgentsmdRuleSettablePathsGlobal,
} from "./nested-agentsmd-rule.js";
import { ToolRuleFromFileParams, ToolRuleImportOnlyRoot } from "./tool-rule.js";

export type WarpRuleParams = AiFileParams & {
  root?: boolean;
};

export type WarpRuleSettablePaths = NestedAgentsmdRuleSettablePaths & {
  /** The legacy root `WARP.md`, read on import only. */
  importOnlyRoots?: ToolRuleImportOnlyRoot[];
};

/**
 * Warp rules.
 *
 * Warp reads project rules from `AGENTS.md` (or the back-compat `WARP.md`) at
 * the repository root and in subdirectories "for more targeted guidance": it
 * applies the root file plus the current directory's file, and the
 * subdirectory's rules take precedence over the root's. Nested per-directory
 * files are therefore a real scoping surface. Warp does NOT scan a
 * `.warp/memories/` directory and does not follow references out of a rules
 * file, so every non-root rule without `agentsmd.subprojectPath` folds into
 * the root `./AGENTS.md`.
 *
 * A legacy root `WARP.md` is read on import when the root `AGENTS.md` is
 * absent, so a repository that has not moved to `AGENTS.md` yet imports its
 * rules. It is never written or deleted. When both exist, Warp reads
 * `WARP.md`, so import keeps reading the `AGENTS.md` rulesync manages and warns
 * that Warp ignores it, as generate already does.
 *
 * In global mode, Warp reads a third rule source from `~/.agents/AGENTS.md`
 * (the cross-tool agent config directory), indexed like project rules and also
 * used from remote hosts in SSH sessions. The same root-fold policy applies.
 *
 * @see https://docs.warp.dev/agents/capabilities/rules/
 * @see https://docs.warp.dev/terminal/settings/file-locations/
 */
export class WarpRule extends NestedAgentsmdRule {
  protected static getFamily(): NestedAgentsmdRuleFamily {
    return { globalDir: WARP_GLOBAL_RULE_DIR, toolTarget: "warp" };
  }

  static override getSettablePaths(
    options: { global?: boolean; excludeToolDir?: boolean } = {},
  ): WarpRuleSettablePaths | NestedAgentsmdRuleSettablePathsGlobal {
    const paths = super.getSettablePaths(options);
    if (options.global) {
      return paths;
    }
    return {
      ...paths,
      importOnlyRoots: [
        {
          relativeDirPath: ".",
          relativeFilePath: WARP_LEGACY_RULE_FILE_NAME,
          onlyWhenRootAbsent: true,
          outranksRoot: true,
        },
      ],
    };
  }

  static override async fromFile(params: ToolRuleFromFileParams): Promise<NestedAgentsmdRule> {
    const {
      outputRoot = process.cwd(),
      relativeDirPath,
      relativeFilePath,
      validate = true,
    } = params;
    // The legacy root `WARP.md` found through `importOnlyRoots` is Warp's root
    // rule, so it imports as the root (overview) rule.
    const isLegacyRoot =
      !params.global &&
      relativeFilePath === WARP_LEGACY_RULE_FILE_NAME &&
      (relativeDirPath === undefined || relativeDirPath === ".");
    if (isLegacyRoot) {
      return new this({
        outputRoot,
        relativeDirPath: ".",
        relativeFilePath: WARP_LEGACY_RULE_FILE_NAME,
        fileContent: await readFileContent(join(outputRoot, WARP_LEGACY_RULE_FILE_NAME)),
        validate,
        root: true,
      });
    }
    return super.fromFile(params);
  }
}
