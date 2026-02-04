import { z } from "zod/mini";

import {
  type RulesyncCommandFrontmatter,
  RulesyncCommandFrontmatterSchema,
} from "../features/commands/rulesync-command.js";
import {
  type RulesyncRuleFrontmatter,
  RulesyncRuleFrontmatterSchema,
} from "../features/rules/rulesync-rule.js";
import {
  type RulesyncSkillFrontmatter,
  RulesyncSkillFrontmatterSchema,
} from "../features/skills/rulesync-skill.js";
import {
  type RulesyncSubagentFrontmatter,
  RulesyncSubagentFrontmatterSchema,
} from "../features/subagents/rulesync-subagent.js";
import { commandTools } from "./commands.js";
import { generateOptionsSchema, generateTools } from "./generate.js";
import { ignoreTools } from "./ignore.js";
import { importOptionsSchema, importTools } from "./import.js";
import { mcpTools } from "./mcp.js";
import { ruleTools } from "./rules.js";
import { skillTools } from "./skills.js";
import { subagentTools } from "./subagents.js";

const rulesyncFeatureSchema = z.enum([
  "rule",
  "command",
  "subagent",
  "skill",
  "ignore",
  "mcp",
  "generate",
  "import",
]);

const rulesyncOperationSchema = z.enum(["list", "get", "put", "delete", "run"]);

const skillFileSchema = z.object({
  name: z.string(),
  body: z.string(),
});

const rulesyncToolSchema = z.object({
  feature: rulesyncFeatureSchema,
  operation: rulesyncOperationSchema,
  targetPathFromCwd: z.optional(z.string()),
  frontmatter: z.optional(z.unknown()),
  body: z.optional(z.string()),
  otherFiles: z.optional(z.array(skillFileSchema)),
  content: z.optional(z.string()),
  generateOptions: z.optional(generateOptionsSchema),
  importOptions: z.optional(importOptionsSchema),
});

type RulesyncFeature = z.infer<typeof rulesyncFeatureSchema>;
type RulesyncOperation = z.infer<typeof rulesyncOperationSchema>;
type RulesyncToolArgs = z.infer<typeof rulesyncToolSchema>;
type RulesyncFrontmatterFeature = Exclude<
  RulesyncFeature,
  "ignore" | "mcp" | "generate" | "import"
>;
type RulesyncFrontmatterByFeature = {
  rule: RulesyncRuleFrontmatter;
  command: RulesyncCommandFrontmatter;
  subagent: RulesyncSubagentFrontmatter;
  skill: RulesyncSkillFrontmatter;
};

const supportedOperationsByFeature: Record<RulesyncFeature, RulesyncOperation[]> = {
  rule: ["list", "get", "put", "delete"],
  command: ["list", "get", "put", "delete"],
  subagent: ["list", "get", "put", "delete"],
  skill: ["list", "get", "put", "delete"],
  ignore: ["get", "put", "delete"],
  mcp: ["get", "put", "delete"],
  generate: ["run"],
  import: ["run"],
};

function assertSupported({
  feature,
  operation,
}: {
  feature: RulesyncFeature;
  operation: RulesyncOperation;
}): void {
  const supportedOperations = supportedOperationsByFeature[feature];

  if (!supportedOperations.includes(operation)) {
    throw new Error(
      `Operation ${operation} is not supported for feature ${feature}. Supported operations: ${supportedOperations.join(
        ", ",
      )}`,
    );
  }
}

function requireTargetPath({ targetPathFromCwd, feature, operation }: RulesyncToolArgs): string {
  if (!targetPathFromCwd) {
    throw new Error(`targetPathFromCwd is required for ${feature} ${operation} operation`);
  }

  return targetPathFromCwd;
}

function parseFrontmatter({
  feature,
  frontmatter,
}: {
  feature: "rule";
  frontmatter: unknown;
}): RulesyncRuleFrontmatter;
function parseFrontmatter({
  feature,
  frontmatter,
}: {
  feature: "command";
  frontmatter: unknown;
}): RulesyncCommandFrontmatter;
function parseFrontmatter({
  feature,
  frontmatter,
}: {
  feature: "subagent";
  frontmatter: unknown;
}): RulesyncSubagentFrontmatter;
function parseFrontmatter({
  feature,
  frontmatter,
}: {
  feature: "skill";
  frontmatter: unknown;
}): RulesyncSkillFrontmatter;
function parseFrontmatter<Feature extends RulesyncFrontmatterFeature>({
  feature,
  frontmatter,
}: {
  feature: Feature;
  frontmatter: unknown;
}): RulesyncFrontmatterByFeature[Feature];
function parseFrontmatter({
  feature,
  frontmatter,
}: {
  feature: RulesyncFrontmatterFeature;
  frontmatter: unknown;
}): RulesyncFrontmatterByFeature[RulesyncFrontmatterFeature] {
  switch (feature) {
    case "rule": {
      return RulesyncRuleFrontmatterSchema.parse(frontmatter);
    }
    case "command": {
      return RulesyncCommandFrontmatterSchema.parse(frontmatter);
    }
    case "subagent": {
      return RulesyncSubagentFrontmatterSchema.parse(frontmatter);
    }
    case "skill": {
      return RulesyncSkillFrontmatterSchema.parse(frontmatter);
    }
  }
}

