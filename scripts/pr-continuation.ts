// oxlint-disable no-console

// Maintainer helper: continue work on a contributor's PR from a fork.
//
// PREREQUISITE: The final step calls `git gtr new`, which is NOT a Git
// built-in. It resolves to `git-gtr`, the binary shipped by
// dyoshikawa/git-worktree-runner, and must be available on PATH. If it is
// missing, the script will fail at the last step with
// `git: 'gtr' is not a git command`.
//
// SECURITY NOTE: Pushing a contributor's commits to a branch on this repo
// turns those commits into in-repo, "trusted" code from the GitHub Actions
// perspective. Same-repo `push` / `pull_request` events expose a wider
// `GITHUB_TOKEN` permission set (and any workflow `secrets.*`) than fork PRs
// receive. Before running this script against a fork PR, review the PR diff
// for any change that could be weaponized once the code runs as an in-repo
// branch:
//   - `.github/workflows/**`     (workflow definitions, triggers, permissions)
//   - `.github/actions/**`       (composite / local actions)
//   - `package.json` fields:     `scripts` (postinstall / prepare /
//                                prepublishOnly / etc.), `trustedDependencies`,
//                                `simple-git-hooks`
//   - `pnpm-workspace.yaml`      (`allowBuilds` entries — re-enabling a
//                                postinstall opens a code-execution path)
//   - `vitest.config.*`, `tsdown.config.*`, `eslint.config.*`, `scripts/**`
//   - Test files that import/execute shell commands or write to the filesystem
// When in doubt, check out the PR locally in a sandbox first and inspect what
// runs during `pnpm install`, `pnpm test`, and `pnpm build`.

import { simpleGit, type SimpleGit } from "simple-git";

import { formatError } from "../src/utils/error.js";

const PR_URL_REGEX = /\/pull\/(\d+)(?:[/?#]|$)/;
const NUMERIC_REGEX = /^[1-9]\d*$/;

export type CliArgs = {
  prInput: string;
  remote: string;
  dryRun: boolean;
};

export function parseArgs(argv: readonly string[]): CliArgs {
  let prInput: string | undefined;
  let remote = "origin";
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--remote") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--remote requires a value (e.g. --remote upstream).");
      }
      remote = value;
      i++;
      continue;
    }
    if (arg?.startsWith("--remote=")) {
      remote = arg.slice("--remote=".length);
      if (!remote) {
        throw new Error("--remote requires a value (e.g. --remote=upstream).");
      }
      continue;
    }
    if (arg?.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    if (prInput !== undefined) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
    prInput = arg;
  }

  if (!prInput) {
    throw new Error(
      "Missing PR identifier. Usage: pnpm pr-continuation <pr-number-or-url> [--remote <name>] [--dry-run]",
    );
  }

  return { prInput, remote, dryRun };
}

export function parsePrNumber(input: string): number {
  const trimmed = input.trim();

  if (NUMERIC_REGEX.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const match = trimmed.match(PR_URL_REGEX);
  if (match?.[1]) {
    const value = Number.parseInt(match[1], 10);
    if (value > 0) {
      return value;
    }
  }

  throw new Error(
    `Invalid PR identifier: "${input}". Expected a positive PR number (e.g. 123) or a GitHub PR URL (e.g. https://github.com/owner/repo/pull/123).`,
  );
}

async function assertBranchAbsent({
  git,
  branch,
}: {
  git: SimpleGit;
  branch: string;
}): Promise<void> {
  const branches = await git.branchLocal();
  if (branches.all.includes(branch)) {
    throw new Error(
      `Local branch "${branch}" already exists. Delete it first (git branch -D ${branch}) or check it out manually if you want to resume work on it.`,
    );
  }
}

async function continuePr({
  git,
  prNumber,
  remote,
  dryRun,
}: {
  git: SimpleGit;
  prNumber: number;
  remote: string;
  dryRun: boolean;
}): Promise<void> {
  const branch = `continuation/pr-${prNumber}`;
  const refspec = `pull/${prNumber}/head:${branch}`;

  if (dryRun) {
    console.log("[dry-run] Would run:");
    console.log(`  git fetch ${remote} ${refspec}`);
    console.log(`  git push -u ${remote} ${branch}:${branch}`);
    console.log(`  git gtr new ${branch} --yes`);
    return;
  }

  await assertBranchAbsent({ git, branch });

  console.log(`Fetching ${refspec} from ${remote}...`);
  await git.fetch(remote, refspec);

  console.log(`Pushing ${branch} to ${remote}...`);
  await git.raw(["push", "-u", remote, `${branch}:${branch}`]);

  console.log(`Creating worktree for ${branch} via git gtr new...`);
  await git.raw(["gtr", "new", branch, "--yes"]);

  console.log(`Done. Worktree for ${branch} is ready.`);
}

async function main(): Promise<void> {
  const { prInput, remote, dryRun } = parseArgs(process.argv.slice(2));
  const prNumber = parsePrNumber(prInput);
  const git = simpleGit();
  await continuePr({ git, prNumber, remote, dryRun });
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error: unknown) => {
    console.error(formatError(error));
    process.exit(1);
  });
}
