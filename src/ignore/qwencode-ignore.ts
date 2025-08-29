import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod/mini";
import type { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import type { ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

interface QwencodeFileFiltering {
  respectGitIgnore?: boolean | undefined;
  enableRecursiveFileSearch?: boolean | undefined;
}

const QwencodeSettingsSchema = z.object({
  fileFiltering: z.optional(
    z.object({
      respectGitIgnore: z.optional(z.boolean()),
      enableRecursiveFileSearch: z.optional(z.boolean()),
    }),
  ),
});

export interface QwencodeIgnoreParams extends AiFileParams {
  fileFiltering?: QwencodeFileFiltering;
}

export class QwencodeIgnore extends ToolIgnore {
  private readonly fileFiltering: QwencodeFileFiltering;

  constructor({ fileFiltering = {}, ...rest }: QwencodeIgnoreParams) {
    // QwenCode doesn't have explicit file patterns - uses Git integration
    const patterns: string[] = [];

    // Apply default values for file filtering before super call
    const processedFileFiltering = {
      respectGitIgnore: fileFiltering.respectGitIgnore ?? true,
      enableRecursiveFileSearch: fileFiltering.enableRecursiveFileSearch ?? true,
    };

    super({
      patterns,
      ...rest,
      validate: false, // Skip validation during construction
    });

    this.fileFiltering = processedFileFiltering;

    // Validate after setting fileFiltering, if validation was requested
    if (rest.validate !== false) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  getFileFiltering(): QwencodeFileFiltering {
    return this.fileFiltering;
  }

  toRulesyncIgnore(): RulesyncIgnore {
    // Convert Qwen Code file filtering settings to unified ignore patterns
    const body = this.generateIgnorePatternsFromSettings();

    return new RulesyncIgnore({
      baseDir: this.baseDir,
      relativeDirPath: ".rulesync/ignore",
      relativeFilePath: `${basename(this.relativeFilePath, ".json")}.md`,
      frontmatter: {
        targets: ["qwencode"],
        description: `Generated from Qwen Code settings: ${this.relativeFilePath}`,
      },
      body,
      fileContent: body,
    });
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    relativeDirPath,
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): QwencodeIgnore {
    const body = rulesyncIgnore.getBody();

    // Since QwenCode relies primarily on Git ignore, we'll note that in the settings
    // and include any additional patterns as comments
    const patterns = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    // QwenCode file filtering settings
    const fileFiltering: QwencodeFileFiltering = {
      respectGitIgnore: true,
      enableRecursiveFileSearch: !patterns.some(
        (pattern) =>
          pattern.includes("**") || pattern.includes("large") || pattern.includes("performance"),
      ),
    };

    return new QwencodeIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath: ".qwen/settings.json",
      fileFiltering,
      fileContent: JSON.stringify({ fileFiltering }, null, 2),
    });
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<QwencodeIgnore> {
    const fileContent = await readFile(filePath, "utf-8");
    let parsedContent: unknown;

    try {
      parsedContent = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Validate settings structure
    const result = QwencodeSettingsSchema.safeParse(parsedContent);
    if (!result.success) {
      throw new Error(`Invalid settings in ${filePath}: ${result.error.message}`);
    }

    const filename = basename(filePath);

    return new QwencodeIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: filename,
      fileFiltering: result.data.fileFiltering || {},
      fileContent,
    });
  }

  generateSettingsJson(): string {
    const settings = {
      fileFiltering: this.fileFiltering,
    };
    return JSON.stringify(settings, null, 2);
  }

  private generateIgnorePatternsFromSettings(): string {
    const patterns: string[] = [];

    patterns.push("# Generated from Qwen Code file filtering settings");
    patterns.push("");

    if (this.fileFiltering.respectGitIgnore !== false) {
      patterns.push("# Qwen Code automatically respects .gitignore patterns");
      patterns.push("# Files ignored by Git are automatically excluded from AI context");
      patterns.push("");
    }

    if (this.fileFiltering.enableRecursiveFileSearch === false) {
      patterns.push("# Recursive file search disabled for performance optimization");
      patterns.push("# Large repositories may benefit from this setting");
      patterns.push("");
    }

    patterns.push("# QwenCode File Filtering Configuration:");
    patterns.push(`# respectGitIgnore: ${this.fileFiltering.respectGitIgnore}`);
    patterns.push(`# enableRecursiveFileSearch: ${this.fileFiltering.enableRecursiveFileSearch}`);
    patterns.push("");

    patterns.push("# Common Git ignore patterns that QwenCode respects:");
    patterns.push(...this.getDefaultFilePatterns());

    return patterns.join("\n");
  }

  private getDefaultFilePatterns(): string[] {
    return [
      "# Dependencies",
      "node_modules/",
      ".pnpm-store/",
      ".yarn/",
      "vendor/",
      "",
      "# Build artifacts",
      "dist/",
      "build/",
      "out/",
      "target/",
      ".next/",
      ".nuxt/",
      "",
      "# Environment files",
      ".env",
      ".env.*",
      "!.env.example",
      "",
      "# Logs and temporary files",
      "*.log",
      "*.tmp",
      ".cache/",
      "",
      "# IDE and editor files",
      ".vscode/settings.json",
      ".idea/",
      "*.swp",
      "*.swo",
      "",
      "# System files",
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",
    ];
  }

  validate(): ValidationResult {
    const baseResult = super.validate();
    if (!baseResult.success) {
      return baseResult;
    }

    // Additional validation for file filtering settings
    if (!this.fileFiltering) {
      return {
        success: false,
        error: new Error("fileFiltering must be defined"),
      };
    }

    if (
      typeof this.fileFiltering.respectGitIgnore !== "undefined" &&
      typeof this.fileFiltering.respectGitIgnore !== "boolean"
    ) {
      return {
        success: false,
        error: new Error("respectGitIgnore must be a boolean"),
      };
    }

    if (
      typeof this.fileFiltering.enableRecursiveFileSearch !== "undefined" &&
      typeof this.fileFiltering.enableRecursiveFileSearch !== "boolean"
    ) {
      return {
        success: false,
        error: new Error("enableRecursiveFileSearch must be a boolean"),
      };
    }

    return { success: true, error: null };
  }

  static createWithDefaultRules(params: Partial<QwencodeIgnoreParams> = {}): QwencodeIgnore {
    const defaultFileFiltering: QwencodeFileFiltering = {
      respectGitIgnore: true,
      enableRecursiveFileSearch: true,
    };

    return new QwencodeIgnore({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath || ".qwen",
      relativeFilePath: params.relativeFilePath || "settings.json",
      fileFiltering: defaultFileFiltering,
      fileContent: JSON.stringify({ fileFiltering: defaultFileFiltering }, null, 2),
      ...params,
    });
  }

  static getSupportedFileNames(): readonly string[] {
    return ["settings.json"] as const;
  }
}
