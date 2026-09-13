import { relative } from "node:path";

import { RulesProcessor } from "../features/rules/rules-processor.js";
import { ToolRule } from "../features/rules/tool-rule.js";
import { AiFile } from "../types/ai-file.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { toPosixPath } from "../utils/file.js";
import type { Logger } from "../utils/logger.js";

/** One target's take on a root file, in the order the targets were processed. */
type RootWrite = {
  target: ToolTarget;
  folds: boolean;
  content: string;
};

/**
 * Whether a target folds every non-root rule into its root file, i.e. its tool
 * reads the one root file and nothing else.
 */
function foldsIntoRoot({ toolTarget }: { toolTarget: ToolTarget }): boolean {
  return RulesProcessor.getFactory(toolTarget)?.meta.collisionPolicy === "fold";
}

/**
 * Names the root file the way the rest of the run does: relative to the
 * working directory when it lives under it (so `AGENTS.md`, or
 * `packages/app/AGENTS.md` for a second output root), absolute otherwise.
 */
function displayPath({ filePath }: { filePath: string }): string {
  const rel = relative(process.cwd(), filePath);
  return rel === "" || rel.startsWith("..") ? filePath : toPosixPath(rel);
}

/**
 * Watches for a later target overwriting a fold target's root file with
 * different content, which silently loses every non-root rule for that tool.
 *
 * Several targets write the same root file (`AGENTS.md` above all), and the
 * documented rule is that the last target in config order wins. For a target
 * that files non-root rules in its own directory that is harmless: it keeps the
 * root body either way. A `collisionPolicy: "fold"` target (codexcli and the
 * others whose tool reads only the one root file) has nowhere else to put its
 * non-root rules, so when a sibling that emits the root body alone comes later
 * in config order — `["codexcli", "zoocode"]` — the fold is overwritten and
 * Codex CLI is left with the root rule only, in a diff that reads as a large
 * deletion of `AGENTS.md`. See issue #3022.
 *
 * The overwrite itself is not prevented (last-wins is what the docs promise);
 * it is named, once per root file, together with the reordering that keeps the
 * folded content. `observe` only records what each target would write; the
 * verdict is `report`'s, once every target has been seen, because only the
 * final writer decides what is on disk: with `["codexcli", "zoocode", "pi"]`
 * the fold target `pi` wins the file with every non-root body in it, so nothing
 * is lost and nothing is reported. Paths are absolute, so a project with
 * several output roots is compared root by root. In `--check` mode nothing is
 * written, but the sentence describes the same outcome of the same config, so
 * it is worded the same.
 */
export function createFoldRootOverwriteWatch({ logger }: { logger: Logger }): {
  observe: (params: { toolTarget: ToolTarget; toolFiles: AiFile[] }) => void;
  report: () => void;
} {
  const writesByPath = new Map<string, RootWrite[]>();
  return {
    observe: ({ toolTarget, toolFiles }) => {
      const folds = foldsIntoRoot({ toolTarget });
      for (const file of toolFiles) {
        if (!(file instanceof ToolRule) || !file.isRoot()) {
          continue;
        }
        const path = file.getFilePath();
        const writes = writesByPath.get(path) ?? [];
        writes.push({ target: toolTarget, folds, content: file.getFileContent() });
        writesByPath.set(path, writes);
      }
    },
    report: () => {
      for (const [path, writes] of writesByPath) {
        const last = writes.at(-1);
        if (last === undefined || last.folds) {
          continue;
        }
        // The fold target whose content was on disk right before the final
        // writer replaced it. Identical content means the fold had nothing to
        // add (a root rule with no non-root siblings), so nothing is lost.
        const fold = writes.findLast((write) => write.folds && write.content !== last.content);
        if (fold === undefined) {
          continue;
        }
        logger.warn(
          `Target '${last.target}' overwrites ${displayPath({ filePath: path })}, the file target ` +
            `'${fold.target}' folds every non-root rule into, so '${fold.target}' is left with ` +
            `the root rule only. The last target in config order wins a shared file: list ` +
            `'${fold.target}' after '${last.target}' to keep the folded content (see "Target ` +
            `Order and File Conflicts" in the configuration guide).`,
        );
      }
    },
  };
}
