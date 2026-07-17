import { createHash } from "node:crypto";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH,
} from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { buildTarball } from "../../test-utils/tar-fixture.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { fileExists, readFileContent, writeFileContent } from "../../utils/file.js";
import { installCommand } from "./install.js";

// Obviously-fake placeholder token for tests (never a real credential).
const FAKE_TOKEN = "artifactory-test-token-placeholder";

const REGISTRY_URL = "https://acme.jfrog.io/artifactory/api/npm/npm-local";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tarballResponse(tarball: Buffer): Response {
  return new Response(new Uint8Array(tarball), {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  });
}

function sriOf(tarball: Buffer): string {
  return `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
}

// Mock only the network boundary (global fetch). Everything else (config
// loader, npm lockfile read/write, tar extraction, filesystem deployment)
// runs for real against a temp directory — this is the happy-path E2E for
// the EXPERIMENTAL npm transport.
describe("installCommand with npm-transport sources (happy path)", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;
  let fetchMock: ReturnType<typeof vi.fn>;
  const logger = createMockLogger();

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("installs skills from a private registry package and writes the npm lockfile", async () => {
    vi.stubEnv("ACME_REGISTRY_TOKEN", FAKE_TOKEN);
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [
    {
      "source": "@acme/skill-package",
      "transport": "npm",
      "registry": "${REGISTRY_URL}",
      "tokenEnv": "ACME_REGISTRY_TOKEN"
    }
  ]
}
`,
    );

    const tarball = buildTarball([
      { name: "package/package.json", content: '{"name":"@acme/skill-package"}' },
      { name: "package/skills/git-commit/SKILL.md", content: "# Git Commit Skill\n" },
      { name: "package/skills/git-commit/references/notes.md", content: "notes\n" },
      { name: "package/skills/release/SKILL.md", content: "# Release Skill\n" },
    ]);
    const tarballUrl = `${REGISTRY_URL}/@acme/skill-package/-/skill-package-1.2.3.tgz`;
    const packument = {
      name: "@acme/skill-package",
      "dist-tags": { latest: "1.2.3" },
      versions: {
        "1.2.3": { dist: { tarball: tarballUrl, integrity: sriOf(tarball) } },
      },
    };

    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${REGISTRY_URL}/@acme%2Fskill-package`) return jsonResponse(packument);
      if (url === tarballUrl) return tarballResponse(tarball);
      return new Response("not found", { status: 404 });
    });

    await installCommand(logger, {});

    // Both request types carry the bearer token from tokenEnv.
    const packumentCall = fetchMock.mock.calls.find(
      (call) => call[0] === `${REGISTRY_URL}/@acme%2Fskill-package`,
    );
    expect(packumentCall?.[1]?.headers).toMatchObject({
      Accept: "application/vnd.npm.install-v1+json",
      Authorization: `Bearer ${FAKE_TOKEN}`,
    });
    const tarballCall = fetchMock.mock.calls.find((call) => call[0] === tarballUrl);
    expect(tarballCall?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${FAKE_TOKEN}`,
    });

    // Skills are deployed into the curated directory.
    const curatedDir = join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
    expect(await readFileContent(join(curatedDir, "git-commit", "SKILL.md"))).toBe(
      "# Git Commit Skill\n",
    );
    expect(await readFileContent(join(curatedDir, "git-commit", "references", "notes.md"))).toBe(
      "notes\n",
    );
    expect(await readFileContent(join(curatedDir, "release", "SKILL.md"))).toBe(
      "# Release Skill\n",
    );

    // The npm lockfile pins the resolved version and tarball integrity.
    const lockPath = join(testDir, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH);
    const lock = JSON.parse(await readFileContent(lockPath));
    expect(lock.lockfileVersion).toBe(1);
    expect(lock.sources["@acme/skill-package"]).toMatchObject({
      registry: REGISTRY_URL,
      requestedVersion: "latest",
      resolvedVersion: "1.2.3",
      integrity: sriOf(tarball),
    });
    expect(Object.keys(lock.sources["@acme/skill-package"].skills).toSorted()).toEqual([
      "git-commit",
      "release",
    ]);

    // The main sources lockfile is not created for npm-only sources.
    expect(await fileExists(join(testDir, "rulesync.lock"))).toBe(false);

    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining("2 skill(s)"));
  });

  it("installs a single-skill package with SKILL.md at the package root", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [
    { "source": "@acme/my-skill", "transport": "npm", "registry": "${REGISTRY_URL}" }
  ]
}
`,
    );

    const tarball = buildTarball([
      { name: "package/package.json", content: '{"name":"@acme/my-skill"}' },
      { name: "package/SKILL.md", content: "# Root Skill\n" },
    ]);
    const tarballUrl = `${REGISTRY_URL}/@acme/my-skill/-/my-skill-2.0.0.tgz`;
    const packument = {
      "dist-tags": { latest: "2.0.0" },
      versions: { "2.0.0": { dist: { tarball: tarballUrl, integrity: sriOf(tarball) } } },
    };

    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${REGISTRY_URL}/@acme%2Fmy-skill`) return jsonResponse(packument);
      if (url === tarballUrl) return tarballResponse(tarball);
      return new Response("not found", { status: 404 });
    });

    await installCommand(logger, {});

    // The skill is named after the package base name (scope stripped).
    const curatedDir = join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
    expect(await readFileContent(join(curatedDir, "my-skill", "SKILL.md"))).toBe("# Root Skill\n");
  });

  it("skips re-fetching when the lockfile and curated skills are up to date", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [
    { "source": "acme-skills", "transport": "npm", "registry": "${REGISTRY_URL}" }
  ]
}
`,
    );

    const tarball = buildTarball([
      { name: "package/skills/git-commit/SKILL.md", content: "# Git Commit Skill\n" },
    ]);
    const tarballUrl = `${REGISTRY_URL}/acme-skills/-/acme-skills-1.0.0.tgz`;
    const packument = {
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { dist: { tarball: tarballUrl, integrity: sriOf(tarball) } } },
    };
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${REGISTRY_URL}/acme-skills`) return jsonResponse(packument);
      if (url === tarballUrl) return tarballResponse(tarball);
      return new Response("not found", { status: 404 });
    });

    await installCommand(logger, {});
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second run: locked version + files on disk → no network at all.
    fetchMock.mockClear();
    await installCommand(logger, {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails a frozen install when the npm lockfile is missing", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [
    { "source": "acme-skills", "transport": "npm", "registry": "${REGISTRY_URL}" }
  ]
}
`,
    );

    await expect(installCommand(logger, { frozen: true })).rejects.toThrow(
      /lockfile is missing entries for: acme-skills/,
    );
  });

  it("refuses a tampered tarball and installs nothing", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [
    { "source": "acme-skills", "transport": "npm", "registry": "${REGISTRY_URL}" }
  ]
}
`,
    );

    const tarball = buildTarball([
      { name: "package/skills/git-commit/SKILL.md", content: "# Tampered\n" },
    ]);
    const tarballUrl = `${REGISTRY_URL}/acme-skills/-/acme-skills-1.0.0.tgz`;
    const packument = {
      "dist-tags": { latest: "1.0.0" },
      versions: {
        "1.0.0": {
          dist: {
            // Integrity of different content — simulates a swapped tarball.
            tarball: tarballUrl,
            integrity: `sha512-${createHash("sha512").update("other-bytes").digest("base64")}`,
          },
        },
      },
    };
    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${REGISTRY_URL}/acme-skills`) return jsonResponse(packument);
      if (url === tarballUrl) return tarballResponse(tarball);
      return new Response("not found", { status: 404 });
    });

    await installCommand(logger, {});

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Integrity verification failed"),
    );
    const curatedDir = join(testDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
    expect(await fileExists(join(curatedDir, "git-commit"))).toBe(false);
    expect(await fileExists(join(testDir, RULESYNC_NPM_SOURCES_LOCK_RELATIVE_FILE_PATH))).toBe(
      false,
    );
  });

  it("logs an auth hint when the registry rejects the request", async () => {
    await writeFileContent(
      join(testDir, "rulesync.jsonc"),
      `{
  "targets": ["claudecode"],
  "features": ["skills"],
  "sources": [
    { "source": "acme-skills", "transport": "npm", "registry": "${REGISTRY_URL}" }
  ]
}
`,
    );
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));

    await installCommand(logger, {});

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("HTTP 401"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("NPM_TOKEN"));
  });
});
