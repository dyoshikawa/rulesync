import { describe, expect, it } from "vitest";

import { resolveDisableModelInvocation } from "./skills-utils.js";

describe("resolveDisableModelInvocation", () => {
  it("returns the section value when it is set", () => {
    expect(
      resolveDisableModelInvocation({
        rootFrontmatter: { "disable-model-invocation": false },
        section: { "disable-model-invocation": true },
      }),
    ).toBe(true);
  });

  it("lets a false section value override a true root value", () => {
    expect(
      resolveDisableModelInvocation({
        rootFrontmatter: { "disable-model-invocation": true },
        section: { "disable-model-invocation": false },
      }),
    ).toBe(false);
  });

  it("falls back to the root value when the section omits the key", () => {
    expect(
      resolveDisableModelInvocation({
        rootFrontmatter: { "disable-model-invocation": true },
        section: {},
      }),
    ).toBe(true);
  });

  it("falls back to the root value when the section is undefined", () => {
    expect(
      resolveDisableModelInvocation({
        rootFrontmatter: { "disable-model-invocation": true },
        section: undefined,
      }),
    ).toBe(true);
  });

  it("returns undefined when neither value is set", () => {
    expect(
      resolveDisableModelInvocation({
        rootFrontmatter: {},
        section: undefined,
      }),
    ).toBeUndefined();
  });
});
