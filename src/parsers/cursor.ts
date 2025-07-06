import { basename, join } from "node:path";
import matter from "gray-matter";
import { DEFAULT_SCHEMA, FAILSAFE_SCHEMA, load } from "js-yaml";
import { z } from "zod/v4";
import type { ParsedRule, RuleFrontmatter } from "../types/index.js";
import type { RulesyncMcpServer } from "../types/mcp.js";
import { RulesyncMcpConfigSchema } from "../types/mcp.js";
import { fileExists, readFileContent } from "../utils/index.js";

export interface CursorImportResult {
  rules: ParsedRule[];
  errors: string[];
  ignorePatterns?: string[];
  mcpServers?: Record<string, RulesyncMcpServer>;
}

// Custom gray-matter options for more lenient YAML parsing
// This is needed to handle Cursor's .mdc file format where "globs: *" (without quotes) is valid
// but causes YAML parsing errors since * is a reserved character in YAML.
// We preprocess the frontmatter to add quotes around bare asterisks in globs fields.
const customMatterOptions = {
  engines: {
    yaml: {
      parse: (str: string): object => {
        try {
          // Preprocess to handle Cursor's valid formats:
          // 1. "globs: *" (bare asterisk) -> "globs: \"*\""
          // 2. "globs: **/*.ts" (glob patterns without quotes) -> "globs: \"**/*.ts\""
          // 3. "globs: **/*.py,**/*.pyc" (comma-separated patterns) -> "globs: \"**/*.py,**/*.pyc\""
          // Note: Don't process array literals like [] or ["item"]
          const preprocessed = str
            // Handle bare asterisk
            .replace(/^(\s*globs:\s*)\*\s*$/gm, '$1"*"')
            // Handle glob patterns without quotes (single or comma-separated)
            // But exclude array literals (starting with [ or already quoted strings)
            .replace(/^(\s*globs:\s*)([^\s"'[\n][^"'[\n]*?)(\s*)$/gm, '$1"$2"$3');

          const result = load(preprocessed, { schema: DEFAULT_SCHEMA });
          if (typeof result === "object" && result !== null) {
            return result;
          }
          throw new Error("Failed to parse YAML: result is not an object");
        } catch (error) {
          // If that fails, try with FAILSAFE_SCHEMA as a fallback
          try {
            const result = load(str, { schema: FAILSAFE_SCHEMA });
            if (typeof result === "object" && result !== null) {
              return result;
            }
            throw new Error("Failed to parse YAML: result is not an object");
          } catch {
            // If all else fails, throw the original error
            throw error;
          }
        }
      },
    },
  },
};

/**
 * convert from .mdc file to rulesync format according to four kinds of .mdc file format
 */
function convertCursorMdcFrontmatter(
  cursorFrontmatter: unknown,
  _filename: string,
): RuleFrontmatter {
  // Validate frontmatter is an object
  const FrontmatterSchema = z.record(z.string(), z.unknown());
  const parseResult = FrontmatterSchema.safeParse(cursorFrontmatter);
  if (!parseResult.success) {
    // Fallback if validation fails
    return {
      root: false,
      targets: ["*"],
      description: "",
      globs: [],
      cursorRuleType: "manual",
    };
  }
  const frontmatter = parseResult.data;

  // Normalize values according to term definitions
  const description = normalizeValue(frontmatter?.description);
  const globs = normalizeGlobsValue(frontmatter?.globs);
  const alwaysApply = frontmatter?.alwaysApply === true || frontmatter?.alwaysApply === "true";

  // 1. always: when alwaysApply: true is present
  if (alwaysApply) {
    return {
      root: false,
      targets: ["*"],
      description: description || "",
      globs: ["**/*"],
      cursorRuleType: "always",
    };
  }

  // 2. manual: empty description + empty globs + alwaysApply: false
  if (isEmpty(description) && isEmpty(globs)) {
    return {
      root: false,
      targets: ["*"],
      description: "",
      globs: [],
      cursorRuleType: "manual",
    };
  }

  // 3. specificFiles: description is empty string and globs is not empty and alwaysApply: false
  // edge case: no description and globs is not empty -> specificFiles
  if (!isEmpty(globs)) {
    return {
      root: false,
      targets: ["*"],
      description: "",
      globs: convertGlobsToArray(globs),
      cursorRuleType: "specificFiles",
    };
  }

  // 4. intelligently: non-empty description + empty globs + alwaysApply: false
  if (!isEmpty(description)) {
    return {
      root: false,
      targets: ["*"],
      description: description || "",
      globs: [],
      cursorRuleType: "intelligently",
    };
  }

  // Default: treat as manual
  return {
    root: false,
    targets: ["*"],
    description: "",
    globs: [],
    cursorRuleType: "manual",
  };
}

/**
 * Normalize values (handle empty strings, unspecified, and undefined uniformly)
 */
function normalizeValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return String(value);
}

/**
 * Normalize globs value
 */
function normalizeGlobsValue(value: unknown): string | string[] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? undefined : value;
  }
  return String(value);
}

