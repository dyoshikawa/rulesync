import { z } from "zod/mini";

import {
  type RulesyncCheckFrontmatter,
  RulesyncCheckFrontmatterSchema,
} from "../features/checks/rulesync-check.js";
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
import { withWarnOnceScope } from "../utils/warned-once.js";
import { addOptionsSchema, addTools } from "./add.js";
import { checkTools } from "./checks.js";
import { commandTools } from "./commands.js";
import { convertOptionsSchema, convertTools } from "./convert.js";
import { docsOptionsSchema, docsTools } from "./docs.js";
import { doctorOptionsSchema, doctorTools } from "./doctor.js";
import { fetchOptionsSchema, fetchTools } from "./fetch.js";
import { generateOptionsSchema, generateTools } from "./generate.js";
import { gitignoreOptionsSchema, gitignoreTools } from "./gitignore.js";
import { hooksTools } from "./hooks.js";
import { ignoreTools } from "./ignore.js";
import { importOptionsSchema, importTools } from "./import.js";
import { initTools } from "./init.js";
import { installOptionsSchema, installTools } from "./install.js";
import { mcpTools } from "./mcp.js";
import { permissionsTools } from "./permissions.js";
import { releaseNotesOptionsSchema, releaseNotesTools } from "./release-notes.js";
import { ruleTools } from "./rules.js";
import { skillTools } from "./skills.js";
import { subagentTools } from "./subagents.js";

const rulesyncFeatureSchema = z.enum([
  "rule",
  "command",
  "subagent",
  "skill",
  "check",
  "ignore",
  "mcp",
  "permissions",
  "hooks",
  "generate",
  "import",
  "convert",
  "init",
  "gitignore",
  "add",
  "fetch",
  "install",
  "doctor",
  "docs",
  "releaseNotes",
]);

const rulesyncOperationSchema = z.enum(["list", "get", "put", "delete", "run"]);

const skillFileSchema = z.object({
  name: z.string(),
  body: z.string(),
  encoding: z.optional(z.enum(["utf-8", "base64"])),
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
  gitignoreOptions: z.optional(gitignoreOptionsSchema),
  addOptions: z.optional(addOptionsSchema),
  fetchOptions: z.optional(fetchOptionsSchema),
  installOptions: z.optional(installOptionsSchema),
  doctorOptions: z.optional(doctorOptionsSchema),
  docsOptions: z.optional(docsOptionsSchema),
  releaseNotesOptions: z.optional(releaseNotesOptionsSchema),
});

type RulesyncFeature = z.infer<typeof rulesyncFeatureSchema>;
type RulesyncOperation = z.infer<typeof rulesyncOperationSchema>;
type RulesyncToolArgs = z.infer<typeof rulesyncToolSchema>;
type RulesyncFrontmatterFeature = Extract<
  RulesyncFeature,
  "rule" | "command" | "subagent" | "skill" | "check"
>;
type RulesyncFrontmatterByFeature = {
  rule: RulesyncRuleFrontmatter;
  command: RulesyncCommandFrontmatter;
  subagent: RulesyncSubagentFrontmatter;
  skill: RulesyncSkillFrontmatter;
  check: RulesyncCheckFrontmatter;
};

