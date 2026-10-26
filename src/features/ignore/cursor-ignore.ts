import { CURSOR_IGNORE_FILE_NAME } from "../../constants/cursor-paths.js";
import { RULESYNC_AIIGNORE_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnoreSettablePaths } from "./tool-ignore.js";

/**
 * Cursor ignore adapter.
 *
 * Cursor documents two ignore files with different semantics:
 * - `.cursorignore` — blocks access entirely (semantic search, Tab, Agent,
 *   Inline Edit, `@`-mentions).
 * - `.cursorindexingignore` — excludes from indexing only; files stay accessible
 *   to the AI on demand.
 *
 * rulesync's `ignore` feature models a single canonical ignore list per tool,
 * with no per-pattern way to distinguish "block access" from "exclude from
 * indexing only". Emitting the same patterns to both files would be wrong (they
 * mean different things), so this adapter writes only `.cursorignore`;
 * `.cursorindexingignore` is an intentional non-goal (see issue #1923). Authors
 * who need indexing-only excludes should maintain that file by hand.
 *
 * @see https://cursor.com/docs/reference/ignore-file
 */
export class CursorIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: CURSOR_IGNORE_FILE_NAME,
    };
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return new RulesyncIgnore({
      outputRoot: ".",
      relativeDirPath: ".",
      relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
      fileContent: this.fileContent,
    });
  }
}
