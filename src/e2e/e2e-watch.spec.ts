import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../constants/rulesync-paths.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import { rulesyncArgs, rulesyncCmd, useTestDirectory } from "./e2e-helper.js";

const WAIT_TIMEOUT_MS = 30000;

function buildRuleContent(body: string): string {
  return `---
root: true
targets: ["*"]
description: "Watch mode rule"
globs: ["**/*"]
---

# Watch Mode Rule

${body}
`;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { message }: { message: string },
): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.on("close", (code) => {
      resolve(code);
    });
  });
}

describe("E2E: generate --watch", () => {
  const { getTestDir } = useTestDirectory();

  it("regenerates when a rule file changes and stops cleanly on SIGINT", async () => {
    const testDir = getTestDir();
    const rulePath = join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME);
    const outputPath = join(testDir, "CLAUDE.md");

    await writeFileContent(rulePath, buildRuleContent("Initial body."));

    let output = "";
    const child = spawn(
      rulesyncCmd,
      [...rulesyncArgs, "generate", "--watch", "--targets", "claudecode", "--features", "rules"],
      { cwd: testDir, env: { ...process.env, NODE_ENV: "e2e" } },
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    try {
      await waitFor(() => output.includes("Watching for changes"), {
        message: `the watcher to start. Output so far:\n${output}`,
      });

      expect(await fileExists(outputPath)).toBe(true);
      expect(await readFileContent(outputPath)).toContain("Initial body.");

      await writeFileContent(rulePath, buildRuleContent("Updated body."));

      await waitFor(async () => (await readFileContent(outputPath)).includes("Updated body."), {
        message: `the regenerated output. Output so far:\n${output}`,
      });

      expect(output).toContain("Change detected");
    } finally {
      child.kill("SIGINT");
    }

    const exitCode = await waitForExit(child);

    // Windows has no signal delivery: `child.kill("SIGINT")` terminates the
    // process outright, so the handler never runs and the exit code is null.
    // A real Ctrl+C in a Windows console still reaches Node as SIGINT, which
    // is the path the graceful-shutdown handler exists for; only this
    // programmatic kill cannot exercise it.
    if (process.platform === "win32") {
      expect(exitCode).toBeNull();
    } else {
      expect(exitCode).toBe(0);
      expect(output).toContain("Stopped watching.");
    }
  });

  it("rejects --watch combined with --check", async () => {
    const testDir = getTestDir();
    await writeFileContent(
      join(testDir, RULESYNC_RULES_RELATIVE_DIR_PATH, RULESYNC_OVERVIEW_FILE_NAME),
      buildRuleContent("Initial body."),
    );

    let output = "";
    const child = spawn(
      rulesyncCmd,
      [
        ...rulesyncArgs,
        "generate",
        "--watch",
        "--check",
        "--targets",
        "claudecode",
        "--features",
        "rules",
      ],
      { cwd: testDir, env: { ...process.env, NODE_ENV: "e2e" } },
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    const exitCode = await waitForExit(child);

    expect(exitCode).toBe(1);
    expect(output).toContain("--watch cannot be combined with --check");
  });
});
