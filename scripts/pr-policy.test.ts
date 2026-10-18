import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

// cspell:ignore noprofile

const workflow = load(
  readFileSync(new URL("../.github/workflows/pr-policy.yml", import.meta.url), "utf8"),
) as {
  jobs: { "check-policy": { steps: { env: Record<string, string>; run: string }[] } };
};
const step = workflow.jobs["check-policy"].steps[0]!;

function runPolicy(env: Record<string, string> = {}) {
  // Execute the workflow's actual shell, but intercept every gh invocation.
  // No token is inherited and no GitHub API requests or comments are made.
  return spawnSync("bash", ["--noprofile", "--norc"], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      GH_REPO: "example/repository",
      PR_NUMBER: "1",
      PR_AUTHOR: "contributor",
      PR_AUTHOR_TYPE: "User",
      AUTHOR_ASSOCIATION: "NONE",
      EVENT_ACTION: "opened",
      TEST_ADDITIONS: "1001",
      TEST_OPEN_PRS: "3",
      ...env,
    },
    input: `
gh() {
  echo "gh $1 $2" >&2
  case "$1 $2" in
    "api "*) echo "$TEST_ADDITIONS" ;;
    "pr list") echo "$TEST_OPEN_PRS" ;;
    "pr comment") return 0 ;;
    *) return 1 ;;
  esac
}
${step.run}`,
  });
}

describe("PR policy workflow", () => {
  it("reads the PR author's account type from the event", () => {
    expect(step.env.PR_AUTHOR_TYPE).toBe("${{ github.event.pull_request.user.type }}");
  });

  it.each(["dependabot[bot]", "renovate[bot]", "another-app[bot]"])(
    "skips bot author %s even when it exceeds both limits",
    (login) => {
      const result = runPolicy({ PR_AUTHOR: login, PR_AUTHOR_TYPE: "Bot" });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Author is a bot");
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain("::warning::");
    },
  );

  it.each(["OWNER", "MEMBER", "COLLABORATOR"])("still skips %s authors", (association) => {
    const result = runPolicy({ AUTHOR_ASSOCIATION: association });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Author is ${association}`);
    expect(result.stderr).toBe("");
  });

  it("still checks both limits for human contributors", () => {
    const result = runPolicy();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PR exceeds the addition line limit");
    expect(result.stdout).toContain("Author has too many open PRs");
    expect(result.stderr.match(/gh pr comment/g)).toHaveLength(2);
  });

  it("does not classify a human by a bot-like login", () => {
    const result = runPolicy({ PR_AUTHOR: "dependabot[bot]", PR_AUTHOR_TYPE: "User" });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("gh api");
    expect(result.stderr).toContain("gh pr list");
  });

  it("does not warn for human contributors at the limits", () => {
    const result = runPolicy({ TEST_ADDITIONS: "1000", TEST_OPEN_PRS: "2" });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("::warning::");
    expect(result.stderr).not.toContain("gh pr comment");
  });
});
