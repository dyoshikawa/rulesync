import { describe, expect, it } from "vitest";

import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import {
  escapeCheckMarkers,
  findCheckMarkers,
  hasHandWrittenPreamble,
  isOnlyGeneratedSections,
  renderCheckFile,
  renderCheckMarker,
  splitCheckFile,
  unescapeCheckMarkers,
} from "./aggregated-check-file.js";
import { RulesyncCheck } from "./rulesync-check.js";

const checkOf = ({
  name,
  body = "",
  description,
}: {
  name: string;
  body?: string;
  description?: string;
}): RulesyncCheck =>
  new RulesyncCheck({
    outputRoot: ".",
    relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
    relativeFilePath: `${name}.md`,
    frontmatter: { targets: ["*"], ...(description !== undefined && { description }) },
    body,
  });

describe("aggregated-check-file", () => {
  describe("findCheckMarkers", () => {
    it("should find every marker and stay repeatable across calls", () => {
      const content = [renderCheckMarker("a"), "body", renderCheckMarker("b")].join("\n");

      expect(findCheckMarkers(content).map((marker) => marker.name)).toEqual(["a", "b"]);
      // The pattern is module-level and global, so a second call must agree.
      expect(findCheckMarkers(content).map((marker) => marker.name)).toEqual(["a", "b"]);
    });

    it("should ignore a marker that is not alone on its line", () => {
      expect(findCheckMarkers(`text ${renderCheckMarker("a")}`)).toEqual([]);
    });
  });

  describe("hasHandWrittenPreamble", () => {
    it.each([
      { label: "an empty file", content: "", expected: false },
      { label: "a whitespace-only file", content: "\n\n  \n", expected: false },
      { label: "a file with no marker", content: "Hand-written.\n", expected: true },
      {
        label: "text ahead of the first marker",
        content: `Hand-written.\n${renderCheckMarker("a")}\n`,
        expected: true,
      },
      {
        label: "only generated sections",
        content: `${renderCheckMarker("a")}\n## a\n\nbody\n`,
        expected: false,
      },
    ])("should be $expected for $label", ({ content, expected }) => {
      expect(hasHandWrittenPreamble(content)).toBe(expected);
    });
  });

  describe("isOnlyGeneratedSections", () => {
    it.each([
      // Stricter than hasHandWrittenPreamble: with no marker there is nothing
      // rulesync wrote, so an empty file is not rulesync's to delete either.
      { label: "an empty file", content: "", expected: false },
      { label: "a whitespace-only file", content: "\n\n", expected: false },
      { label: "a file with no marker", content: "Hand-written.\n", expected: false },
      {
        label: "text ahead of the first marker",
        content: `Hand-written.\n${renderCheckMarker("a")}\n`,
        expected: false,
      },
      {
        label: "only generated sections",
        content: `${renderCheckMarker("a")}\n## a\n\nbody\n`,
        expected: true,
      },
    ])("should be $expected for $label", ({ content, expected }) => {
      expect(isOnlyGeneratedSections(content)).toBe(expected);
    });
  });

  describe("marker escaping", () => {
    it("should escape and unescape a marker line a body wrote itself", () => {
      const body = renderCheckMarker("inner");
      const escaped = escapeCheckMarkers(body);

      expect(escaped).toBe("<!-- rulesync:literal-check:inner -->");
      expect(findCheckMarkers(escaped)).toEqual([]);
      expect(unescapeCheckMarkers(escaped)).toBe(body);
    });

    it("should ladder so an already-escaped marker survives another round", () => {
      const body = "<!-- rulesync:literal-check:inner -->";
      const escaped = escapeCheckMarkers(body);

      expect(escaped).toBe("<!-- rulesync:literal-literal-check:inner -->");
      expect(unescapeCheckMarkers(escaped)).toBe(body);
    });
  });

  describe("renderCheckFile", () => {
    it("should write a marker, a heading and the body per check", () => {
      const content = renderCheckFile([checkOf({ name: "a", body: "Body A." })]);

      expect(content).toBe("<!-- rulesync:check:a -->\n## a\n\nBody A.\n");
    });

    it("should fall back to the description when the body is empty", () => {
      expect(renderCheckFile([checkOf({ name: "a", description: "Summary." })])).toContain(
        "Summary.",
      );
    });

    it("should name a nested check by its basename only", () => {
      const nested = new RulesyncCheck({
        outputRoot: ".",
        relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
        relativeFilePath: "group/a.md",
        frontmatter: { targets: ["*"] },
        body: "Body.",
      });

      expect(renderCheckFile([nested])).toContain("<!-- rulesync:check:a -->");
    });
  });

  describe("splitCheckFile", () => {
    it("should round-trip a rendered file", () => {
      const checks = [checkOf({ name: "a", body: "Body A." }), checkOf({ name: "b", body: "B." })];

      const split = splitCheckFile({
        fileContent: renderCheckFile(checks),
        fallbackName: "fallback",
      });

      expect(split.map((check) => check.getRelativeFilePath())).toEqual(["a.md", "b.md"]);
      expect(split.map((check) => check.getBody())).toEqual(["Body A.", "B."]);
    });

    it("should import a file with no marker as the fallback check", () => {
      const split = splitCheckFile({ fileContent: "Prose.\n", fallbackName: "fallback" });

      expect(split).toHaveLength(1);
      expect(split[0]!.getRelativeFilePath()).toBe("fallback.md");
      expect(split[0]!.getBody()).toBe("Prose.");
    });

    it("should keep a preamble as its own check alongside the sections", () => {
      const split = splitCheckFile({
        fileContent: `Preamble.\n\n${renderCheckMarker("a")}\n## a\n\nBody A.\n`,
        fallbackName: "fallback",
      });

      expect(split.map((check) => check.getRelativeFilePath())).toEqual(["fallback.md", "a.md"]);
    });

    it("should return nothing for an empty file", () => {
      expect(splitCheckFile({ fileContent: "", fallbackName: "fallback" })).toEqual([]);
    });

    it("should slugify a marker name so it cannot escape the checks directory", () => {
      const split = splitCheckFile({
        fileContent: `${renderCheckMarker("../escape")}\nBody.\n`,
        fallbackName: "fallback",
      });

      expect(split[0]!.getRelativeFilePath()).not.toContain("..");
    });

    it("should suffix names that slugify the same so neither is lost", () => {
      const split = splitCheckFile({
        fileContent: [
          `${renderCheckMarker("No Console")}`,
          "first",
          `${renderCheckMarker("no console")}`,
          "second",
        ].join("\n"),
        fallbackName: "fallback",
      });

      expect(split).toHaveLength(2);
      expect(split.map((check) => check.getRelativeFilePath())).toEqual([
        "no-console.md",
        "no-console-2.md",
      ]);
      expect(split.map((check) => check.getBody())).toEqual(["first", "second"]);
    });

    it("should strip only the heading generate wrote, keeping a different one", () => {
      const generated = splitCheckFile({
        fileContent: `${renderCheckMarker("a")}\n## a\n\nBody.\n`,
        fallbackName: "fallback",
      });
      const foreign = splitCheckFile({
        fileContent: `${renderCheckMarker("a")}\n## Something Else\n\nBody.\n`,
        fallbackName: "fallback",
      });

      expect(generated[0]!.getBody()).toBe("Body.");
      expect(foreign[0]!.getBody()).toBe("## Something Else\n\nBody.");
    });

    it("should match the heading against the raw marker name, not its slug", () => {
      // A check named `No_Console` slugifies to `no-console`, but the heading
      // generate wrote says `No_Console`.
      const split = splitCheckFile({
        fileContent: `${renderCheckMarker("No_Console")}\n## No_Console\n\nBody.\n`,
        fallbackName: "fallback",
      });

      expect(split[0]!.getBody()).toBe("Body.");
    });

    it("should import every check as applying to any tool", () => {
      const split = splitCheckFile({ fileContent: "Prose.\n", fallbackName: "fallback" });

      expect(split[0]!.getFrontmatter().targets).toEqual(["*"]);
    });
  });
});
