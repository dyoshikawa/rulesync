import { join } from "node:path";

export const ZED_DIR = ".zed";
export const ZED_GLOBAL_DIR = join(".config", "zed");
// Zed's user config lives in `%APPDATA%\Zed` on Windows (AppData/Roaming), not
// `~/.config/zed` — both settings.json and the personal AGENTS.md.
// @see https://zed.dev/docs/configuring-zed#user-settings
// @see https://zed.dev/docs/ai/instructions#personal-instructions
export const ZED_GLOBAL_WIN32_DIR = join("AppData", "Roaming", "Zed");

export function getZedGlobalDir(): string {
  return process.platform === "win32" ? ZED_GLOBAL_WIN32_DIR : ZED_GLOBAL_DIR;
}
export const ZED_SETTINGS_FILE_NAME = "settings.json";
export const ZED_RULE_FILE_NAME = ".rules";
export const ZED_GLOBAL_RULE_FILE_NAME = "AGENTS.md";
export const ZED_SKILLS_DIR_PATH = join(".agents", "skills");
