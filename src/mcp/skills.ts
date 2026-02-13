import { basename, dirname, join } from "node:path";
import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import {
  RulesyncSkill,
  type RulesyncSkillFrontmatter,
  RulesyncSkillFrontmatterSchema,
} from "../features/skills/rulesync-skill.js";
import { AiDirFile } from "../types/ai-dir.js";
import { formatError } from "../utils/error.js";
import {
  checkPathTraversal,
  directoryExists,
  ensureDir,
  findFilesByGlobs,
  removeDirectory,
  writeFileContent,
} from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import { logger } from "../utils/logger.js";

const maxSkillSizeBytes = 1024 * 1024; // 1MB
const maxSkillsCount = 1000;

/**
 * Type for other files in MCP API (string-based for easier AI agent use)
 */
type McpSkillFile = {
  name: string;
  body: string;
};

/**
 * Convert AiDirFile to McpSkillFile
 */
function aiDirFileToMcpSkillFile(file: AiDirFile): McpSkillFile {
  return {
    name: file.relativeFilePathToDirPath,
    body: file.fileBuffer.toString("utf-8"),
  };
}

/**
 * Convert McpSkillFile to AiDirFile
 */
function mcpSkillFileToAiDirFile(file: McpSkillFile): AiDirFile {
  return {
    relativeFilePathToDirPath: file.name,
    fileBuffer: Buffer.from(file.body, "utf-8"),
  };
}

/**
 * Extract directory name from relative path
 * @example ".rulesync/skills/my-skill" -> "my-skill"
 */
function extractDirName(relativeDirPathFromCwd: string): string {
  const dirName = basename(relativeDirPathFromCwd);
  if (!dirName) {
    throw new Error(`Invalid path: ${relativeDirPathFromCwd}`);
  }
  return dirName;
}

/**
 * Tool to list all skills from .rulesync/skills/\*\/SKILL.md
 */
async function listSkills(): Promise<
  Array<{
    relativeDirPathFromCwd: string;
    frontmatter: RulesyncSkillFrontmatter;
  }>
> {
  const skillsDir = join(process.cwd(), RULESYNC_SKILLS_RELATIVE_DIR_PATH);

  try {
    // Find all skill directories (directories containing SKILL.md)
    const skillDirPaths = await findFilesByGlobs(join(skillsDir, "*"), { type: "dir" });

    const skills = await Promise.all(
      skillDirPaths.map(async (dirPath) => {
        const dirName = basename(dirPath);
        if (!dirName) return null;
        try {
          // Read the skill using RulesyncSkill
          const skill = await RulesyncSkill.fromDir({
            dirName,
          });

          const frontmatter = skill.getFrontmatter();

          return {
            relativeDirPathFromCwd: join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName),
            frontmatter,
          };
        } catch (error) {
          logger.error(`Failed to read skill directory ${dirName}: ${formatError(error)}`);
          return null;
        }
      }),
    );

    // Filter out null values (failed reads)
    return skills.filter((skill): skill is NonNullable<typeof skill> => skill !== null);
  } catch (error) {
    logger.error(
      `Failed to read skills directory (${RULESYNC_SKILLS_RELATIVE_DIR_PATH}): ${formatError(error)}`,
    );
    return [];
  }
}

/**
 * Tool to get detailed information about a specific skill
 */