function ensureBody({ body, feature, operation }: RulesyncToolArgs): string {
  if (!body) {
    throw new Error(`body is required for ${feature} ${operation} operation`);
  }

  return body;
}

export const rulesyncTool = {
  name: "rulesyncTool",
  description:
    "Manage Rulesync files through a single MCP tool. Features: rule/command/subagent/skill support list/get/put/delete; ignore/mcp support get/put/delete only; generate supports run only; import supports run only. Parameters: list requires no targetPathFromCwd (lists all items); get/delete require targetPathFromCwd; put requires targetPathFromCwd, frontmatter, and body (or content for ignore/mcp); generate/run uses generateOptions to configure generation; import/run uses importOptions to configure import.",
  parameters: rulesyncToolSchema,
  execute: async (args: RulesyncToolArgs) => {
    const parsed = rulesyncToolSchema.parse(args);

    assertSupported({ feature: parsed.feature, operation: parsed.operation });

    switch (parsed.feature) {
      case "rule": {
        if (parsed.operation === "list") {
          return ruleTools.listRules.execute();
        }

        if (parsed.operation === "get") {
          return ruleTools.getRule.execute({ relativePathFromCwd: requireTargetPath(parsed) });
        }

        if (parsed.operation === "put") {
          return ruleTools.putRule.execute({
            relativePathFromCwd: requireTargetPath(parsed),
            frontmatter: parseFrontmatter({
              feature: "rule",
              frontmatter: parsed.frontmatter ?? {},
            }),
            body: ensureBody(parsed),
          });
        }

        return ruleTools.deleteRule.execute({ relativePathFromCwd: requireTargetPath(parsed) });
      }
      case "command": {
        if (parsed.operation === "list") {
          return commandTools.listCommands.execute();
        }

        if (parsed.operation === "get") {
          return commandTools.getCommand.execute({
            relativePathFromCwd: requireTargetPath(parsed),
          });
        }

        if (parsed.operation === "put") {
          return commandTools.putCommand.execute({
            relativePathFromCwd: requireTargetPath(parsed),
            frontmatter: parseFrontmatter({
              feature: "command",
              frontmatter: parsed.frontmatter ?? {},
            }),
            body: ensureBody(parsed),
          });
        }

        return commandTools.deleteCommand.execute({
          relativePathFromCwd: requireTargetPath(parsed),
        });
      }
      case "subagent": {
        if (parsed.operation === "list") {
          return subagentTools.listSubagents.execute();
        }

        if (parsed.operation === "get") {
          return subagentTools.getSubagent.execute({
            relativePathFromCwd: requireTargetPath(parsed),
          });
        }

        if (parsed.operation === "put") {
          return subagentTools.putSubagent.execute({
            relativePathFromCwd: requireTargetPath(parsed),
            frontmatter: parseFrontmatter({
              feature: "subagent",
              frontmatter: parsed.frontmatter ?? {},
            }),
            body: ensureBody(parsed),
          });
        }

        return subagentTools.deleteSubagent.execute({
          relativePathFromCwd: requireTargetPath(parsed),
        });
      }
      case "skill": {
        if (parsed.operation === "list") {
          return skillTools.listSkills.execute();
        }

        if (parsed.operation === "get") {
          return skillTools.getSkill.execute({ relativeDirPathFromCwd: requireTargetPath(parsed) });
        }

        if (parsed.operation === "put") {
          return skillTools.putSkill.execute({
            relativeDirPathFromCwd: requireTargetPath(parsed),
            frontmatter: parseFrontmatter({
              feature: "skill",
              frontmatter: parsed.frontmatter ?? {},
            }),
            body: ensureBody(parsed),
            otherFiles: parsed.otherFiles ?? [],
          });
        }

        return skillTools.deleteSkill.execute({
          relativeDirPathFromCwd: requireTargetPath(parsed),
        });
      }
      case "ignore": {
        if (parsed.operation === "get") {
          return ignoreTools.getIgnoreFile.execute();
        }

        if (parsed.operation === "put") {
          if (!parsed.content) {
            throw new Error("content is required for ignore put operation");
          }

          return ignoreTools.putIgnoreFile.execute({ content: parsed.content });
        }

        return ignoreTools.deleteIgnoreFile.execute();
      }
      case "mcp": {
        if (parsed.operation === "get") {
          return mcpTools.getMcpFile.execute();
        }

        if (parsed.operation === "put") {
          if (!parsed.content) {
            throw new Error("content is required for mcp put operation");
          }

          return mcpTools.putMcpFile.execute({ content: parsed.content });
        }

        return mcpTools.deleteMcpFile.execute();
      }
      case "generate": {
        // Only "run" operation is supported for generate feature
        return generateTools.executeGenerate.execute(parsed.generateOptions ?? {});
      }
      case "import": {
        // Only "run" operation is supported for import feature
        if (!parsed.importOptions) {
          throw new Error("importOptions is required for import feature");
        }
        return importTools.executeImport.execute(parsed.importOptions);
      }
      default: {
        throw new Error(`Unknown feature: ${parsed.feature}`);
      }
    }
  },
} as const;
