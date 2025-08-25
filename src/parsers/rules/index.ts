import type { ToolTarget } from "../../types/tool-targets.js";
import { AgentsMdRuleParser, createAgentsMdRuleParser } from "./agentsmd.js";
import { AmazonQCLIRuleParser } from "./amazonqcli.js";
import { AugmentCodeRuleParser } from "./augmentcode.js";
import type { BaseRuleParser } from "./base.js";
import { ClaudeCodeRuleParser } from "./claudecode.js";
import { ClineRuleParser } from "./cline.js";
import { CodexCLIRuleParser } from "./codexcli.js";
import { CopilotRuleParser } from "./copilot.js";
import { CursorRuleParser } from "./cursor.js";
import { GeminiCLIRuleParser } from "./geminicli.js";
import { JunieRuleParser } from "./junie.js";
import { OpenCodeRuleParser } from "./opencode.js";
import { QwenCodeRuleParser } from "./qwencode.js";
import { RooRuleParser } from "./roo.js";
import { WindsurfRuleParser } from "./windsurf.js";

// Export all rule parsers
export * from "./agentsmd.js";
export * from "./amazonqcli.js";
export * from "./augmentcode.js";
export * from "./base.js";
export * from "./claudecode.js";
export * from "./cline.js";
export * from "./codexcli.js";
export * from "./copilot.js";
export * from "./cursor.js";
export * from "./geminicli.js";
export * from "./junie.js";
export * from "./kiro.js";
export * from "./opencode.js";
export * from "./qwencode.js";
export * from "./roo.js";
export * from "./windsurf.js";

/**
 * Factory function to get the appropriate rule parser for a tool
 */
export function getRuleParser(tool: ToolTarget): BaseRuleParser | undefined {
  switch (tool) {
    case "agentsmd":
      return new AgentsMdRuleParser();
    case "amazonqcli":
      return new AmazonQCLIRuleParser();
    case "augmentcode":
      return new AugmentCodeRuleParser();
    case "claudecode":
      return new ClaudeCodeRuleParser();
    case "cline":
      return new ClineRuleParser();
    case "codexcli":
      return new CodexCLIRuleParser();
    case "copilot":
      return new CopilotRuleParser();
    case "cursor":
      return new CursorRuleParser();
    case "geminicli":
      return new GeminiCLIRuleParser();
    case "junie":
      return new JunieRuleParser();
    case "kiro":
      return createAgentsMdRuleParser("kiro", "Kiro IDE configuration");
    case "opencode":
      return new OpenCodeRuleParser();
    case "qwencode":
      return new QwenCodeRuleParser();
    case "roo":
      return new RooRuleParser();
    case "windsurf":
      return new WindsurfRuleParser();
    default:
      return undefined;
  }
}
