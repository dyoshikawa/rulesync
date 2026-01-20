// High-level functions
export { generate, type GenerateParams } from "./lib/generate.js";
export { gitignore } from "./lib/gitignore.js";
export { importFrom, type ImportFromParams } from "./lib/import.js";
export { init } from "./lib/init.js";

// Configuration
export { Config, type ConfigParams, type PartialConfigParams } from "./config/config.js";
export { ConfigResolver, type ConfigResolverResolveParams } from "./config/config-resolver.js";

// Feature Processors
export { CommandsProcessor } from "./features/commands/commands-processor.js";
export { IgnoreProcessor } from "./features/ignore/ignore-processor.js";
export { McpProcessor } from "./features/mcp/mcp-processor.js";
export { RulesProcessor } from "./features/rules/rules-processor.js";
export { SkillsProcessor } from "./features/skills/skills-processor.js";
export { SubagentsProcessor } from "./features/subagents/subagents-processor.js";

// Rulesync File Classes
export { RulesyncCommand } from "./features/commands/rulesync-command.js";
export { RulesyncIgnore } from "./features/ignore/rulesync-ignore.js";
export { RulesyncMcp } from "./features/mcp/rulesync-mcp.js";
export { RulesyncRule } from "./features/rules/rulesync-rule.js";
export { RulesyncSkill } from "./features/skills/rulesync-skill.js";
export { RulesyncSubagent } from "./features/subagents/rulesync-subagent.js";

// Base Classes
export { FeatureProcessor } from "./types/feature-processor.js";
export { DirFeatureProcessor } from "./types/dir-feature-processor.js";

// Types
export {
  ALL_FEATURES,
  ALL_FEATURES_WITH_WILDCARD,
  type Feature,
  type Features,
  type RulesyncFeatures,
} from "./types/features.js";

export {
  ALL_TOOL_TARGETS,
  ALL_TOOL_TARGETS_WITH_WILDCARD,
  type ToolTarget,
  type ToolTargets,
  type RulesyncTargets,
} from "./types/tool-targets.js";
