import { CommandsProcessor } from "../features/commands/commands-processor.js";
import {
  CommandsProcessorToolTargetSchema,
  toolCommandFactories,
} from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import {
  HooksProcessorToolTargetSchema,
  toolHooksFactories,
} from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import {
  IgnoreProcessorToolTargetSchema,
  toolIgnoreFactories,
} from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { McpProcessorToolTargetSchema, toolMcpFactories } from "../features/mcp/mcp-processor.js";
import { PermissionsProcessor } from "../features/permissions/permissions-processor.js";
import {
  PermissionsProcessorToolTargetSchema,
  toolPermissionsFactories,
} from "../features/permissions/permissions-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import {
  RulesProcessorToolTargetSchema,
  toolRuleFactories,
} from "../features/rules/rules-processor.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import {
  SkillsProcessorToolTargetSchema,
  toolSkillFactories,
} from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import {
  SubagentsProcessorToolTargetSchema,
  toolSubagentFactories,
} from "../features/subagents/subagents-processor.js";
import type { Feature } from "./features.js";
import type { ToolTarget } from "./tool-targets.js";

// Common surface every feature processor exposes. `getToolTargets`/`Simulated`
// are static, so they are reached through the class reference.
type ProcessorClass = {
  getToolTargets(options?: { global?: boolean; importOnly?: boolean }): ToolTarget[];
  getToolTargetsSimulated?: () => ToolTarget[];
};

type FactoryMap = ReadonlyMap<ToolTarget, unknown>;

// Only `options` (the enum members) is consumed by registry readers, so the
// schema is typed by that surface rather than each feature's distinct enum type.
type ToolTargetSchema = { readonly options: ReadonlyArray<string> };

export type ProcessorRegistryEntry = {
  readonly feature: Feature;
  readonly processor: ProcessorClass;
  readonly schema: ToolTargetSchema;
  readonly factory: FactoryMap;
};

// Single place that binds each feature to its processor, schema and factory.
// Adding a ninth feature means adding one entry here — tool-targets tests,
// gitignore derivation and the supported-tools table generator all read from it.
export const PROCESSOR_REGISTRY: ReadonlyArray<ProcessorRegistryEntry> = [
  {
    feature: "rules",
    processor: RulesProcessor,
    schema: RulesProcessorToolTargetSchema,
    factory: toolRuleFactories,
  },
  {
    feature: "ignore",
    processor: IgnoreProcessor,
    schema: IgnoreProcessorToolTargetSchema,
    factory: toolIgnoreFactories,
  },
  {
    feature: "mcp",
    processor: McpProcessor,
    schema: McpProcessorToolTargetSchema,
    factory: toolMcpFactories,
  },
  {
    feature: "commands",
    processor: CommandsProcessor,
    schema: CommandsProcessorToolTargetSchema,
    factory: toolCommandFactories,
  },
  {
    feature: "subagents",
    processor: SubagentsProcessor,
    schema: SubagentsProcessorToolTargetSchema,
    factory: toolSubagentFactories,
  },
  {
    feature: "skills",
    processor: SkillsProcessor,
    schema: SkillsProcessorToolTargetSchema,
    factory: toolSkillFactories,
  },
  {
    feature: "hooks",
    processor: HooksProcessor,
    schema: HooksProcessorToolTargetSchema,
    factory: toolHooksFactories,
  },
  {
    feature: "permissions",
    processor: PermissionsProcessor,
    schema: PermissionsProcessorToolTargetSchema,
    factory: toolPermissionsFactories,
  },
];

export const getProcessorRegistryEntry = (feature: Feature): ProcessorRegistryEntry => {
  const entry = PROCESSOR_REGISTRY.find((e) => e.feature === feature);
  if (!entry) {
    throw new Error(`No processor registered for feature: ${feature}`);
  }
  return entry;
};
