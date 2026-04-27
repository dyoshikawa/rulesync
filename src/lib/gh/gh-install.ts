import { createHash } from "node:crypto";
import { basename, join, posix } from "node:path";

import { Semaphore } from "es-toolkit/promise";

import type { SourceEntry } from "../../config/config.js";
import { FETCH_CONCURRENCY_LIMIT, MAX_FILE_SIZE } from "../../constants/rulesync-paths.js";
import { formatError } from "../../utils/error.js";
import {
  checkPathTraversal,
  getHomeDirectory,
  removeFile,
  toPosixPath,
  writeFileContent,
} from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { GitHubClient, GitHubClientError, logGitHubAuthHints } from "../github-client.js";
import { listDirectoryRecursive, withSemaphore } from "../github-utils.js";
import { parseSource } from "../source-parser.js";
import { injectSourceMetadata } from "./gh-frontmatter.js";
import {
  createEmptyGhLock,
  findGhLockInstallation,
  type GhLock,
  type GhLockInstallation,
  readGhLock,
  RULESYNC_CONTENT_HASH_REGEX,
  writeGhLock,
} from "./gh-lock.js";
import { type GhAgent, GH_AGENTS, type GhScope, relativeInstallDirFor } from "./gh-paths.js";

const SKILLS_REMOTE_DIR = "skills";
const SKILL_FILE_NAME = "SKILL.md";

export type GhInstallOptions = {
  /** Force re-resolve all refs, ignoring the lockfile. */
  update?: boolean;
  /** Fail if the lockfile is missing or out of sync (for CI). */
  frozen?: boolean;
  /** GitHub token for private repositories. */
  token?: string;
};

export type GhInstallResult = {
  sourcesProcessed: number;
  installedSkillCount: number;
  failedSourceCount: number;
};

type ResolvedSource = {
  entry: SourceEntry;
  owner: string;
  repo: string;
  ref?: string;
  agent: GhAgent;
  scope: GhScope;
};

type DeployedFile = {
  /** Relative POSIX path under the install dir's scope root. Recorded in the lockfile. */
  relativeToScopeRoot: string;
  /** Absolute on-disk path where the bytes are written. */
  absolutePath: string;
  content: string;
};

type SkillInstallation = {
  installation: GhLockInstallation;
  deployed: DeployedFile[];
};

/**
 * Entry point for `rulesync install --mode gh`. Reads `sources` from
 * `rulesync.jsonc`, resolves each one against the GitHub API, and deploys
 * each discovered `skills/<name>/` tree under the agent-specific install
 * directory recorded by `resolveGhInstallDir`. Updates `rulesync-gh.lock.yaml`
 * to pin commits and per-skill content hashes.
 */
