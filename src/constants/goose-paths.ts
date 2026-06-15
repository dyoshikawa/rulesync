import { join } from "node:path";

export const GOOSE_DIR = ".goose";
export const GOOSE_GLOBAL_DIR = join(".config", "goose");
export const GOOSE_RULE_FILE_NAME = ".goosehints";
export const GOOSE_IGNORE_FILE_NAME = ".gooseignore";
export const GOOSE_MCP_FILE_NAME = "config.yaml";
export const GOOSE_HOOKS_DIR_PATH = join(".agents", "plugins", "rulesync", "hooks");
export const GOOSE_HOOKS_FILE_NAME = "hooks.json";
