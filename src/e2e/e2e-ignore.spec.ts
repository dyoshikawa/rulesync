import { join } from "node:path";

import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";

import {
  KIRO_GLOBAL_IGNORE_FILE_NAME,
  KIRO_IGNORE_FILE_NAME,
  KIRO_SETTINGS_DIR_PATH,
} from "../constants/kiro-paths.js";
import {
  REASONIX_GLOBAL_DIR,
  REASONIX_GLOBAL_PERMISSIONS_FILE_NAME,
  REASONIX_PROJECT_PERMISSIONS_FILE_NAME,
} from "../constants/reasonix-paths.js";
import { RULESYNC_AIIGNORE_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { getZedGlobalDir, ZED_SETTINGS_FILE_NAME } from "../constants/zed-paths.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { fileExists, readFileContent, writeFileContent } from "../utils/file.js";
import {
  assertGenerateMatrixCoversTargets,
  runGenerate,
  runImport,
  useGlobalTestDirectories,
  useTestDirectory,
} from "./e2e-helper.js";

const ignoreGenerateTargets = [
  { target: "cursor", outputPath: ".cursorignore", format: "plaintext" as const },
  {
    target: "claudecode",
    outputPath: join(".claude", "settings.json"),
    format: "json" as const,
  },
  { target: "antigravity-cli", outputPath: ".geminiignore", format: "plaintext" as const },
  {
    target: "hermesagent",
    outputPath: join(".hermes", "plugins", "rulesync-ignore", "patterns.gitignore"),
    format: "plaintext" as const,
  },
  { target: "cline", outputPath: ".clineignore", format: "plaintext" as const },
  { target: "kilo", outputPath: ".kilocodeignore", format: "plaintext" as const },
  { target: "roo", outputPath: ".rooignore", format: "plaintext" as const },
  { target: "qwencode", outputPath: ".qwenignore", format: "plaintext" as const },
  { target: "kiro", outputPath: KIRO_IGNORE_FILE_NAME, format: "plaintext" as const },
  { target: "kiro-cli", outputPath: KIRO_IGNORE_FILE_NAME, format: "plaintext" as const },
  { target: "kiro-ide", outputPath: KIRO_IGNORE_FILE_NAME, format: "plaintext" as const },
  { target: "junie", outputPath: ".aiignore", format: "plaintext" as const },
  { target: "aiassistant", outputPath: ".aiignore", format: "plaintext" as const },
  { target: "augmentcode", outputPath: ".augmentignore", format: "plaintext" as const },
  { target: "devin", outputPath: ".devinignore", format: "plaintext" as const },
  {
    target: "zed",
    outputPath: join(".zed", "settings.json"),
    format: "json" as const,
  },
  { target: "vibe", outputPath: ".vibeignore", format: "plaintext" as const },
  { target: "warp", outputPath: ".warpindexingignore", format: "plaintext" as const },
  {
    target: "reasonix",
    outputPath: REASONIX_PROJECT_PERMISSIONS_FILE_NAME,
    format: "toml" as const,
  },
] as const;

describe("E2E: ignore", () => {
  const { getTestDir } = useTestDirectory();

  it("generate matrix must cover every native ignore tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: IgnoreProcessor,
      testedTargets: ignoreGenerateTargets.map((e) => e.target),
    });
  });

  it.each(ignoreGenerateTargets)(
    "should generate $target ignore",
    async ({ target, outputPath, format }) => {
      const testDir = getTestDir();

      const ignoreContent = `tmp/
credentials/
*.secret
`;
      await writeFileContent(join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH), ignoreContent);

      const homeDir = join(testDir, "home");
      const hermesHome = join(testDir, "hermes-profile");
      await runGenerate({
        target,
        features: "ignore",
        env: {
          HOME_DIR: homeDir,
          ...(target === "hermesagent" ? { HERMES_HOME: hermesHome } : {}),
        },
      });

      const generatedContent = await readFileContent(join(testDir, outputPath));
      if (format === "plaintext") {
        expect(generatedContent).toContain("tmp/");
        expect(generatedContent).toContain("credentials/");
      } else if (format === "json" && target === "claudecode") {
        // Claude Code uses JSON format with permissions.deny
        const parsed = JSON.parse(generatedContent);
        expect(parsed.permissions.deny).toBeDefined();
        expect(parsed.permissions.deny).toEqual(
          expect.arrayContaining([expect.stringContaining("tmp/")]),
        );
      } else if (format === "toml" && target === "reasonix") {
        // Reasonix writes Read(<pattern>) entries into the [permissions] table
        const parsed = parseToml(generatedContent) as {
          permissions?: { deny?: string[] };
        };
        expect(parsed.permissions?.deny).toEqual(
          expect.arrayContaining(["Read(tmp/)", "Read(credentials/)", "Read(*.secret)"]),
        );
      } else if (format === "json" && target === "zed") {
        // Zed uses JSON format with private_files
        const parsed = JSON.parse(generatedContent);
        expect(parsed.private_files).toBeDefined();
        expect(parsed.private_files).toEqual(
          expect.arrayContaining([expect.stringContaining("tmp/")]),
        );
      }

      if (target === "hermesagent") {
        expect(await readFileContent(join(hermesHome, "config.yaml"))).toContain("rulesync-ignore");
        expect(await fileExists(join(hermesHome, ".env"))).toBe(false);
        expect(await fileExists(join(homeDir, ".hermes", "config.yaml"))).toBe(false);
      }
    },
  );

  it("should check Hermes project plugin activation without writing", async () => {
    const testDir = getTestDir();
    const homeDir = join(testDir, "home");
    await writeFileContent(join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH), "tmp/\n");

    await expect(
      runGenerate({
        target: "hermesagent",
        features: "ignore",
        check: true,
        env: { HOME_DIR: homeDir },
      }),
    ).rejects.toMatchObject({ code: 1 });

    expect(
      await fileExists(join(testDir, ".hermes", "plugins", "rulesync-ignore", "__init__.py")),
    ).toBe(false);
    expect(await fileExists(join(homeDir, ".hermes", "config.yaml"))).toBe(false);
    expect(await fileExists(join(homeDir, ".hermes", ".env"))).toBe(false);

    await runGenerate({
      target: "hermesagent",
      features: "ignore",
      env: { HOME_DIR: homeDir },
    });
    await runGenerate({
      target: "hermesagent",
      features: "ignore",
      check: true,
      env: { HOME_DIR: homeDir },
    });
  });

  it.each([
    { target: "cursor", orphanPath: ".cursorignore" },
    // claudecode uses settings.json (isDeletable=false) — excluded
    { target: "antigravity-cli", orphanPath: ".geminiignore" },
    { target: "cline", orphanPath: ".clineignore" },
    { target: "kilo", orphanPath: ".kilocodeignore" },
    { target: "roo", orphanPath: ".rooignore" },
    { target: "qwencode", orphanPath: ".qwenignore" },
    { target: "kiro", orphanPath: KIRO_IGNORE_FILE_NAME },
    { target: "kiro-cli", orphanPath: KIRO_IGNORE_FILE_NAME },
    { target: "kiro-ide", orphanPath: KIRO_IGNORE_FILE_NAME },
    { target: "junie", orphanPath: ".aiignore" },
    { target: "augmentcode", orphanPath: ".augmentignore" },
    { target: "devin", orphanPath: ".devinignore" },
    { target: "vibe", orphanPath: ".vibeignore" },
    { target: "warp", orphanPath: ".warpindexingignore" },
    // zed ignore uses .zed/settings.json which is not deletable by rulesync
  ])(
    "should fail in check mode when delete would remove an orphan $target ignore file",
    async ({ target, orphanPath }) => {
      const testDir = getTestDir();

      await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
      await writeFileContent(join(testDir, orphanPath), "# orphan\n");

      await expect(
        runGenerate({
          target,
          features: "ignore",
          deleteFiles: true,
          check: true,
          env: { NODE_ENV: "e2e" },
        }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "Files are not up to date. Run 'rulesync generate' to update.",
        ),
      });

      expect(await readFileContent(join(testDir, orphanPath))).toBe("# orphan\n");
    },
  );

  it("should succeed in check mode when a claudecode ignore file is non-deletable", async () => {
    const testDir = getTestDir();

    await writeFileContent(join(testDir, ".rulesync", ".gitkeep"), "");
    await writeFileContent(
      join(testDir, ".claude", "settings.json"),
      JSON.stringify({ permissions: { deny: ["tmp/"] }, theme: "dark" }, null, 2),
    );

    const { stdout } = await runGenerate({
      target: "claudecode",
      features: "ignore",
      deleteFiles: true,
      check: true,
      env: { NODE_ENV: "e2e" },
    });

    expect(stdout).toContain("All files are up to date.");
  });
});

