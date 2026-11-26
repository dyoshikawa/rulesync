import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { findFilesByGlobs, toPosixPath, writeFileContent } from "../../utils/file.js";
import { WarningCollectingLogger, withFallbackLoggerTarget } from "../../utils/logger.js";
import { AntigravityCliRule } from "./antigravity-cli-rule.js";
import { AntigravityIdeRule } from "./antigravity-ide-rule.js";
import { AntigravityPluginRule } from "./antigravity-plugin-rule.js";
import { extractAntigravitySubprojectPath } from "./antigravity-rule.js";
import { RulesyncRule, type RulesyncRuleFrontmatter } from "./rulesync-rule.js";

/** The warnings `operation` sends through the shared fallback logger. */
async function collectWarnings(operation: () => void): Promise<string[]> {
  const warnings = new WarningCollectingLogger({ verbose: false, silent: true });
  await withFallbackLoggerTarget({
    logger: warnings,
    operation: async () => {
      operation();
    },
  });
  return warnings.getWarnings();
}

function buildRulesyncRule({
  testDir,
  frontmatter,
  relativeFilePath = "api.md",
}: {
  testDir: string;
  frontmatter: Partial<RulesyncRuleFrontmatter>;
  relativeFilePath?: string;
}): RulesyncRule {
  return new RulesyncRule({
    outputRoot: testDir,
    relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
    relativeFilePath,
    frontmatter: { targets: ["*"], ...frontmatter },
    body: "Rule body",
  });
}

describe("extractAntigravitySubprojectPath", () => {
  it.each([
    [
      join("packages", "api", ".agents", "rules"),
      { subprojectPath: "packages/api", innerDirPath: "" },
    ],
    [
      join("packages", "api", ".agents", "rules", "sub"),
      { subprojectPath: "packages/api", innerDirPath: "sub" },
    ],
  ])("splits %s", (relativeDirPath, expected) => {
    expect(extractAntigravitySubprojectPath(relativeDirPath)).toEqual(expected);
  });

  it.each([
    join(".agents", "rules"),
    ".",
    join("packages", "api"),
    join(".worktrees", "feature", ".agents", "rules"),
  ])("does not treat %s as a nested rules directory", (relativeDirPath) => {
    expect(extractAntigravitySubprojectPath(relativeDirPath)).toBeUndefined();
  });
});

