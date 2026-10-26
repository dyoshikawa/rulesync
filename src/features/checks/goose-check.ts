import { z } from "zod/mini";

import { GOOSE_CHECKS_GLOBAL_DIR, GOOSE_CHECKS_PROJECT_DIR } from "../../constants/goose-paths.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { AmpCheck, AmpCheckFrontmatter, AmpCheckFrontmatterSchema } from "./amp-check.js";
import type { ToolCheckSettablePaths } from "./tool-check.js";

// Goose's `CheckFrontmatter` is Amp's field set plus `model` and `turn-limit`
// (`Option<usize>`, so a non-negative integer).
// @see https://github.com/aaif-goose/goose/blob/main/crates/goose/src/checks/mod.rs
const GooseCheckFrontmatterSchema = z.extend(AmpCheckFrontmatterSchema, {
  model: z.optional(z.string()),
  "turn-limit": z.optional(z.int().check(z.nonnegative())),
});

/**
 * Represents a Goose review check (`goose review`), written to the user-wide
 * `~/.config/goose/checks/` (global scope only).
 *
 * Goose discovers repository checks in `.agents/checks/*.md`, the same
 * cross-tool directory the `amp` checks target already writes (Goose's
 * `tools` and `severity-default` fields exist for parity with Amp's), so the
 * project scope is left to `amp` rather than having two targets own the same
 * files. Its global discovery reads `~/.config/goose/checks/` first, then
 * `~/.config/agents/checks/`. The file format is Amp's, so this class reuses
 * `AmpCheck` and adds Goose's `model` and `turn-limit`, which live in the
 * `goose:` section of a rulesync check; `name` is derived from the file name.
 *
 * @see https://github.com/aaif-goose/goose/blob/main/crates/goose/src/checks/mod.rs
 */
export class GooseCheck extends AmpCheck {
  protected static override getCheckToolTarget(): ToolTarget {
    return "goose";
  }

  protected static override getFrontmatterSchema(): z.ZodMiniType<AmpCheckFrontmatter> {
    return GooseCheckFrontmatterSchema;
  }

  protected static override getToolOnlyKeys(): readonly string[] {
    return ["model", "turn-limit"];
  }

  static override getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolCheckSettablePaths {
    return {
      relativeDirPath: global ? GOOSE_CHECKS_GLOBAL_DIR : GOOSE_CHECKS_PROJECT_DIR,
    };
  }
}
