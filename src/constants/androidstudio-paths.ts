import { join } from "node:path";

/**
 * Gemini in Android Studio configuration-layout conventions.
 *
 * Only the Android Studio-specific files are owned by the `androidstudio`
 * target. The shared `AGENTS.md` and `.agents/skills/` surfaces Gemini also
 * reads belong to the `agentsmd` and `agentsskills` targets.
 */

// `.aiexclude` follows the `.gitignore` syntax and applies to the files at or
// below the directory that contains it. Rulesync writes the project-root file.
// @see https://developer.android.com/studio/gemini/aiexclude
export const ANDROIDSTUDIO_IGNORE_FILE_NAME = ".aiexclude";

// Android Studio (Quail 1 and later) loads Agent Skills from
// `.android-studio/skills/` at the project root or in the home directory.
// @see https://developer.android.com/studio/gemini/skills
export const ANDROIDSTUDIO_DIR = ".android-studio";
export const ANDROIDSTUDIO_SKILLS_DIR_PATH = join(ANDROIDSTUDIO_DIR, "skills");
