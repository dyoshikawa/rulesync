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
import { convertOptionsSchema, convertTools } from "./convert.js";
import { generateOptionsSchema, generateTools } from "./generate.js";
import { hooksTools } from "./hooks.js";
import { ignoreTools } from "./ignore.js";
import { importOptionsSchema, importTools } from "./import.js";
import { mcpTools } from "./mcp.js";
import { permissionsTools } from "./permissions.js";
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
  "permissions",
  "hooks",
  "generate",
  "import",
  "convert",
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
  convertOptions: z.optional(convertOptionsSchema),
});

type RulesyncFeature = z.infer<typeof rulesyncFeatureSchema>;
type RulesyncOperation = z.infer<typeof rulesyncOperationSchema>;
type RulesyncToolArgs = z.infer<typeof rulesyncToolSchema>;
type RulesyncFrontmatterFeature = Exclude<
  RulesyncFeature,
  "ignore" | "mcp" | "permissions" | "hooks" | "generate" | "import" | "convert"
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
  permissions: ["get", "put", "delete"],
  hooks: ["get", "put", "delete"],
  generate: ["run"],
  import: ["run"],
  convert: ["run"],
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

function requireContent({
  content,
  feature,
}: {
  content: string | undefined;
  feature: string;
}): string {
  if (!content) {
    throw new Error(`content is required for ${feature} put operation`);
  }

  return content;
}

function executeRule(parsed: RulesyncToolArgs) {
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

function executeCommand(parsed: RulesyncToolArgs) {
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

function executeSubagent(parsed: RulesyncToolArgs) {
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

function executeSkill(parsed: RulesyncToolArgs) {
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

function executeIgnore(parsed: RulesyncToolArgs) {
  if (parsed.operation === "get") {
    return ignoreTools.getIgnoreFile.execute();
  }

  if (parsed.operation === "put") {
    return ignoreTools.putIgnoreFile.execute({
      content: requireContent({ content: parsed.content, feature: "ignore" }),
    });
  }

  return ignoreTools.deleteIgnoreFile.execute();
}

function executeMcp(parsed: RulesyncToolArgs) {
  if (parsed.operation === "get") {
    return mcpTools.getMcpFile.execute();
  }

  if (parsed.operation === "put") {
    return mcpTools.putMcpFile.execute({
      content: requireContent({ content: parsed.content, feature: "mcp" }),
    });
  }

  return mcpTools.deleteMcpFile.execute();
}

function executePermissions(parsed: RulesyncToolArgs) {
  if (parsed.operation === "get") {
    return permissionsTools.getPermissionsFile.execute();
  }

  if (parsed.operation === "put") {
    return permissionsTools.putPermissionsFile.execute({
      content: requireContent({ content: parsed.content, feature: "permissions" }),
    });
  }

  return permissionsTools.deletePermissionsFile.execute();
}

function executeHooks(parsed: RulesyncToolArgs) {
  if (parsed.operation === "get") {
    return hooksTools.getHooksFile.execute();
  }

  if (parsed.operation === "put") {
    return hooksTools.putHooksFile.execute({
      content: requireContent({ content: parsed.content, feature: "hooks" }),
    });
  }

  return hooksTools.deleteHooksFile.execute();
}

function executeGenerate(parsed: RulesyncToolArgs) {
  // Only "run" operation is supported for generate feature
  return generateTools.executeGenerate.execute(parsed.generateOptions ?? {});
}

function executeImport(parsed: RulesyncToolArgs) {
  // Only "run" operation is supported for import feature
  if (!parsed.importOptions) {
    throw new Error("importOptions is required for import feature");
  }
  return importTools.executeImport.execute(parsed.importOptions);
}

function executeConvert(parsed: RulesyncToolArgs) {
  // Only "run" operation is supported for convert feature
  if (!parsed.convertOptions) {
    throw new Error("convertOptions is required for convert feature");
  }
  return convertTools.executeConvert.execute(parsed.convertOptions);
}

const featureExecutors: Record<RulesyncFeature, (parsed: RulesyncToolArgs) => Promise<string>> = {
  rule: executeRule,
  command: executeCommand,
  subagent: executeSubagent,
  skill: executeSkill,
  ignore: executeIgnore,
  mcp: executeMcp,
  permissions: executePermissions,
  hooks: executeHooks,
  generate: executeGenerate,
  import: executeImport,
  convert: executeConvert,
};

export const rulesyncTool = {
  name: "rulesyncTool",
  description:
    "Manage Rulesync files through a single MCP tool. Features: rule/command/subagent/skill support list/get/put/delete; ignore/mcp/permissions/hooks support get/put/delete only; generate supports run only; import supports run only; convert supports run only. Parameters: list requires no targetPathFromCwd (lists all items); get/delete require targetPathFromCwd; put requires targetPathFromCwd, frontmatter, and body (or content for ignore/mcp/permissions/hooks); generate/run uses generateOptions to configure generation; import/run uses importOptions to configure import; convert/run uses convertOptions to configure conversion.",
  parameters: rulesyncToolSchema,
  execute: async (args: RulesyncToolArgs) => {
    const parsed = rulesyncToolSchema.parse(args);

    assertSupported({ feature: parsed.feature, operation: parsed.operation });

    const executor = featureExecutors[parsed.feature];
    if (!executor) {
      throw new Error(`Unknown feature: ${parsed.feature}`);
    }

    return executor(parsed);
  },
} as const;
