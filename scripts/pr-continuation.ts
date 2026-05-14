// oxlint-disable no-console

import { simpleGit, type SimpleGit } from "simple-git";

import { formatError } from "../src/utils/error.js";

const PR_URL_REGEX = /\/pull\/(\d+)(?:\/|$)/;

function parsePrNumber(input: string): number {
  const trimmed = input.trim();

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const match = trimmed.match(PR_URL_REGEX);
  if (match?.[1]) {
    return Number.parseInt(match[1], 10);
  }

  throw new Error(
    `Invalid PR identifier: "${input}". Expected a PR number (e.g. 123) or a GitHub PR URL (e.g. https://github.com/owner/repo/pull/123).`,
  );
}

async function continuePr({ git, prNumber }: { git: SimpleGit; prNumber: number }): Promise<void> {
  const branch = `continuation/pr-${prNumber}`;
  const refspec = `pull/${prNumber}/head:${branch}`;

  console.log(`Fetching ${refspec} from origin...`);
  await git.fetch("origin", refspec);

  console.log(`Switching to ${branch}...`);
  await git.raw(["switch", branch]);

  console.log(`Pushing ${branch} to origin...`);
  await git.push(["-u", "origin", branch]);

  console.log(`Done. Branch ${branch} is ready for continuation.`);
}

async function main(): Promise<void> {
  const [, , rawInput] = process.argv;
  if (!rawInput) {
    throw new Error("Missing argument. Usage: tsx scripts/pr-continuation.ts <pr-number-or-url>");
  }

  const prNumber = parsePrNumber(rawInput);
  const git = simpleGit();
  await continuePr({ git, prNumber });
}

main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exit(1);
});
