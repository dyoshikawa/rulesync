import { describe, expect, it } from "vitest";
import * as z from "zod";

import { RulesyncFeaturesSchema } from "./features.js";

describe("RulesyncFeaturesSchema", () => {
  it("should continue accepting the deprecated ignore feature", () => {
    expect(RulesyncFeaturesSchema.safeParse(["ignore"]).success).toBe(true);
  });

  it("should expose ignore deprecation metadata in JSON Schema", () => {
    const schema = z.toJSONSchema(RulesyncFeaturesSchema);
    const items = schema.items as {
      anyOf?: Array<Record<string, unknown>>;
    };
    const ignoreSchema = items.anyOf?.find((item) => item.const === "ignore");

    expect(ignoreSchema).toMatchObject({
      const: "ignore",
      deprecated: true,
      description: expect.stringContaining("use the permissions feature"),
    });
  });
});
