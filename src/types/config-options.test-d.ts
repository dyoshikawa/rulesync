import { assertType, describe, test } from "vitest";
import { z } from "zod/mini";
import { OutputPathsSchema } from "./config-options.js";
import type { ToolTarget } from "./tool-targets.js";

describe("config-options type tests", () => {
  test("OutputPathsSchema keys should match ToolTarget keys", () => {
    type OutputPathsKeys = keyof z.infer<typeof OutputPathsSchema>;

    type _AssertKeysMatch = OutputPathsKeys extends ToolTarget ? true : false;
    assertType<_AssertKeysMatch>(true);

    type _AssertAllTargetsCovered = ToolTarget extends OutputPathsKeys ? true : false;
    assertType<_AssertAllTargetsCovered>(true);
  });

  test("should detect missing keys", () => {
    const SchemaWithMissingKey = z.object({
      augmentcode: z.optional(z.string()),
      "augmentcode-legacy": z.optional(z.string()),
      copilot: z.optional(z.string()),
      cursor: z.optional(z.string()),
      cline: z.optional(z.string()),
      claudecode: z.optional(z.string()),
      roo: z.optional(z.string()),
      geminicli: z.optional(z.string()),
      // kiro is missing
    });

    type SchemaWithMissingKeyKeys = keyof z.infer<typeof SchemaWithMissingKey>;

    type _Assert = ToolTarget extends SchemaWithMissingKeyKeys ? true : false;
    assertType<_Assert>(false);
  });

  test("should detect extra keys", () => {
    const SchemaWithExtraKey = z.extend(
      OutputPathsSchema,
      z.object({
        extraUnknownProperty: z.optional(z.string()),
      }),
    );

    type SchemaWithExtraKeyKeys = keyof z.infer<typeof SchemaWithExtraKey>;

    type _Assert = SchemaWithExtraKeyKeys extends ToolTarget ? true : false;
    assertType<_Assert>(false);
  });
});
