import { describe, expect, it } from "vitest";
import { z } from "zod/mini";

import { RULESYNC_CHECKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { createMockLogger } from "../../test-utils/mock-logger.js";
import { checkStem, parseCheckOverride, slugifyCheckName, uniqueCheckName } from "./check-slug.js";
import { RulesyncCheck } from "./rulesync-check.js";

describe("slugifyCheckName", () => {
  it("lowercases and collapses runs of non-alphanumerics into single hyphens", () => {
    expect(slugifyCheckName("No_Console  Logs!")).toBe("no-console-logs");
  });

  it("trims leading and trailing separators", () => {
    expect(slugifyCheckName("--style--")).toBe("style");
  });

  it("neutralizes a name that would otherwise escape the checks directory", () => {
    expect(slugifyCheckName("../../etc/passwd")).toBe("etc-passwd");
  });

  it("caps the length without leaving a trailing separator", () => {
    const slug = slugifyCheckName(`${"a".repeat(47)} tail`);

    expect(slug).toHaveLength(47);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("returns an empty string when nothing survives, so callers can fall back", () => {
    expect(slugifyCheckName("///")).toBe("");
  });
});

describe("checkStem", () => {
  it("drops the directory and the .md extension", () => {
    const rulesyncCheck = new RulesyncCheck({
      outputRoot: ".",
      relativeDirPath: RULESYNC_CHECKS_RELATIVE_DIR_PATH,
      relativeFilePath: "nested/no-console.md",
      frontmatter: { targets: ["*"] },
      body: "",
    });
    expect(checkStem(rulesyncCheck)).toBe("no-console");
  });
});

describe("uniqueCheckName", () => {
  it("suffixes a taken name and records every name it hands out", () => {
    const used = new Set<string>();
    expect(uniqueCheckName({ preferred: "a", used })).toBe("a");
    expect(uniqueCheckName({ preferred: "a", used })).toBe("a-2");
    expect(uniqueCheckName({ preferred: "a", used })).toBe("a-3");
    expect([...used]).toEqual(["a", "a-2", "a-3"]);
  });
});

describe("parseCheckOverride", () => {
  const schema = z.looseObject({ name: z.optional(z.string()) });

  it("returns an empty override for a missing block", () => {
    expect(parseCheckOverride({ raw: undefined, filePath: "a.md", section: "x", schema })).toEqual(
      {},
    );
  });

  it("warns about and ignores a block that is not a mapping", () => {
    const logger = createMockLogger();
    expect(
      parseCheckOverride({ raw: "oops", filePath: "a.md", section: "x", schema, logger }),
    ).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith("Ignoring the `x` block in a.md: expected a mapping.");
  });

  it("throws on an invalid block, keeping the zod error as the cause", () => {
    let caught: unknown;
    try {
      parseCheckOverride({ raw: { name: 1 }, filePath: "a.md", section: "x", schema });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message.startsWith("Invalid `x` block in a.md: ")).toBe(true);
    expect((caught as Error).cause).toBeDefined();
  });

  it("returns the parsed block", () => {
    expect(
      parseCheckOverride({ raw: { name: "n", extra: 1 }, filePath: "a.md", section: "x", schema }),
    ).toEqual({ name: "n", extra: 1 });
  });
});