describe("E2E: ignore (import)", () => {
  const { getTestDir } = useTestDirectory();

  it.each([
    { target: "cursor", sourcePath: ".cursorignore" },
    { target: "antigravity-cli", sourcePath: ".geminiignore" },
    {
      target: "hermesagent",
      sourcePath: join(".hermes", "plugins", "rulesync-ignore", "patterns.gitignore"),
    },
    { target: "cline", sourcePath: ".clineignore" },
    { target: "kilo", sourcePath: ".kilocodeignore" },
    { target: "roo", sourcePath: ".rooignore" },
    { target: "qwencode", sourcePath: ".qwenignore" },
    { target: "kiro", sourcePath: KIRO_IGNORE_FILE_NAME },
    { target: "kiro-cli", sourcePath: KIRO_IGNORE_FILE_NAME },
    { target: "kiro-ide", sourcePath: KIRO_IGNORE_FILE_NAME },
    { target: "junie", sourcePath: ".aiignore" },
    { target: "augmentcode", sourcePath: ".augmentignore" },
    { target: "devin", sourcePath: ".devinignore" },
    { target: "vibe", sourcePath: ".vibeignore" },
    { target: "warp", sourcePath: ".warpindexingignore" },
  ])("should import $target ignore", async ({ target, sourcePath }) => {
    const testDir = getTestDir();

    const ignoreContent = `tmp/
credentials/
*.secret
`;
    await writeFileContent(join(testDir, sourcePath), ignoreContent);

    await runImport({ target, features: "ignore" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH),
    );
    expect(importedContent).toContain("tmp/");
    expect(importedContent).toContain("credentials/");
  });

  it("should import reasonix ignore from the [permissions] deny table", async () => {
    const testDir = getTestDir();

    await writeFileContent(
      join(testDir, REASONIX_PROJECT_PERMISSIONS_FILE_NAME),
      '[permissions]\ndeny = ["Read(tmp/)", "Read(credentials/)", "Bash(rm *)"]\n',
    );

    await runImport({ target: "reasonix", features: "ignore" });

    const importedContent = await readFileContent(
      join(testDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH),
    );
    expect(importedContent).toContain("tmp/");
    expect(importedContent).toContain("credentials/");
    expect(importedContent).not.toContain("Bash(rm *)");
  });
});

