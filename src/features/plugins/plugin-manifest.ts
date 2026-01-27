import { optional, z } from "zod/mini";

/**
 * Schema for plugin.json manifest file.
 * This file is required in every plugin directory.
 */
export const PluginManifestSchema = z.looseObject({
  /** Plugin name (required) */
  name: z.string(),
  /** Plugin description (required) */
  description: z.string(),
  /** Plugin version using semver format (required) */
  version: z.string(),
  /** Author information (optional) */
  author: optional(
    z.looseObject({
      name: z.string(),
      email: optional(z.string()),
      url: optional(z.string()),
    }),
  ),
  /** Repository URL (optional) */
  repository: optional(z.string()),
  /** Keywords for discovery (optional) */
  keywords: optional(z.array(z.string())),
  /** License (optional) */
  license: optional(z.string()),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * Plugin manifest file name.
 */
export const PLUGIN_MANIFEST_FILE_NAME = "plugin.json";
