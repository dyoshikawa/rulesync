import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod/mini";

import type { SourceEntry } from "../../config/config.js";
import { formatError } from "../../utils/error.js";
import type { Logger } from "../../utils/logger.js";
import { parseSource } from "../source-parser.js";

const execFileAsync = promisify(execFile);

export type GhInstallOptions = {
  update?: boolean;
  frozen?: boolean;
  token?: string;
};

export type GhInstallResult = {
  sourcesProcessed: number;
  failedSourceCount: number;
};

export function validateGhOptions(options: GhInstallOptions): void {
  if (options.frozen) {
    throw new Error(
      "--frozen is not supported in gh mode: GitHub CLI does not provide a frozen install. Use an explicit full commit SHA in source.ref for a fixed installation, or --mode rulesync for lockfile-based installs.",
    );
  }
  if (options.update) {
    throw new Error(
      "--update is not supported in gh mode. Use 'gh skill update --all' (optionally with --dir) for GitHub CLI's update policy, or 'rulesync install --mode gh' to reinstall the declared refs.",
    );
  }
}

/** GitHub CLI owns installation, provenance, and installed-skill state. */
export async function installGh(params: {
  projectRoot: string;
  sources: SourceEntry[];
  options?: GhInstallOptions;
  logger: Logger;
}): Promise<GhInstallResult> {
  const { projectRoot, sources, options = {}, logger } = params;
  validateGhOptions(options);
  const resolved = sources.map(resolveGhSource);
  if (resolved.length === 0) return { sourcesProcessed: 0, failedSourceCount: 0 };

  const runGh = async (args: string[]): Promise<string> => {
    try {
      const { stdout, stderr } = await execFileAsync("gh", args, {
        cwd: projectRoot,
        env: {
          ...process.env,
          GH_PROMPT_DISABLED: "1",
          ...(options.token ? { GH_TOKEN: options.token } : {}),
        },
        maxBuffer: 16 * 1024 * 1024,
      });
      if (stderr.trim()) logger.info(stderr.trim());
      return stdout;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error("--mode gh requires GitHub CLI on PATH with 'gh skill install' support.", {
          cause: error,
        });
      }
      throw error;
    }
  };

  // Fail before installing anything when gh is missing or predates gh skill.
  await runGh(["skill", "install", "--help"]);
  let failedSourceCount = 0;
  for (const source of resolved) {
    try {
      let skills = source.entry.skills;
      if ((!skills || skills.length === 0) && source.ref) {
        // gh --all cannot be combined with skill@ref. Preserve the existing
        // root skills/* selection at an explicit ref, then let gh install it.
        const output = await runGh([
          "api",
          "--hostname",
          "github.com",
          `repos/${source.owner}/${source.repo}/git/trees/${encodeURIComponent(source.ref)}?recursive=1`,
        ]);
        const tree = z
          .object({
            truncated: z.boolean(),
            tree: z.array(z.object({ path: z.string(), type: z.string() })),
          })
          .parse(JSON.parse(output));
        if (tree.truncated)
          throw new Error("Repository tree is truncated; declare explicit skills.");
        skills = tree.tree
          .filter((item) => item.type === "blob" && /^skills\/[^/]+\/SKILL\.md$/.test(item.path))
          .map((item) => item.path);
        if (skills.length === 0)
          throw new Error("No skills/<name>/SKILL.md found at the declared ref.");
      }
      const selections = skills?.length ? skills : [undefined];
      for (const skill of selections) {
        const stdout = await runGh([
          "skill",
          "install",
          "--agent",
          source.agent,
          "--scope",
          source.entry.scope ?? "project",
          "--force",
          ...(skill ? [] : ["--all"]),
          "--",
          `https://github.com/${source.owner}/${source.repo}`,
          ...(skill ? [source.ref ? `${skill}@${source.ref}` : skill] : []),
        ]);
        if (stdout.trim()) logger.info(stdout.trim());
      }
    } catch (error) {
      failedSourceCount++;
      logger.warn(`Failed to install gh source "${source.entry.source}": ${formatError(error)}`);
    }
  }
  return { sourcesProcessed: sources.length, failedSourceCount };
}

function resolveGhSource(entry: SourceEntry) {
  if (entry.skills?.some((skill) => !skill.trim())) {
    throw new Error('--mode gh: field "skills" must not contain empty selectors.');
  }
  const parsed = parseSource(entry.source);
  if (parsed.provider !== "github") {
    throw new Error(`--mode gh only supports GitHub sources: "${entry.source}".`);
  }
  if (entry.transport !== undefined && entry.transport !== "github") {
    throw new Error('--mode gh: field "transport" is not supported. Use --mode rulesync.');
  }
  for (const field of ["path", "rules", "rulesPath"] as const) {
    if (entry[field] !== undefined || (field === "path" && parsed.path !== undefined)) {
      throw new Error(`--mode gh: field "${field}" is not supported. Use --mode rulesync.`);
    }
  }
  return {
    ...parsed,
    entry,
    ref: entry.ref ?? parsed.ref,
    // Retain the old Rulesync spelling while using GitHub CLI's agent ID.
    agent: entry.agent === "gemini" ? "gemini-cli" : (entry.agent ?? "github-copilot"),
  };
}