async function getSkill({ relativeDirPathFromCwd }: { relativeDirPathFromCwd: string }): Promise<{
  relativeDirPathFromCwd: string;
  frontmatter: RulesyncSkillFrontmatter;
  body: string;
  otherFiles: McpSkillFile[];
}> {
  checkPathTraversal({
    relativePath: relativeDirPathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const dirName = extractDirName(relativeDirPathFromCwd);

  try {
    const skill = await RulesyncSkill.fromDir({
      dirName,
    });

    return {
      relativeDirPathFromCwd: join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName),
      frontmatter: skill.getFrontmatter(),
      body: skill.getBody(),
      otherFiles: skill.getOtherFiles().map(aiDirFileToMcpSkillFile),
    };
  } catch (error) {
    throw new Error(
      `Failed to read skill directory ${relativeDirPathFromCwd}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Tool to create or update a skill (upsert operation)
 */
async function putSkill({
  relativeDirPathFromCwd,
  frontmatter,
  body,
  otherFiles = [],
}: {
  relativeDirPathFromCwd: string;
  frontmatter: RulesyncSkillFrontmatter;
  body: string;
  otherFiles?: McpSkillFile[];
}): Promise<{
  relativeDirPathFromCwd: string;
  frontmatter: RulesyncSkillFrontmatter;
  body: string;
  otherFiles: McpSkillFile[];
}> {
  checkPathTraversal({
    relativePath: relativeDirPathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const dirName = extractDirName(relativeDirPathFromCwd);

  // Check file size constraint
  const estimatedSize =
    JSON.stringify(frontmatter).length +
    body.length +
    otherFiles.reduce((acc, file) => acc + file.name.length + file.body.length, 0);
  if (estimatedSize > maxSkillSizeBytes) {
    throw new Error(
      `Skill size ${estimatedSize} bytes exceeds maximum ${maxSkillSizeBytes} bytes (1MB) for ${relativeDirPathFromCwd}`,
    );
  }

  try {
    // Check skill count constraint
    const existingSkills = await listSkills();
    const isUpdate = existingSkills.some(
      (skill) => skill.relativeDirPathFromCwd === join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName),
    );

    if (!isUpdate && existingSkills.length >= maxSkillsCount) {
      throw new Error(
        `Maximum number of skills (${maxSkillsCount}) reached in ${RULESYNC_SKILLS_RELATIVE_DIR_PATH}`,
      );
    }

    // Convert McpSkillFile to AiDirFile for RulesyncSkill
    const aiDirFiles = otherFiles.map(mcpSkillFileToAiDirFile);

    // Create a new RulesyncSkill instance for validation
    const skill = new RulesyncSkill({
      baseDir: process.cwd(),
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName,
      frontmatter,
      body,
      otherFiles: aiDirFiles,
      validate: true,
    });

    // Ensure skill directory exists
    const skillDirPath = join(process.cwd(), RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName);
    await ensureDir(skillDirPath);

    // Write the SKILL.md file
    const skillFilePath = join(skillDirPath, SKILL_FILE_NAME);
    const skillFileContent = stringifyFrontmatter(body, frontmatter);
    await writeFileContent(skillFilePath, skillFileContent);

    // Write other files
    for (const file of otherFiles) {
      // Validate file path to prevent path traversal
      checkPathTraversal({
        relativePath: file.name,
        intendedRootDir: skillDirPath,
      });
      const filePath = join(skillDirPath, file.name);
      // Ensure subdirectory exists if file has path separators
      const fileDir = join(skillDirPath, dirname(file.name));
      if (fileDir !== skillDirPath) {
        await ensureDir(fileDir);
      }
      await writeFileContent(filePath, file.body);
    }

    return {
      relativeDirPathFromCwd: join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName),
      frontmatter: skill.getFrontmatter(),
      body: skill.getBody(),
      otherFiles: skill.getOtherFiles().map(aiDirFileToMcpSkillFile),
    };
  } catch (error) {
    throw new Error(
      `Failed to write skill directory ${relativeDirPathFromCwd}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Tool to delete a skill
 */
async function deleteSkill({
  relativeDirPathFromCwd,
}: {
  relativeDirPathFromCwd: string;
}): Promise<{
  relativeDirPathFromCwd: string;
}> {
  checkPathTraversal({
    relativePath: relativeDirPathFromCwd,
    intendedRootDir: process.cwd(),
  });

  const dirName = extractDirName(relativeDirPathFromCwd);
  const skillDirPath = join(process.cwd(), RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName);

  try {
    // Check if skill directory exists before attempting to delete
    if (await directoryExists(skillDirPath)) {
      await removeDirectory(skillDirPath);
    }

    return {
      relativeDirPathFromCwd: join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName),
    };
  } catch (error) {
    throw new Error(
      `Failed to delete skill directory ${relativeDirPathFromCwd}: ${formatError(error)}`,
      {
        cause: error,
      },
    );
  }
}

/**
 * Schema for other files in a skill directory
 */
const McpSkillFileSchema = z.object({
  name: z.string(),
  body: z.string(),
});

/**
 * Schema for skill-related tool parameters
 */
export const skillToolSchemas = {
  listSkills: z.object({}),
  getSkill: z.object({
    relativeDirPathFromCwd: z.string(),
  }),
  putSkill: z.object({
    relativeDirPathFromCwd: z.string(),
    frontmatter: RulesyncSkillFrontmatterSchema,
    body: z.string(),
    otherFiles: z.optional(z.array(McpSkillFileSchema)),
  }),
  deleteSkill: z.object({
    relativeDirPathFromCwd: z.string(),
  }),
} as const;

/**
 * Tool definitions for skill-related operations
 */
export const skillTools = {
  listSkills: {
    name: "listSkills",
    description: `List all skills from ${join(RULESYNC_SKILLS_RELATIVE_DIR_PATH, "*", SKILL_FILE_NAME)} with their frontmatter.`,
    parameters: skillToolSchemas.listSkills,
    execute: async () => {
      const skills = await listSkills();
      const output = { skills };
      return JSON.stringify(output, null, 2);
    },
  },
  getSkill: {
    name: "getSkill",
    description:
      "Get detailed information about a specific skill including SKILL.md content and other files. relativeDirPathFromCwd parameter is required.",
    parameters: skillToolSchemas.getSkill,
    execute: async (args: { relativeDirPathFromCwd: string }) => {
      const result = await getSkill({ relativeDirPathFromCwd: args.relativeDirPathFromCwd });
      return JSON.stringify(result, null, 2);
    },
  },
  putSkill: {
    name: "putSkill",
    description:
      "Create or update a skill (upsert operation). relativeDirPathFromCwd, frontmatter, and body parameters are required. otherFiles is optional.",
    parameters: skillToolSchemas.putSkill,
    execute: async (args: {
      relativeDirPathFromCwd: string;
      frontmatter: RulesyncSkillFrontmatter;
      body: string;
      otherFiles?: McpSkillFile[];
    }) => {
      const result = await putSkill({
        relativeDirPathFromCwd: args.relativeDirPathFromCwd,
        frontmatter: args.frontmatter,
        body: args.body,
        otherFiles: args.otherFiles,
      });
      return JSON.stringify(result, null, 2);
    },
  },
  deleteSkill: {
    name: "deleteSkill",
    description:
      "Delete a skill directory and all its contents. relativeDirPathFromCwd parameter is required.",
    parameters: skillToolSchemas.deleteSkill,
    execute: async (args: { relativeDirPathFromCwd: string }) => {
      const result = await deleteSkill({ relativeDirPathFromCwd: args.relativeDirPathFromCwd });
      return JSON.stringify(result, null, 2);
    },
  },
} as const;
