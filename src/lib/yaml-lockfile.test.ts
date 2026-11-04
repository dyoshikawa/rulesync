import { describe, expect, it } from "vite-plus/test";
import { z } from "zod/mini";

import {
  parseYamlLockfile,
  ResolvedCommitShaSchema,
  serializeYamlLockfile,
} from "./yaml-lockfile.js";

const schema = z.looseObject({ version: z.literal("1"), resolved_commit: ResolvedCommitShaSchema });

describe("parseYamlLockfile", () => {
  it("returns null for empty, non-YAML or non-object content", () => {
    expect(parseYamlLockfile({ content: "  \n", schema, fileName: "x.lock.yaml" })).toBeNull();
    expect(parseYamlLockfile({ content: "a: [", schema, fileName: "x.lock.yaml" })).toBeNull();
    expect(parseYamlLockfile({ content: "just text", schema, fileName: "x.lock.yaml" })).toBeNull();
  });

  it("returns the parsed lock for valid content", () => {
    const sha = "a".repeat(40);
    expect(
      parseYamlLockfile({
        content: `version: "1"\nresolved_commit: ${sha}\n`,
        schema,
        fileName: "x.lock.yaml",
      }),
    ).toEqual({ version: "1", resolved_commit: sha });
  });

  it("throws an error naming the file and each issue for invalid content", () => {
    expect(() =>
      parseYamlLockfile({
        content: `version: "1"\nresolved_commit: abc\n`,
        schema,
        fileName: "x.lock.yaml",
      }),
    ).toThrow(
      "Invalid x.lock.yaml:\n  - resolved_commit: resolved_commit must be a 40-char hex SHA",
    );
  });
});

describe("serializeYamlLockfile", () => {
  it("keeps key order and long values on one line", () => {
    const long = "x".repeat(200);
    expect(serializeYamlLockfile({ b: long, a: 1 })).toBe(`b: ${long}\na: 1\n`);
  });
});