export async function installGh(params: {
  projectRoot: string;
  sources: SourceEntry[];
  options?: GhInstallOptions;
  logger: Logger;
}): Promise<GhInstallResult> {
  const { projectRoot, sources, options = {}, logger } = params;

  if (sources.length === 0) {
    return { sourcesProcessed: 0, installedSkillCount: 0, failedSourceCount: 0 };
  }

  // Pre-resolve every source's owner/repo + agent/scope defaults so the
  // frozen-mode coverage check below has a stable view of what installations
  // are required. We do not contact the API yet — that happens per-source.
  const resolvedSources: ResolvedSource[] = sources.map((entry) => {
    const parsed = parseSource(entry.source);
    if (parsed.provider !== "github") {
      throw new Error(
        `--mode gh only supports GitHub sources. "${entry.source}" resolves to provider "${parsed.provider}".`,
      );
    }
    // gh mode does not honor `transport` or `path` from the SourceEntry —
    // both are rulesync-mode-only concepts. Silently dropping them would
    // surprise users migrating from --mode rulesync, so reject up-front
    // with a message that names the offending field.
    if (entry.transport !== undefined && entry.transport !== "github") {
      throw new Error(
        `--mode gh: field "transport" is not supported (got "${entry.transport}" for source "${entry.source}"). Drop the field or switch to --mode rulesync.`,
      );
    }
    if (entry.path !== undefined) {
      throw new Error(
        `--mode gh: field "path" is not supported for source "${entry.source}". The remote layout is fixed to "skills/<name>/SKILL.md".`,
      );
    }
    const agent = entry.agent ?? "github-copilot";
    if (!GH_AGENTS.includes(agent)) {
      throw new Error(
        `--mode gh: unknown agent "${agent}" for source "${entry.source}". Valid agents: ${GH_AGENTS.join(", ")}.`,
      );
    }
    const scope: GhScope = entry.scope ?? "project";
    return {
      entry,
      owner: parsed.owner,
      repo: parsed.repo,
      ref: entry.ref ?? parsed.ref,
      agent,
      scope,
    };
  });

  const existingLock = await readGhLock(projectRoot);
  const frozen = options.frozen ?? false;
  const update = options.update ?? false;

  if (frozen && !existingLock) {
    throw new Error(
      "Frozen install failed: rulesync-gh.lock.yaml is missing. Run 'rulesync install --mode gh' to create it.",
    );
  }

  // Frozen mode: per-source coverage check. A brand-new source (no
  // installations at all in the lock) must fail before we contact the
  // GitHub API — both to save quota and to prevent in-flight Promise.all
  // siblings from writing files when another source is going to throw.
  // Per-skill coverage (when entry.skills lists names that ARE absent from
  // the lock) is still enforced lazily inside installSource, since that
  // requires API discovery to know which skills exist remotely.
  if (frozen && existingLock) {
    const uncovered: string[] = [];
    for (const rs of resolvedSources) {
      const hasAny = existingLock.installations.some(
        (i) =>
          i.source.toLowerCase() === rs.entry.source.toLowerCase() &&
          i.agent === rs.agent &&
          i.scope === rs.scope,
      );
      if (!hasAny) {
        uncovered.push(`${rs.entry.source} (agent=${rs.agent}, scope=${rs.scope})`);
      }
    }
    if (uncovered.length > 0) {
      throw new Error(
        `Frozen install failed: rulesync-gh.lock.yaml is missing entries for: ${uncovered.join(", ")}. Run 'rulesync install --mode gh' to update the lockfile.`,
      );
    }

    // Detect manifest drift on `ref`: when the user edited `ref` in
    // rulesync.jsonc without re-running install, refuse rather than
    // silently install the locked SHA against a different declared ref.
    const drifted: string[] = [];
    for (const rs of resolvedSources) {
      if (!rs.ref) continue;
      const matches = existingLock.installations.filter(
        (i) => i.source.toLowerCase() === rs.entry.source.toLowerCase(),
      );
      for (const m of matches) {
        if (m.requested_ref !== undefined && m.requested_ref !== rs.ref) {
          drifted.push(`${rs.entry.source} (manifest=${rs.ref}, lock=${m.requested_ref})`);
          break;
        }
      }
    }
    if (drifted.length > 0) {
      throw new Error(
        `Frozen install failed: manifest ref does not match rulesync-gh.lock.yaml for: ${drifted.join(", ")}. Run 'rulesync install --mode gh' to update the lockfile.`,
      );
    }
  }

  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });
  const semaphore = new Semaphore(FETCH_CONCURRENCY_LIMIT);

  const newLock: GhLock = createEmptyGhLock({ existingLock });

  type SourceResult =
    | { status: "ok"; installations: SkillInstallation[] }
    | { status: "failed"; preserved: GhLockInstallation[] };

  const runOne = async (rs: ResolvedSource): Promise<SourceResult> => {
    const installations = await installSource({
      rs,
      client,
      semaphore,
      projectRoot,
      existingLock,
      frozen,
      update,
      logger,
    });
    return { status: "ok", installations };
  };

  const results: SourceResult[] = frozen
    ? await Promise.all(resolvedSources.map(runOne))
    : await Promise.all(
        resolvedSources.map(async (rs): Promise<SourceResult> => {
          try {
            return await runOne(rs);
          } catch (error) {
            logger.error(`Failed to install gh source "${rs.entry.source}": ${formatError(error)}`);
            if (error instanceof GitHubClientError) {
              logGitHubAuthHints({ error, logger });
            }
            // Preserve all prior installations for this source so that a
            // transient error does not erase previously pinned commit SHAs.
            const preserved = existingLock
              ? existingLock.installations.filter(
                  (i) => i.source.toLowerCase() === rs.entry.source.toLowerCase(),
                )
              : [];
            return { status: "failed", preserved };
          }
        }),
      );

  // Frozen-mode deferred writes. `installSource` never touches the disk
  // under --frozen — every write lands here, only after Promise.all has
  // resolved successfully for every source. Without this gate, source A
  // could finish writing its bytes before source B's coverage / integrity
  // check throws, leaving the working tree in a partially-frozen state
  // despite the install reporting failure.
  if (frozen) {
    for (const result of results) {
      if (result.status !== "ok") continue;
      for (const inst of result.installations) {
        for (const d of inst.deployed) {
          await writeFileContent(d.absolutePath, d.content);
        }
      }
    }
  }

  let totalInstalled = 0;
  let failedCount = 0;
  for (const result of results) {
    if (result.status === "ok") {
      for (const inst of result.installations) {
        newLock.installations.push(inst.installation);
      }
      totalInstalled += result.installations.length;
    } else {
      failedCount += 1;
      for (const preserved of result.preserved) {
        newLock.installations.push(preserved);
      }
    }
  }

  // Stale-file cleanup. Same hardening shape as apm-install.
  if (existingLock) {
    const newDeployed = new Set<string>();
    for (const inst of newLock.installations) {
      for (const file of inst.deployed_files) {
        // Key by (scope, path) so a file in `<home>/.claude/skills/foo` and a
        // file at `<base>/.claude/skills/foo` are not conflated.
        newDeployed.add(`${inst.scope}::${file}`);
      }
    }
    for (const prev of existingLock.installations) {
      for (const deployed of prev.deployed_files) {
        const key = `${prev.scope}::${deployed}`;
        if (newDeployed.has(key)) continue;
        await removeStaleFile({
          relativePath: deployed,
          scope: prev.scope === "user" ? "user" : "project",
          projectRoot,
          logger,
        });
      }
    }
  }

  if (!frozen) {
    newLock.generated_at = new Date().toISOString();
    await writeGhLock({ projectRoot, lock: newLock });
    if (failedCount === 0) {
      logger.debug("rulesync-gh.lock.yaml updated.");
    } else {
      logger.warn(
        `rulesync-gh.lock.yaml written with partially successful installs (${failedCount} source(s) failed).`,
      );
    }
  }

  return {
    sourcesProcessed: sources.length,
    installedSkillCount: totalInstalled,
    failedSourceCount: failedCount,
  };
}