/**
 * Check if value is empty
 */
function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Convert globs value to array
 */
function convertGlobsToArray(globs: string | string[] | undefined): string[] {
  if (!globs) {
    return [];
  }

  if (Array.isArray(globs)) {
    return globs;
  }

  // Convert comma-separated string to array
  if (typeof globs === "string") {
    return globs
      .split(",")
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
  }

  return [];
}

export async function parseCursorConfiguration(
  baseDir: string = process.cwd(),
): Promise<CursorImportResult> {
  const errors: string[] = [];
  const rules: ParsedRule[] = [];
  let ignorePatterns: string[] | undefined;
  let mcpServers: Record<string, RulesyncMcpServer> | undefined;

  // Check for .cursorrules file (legacy)
  const cursorFilePath = join(baseDir, ".cursorrules");
  if (await fileExists(cursorFilePath)) {
    try {
      const rawContent = await readFileContent(cursorFilePath);
      const parsed = matter(rawContent, customMatterOptions);
      const content = parsed.content.trim();

      if (content) {
        // Convert Cursor frontmatter format to rulesync format using unified function
        const frontmatter = convertCursorMdcFrontmatter(parsed.data, "cursorrules");

        // Override targets to be cursor-specific for .cursorrules files
        frontmatter.targets = ["cursor"];

        rules.push({
          frontmatter,
          content,
          filename: "cursor-rules",
          filepath: cursorFilePath,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to parse .cursorrules file: ${errorMessage}`);
    }
  }

  // Check for .cursor/rules/*.mdc files
  const cursorRulesDir = join(baseDir, ".cursor", "rules");
  if (await fileExists(cursorRulesDir)) {
    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(cursorRulesDir);

      for (const file of files) {
        if (file.endsWith(".mdc")) {
          const filePath = join(cursorRulesDir, file);
          try {
            const rawContent = await readFileContent(filePath);
            const parsed = matter(rawContent, customMatterOptions);
            const content = parsed.content.trim();

            if (content) {
              const filename = basename(file, ".mdc");
              // Convert according to four kinds of mdc file format
              const frontmatter = convertCursorMdcFrontmatter(parsed.data, filename);

              rules.push({
                frontmatter,
                content,
                filename: `cursor-${filename}`,
                filepath: filePath,
              });
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push(`Failed to parse ${filePath}: ${errorMessage}`);
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to parse .cursor/rules files: ${errorMessage}`);
    }
  }

  if (rules.length === 0) {
    errors.push("No Cursor configuration files found (.cursorrules or .cursor/rules/*.mdc)");
  }

  // Check for .cursorignore file
  const cursorIgnorePath = join(baseDir, ".cursorignore");
  if (await fileExists(cursorIgnorePath)) {
    try {
      const content = await readFileContent(cursorIgnorePath);
      const patterns = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      if (patterns.length > 0) {
        ignorePatterns = patterns;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to parse .cursorignore: ${errorMessage}`);
    }
  }

  // Check for .cursor/mcp.json file
  const cursorMcpPath = join(baseDir, ".cursor", "mcp.json");
  if (await fileExists(cursorMcpPath)) {
    try {
      const content = await readFileContent(cursorMcpPath);
      const mcp = JSON.parse(content);
      const parseResult = RulesyncMcpConfigSchema.safeParse(mcp);
      if (parseResult.success && Object.keys(parseResult.data.mcpServers).length > 0) {
        mcpServers = parseResult.data.mcpServers;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to parse .cursor/mcp.json: ${errorMessage}`);
    }
  }

  return {
    rules,
    errors,
    ...(ignorePatterns && { ignorePatterns }),
    ...(mcpServers && { mcpServers }),
  };
}
