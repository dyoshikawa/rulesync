import type { Config, GeneratedOutput, ParsedRule } from "../../types/index.js";
import { generateBaseRulesConfig, generateMarkdownContent } from "./base-generator.js";

export async function generateCodexConfig(
  rules: ParsedRule[],
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  return generateBaseRulesConfig(
    rules,
    config,
    {
      fileName: "AGENTS.md",
      ignoreFileName: ".codexignore",
      generateContent: generateMarkdownContent,
      tool: "codexcli",
    },
    baseDir,
  );
}
