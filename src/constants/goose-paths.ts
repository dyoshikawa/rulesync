import { join } from "node:path";

export const GOOSE_DIR = ".goose";
export const GOOSE_GLOBAL_DIR = join(".config", "goose");
export const GOOSE_RULE_FILE_NAME = ".goosehints";
export const GOOSE_IGNORE_FILE_NAME = ".gooseignore";
export const GOOSE_MCP_FILE_NAME = "config.yaml";
// Goose persists per-tool permission overrides in the global user config dir.
// https://github.com/block/goose/blob/main/crates/goose/src/config/permission.rs
export const GOOSE_PERMISSIONS_FILE_NAME = "permission.yaml";
export const GOOSE_HOOKS_DIR_PATH = join(".agents", "plugins", "rulesync", "hooks");
export const GOOSE_HOOKS_FILE_NAME = "hooks.json";

// Recipes are reusable YAML workflow files. Goose discovers project recipes in
// `./.goose/recipes/` and global recipes in `~/.config/goose/recipes/`.
// rulesync maps commands → top-level recipes (here) and subagents → sub-recipe
// files under the `subagents/` subdirectory (referenced from a parent recipe via
// a relative `path`). Keeping subagents in a subdirectory makes the command and
// subagent file sets disjoint so import/orphan-deletion never cross over.
// @see https://block.github.io/goose/docs/guides/recipes/recipe-reference/
export const GOOSE_RECIPES_DIR_PATH = join(GOOSE_DIR, "recipes");
export const GOOSE_GLOBAL_RECIPES_DIR_PATH = join(GOOSE_GLOBAL_DIR, "recipes");
export const GOOSE_RECIPES_SUBAGENTS_DIR_PATH = join(GOOSE_RECIPES_DIR_PATH, "subagents");
export const GOOSE_GLOBAL_RECIPES_SUBAGENTS_DIR_PATH = join(
  GOOSE_GLOBAL_RECIPES_DIR_PATH,
  "subagents",
);
