import { basename, join } from "node:path";

import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { directoryExists, findFilesByGlobs } from "../../utils/file.js";

/**
 * Returns the set of local skill directory names (excluding `.curated`).
 */
export async function getLocalSkillDirNames(baseDir: string): Promise<Set<string>> {
  const skillsDir = join(baseDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
  const names = new Set<string>();

  if (!(await directoryExists(skillsDir))) {
    return names;
  }

  const dirPaths = await findFilesByGlobs(join(skillsDir, "*"), { type: "dir" });
  for (const dirPath of dirPaths) {
    const name = basename(dirPath);
    // Skip the .curated directory itself
    if (name === ".curated") continue;
    names.add(name);
  }

  return names;
}
