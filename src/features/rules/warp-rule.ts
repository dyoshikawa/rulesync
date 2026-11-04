import { join } from "node:path";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { WARP_GLOBAL_RULE_DIR, WARP_LEGACY_RULE_FILE_NAME } from "../../constants/warp-paths.js";
import { AiFileParams } from "../../types/ai-file.js";
import { stripControlCharacters } from "../../utils/control-characters.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import {
  NestedAgentsmdRule,
  NestedAgentsmdRuleFamily,
  NestedAgentsmdRuleSettablePathsGlobal,
} from "./nested-agentsmd-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleImportOnlyRoot,
  ToolRuleRootOnlySettablePaths,
} from "./tool-rule.js";

export type WarpRuleParams = AiFileParams & {
  root?: boolean;
};

export type WarpRuleSettablePaths = ToolRuleRootOnlySettablePaths & {
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
    options: { global?: boolean } = {},
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

  /**
   * Warp still reads a legacy `WARP.md`, and when both `WARP.md` and
   * `AGENTS.md` sit in the same directory, `WARP.md` takes priority — so an
   * `AGENTS.md` this run writes next to one would never be read. That holds for
   * the root file and for every nested `<subprojectPath>/AGENTS.md` alike.
   * Rulesync neither writes nor deletes `WARP.md` (it is hand-authored), so the
   * only thing it can do is say so. Project scope only: the documented
   * precedence is about project rules, and Warp's global rule source is
   * `~/.agents/AGENTS.md`.
   * @see https://docs.warp.dev/agents/capabilities/rules/
   */
  static async getGenerationWarnings({
    toolRules,
    outputRoot,
    global,
  }: {
    toolRules: ToolRule[];
    outputRoot: string;
    global: boolean;
  }): Promise<string[]> {
    if (global) {
      return [];
    }
    const rulePathsByDir = new Map(
      toolRules.map((rule) => [
        rule.getRelativeDirPath(),
        join(rule.getRelativeDirPath(), rule.getRelativeFilePath()),
      ]),
    );
    const warnings: string[] = [];
    for (const [ruleDirPath, rulesRelativePath] of rulePathsByDir) {
      const legacyRelativePath = join(ruleDirPath, WARP_LEGACY_RULE_FILE_NAME);
      if (!(await fileExists(join(outputRoot, legacyRelativePath)))) {
        continue;
      }
      warnings.push(
        `${stripControlCharacters(legacyRelativePath)} exists next to ${stripControlCharacters(rulesRelativePath)}, and Warp reads WARP.md instead of AGENTS.md when both are present, so the generated ${stripControlCharacters(rulesRelativePath)} is ignored by Warp. Move any content you still need into ${RULESYNC_RULES_RELATIVE_DIR_PATH}, then delete or rename ${stripControlCharacters(legacyRelativePath)}.`,
      );
    }
    return warnings;
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
