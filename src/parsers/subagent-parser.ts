import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { type ParsedSubagent, SubagentFrontmatterSchema } from "../types/subagent.js";
import { fileExists } from "../utils/file.js";
import { logger } from "../utils/logger.js";

/**
 * Parse a single subagent file
 */
export async function parseSubagentFile(filepath: string): Promise<ParsedSubagent | null> {
  try {
    const fileContent = await readFile(filepath, "utf-8");
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter
    const result = SubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      logger.warn(`Invalid frontmatter in ${filepath}: ${result.error.message}`);
      return null;
    }

    const filename = path.basename(filepath, path.extname(filepath));

    return {
      frontmatter: result.data,
      content: content.trim(),
      filename,
      filepath,
    };
  } catch (error) {
    logger.error(`Error parsing subagent file ${filepath}:`, error);
    return null;
  }
}

/**
 * Parse all subagent files from a directory
 */
export async function parseSubagentsFromDirectory(agentsDir: string): Promise<ParsedSubagent[]> {
  try {
    // Check if directory exists
    if (!(await fileExists(agentsDir))) {
      logger.debug(`Agents directory does not exist: ${agentsDir}`);
      return [];
    }

    // Find all markdown files in the agents directory
    const entries = await readdir(agentsDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));
    const files = mdFiles.map((file) => path.join(agentsDir, file));

    if (files.length === 0) {
      logger.debug(`No subagent files found in ${agentsDir}`);
      return [];
    }

    logger.debug(`Found ${files.length} subagent files in ${agentsDir}`);

    // Parse all files in parallel
    const parsePromises = files.map((file) => parseSubagentFile(file));
    const results = await Promise.all(parsePromises);

    // Filter out null results (failed parses)
    const subagents = results.filter((result): result is ParsedSubagent => result !== null);

    logger.info(`Successfully parsed ${subagents.length} subagents`);
    return subagents;
  } catch (error) {
    logger.error(`Error parsing subagents from directory ${agentsDir}:`, error);
    return [];
  }
}
