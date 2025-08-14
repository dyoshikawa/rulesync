import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { getDefaultConfig } from "../../utils/config.js";

/**
 * Remove .md extension from filename
 */
function sanitizeFilename(filename: string): string {
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

/**
 * Generate default rule file template
 */
function generateRuleTemplate(filename: string): string {
  return `---
root: false
targets: ["*"]
description: "Rules for ${filename}"
globs: []
---

# ${filename.charAt(0).toUpperCase() + filename.slice(1)} Rules

Add your rules here.
`;
}

/**
 * Implementation of add command
 */
export async function addCommand(filename: string): Promise<void> {
  try {
    const config = getDefaultConfig();
    const sanitizedFilename = sanitizeFilename(filename);
    const rulesDir = config.aiRulesDir;
    const filePath = path.join(rulesDir, `${sanitizedFilename}.md`);

    // Create .rulesync directory if it doesn't exist
    await mkdir(rulesDir, { recursive: true });

    // Generate template content
    const template = generateRuleTemplate(sanitizedFilename);

    // Create the file
    await writeFile(filePath, template, "utf8");

    console.log(`✅ Created rule file: ${filePath}`);
    console.log(`📝 Edit the file to customize your rules.`);
  } catch (error) {
    console.error(
      `❌ Failed to create rule file: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(3); // File I/O error
  }
}
