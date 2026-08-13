import { GitHubClient, GitHubClientError } from "../../lib/github-client.js";
import {
  fetchReleaseNotes,
  formatReleaseNotesMarkdown,
  parseRepository,
  type ReleaseNotesOptions,
  resolveReleaseNotesFilter,
} from "../../lib/release-notes.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import type { Logger } from "../../utils/logger.js";

export type ReleaseNotesCommandOptions = ReleaseNotesOptions & {
  source: string;
  token?: string;
};

/**
 * The rendered Markdown is the command's product (piped to other tools, read
 * by agents), so it is written directly rather than through the logger, whose
 * output is suppressed under --silent and in test environments.
 */
function printMarkdown(markdown: string): void {
  process.stdout.write(markdown);
}

/**
 * `rulesync release-notes <owner>/<repo>` — print GitHub release notes.
 */
export async function releaseNotesCommand(
  logger: Logger,
  options: ReleaseNotesCommandOptions,
): Promise<void> {
  const { source, token, ...filterOptions } = options;
  const { owner, repo } = parseRepository(source);
  const filter = resolveReleaseNotesFilter(filterOptions);

  logger.debug(`Fetching release notes for ${owner}/${repo} (${filter.kind})...`);

  const client = new GitHubClient({ token: GitHubClient.resolveToken(token) });

  try {
    const releases = await fetchReleaseNotes({
      client,
      owner,
      repo,
      filter,
      includePrereleases: filterOptions.includePrereleases,
    });

    if (logger.jsonMode) {
      logger.captureData("repository", `${owner}/${repo}`);
      logger.captureData("filter", filter);
      logger.captureData("releases", releases);
      logger.captureData("totalReleases", releases.length);
    }

    if (releases.length === 0) {
      logger.warn(`No releases found for ${owner}/${repo}.`);
      return;
    }

    if (!logger.jsonMode) {
      printMarkdown(formatReleaseNotesMarkdown({ owner, repo, releases }));
    }
    logger.debug(`Printed ${releases.length} release(s).`);
  } catch (error) {
    if (error instanceof GitHubClientError) {
      const authHint =
        error.statusCode === 401 || error.statusCode === 403
          ? " Tip: Set GITHUB_TOKEN or GH_TOKEN environment variable, or use `GITHUB_TOKEN=$(gh auth token) rulesync release-notes ...`"
          : "";
      throw new CLIError(
        `GitHub API Error: ${error.message}.${authHint}`,
        ErrorCodes.RELEASE_NOTES_FAILED,
      );
    }
    throw error;
  }
}
