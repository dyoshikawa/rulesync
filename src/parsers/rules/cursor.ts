import { basename, join } from "node:path";
import { DEFAULT_SCHEMA, FAILSAFE_SCHEMA, load } from "js-yaml";
import { z } from "zod/mini";
import type { RuleFrontmatter } from "../../types/index.js";
import { safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { BaseRuleParser, type RuleParseResult } from "./base.js";

/**
 * Parser for Cursor rule files (.cursorrules and .cursor/rules/*.mdc)
 */
export class CursorRuleParser extends BaseRuleParser {
  getToolName() {
    return "cursor" as const;
  }

  getRuleFilesPattern(): string[] {
    return [".cursorrules", ".cursor/rules/*.mdc"];
  }

  async parseRules(baseDir: string): Promise<RuleParseResult> {
    const result: RuleParseResult = {
      rules: [],
      errors: [],
    };

    // Parse .cursorrules file (legacy)
    await this.parseCursorRulesFile(baseDir, result);

    // Parse .cursor/rules/*.mdc files
    await this.parseCursorMdcFiles(baseDir, result);

    if (result.rules.length === 0) {
      result.errors.push(
        "No Cursor configuration files found (.cursorrules or .cursor/rules/*.mdc)",
      );
    }

    return result;
  }

  private async parseCursorRulesFile(baseDir: string, result: RuleParseResult): Promise<void> {
    const cursorFilePath = join(baseDir, ".cursorrules");
    if (!(await fileExists(cursorFilePath))) {
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const rawContent = await readFileContent(cursorFilePath);
      const parsed = parseFrontmatter(rawContent, { matterOptions: this.customMatterOptions });
      const content = parsed.content;

      if (content) {
        // Convert Cursor frontmatter format to rulesync format
        const frontmatter = this.convertCursorMdcFrontmatter(parsed.data, "cursorrules");

        // Override targets to be cursor-specific for .cursorrules files
        frontmatter.targets = ["cursor"];

        result.rules.push({
          frontmatter,
          content,
          filename: "cursor-rules",
          filepath: cursorFilePath,
        });
      }
    }, "Failed to parse .cursorrules file");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }

  private async parseCursorMdcFiles(baseDir: string, result: RuleParseResult): Promise<void> {
    const cursorRulesDir = join(baseDir, ".cursor", "rules");
    if (!(await fileExists(cursorRulesDir))) {
      return;
    }

    const parseResult = await safeAsyncOperation(async () => {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(cursorRulesDir);

      for (const file of files) {
        if (file.endsWith(".mdc")) {
          const filePath = join(cursorRulesDir, file);
          const fileResult = await safeAsyncOperation(async () => {
            const rawContent = await readFileContent(filePath);
            const parsed = parseFrontmatter(rawContent, {
              matterOptions: this.customMatterOptions,
            });
            const content = parsed.content;

            if (content) {
              const filename = basename(file, ".mdc");
              // Convert according to four kinds of mdc file format
              const frontmatter = this.convertCursorMdcFrontmatter(parsed.data, filename);

              result.rules.push({
                frontmatter,
                content,
                filename: `cursor-${filename}`,
                filepath: filePath,
              });
            }
          }, `Failed to parse ${filePath}`);

          if (!fileResult.success) {
            result.errors.push(fileResult.error);
          }
        }
      }
    }, "Failed to parse .cursor/rules files");

    if (!parseResult.success) {
      result.errors.push(parseResult.error);
    }
  }

  // Custom gray-matter options for more lenient YAML parsing
  private customMatterOptions = {
    engines: {
      yaml: {
        parse: (str: string): object => {
          try {
            // Preprocess to handle Cursor's valid formats
            const preprocessed = str
              // Handle bare asterisk
              .replace(/^(\s*globs:\s*)\*\s*$/gm, '$1"*"')
              // Handle glob patterns without quotes
              .replace(/^(\s*globs:\s*)([^\s"'[\n][^"'[\n]*?)(\s*)$/gm, '$1"$2"$3');

            const result = load(preprocessed, { schema: DEFAULT_SCHEMA });
            if (typeof result === "object" && result !== null) {
              return result;
            }
            throw new Error("Failed to parse YAML: result is not an object");
          } catch (error) {
            // Fallback to FAILSAFE_SCHEMA
            try {
              const result = load(str, { schema: FAILSAFE_SCHEMA });
              if (typeof result === "object" && result !== null) {
                return result;
              }
              throw new Error("Failed to parse YAML: result is not an object");
            } catch {
              throw error;
            }
          }
        },
      },
    },
  };

  private convertCursorMdcFrontmatter(
    cursorFrontmatter: unknown,
    _filename: string,
  ): RuleFrontmatter {
    // Validate frontmatter is an object
    const FrontmatterSchema = z.record(z.string(), z.unknown());
    const parseResult = FrontmatterSchema.safeParse(cursorFrontmatter);
    if (!parseResult.success) {
      return {
        root: false,
        targets: ["*"],
        description: "",
        globs: [],
        cursorRuleType: "manual",
      };
    }
    const frontmatter = parseResult.data;

    // Normalize values
    const description = this.normalizeValue(frontmatter?.description);
    const globs = this.normalizeGlobsValue(frontmatter?.globs);
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

    // Special case: globs: * (single asterisk wildcard) should be treated as manual
    // This is Cursor's specific format where * means "all files" but with manual activation
    if (globs && globs.length === 1 && globs[0] === "*") {
      return {
        root: false,
        targets: ["*"],
        description: description || "",
        globs: globs,
        cursorRuleType: "manual",
      };
    }

    // 2. When both description and globs are present, treat as manual (edge case)
    // This handles the case where rules have both description and globs
    if (description && globs && globs.length > 0) {
      return {
        root: false,
        targets: ["*"],
        description: description, // Preserve description when both description and globs are present
        globs: globs,
        cursorRuleType: "manual",
      };
    }

    // 3. glob: has globs + alwaysApply: false (no description)
    if (globs && globs.length > 0) {
      return {
        root: false,
        targets: ["*"],
        description: "",
        globs: globs,
        cursorRuleType: "specificFiles",
      };
    }

    // 4. auto: has description + empty globs + alwaysApply: false
    if (description && (!globs || globs.length === 0)) {
      return {
        root: false,
        targets: ["*"],
        description: description,
        globs: [],
        cursorRuleType: "intelligently",
      };
    }

    // 5. manual: empty description + empty globs + alwaysApply: false
    if (!description && (!globs || globs.length === 0)) {
      return {
        root: false,
        targets: ["*"],
        description: "",
        globs: [],
        cursorRuleType: "manual",
      };
    }

    // Default fallback (should only reach here if no globs and no description)
    return {
      root: false,
      targets: ["*"],
      description: "",
      globs: [],
      cursorRuleType: "manual",
    };
  }

  private normalizeValue(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return undefined;
  }

  private normalizeGlobsValue(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map(String).filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      // Handle comma-separated globs
      return value
        .split(",")
        .map((glob) => glob.trim())
        .filter(Boolean);
    }
    return [];
  }
}