async function installSource(params: {
  rs: ResolvedSource;
  client: GitHubClient;
  semaphore: Semaphore;
  projectRoot: string;
  existingLock: GhLock | null;
  frozen: boolean;
  update: boolean;
  logger: Logger;
}): Promise<SkillInstallation[]> {
  const { rs, client, semaphore, projectRoot, existingLock, frozen, update, logger } = params;
  const { entry, owner, repo, agent, scope } = rs;
  const sourceKey = entry.source;

  // Resolve the ref. Order:
  //   1. entry.ref (explicit pin)
  //   2. latest release's tag_name
  //   3. default branch (when the repo has no releases)
  let resolvedRef: string;
  let usedTag = false;
  if (rs.ref) {
    resolvedRef = rs.ref;
  } else {
    try {
      const release = await client.getLatestRelease(owner, repo);
      resolvedRef = release.tag_name;
      usedTag = true;
    } catch (error) {
      // gh's behavior: when a repo has no releases, getLatestRelease returns
      // 404. We treat any 404 (real GitHubClientError or any thrown value
      // carrying statusCode 404) as "no releases" and fall back to the
      // default branch. Other errors propagate.
      if (is404(error)) {
        resolvedRef = await client.getDefaultBranch(owner, repo);
      } else {
        throw error;
      }
    }
  }
  const resolvedSha = await client.resolveRefToSha(owner, repo, resolvedRef);
  logger.debug(`Resolved ${sourceKey} -> ref=${resolvedRef} sha=${resolvedSha}`);

  // Discover skills under `skills/`.
  let topLevel: Awaited<ReturnType<GitHubClient["listDirectory"]>>;
  try {
    topLevel = await client.listDirectory(owner, repo, SKILLS_REMOTE_DIR, resolvedSha);
  } catch (error) {
    if (is404(error)) {
      logger.warn(`No skills/ directory found in ${sourceKey}. Skipping.`);
      return [];
    }
    throw error;
  }

  const skillDirs = topLevel
    .filter((e) => e.type === "dir")
    .map((e) => ({ name: e.name, path: e.path }));

  // Discover which subdirectories are actual skills (contain a SKILL.md).
  // Resolved sequentially to avoid hammering the API for large monorepos
  // beyond the FETCH_CONCURRENCY_LIMIT.
  const validatedSkills: Array<{ name: string; path: string }> = [];
  for (const sk of skillDirs) {
    const info = await withSemaphore(semaphore, () =>
      client.getFileInfo(owner, repo, posix.join(sk.path, SKILL_FILE_NAME), resolvedSha),
    );
    if (info) {
      validatedSkills.push(sk);
    }
  }

  // Apply the explicit skill filter when provided.
  let selected = validatedSkills;
  if (entry.skills && entry.skills.length > 0) {
    const requested = new Set(entry.skills);
    selected = validatedSkills.filter((s) => requested.has(s.name));
    const presentNames = new Set(validatedSkills.map((s) => s.name));
    for (const want of entry.skills) {
      if (!presentNames.has(want)) {
        logger.warn(`Requested skill "${want}" not found in ${sourceKey} under skills/. Skipping.`);
      }
    }
  }

  // Frozen-mode coverage check (per-skill). Only enforceable now that we know
  // the requested skill set.
  if (frozen && existingLock) {
    const missing: string[] = [];
    for (const sk of selected) {
      const locked = findGhLockInstallation(existingLock, {
        source: sourceKey,
        agent,
        scope,
        skill: sk.name,
      });
      if (!locked) {
        missing.push(sk.name);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Frozen install failed: rulesync-gh.lock.yaml is missing entries for ${sourceKey} (agent=${agent}, scope=${scope}) skills: ${missing.join(", ")}. Run 'rulesync install --mode gh' to update the lockfile.`,
      );
    }
  }

  const results: SkillInstallation[] = [];
  const installRelDir = relativeInstallDirFor({ agent, scope });
  const scopeRoot = scope === "user" ? getHomeDirectory() : projectRoot;

  // Source URL recorded in injected frontmatter. Mirrors the canonical form
  // used by `gh skill install`.
  const sourceUrl = `https://github.com/${owner}/${repo}`;
  const repository = `${owner}/${repo}`;
  // gh records the *resolved* ref (the tag name when one was used, else the
  // commit SHA) into the SKILL.md frontmatter so the deployed file has a
  // human-readable provenance hint.
  const provenanceRef = usedTag ? resolvedRef : resolvedSha;

  for (const sk of selected) {
    const locked =
      existingLock && !update
        ? findGhLockInstallation(existingLock, {
            source: sourceKey,
            agent,
            scope,
            skill: sk.name,
          })
        : undefined;

    // Recursively list this skill's tree.
    const allFiles = await listDirectoryRecursive({
      client,
      owner,
      repo,
      path: sk.path,
      ref: resolvedSha,
      semaphore,
    });

    const deployed: DeployedFile[] = [];
    for (const file of allFiles) {
      if (file.size > MAX_FILE_SIZE) {
        logger.warn(
          `Skipping "${file.path}" from ${sourceKey}: ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit.`,
        );
        continue;
      }
      // Path of the file relative to the skill directory root upstream.
      const relativeToSkill = posix.relative(sk.path, toPosixPath(file.path));
      if (
        !relativeToSkill ||
        relativeToSkill.startsWith("..") ||
        posix.isAbsolute(relativeToSkill)
      ) {
        logger.warn(`Skipping "${file.path}" from ${sourceKey}: resolved outside of "${sk.path}".`);
        continue;
      }

      // Path under the scope root (relative). This is the value persisted to
      // the lockfile.
      const deployRelative = toPosixPath(join(installRelDir, sk.name, relativeToSkill));
      // Path-traversal hardening rooted at the scope root, then a tighter
      // check rooted at the per-(agent,scope) install dir to refuse anything
      // that escapes the agent-specific deployment directory.
      checkPathTraversal({ relativePath: deployRelative, intendedRootDir: scopeRoot });
      const installAbs = join(scopeRoot, installRelDir);
      const withinInstallDir = toPosixPath(join(sk.name, relativeToSkill));
      checkPathTraversal({ relativePath: withinInstallDir, intendedRootDir: installAbs });

      let content = await withSemaphore(semaphore, () =>
        client.getFileContent(owner, repo, file.path, resolvedSha),
      );
      const byteLength = Buffer.byteLength(content, "utf8");
      if (byteLength > MAX_FILE_SIZE) {
        logger.warn(
          `Skipping "${file.path}" from ${sourceKey}: fetched ${(byteLength / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit.`,
        );
        continue;
      }

      // Inject provenance frontmatter into SKILL.md files. Other files
      // (e.g. supporting markdown, scripts) pass through unchanged.
      if (basename(file.path) === SKILL_FILE_NAME) {
        try {
          content = injectSourceMetadata({
            content,
            source: sourceUrl,
            repository,
            ref: provenanceRef,
          });
        } catch {
          // Frontmatter exists but is not parseable. Fall back to a fresh
          // prepend so we still record provenance — but warn the user.
          logger.warn(
            `Frontmatter in ${file.path} (${sourceKey}) is invalid. Prepending a fresh provenance block.`,
          );
          content = `---\nsource: ${sourceUrl}\nrepository: ${repository}\nref: ${provenanceRef}\n---\n${content}`;
        }
      }

      const absolutePath = join(scopeRoot, deployRelative);
      deployed.push({ relativeToScopeRoot: deployRelative, absolutePath, content });

      if (!frozen) {
        await writeFileContent(absolutePath, content);
      }
    }

    deployed.sort((a, b) =>
      a.relativeToScopeRoot < b.relativeToScopeRoot
        ? -1
        : a.relativeToScopeRoot > b.relativeToScopeRoot
          ? 1
          : 0,
    );
    const deployedFiles = deployed.map((d) => d.relativeToScopeRoot);
    const contentHash = computeContentHash(deployed);

    // Frozen integrity check: refuse to overwrite known-good bytes with
    // tampered ones when the prior content_hash matches the rulesync format.
    if (frozen && locked?.content_hash) {
      if (RULESYNC_CONTENT_HASH_REGEX.test(locked.content_hash)) {
        if (locked.content_hash !== contentHash) {
          throw new Error(
            `content_hash mismatch for ${sourceKey} skill "${sk.name}" (agent=${agent}, scope=${scope}): lock=${locked.content_hash} computed=${contentHash}. Refuse to trust the deployment under --frozen.`,
          );
        }
      } else {
        logger.debug(
          `Skipping content_hash integrity check for ${sourceKey} skill "${sk.name}": recorded hash "${locked.content_hash}" was not written by rulesync.`,
        );
      }
    }

    // Under --frozen we deliberately do NOT write here even after the
    // integrity check passes. Writes are deferred to the top-level installGh
    // so that a sibling source failing its check cannot leave partial bytes
    // on disk from a peer that already passed.
    const installation: GhLockInstallation = {
      source: sourceKey,
      owner,
      repo,
      agent,
      scope,
      skill: sk.name,
      resolved_ref: resolvedRef,
      resolved_commit: resolvedSha,
      install_dir: toPosixPath(installRelDir),
      deployed_files: deployedFiles,
      content_hash: contentHash,
    };
    if (rs.ref !== undefined) {
      installation.requested_ref = rs.ref;
    }
    results.push({ installation, deployed });

    logger.info(
      `Installed gh skill "${sk.name}" from ${sourceKey} (agent=${agent}, scope=${scope}, ref=${resolvedRef})`,
    );
  }

  return results;
}

async function removeStaleFile(params: {
  relativePath: string;
  scope: GhScope;
  projectRoot: string;
  logger: Logger;
}): Promise<void> {
  const { relativePath, scope, projectRoot, logger } = params;
  if (posix.isAbsolute(relativePath) || relativePath.split(/[/\\]/).includes("..")) {
    logger.warn(`Refusing to remove stale gh file with suspicious path: "${relativePath}".`);
    return;
  }
  const scopeRoot = scope === "user" ? getHomeDirectory() : projectRoot;
  try {
    checkPathTraversal({ relativePath, intendedRootDir: scopeRoot });
  } catch {
    logger.warn(`Refusing to remove stale gh file outside ${scope} root: "${relativePath}".`);
    return;
  }
  const absolute = join(scopeRoot, relativePath);
  await removeFile(absolute);
  logger.debug(`Removed stale gh file: ${relativePath}`);
}

/**
 * Detect a 404-like error in a way that tolerates both real `GitHubClientError`
 * instances and any other thrown value that exposes a numeric `statusCode`
 * (e.g. plain Errors raised from a test mock that does not import the real
 * client class).
 */
function is404(error: unknown): boolean {
  if (error instanceof GitHubClientError && error.statusCode === 404) {
    return true;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === 404
  ) {
    return true;
  }
  return false;
}

/**
 * SHA-256 over a canonical, order-independent representation of the deployed
 * files. Identical algorithm to the apm-install hash so users familiar with
 * one mode can read the other.
 */
function computeContentHash(
  files: Array<{ relativeToScopeRoot: string; content: string }>,
): string {
  const hash = createHash("sha256");
  for (const { relativeToScopeRoot, content } of files) {
    hash.update(relativeToScopeRoot);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
