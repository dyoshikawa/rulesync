import { describe, expect, it } from "vite-plus/test";

import {
  buildOutputStyleFrontmatter,
  isDirectMarkdownChild,
  isOutputStyleChannel,
  resolveTopLevelOutputStyleStem,
} from "./output-style-paths.js";

describe("isDirectMarkdownChild", () => {
  const outputStylesDirPath = ".tool/output-styles";

  it("accepts a direct .md child of the output-styles directory", () => {
    expect(
      isDirectMarkdownChild({
        outputStylesDirPath,
        relativeDirPath: outputStylesDirPath,
        relativeFilePath: "terse.md",
      }),
    ).toBe(true);
  });

  it("rejects another directory, a non-.md file and a nested file", () => {
    expect(
      isDirectMarkdownChild({
        outputStylesDirPath,
        relativeDirPath: ".tool/rules",
        relativeFilePath: "terse.md",
      }),
    ).toBe(false);
    expect(
      isDirectMarkdownChild({
        outputStylesDirPath,
        relativeDirPath: undefined,
        relativeFilePath: "terse.md",
      }),
    ).toBe(false);
    expect(
      isDirectMarkdownChild({
        outputStylesDirPath,
        relativeDirPath: outputStylesDirPath,
        relativeFilePath: "terse.txt",
      }),
    ).toBe(false);
    expect(
      isDirectMarkdownChild({
        outputStylesDirPath,
        relativeDirPath: outputStylesDirPath,
        relativeFilePath: "nested/terse.md",
      }),
    ).toBe(false);
  });
});

describe("isOutputStyleChannel", () => {
  it("is true only for a non-root rule on the output-style channel", () => {
    expect(isOutputStyleChannel({ root: undefined, channel: "output-style" })).toBe(true);
    expect(isOutputStyleChannel({ root: false, channel: "output-style" })).toBe(true);
    expect(isOutputStyleChannel({ root: true, channel: "output-style" })).toBe(false);
    expect(isOutputStyleChannel({ root: false, channel: "design" })).toBe(false);
    expect(isOutputStyleChannel({ root: false, channel: undefined })).toBe(false);
  });
});

describe("resolveTopLevelOutputStyleStem", () => {
  it("returns the file stem of a top-level rule", () => {
    expect(resolveTopLevelOutputStyleStem({ sourcePath: "terse.md", message: "nested" })).toBe(
      "terse",
    );
  });

  it("throws the given message for a nested rule", () => {
    expect(() =>
      resolveTopLevelOutputStyleStem({ sourcePath: "styles/terse.md", message: "is nested" }),
    ).toThrow("is nested");
  });
});

describe("buildOutputStyleFrontmatter", () => {
  it("keeps only the keys that are set", () => {
    expect(buildOutputStyleFrontmatter({ name: "Terse", description: "Short" })).toEqual({
      name: "Terse",
      description: "Short",
    });
    expect(buildOutputStyleFrontmatter({ name: undefined, description: "Short" })).toEqual({
      description: "Short",
    });
    expect(buildOutputStyleFrontmatter({ name: undefined, description: undefined })).toEqual({});
  });
});