describe("E2E: ignore (global mode)", () => {
  const { getProjectDir, getHomeDir } = useGlobalTestDirectories();
  const globalTargets = [
    { target: "kiro", outputPath: join(KIRO_SETTINGS_DIR_PATH, KIRO_GLOBAL_IGNORE_FILE_NAME) },
    { target: "kiro-cli", outputPath: join(KIRO_SETTINGS_DIR_PATH, KIRO_GLOBAL_IGNORE_FILE_NAME) },
    { target: "kiro-ide", outputPath: join(KIRO_SETTINGS_DIR_PATH, KIRO_GLOBAL_IGNORE_FILE_NAME) },
    {
      target: "reasonix",
      outputPath: join(REASONIX_GLOBAL_DIR, REASONIX_GLOBAL_PERMISSIONS_FILE_NAME),
    },
    {
      target: "zed",
      outputPath: join(getZedGlobalDir(), ZED_SETTINGS_FILE_NAME),
    },
  ] as const;

  it("global matrix must cover every native global ignore tool target", () => {
    assertGenerateMatrixCoversTargets({
      processor: IgnoreProcessor,
      testedTargets: globalTargets.map((entry) => entry.target),
      global: true,
    });
  });

  it.each(globalTargets)(
    "should generate $target ignore in the home directory",
    async ({ target, outputPath }) => {
      const projectDir = getProjectDir();
      const homeDir = getHomeDir();
      await writeFileContent(
        join(projectDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH),
        "credentials/\n*.secret\n",
      );

      await runGenerate({
        target,
        features: "ignore",
        global: true,
        env: { HOME_DIR: homeDir },
      });

      const generatedContent = await readFileContent(join(homeDir, outputPath));
      expect(generatedContent).toContain("credentials/");
      expect(generatedContent).toContain("*.secret");
    },
  );

  it("should import the Kiro CLI user-level ignore file", async () => {
    const projectDir = getProjectDir();
    const homeDir = getHomeDir();
    await writeFileContent(
      join(homeDir, KIRO_SETTINGS_DIR_PATH, KIRO_GLOBAL_IGNORE_FILE_NAME),
      "private/\n",
    );

    await runImport({
      target: "kiro-cli",
      features: "ignore",
      global: true,
      env: { HOME_DIR: homeDir },
    });

    expect(await readFileContent(join(projectDir, RULESYNC_AIIGNORE_RELATIVE_FILE_PATH))).toContain(
      "private/",
    );
  });
});
