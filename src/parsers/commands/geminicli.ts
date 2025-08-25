import { basename, join } from "node:path";
import type { ParsedRule, RuleFrontmatter } from "../../types/index.js";
import { fileExists, readFileContent, resolvePath } from "../../utils/file.js";
import { BaseCommandParser } from "./base.js";

/**
 * Gemini CLI command parser
 * Parses commands from .gemini/commands/*.toml files
 */
export class GeminiCommandParser extends BaseCommandParser {
  getToolName() {
    return "geminicli" as const;
  }

  getCommandsDirectory(): string {
    return ".gemini/commands";
  }

  async parseCommands(baseDir: string = process.cwd()): Promise<ParsedRule[]> {
    const commandsDir = resolvePath(this.getCommandsDirectory(), baseDir);

    if (!(await fileExists(commandsDir))) {
      return [];
    }

    const commands: ParsedRule[] = [];

    try {
      const { readdir } = await import("node:fs/promises");
      const { parse } = await import("smol-toml");
      const files = await readdir(commandsDir);

      for (const file of files) {
        if (file.endsWith(".toml")) {
          const filePath = join(commandsDir, file);
          const content = await readFileContent(filePath);

          if (content.trim()) {
            const filename = basename(file, ".toml");

            try {
              // Parse TOML using smol-toml
              const parsed = parse(content);

              // Type guard for the expected structure
              if (typeof parsed !== "object" || parsed === null) {
                continue;
              }

              const commandConfig: Record<string, unknown> = parsed;

              // Check if prompt exists and is a string
              if (typeof commandConfig.prompt === "string") {
                const description =
                  typeof commandConfig.description === "string"
                    ? commandConfig.description
                    : `Command: ${filename}`;

                const frontmatter: RuleFrontmatter = {
                  root: false,
                  targets: ["geminicli"],
                  description,
                  globs: ["**/*"],
                };

                commands.push({
                  frontmatter,
                  content: commandConfig.prompt,
                  filename: filename,
                  filepath: filePath,
                  type: "command",
                } satisfies ParsedRule);
              }
            } catch {
              // Skip files that can't be parsed as valid TOML
            }
          }
        }
      }
    } catch {
      // Commands files are optional, so we don't throw errors
    }

    return commands;
  }
}