describe.each([
  ["AntigravityIdeRule", AntigravityIdeRule],
  ["AntigravityCliRule", AntigravityCliRule],
] as const)("%s directory-scoped rules", (_name, RuleClass) => {
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

  it("writes a directory-scoped rule to the project-root .agents/rules limited to its subproject", () => {
    const rule = RuleClass.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule({
        testDir,
        frontmatter: { description: "API", agentsmd: { subprojectPath: "packages/api" } },
      }),
    });
    expect(rule.getFilePath()).toBe(join(testDir, ".agents", "rules", "packages-api-api.md"));
    const content = rule.getFileContent();
    expect(content).toContain("trigger: glob");
    expect(content).toContain("globs: '**/packages/api/**'");
    expect(content).not.toContain("always_on");
  });

  it.each([
    [["src/**/*.ts"], "**/packages/api/src/**/*.ts"],
    [["**/*.ts", "*.md"], "**/packages/api/**/*.ts,**/packages/api/*.md"],
    [["./src/*.ts", "!src/gen/**"], "**/packages/api/src/*.ts,!**/packages/api/src/gen/**"],
    // A comma inside a brace group does not split the glob.
    [["src/**/*.{ts,tsx}", "*.md"], "**/packages/api/src/**/*.{ts,tsx},**/packages/api/*.md"],
    // An explicit subproject always prefixes, even a glob starting with its name.
    [["packages/api/**"], "**/packages/api/packages/api/**"],
  ])("prefixes the globs %j with the subproject", (globs, expected) => {
    const rule = RuleClass.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule({
        testDir,
        frontmatter: { globs, agentsmd: { subprojectPath: "packages/api/" } },
      }),
    });
    expect(rule.getFileContent()).toContain("trigger: glob");
    expect(rule.getFileContent()).toContain(expected);
  });

  it.each([
    [{ subprojectPath: "auto" }, ["packages/api/**/*.{ts,tsx}"]],
    [undefined, ["packages/api/**"]],
  ])(
    "only anchors the project-root-relative globs of a subproject derived from them (%j)",
    (agentsmd, globs) => {
      const rule = RuleClass.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: new RulesyncRule({
          outputRoot: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "api.md",
          frontmatter: { targets: ["*"], globs, ...(agentsmd && { agentsmd }) },
          body: "Rule body",
          deriveSubprojectPathFromGlobs: agentsmd === undefined,
        }),
      });
      expect(rule.getFilePath()).toBe(join(testDir, ".agents", "rules", "packages-api-api.md"));
      expect(rule.getFileContent()).toContain(`globs: '**/${globs[0]}'`);
    },
  );

  it("keeps a stored glob trigger and prefixes the stored globs", () => {
    const rule = RuleClass.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule({
        testDir,
        frontmatter: {
          globs: ["**/*"],
          antigravity: { trigger: "glob", globs: ["lib/**"] },
          agentsmd: { subprojectPath: "packages/api" },
        },
      }),
    });
    expect(rule.getFileContent()).toContain("globs: '**/packages/api/lib/**'");
  });

  it.each(["model_decision", "manual"])(
    "keeps a %s trigger, which cannot be limited to the subproject, and warns",
    async (trigger) => {
      let rule: InstanceType<typeof RuleClass> | undefined;
      const warnings = await collectWarnings(() => {
        rule = RuleClass.fromRulesyncRule({
          outputRoot: testDir,
          rulesyncRule: buildRulesyncRule({
            testDir,
            frontmatter: {
              description: "API",
              antigravity: { trigger },
              agentsmd: { subprojectPath: "packages/api" },
            },
          }),
        });
      });
      expect(warnings).toEqual([expect.stringContaining("cannot be limited to that subproject")]);
      if (!rule) throw new Error("rule was not generated");
      expect(rule.getRelativeDirPath()).toBe(join(".agents", "rules"));
      expect(rule.getFileContent()).toContain(`trigger: ${trigger}`);
      expect(rule.getFileContent()).not.toContain("globs:");
    },
  );

  it("keeps an unscoped rule in the project-root .agents/rules", () => {
    const rule = RuleClass.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule({ testDir, frontmatter: {} }),
    });
    expect(rule.getRelativeDirPath()).toBe(join(".agents", "rules"));
  });

  it("never nests the root rule or a global rule", () => {
    const root = RuleClass.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule({
        testDir,
        frontmatter: { root: true, agentsmd: { subprojectPath: "packages/api" } },
      }),
    });
    expect(root.getRelativeDirPath()).toBe(".");
    const global = RuleClass.fromRulesyncRule({
      outputRoot: testDir,
      global: true,
      rulesyncRule: buildRulesyncRule({
        testDir,
        frontmatter: { agentsmd: { subprojectPath: "packages/api" } },
      }),
    });
    expect(global.getRelativeDirPath()).toBe(
      RuleClass.getSettablePaths({ global: true }).nonRoot?.relativeDirPath,
    );
  });

  it("imports a legacy nested rule with its subproject and moves it to the project root", async () => {
    await writeFileContent(
      join(testDir, "packages", "api", ".agents", "rules", "api.md"),
      "---\ntrigger: glob\nglobs: src/**/*.ts\n---\nBody\n",
    );
    const rule = await RuleClass.fromFile({
      outputRoot: testDir,
      relativeDirPath: join("packages", "api", ".agents", "rules"),
      relativeFilePath: "api.md",
    });
    expect(rule.getRelativeDirPath()).toBe(join("packages", "api", ".agents", "rules"));
    const rulesyncRule = rule.toRulesyncRule();
    expect(rulesyncRule.getRelativeFilePath()).toBe("api.md");
    expect(rulesyncRule.getFrontmatter()).toMatchObject({
      targets: ["antigravity-ide", "antigravity-cli"],
      agentsmd: { subprojectPath: "packages/api" },
    });
    // The next generate writes it to the project-root rules directory, which
    // Antigravity loads, limited to the subproject.
    const regenerated = RuleClass.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });
    expect(regenerated.getFilePath()).toBe(
      join(testDir, ".agents", "rules", "packages-api-api.md"),
    );
    expect(regenerated.getFileContent()).toContain("globs: '**/packages/api/src/**/*.ts'");
  });

  it.each([
    ["packages/api/**/*.ts", "**/packages/api/**/*.ts"],
    ["src/**/*.ts", "**/packages/api/src/**/*.ts"],
    [
      "packages/api/src/*.ts, !packages/api/src/gen/**",
      "**/packages/api/src/*.ts,!**/packages/api/src/gen/**",
    ],
  ])(
    "moves a legacy nested rule with globs %s without prefixing the subproject twice",
    async (globs, expected) => {
      await writeFileContent(
        join(testDir, "packages", "api", ".agents", "rules", "api.md"),
        `---\ntrigger: glob\nglobs: ${globs}\n---\nBody\n`,
      );
      const imported = await RuleClass.fromFile({
        outputRoot: testDir,
        relativeDirPath: join("packages", "api", ".agents", "rules"),
        relativeFilePath: "api.md",
      });
      const regenerated = RuleClass.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: imported.toRulesyncRule(),
      });
      expect(regenerated.getFilePath()).toBe(
        join(testDir, ".agents", "rules", "packages-api-api.md"),
      );
      expect(regenerated.getFileContent()).toContain(`globs: '${expected}'`);
    },
  );

  it.each<[string, Partial<RulesyncRuleFrontmatter>]>([
    [join("frontend", "codeStyle.md"), {}],
    ["api.md", { globs: ["src/**/*.ts"] }],
    ["api.md", { antigravity: { trigger: "model_decision" }, description: "API" }],
  ])(
    "round-trips the generated project-root file of %s %j unchanged",
    async (relativeFilePath, frontmatter) => {
      const generated = RuleClass.fromRulesyncRule({
        outputRoot: testDir,
        rulesyncRule: buildRulesyncRule({
          testDir,
          relativeFilePath,
          frontmatter: { ...frontmatter, agentsmd: { subprojectPath: "packages/web" } },
        }),
      });
      expect(generated.getRelativeDirPath()).toBe(join(".agents", "rules"));
      await writeFileContent(generated.getFilePath(), generated.getFileContent());

      const imported = await RuleClass.fromFile({
        outputRoot: testDir,
        relativeDirPath: generated.getRelativeDirPath(),
        relativeFilePath: generated.getRelativeFilePath(),
      });
      const rulesyncRule = imported.toRulesyncRule();
      // Imported as an ordinary project-root rule; its globs keep the scope.
      expect(rulesyncRule.getFrontmatter().agentsmd).toBeUndefined();
      const regenerated = RuleClass.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });
      expect(regenerated.getFilePath()).toBe(generated.getFilePath());
      expect(regenerated.getFileContent()).toBe(generated.getFileContent());
    },
  );

  it("writes the same file from the IDE and the CLI", () => {
    const rulesyncRule = buildRulesyncRule({
      testDir,
      relativeFilePath: join("frontend", "codeStyle.md"),
      frontmatter: { globs: ["src/**"], agentsmd: { subprojectPath: "packages/web" } },
    });
    const ide = AntigravityIdeRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });
    const cli = AntigravityCliRule.fromRulesyncRule({ outputRoot: testDir, rulesyncRule });
    expect(ide.getFilePath()).toBe(
      join(testDir, ".agents", "rules", "packages-web-frontend-code-style.md"),
    );
    expect(cli.getFilePath()).toBe(ide.getFilePath());
    expect(cli.getFileContent()).toBe(ide.getFileContent());
  });

  it("does not treat a project-root rule as nested", async () => {
    await writeFileContent(
      join(testDir, ".agents", "rules", "a.md"),
      "---\ntrigger: always_on\n---\nBody\n",
    );
    const rule = await RuleClass.fromFile({
      outputRoot: testDir,
      relativeDirPath: join(".agents", "rules"),
      relativeFilePath: "a.md",
    });
    const frontmatter = rule.toRulesyncRule().getFrontmatter();
    expect(frontmatter.targets).toEqual(["*"]);
    expect(frontmatter.agentsmd).toBeUndefined();
  });

  it("scans subdirectory .agents/rules but not the root one or hidden directories", async () => {
    for (const path of [
      join(".agents", "rules", "root.md"),
      join("packages", "api", ".agents", "rules", "api.md"),
      join("packages", "api", ".agents", "rules", "sub", "deep.md"),
      join(".worktrees", "feature", ".agents", "rules", "copy.md"),
      join("packages", "api", "node_modules", "dep", ".agents", "rules", "dep.md"),
      join("packages", "api", ".agents", "skills", "s", "SKILL.md"),
    ]) {
      await writeFileContent(join(testDir, path), "Body\n");
    }
    const patterns = RuleClass.getNestedFilePatterns();
    const matched = await findFilesByGlobs(patterns.include, {
      cwd: testDir,
      type: "file",
      ignore: patterns.ignore,
    });
    expect(matched.map((path) => toPosixPath(relative(testDir, path)))).toEqual([
      "packages/api/.agents/rules/api.md",
    ]);
  });
});

describe("AntigravityPluginRule directory-scoped rules", () => {
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

  it("keeps a subproject-scoped rule in the plugin's own rules directory", () => {
    const rule = AntigravityPluginRule.fromRulesyncRule({
      outputRoot: testDir,
      rulesyncRule: buildRulesyncRule({
        testDir,
        frontmatter: { agentsmd: { subprojectPath: "packages/api" } },
      }),
    });
    expect(rule.getRelativeDirPath()).toBe("rules");
  });

  it("does not scan the project tree", () => {
    expect(AntigravityPluginRule.getNestedFilePatterns().include).toEqual([]);
  });
});
