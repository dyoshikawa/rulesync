import { z } from "zod/mini";

import { GitHubClient } from "../lib/github-client.js";
import {
  fetchReleaseNotes,
  parseRepository,
  resolveReleaseNotesFilter,
} from "../lib/release-notes.js";
import {
  type McpCommandResult,
  runCommandForMcp,
  stringifyResult,
  withGitHubAuthHint,
} from "./command-runner.js";

/**
 * Schema for release-notes options
 * Excluded parameters:
 * - token: Secrets stay out of tool arguments; GITHUB_TOKEN / GH_TOKEN from the
 *   environment is used instead
 * - verbose/silent: Meaningless in MCP (no console output)
 */
export const releaseNotesOptionsSchema = z.object({
  source: z.string(),
  latest: z.optional(z.union([z.string(), z.number()])),
  since: z.optional(z.string()),
  until: z.optional(z.string()),
  tag: z.optional(z.string()),
  from: z.optional(z.string()),
  to: z.optional(z.string()),
  includePrereleases: z.optional(z.boolean()),
});

export type ReleaseNotesOptions = z.infer<typeof releaseNotesOptionsSchema>;

/**
 * Execute the rulesync release-notes command via MCP. `result.releases` holds
 * the matching releases (tag, name, date, URL and Markdown body).
 */
export async function executeReleaseNotes(options: ReleaseNotesOptions): Promise<McpCommandResult> {
  return await runCommandForMcp({
    run: async (logger) => {
      if (!options.source) {
        throw new Error("source is required.");
      }
      const { source, latest, ...filterOptions } = options;
      const { owner, repo } = parseRepository(source);
      const filter = resolveReleaseNotesFilter({
        ...filterOptions,
        latest: latest === undefined ? undefined : String(latest),
      });
      const client = new GitHubClient({ token: GitHubClient.resolveToken() });
      let releases;
      try {
        releases = await fetchReleaseNotes({
          client,
          owner,
          repo,
          filter,
          includePrereleases: filterOptions.includePrereleases,
        });
      } catch (error) {
        throw withGitHubAuthHint(error);
      }
      if (releases.length === 0) {
        logger.warn(`No releases found for ${owner}/${repo}.`);
      }
      return {
        repository: `${owner}/${repo}`,
        filter,
        releases,
        totalReleases: releases.length,
      };
    },
  });
}

export const releaseNotesTools = {
  executeReleaseNotes: {
    name: "executeReleaseNotes",
    description:
      "Execute the rulesync release-notes command to read GitHub release notes for a repository ('owner/repo'). Uses GITHUB_TOKEN / GH_TOKEN from the environment when set.",
    parameters: releaseNotesOptionsSchema,
    execute: async (options: ReleaseNotesOptions): Promise<string> =>
      stringifyResult(await executeReleaseNotes(options)),
  },
};
