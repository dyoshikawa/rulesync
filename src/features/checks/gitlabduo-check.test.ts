import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { writeFileContent } from "../../utils/file.js";
import { loadYaml } from "../../utils/yaml.js";
import { GitlabduoCheck } from "./gitlabduo-check.js";
import { RulesyncCheck } from "./rulesync-check.js";

const INSTRUCTIONS_PATH = join(".gitlab", "duo", "mr-review-instructions.yaml");

function createCheck({
  name,
  body = "Flag N+1 queries.",
  frontmatter = {},
}: {
  name: string;
  body?: string;
  frontmatter?: Record<string, unknown>;
}) {
  return new RulesyncCheck({
    relativeDirPath: ".rulesync/checks",
    relativeFilePath: `${name}.md`,
    frontmatter: { targets: ["*"], ...frontmatter },
    body,
  });
}

describe("GitlabduoCheck", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it("writes one instruction group per check, dropping severity", async () => {
    const [file] = await GitlabduoCheck.fromRulesyncChecks({
      outputRoot: testDir,
      relativeDirPath: ".gitlab/duo",
      rulesyncChecks: [
        createCheck({ name: "performance", frontmatter: { severity: "high" } }),
        createCheck({
          name: "ruby",
          body: "Use Ruby style.",
          frontmatter: { gitlabduo: { name: "Ruby Style Guide", fileFilters: ["*.rb"] } },
        }),
      ],
    });

    expect(file?.getRelativePathFromCwd()).toBe(INSTRUCTIONS_PATH);
    expect(loadYaml(file?.getFileContent() ?? "")).toEqual({
      instructions: [
        { name: "performance", instructions: "Flag N+1 queries." },
        { name: "Ruby Style Guide", fileFilters: ["*.rb"], instructions: "Use Ruby style." },
      ],
    });
  });

  it("merges into an existing file, replacing claimed groups and keeping the rest", async () => {
    await writeFileContent(
      join(testDir, INSTRUCTIONS_PATH),
      [
        "instructions:",
        "  - name: Hand Written",
        "    instructions: Keep me.",
        "  - name: performance",
        "    instructions: Old text.",
        "",
      ].join("\n"),
    );

    const [file] = await GitlabduoCheck.fromRulesyncChecks({
      outputRoot: testDir,
      relativeDirPath: ".gitlab/duo",
      rulesyncChecks: [createCheck({ name: "performance" }), createCheck({ name: "security" })],
    });

    expect(loadYaml(file?.getFileContent() ?? "")).toEqual({
      instructions: [
        { name: "Hand Written", instructions: "Keep me." },
        { name: "performance", instructions: "Flag N+1 queries." },
        { name: "security", instructions: "Flag N+1 queries." },
      ],
    });
    expect(await GitlabduoCheck.canDeleteAuxiliaryFiles({ outputRoot: testDir })).toBe(false);
  });

  it("returns nothing and warns when no check targets GitLab Duo but the file has groups", async () => {
    await writeFileContent(
      join(testDir, INSTRUCTIONS_PATH),
      "instructions:\n  - name: A\n    instructions: B\n",
    );
    const warn = vi.fn();
    const files = await GitlabduoCheck.fromRulesyncChecks({
      outputRoot: testDir,
      relativeDirPath: ".gitlab/duo",
      rulesyncChecks: [],
      logger: { warn } as never,
    });
    expect(files).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("imports each group as a check carrying its name and filters", () => {
    const file = new GitlabduoCheck({
      outputRoot: testDir,
      relativeDirPath: ".gitlab/duo",
      relativeFilePath: "mr-review-instructions.yaml",
      fileContent: [
        "instructions:",
        "  - name: Ruby Style Guide",
        "    fileFilters:",
        "      - '*.rb'",
        "    instructions: |",
        "      Use Ruby style.",
        "  - name: missing instructions",
        "",
      ].join("\n"),
    });

    const checks = file.toRulesyncChecks();
    expect(checks).toHaveLength(1);
    expect(checks[0]?.getRelativeFilePath()).toBe("ruby-style-guide.md");
    expect(checks[0]?.getFrontmatter()).toEqual({
      targets: ["*"],
      gitlabduo: { name: "Ruby Style Guide", fileFilters: ["*.rb"] },
    });
    expect(checks[0]?.getBody()).toBe("Use Ruby style.");
  });
});