export const supportedOperationsByFeature: Record<RulesyncFeature, RulesyncOperation[]> = {
  rule: ["list", "get", "put", "delete"],
  command: ["list", "get", "put", "delete"],
  subagent: ["list", "get", "put", "delete"],
  skill: ["list", "get", "put", "delete"],
  check: ["list", "get", "put", "delete"],
  ignore: ["get", "put", "delete"],
  mcp: ["get", "put", "delete"],
  permissions: ["get", "put", "delete"],
  hooks: ["get", "put", "delete"],
  generate: ["run"],
  import: ["run"],
  convert: ["run"],
  init: ["run"],
  gitignore: ["run"],
  add: ["run"],
  fetch: ["run"],
  install: ["run"],
  doctor: ["run"],
  docs: ["run"],
  releaseNotes: ["run"],
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

const frontmatterParserByFeature: {
  [Feature in RulesyncFrontmatterFeature]: (
    frontmatter: unknown,
  ) => RulesyncFrontmatterByFeature[Feature];
} = {
  rule: (frontmatter) => RulesyncRuleFrontmatterSchema.parse(frontmatter),
  command: (frontmatter) => RulesyncCommandFrontmatterSchema.parse(frontmatter),
  subagent: (frontmatter) => RulesyncSubagentFrontmatterSchema.parse(frontmatter),
  skill: (frontmatter) => RulesyncSkillFrontmatterSchema.parse(frontmatter),
  check: (frontmatter) => RulesyncCheckFrontmatterSchema.parse(frontmatter),
};

function parseFrontmatter<Feature extends RulesyncFrontmatterFeature>({
  feature,
  frontmatter,
}: {
  feature: Feature;
  frontmatter: unknown;
}): RulesyncFrontmatterByFeature[Feature] {
  return frontmatterParserByFeature[feature](frontmatter);
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

/**
 * Builds the list/get/put/delete dispatcher for a feature stored as Markdown
 * files with frontmatter (rules, commands, subagents and checks).
 */
function createFrontmatterFileExecutor<
  Feature extends Exclude<RulesyncFrontmatterFeature, "skill">,
>({
  feature,
  list,
  get,
  put,
  remove,
}: {
  feature: Feature;
  list: () => Promise<string>;
  get: (args: { relativePathFromCwd: string }) => Promise<string>;
  put: (args: {
    relativePathFromCwd: string;
    frontmatter: RulesyncFrontmatterByFeature[Feature];
    body: string;
  }) => Promise<string>;
  remove: (args: { relativePathFromCwd: string }) => Promise<string>;
}): (parsed: RulesyncToolArgs) => Promise<string> {
  return (parsed) => {
    if (parsed.operation === "list") {
      return list();
    }

    if (parsed.operation === "get") {
      return get({ relativePathFromCwd: requireTargetPath(parsed) });
    }

    if (parsed.operation === "put") {
      return put({
        relativePathFromCwd: requireTargetPath(parsed),
        frontmatter: parseFrontmatter({
          feature,
          frontmatter: parsed.frontmatter ?? {},
        }),
        body: ensureBody(parsed),
      });
    }

    return remove({ relativePathFromCwd: requireTargetPath(parsed) });
  };
}

/**
 * Builds the get/put/delete dispatcher for a feature stored as a single file
 * whose whole content is passed through (ignore, MCP, permissions and hooks).
 */
function createContentFileExecutor({
  feature,
  get,
  put,
  remove,
}: {
  feature: RulesyncFeature;
  get: () => Promise<string>;
  put: (args: { content: string }) => Promise<string>;
  remove: () => Promise<string>;
}): (parsed: RulesyncToolArgs) => Promise<string> {
  return (parsed) => {
    if (parsed.operation === "get") {
      return get();
    }

    if (parsed.operation === "put") {
      return put({ content: requireContent({ content: parsed.content, feature }) });
    }

    return remove();
  };
}

const executeRule = createFrontmatterFileExecutor({
  feature: "rule",
  list: ruleTools.listRules.execute,
  get: ruleTools.getRule.execute,
  put: ruleTools.putRule.execute,
  remove: ruleTools.deleteRule.execute,
});

const executeCommand = createFrontmatterFileExecutor({
  feature: "command",
  list: commandTools.listCommands.execute,
  get: commandTools.getCommand.execute,
  put: commandTools.putCommand.execute,
  remove: commandTools.deleteCommand.execute,
});

const executeSubagent = createFrontmatterFileExecutor({
  feature: "subagent",
  list: subagentTools.listSubagents.execute,
  get: subagentTools.getSubagent.execute,
  put: subagentTools.putSubagent.execute,
  remove: subagentTools.deleteSubagent.execute,
});

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

const executeCheck = createFrontmatterFileExecutor({
  feature: "check",
  list: checkTools.listChecks.execute,
  get: checkTools.getCheck.execute,
  put: checkTools.putCheck.execute,
  remove: checkTools.deleteCheck.execute,
});

const executeIgnore = createContentFileExecutor({
  feature: "ignore",
  get: ignoreTools.getIgnoreFile.execute,
  put: ignoreTools.putIgnoreFile.execute,
  remove: ignoreTools.deleteIgnoreFile.execute,
});

const executeMcp = createContentFileExecutor({
  feature: "mcp",
  get: mcpTools.getFile.execute,
  put: mcpTools.putFile.execute,
  remove: mcpTools.deleteFile.execute,
});

const executePermissions = createContentFileExecutor({
  feature: "permissions",
  get: permissionsTools.getFile.execute,
  put: permissionsTools.putFile.execute,
  remove: permissionsTools.deleteFile.execute,
});

const executeHooks = createContentFileExecutor({
  feature: "hooks",
  get: hooksTools.getFile.execute,
  put: hooksTools.putFile.execute,
  remove: hooksTools.deleteFile.execute,
});

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

function requireOptions<T>({ options, name }: { options: T | undefined; name: string }): T {
  if (!options) {
    throw new Error(`${name} is required for this feature`);
  }
  return options;
}

const featureExecutors: Record<RulesyncFeature, (parsed: RulesyncToolArgs) => Promise<string>> = {
  rule: executeRule,
  command: executeCommand,
  subagent: executeSubagent,
  skill: executeSkill,
  check: executeCheck,
  ignore: executeIgnore,
  mcp: executeMcp,
  permissions: executePermissions,
  hooks: executeHooks,
  generate: executeGenerate,
  import: executeImport,
  convert: executeConvert,
  // The features below support only the "run" operation.
  init: () => initTools.executeInit.execute(),
  gitignore: (parsed) => gitignoreTools.executeGitignore.execute(parsed.gitignoreOptions ?? {}),
  add: (parsed) =>
    addTools.executeAdd.execute(requireOptions({ options: parsed.addOptions, name: "addOptions" })),
  fetch: (parsed) =>
    fetchTools.executeFetch.execute(
      requireOptions({ options: parsed.fetchOptions, name: "fetchOptions" }),
    ),
  install: (parsed) => installTools.executeInstall.execute(parsed.installOptions ?? {}),
  doctor: (parsed) => doctorTools.executeDoctor.execute(parsed.doctorOptions ?? {}),
  docs: (parsed) => docsTools.executeDocs.execute(parsed.docsOptions ?? {}),
  releaseNotes: (parsed) =>
    releaseNotesTools.executeReleaseNotes.execute(
      requireOptions({ options: parsed.releaseNotesOptions, name: "releaseNotesOptions" }),
    ),
};

export const rulesyncTool = {
  name: "rulesyncTool",
  description:
    'Manage Rulesync files and run rulesync commands through a single MCP tool. Features: rule/command/subagent/skill/check support list/get/put/delete; ignore/mcp/permissions/hooks support get/put/delete only; generate/import/convert/init/gitignore/add/fetch/install/doctor/docs/releaseNotes support run only. Parameters: list requires no targetPathFromCwd (lists all items); get/delete require targetPathFromCwd; put requires targetPathFromCwd, frontmatter, and body (or content for ignore/mcp/permissions/hooks); generate/run uses generateOptions to configure generation; import/run uses importOptions to configure import; convert/run uses convertOptions to configure conversion; init/run takes no options; gitignore/run uses optional gitignoreOptions; add/run requires addOptions (source); fetch/run requires fetchOptions (source); install/run uses optional installOptions (outdated: true only reports lockfile status); doctor/run uses optional doctorOptions and returns diagnostics with severities; docs/run uses optional docsOptions (document, search, or neither to list documents); releaseNotes/run requires releaseNotesOptions (source as owner/repo). Path options (configPath, output) must stay inside the project; GitHub tokens are read from GITHUB_TOKEN/GH_TOKEN. skill otherFiles entries accept an optional encoding ("utf-8" by default, "base64" for binary files) and are returned with the encoding they require.',
  parameters: rulesyncToolSchema,
  // Each call gets its own once-per-run bookkeeping. The server is long-lived
  // and does not serialize requests, so without a scope the process-wide record
  // would grow for as long as it runs, and the first call to hit a
  // once-per-run diagnostic would silence it for every call after it — however
  // many days later, and whatever project it was about.
  execute: async (args: RulesyncToolArgs) =>
    await withWarnOnceScope(async () => {
      const parsed = rulesyncToolSchema.parse(args);

      assertSupported({ feature: parsed.feature, operation: parsed.operation });

      return await featureExecutors[parsed.feature](parsed);
    }),
} as const;
