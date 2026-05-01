import { isAbsolute } from "node:path";

import { minLength, optional, refine, z } from "zod/mini";

import { ToolTargetsSchema } from "../../types/tool-targets.js";
import { hasControlCharacters } from "../../utils/validation.js";

const RelativePluginPathSchema = z.string().check(
  minLength(1, "path must be a non-empty string"),
  refine((v) => !v.includes(".."), 'path must not contain ".."'),
  refine((v) => !isAbsolute(v), "path must not be absolute"),
  refine((v) => !hasControlCharacters(v), "path must not contain control characters"),
);

export const CodexcliPluginArtifactSchema = z.object({
  kind: z.enum(["skillsBundle"]),
  path: RelativePluginPathSchema,
});

export const CodexcliPluginInstallSchema = z.object({
  strategy: z.enum(["userSkillsDir"]),
});

export const CodexcliPluginConfigSchema = z.object({
  artifact: CodexcliPluginArtifactSchema,
  install: CodexcliPluginInstallSchema,
});

export const ClaudecodePluginArtifactSchema = z.object({
  kind: z.enum(["skillsBundle"]),
  path: RelativePluginPathSchema,
});

export const ClaudecodePluginInstallSchema = z.object({
  strategy: z.enum(["userSkillsDir"]),
});

export const ClaudecodePluginConfigSchema = z.object({
  artifact: ClaudecodePluginArtifactSchema,
  install: ClaudecodePluginInstallSchema,
});

export const PluginManifestSchema = z.object({
  name: z.string().check(minLength(1, "name must be a non-empty string")),
  targets: ToolTargetsSchema,
  codexcli: optional(CodexcliPluginConfigSchema),
  claudecode: optional(ClaudecodePluginConfigSchema),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export const PluginSourceEntrySchema = z.object({
  name: z.string().check(minLength(1, "name must be a non-empty string")),
  targets: ToolTargetsSchema,
  codexcli: optional(CodexcliPluginConfigSchema),
  claudecode: optional(ClaudecodePluginConfigSchema),
});

export type PluginSourceEntry = z.infer<typeof PluginSourceEntrySchema>;
