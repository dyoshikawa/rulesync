import { describe, expect, it } from "vitest";

import {
  resolveCompatibility,
  resolveDisableModelInvocation,
  resolveLicense,
  resolveMetadata,
  resolveUserInvocable,
} from "./skills-utils.js";

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

describe("resolveUserInvocable", () => {
  it("returns the section value when it is set", () => {
    expect(
      resolveUserInvocable({
        rootFrontmatter: { "user-invocable": true },
        section: { "user-invocable": false },
      }),
    ).toBe(false);
  });

  it("lets a false section value override a true root value", () => {
    expect(
      resolveUserInvocable({
        rootFrontmatter: { "user-invocable": true },
        section: { "user-invocable": false },
      }),
    ).toBe(false);
  });

  it("falls back to the root value when the section omits the key", () => {
    expect(
      resolveUserInvocable({
        rootFrontmatter: { "user-invocable": false },
        section: {},
      }),
    ).toBe(false);
  });

  it("falls back to the root value when the section is undefined", () => {
    expect(
      resolveUserInvocable({
        rootFrontmatter: { "user-invocable": false },
        section: undefined,
      }),
    ).toBe(false);
  });

  it("returns undefined when neither value is set", () => {
    expect(
      resolveUserInvocable({
        rootFrontmatter: {},
        section: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("resolveLicense", () => {
  it("returns the section value when it is set", () => {
    expect(
      resolveLicense({
        rootFrontmatter: { license: "MIT" },
        section: { license: "Apache-2.0" },
      }),
    ).toBe("Apache-2.0");
  });

  it("lets an empty section value override a root value", () => {
    expect(
      resolveLicense({
        rootFrontmatter: { license: "MIT" },
        section: { license: "" },
      }),
    ).toBe("");
  });

  it("falls back to the root value when the section omits the key", () => {
    expect(
      resolveLicense({
        rootFrontmatter: { license: "MIT" },
        section: {},
      }),
    ).toBe("MIT");
  });

  it("falls back to the root value when the section is undefined", () => {
    expect(
      resolveLicense({
        rootFrontmatter: { license: "MIT" },
        section: undefined,
      }),
    ).toBe("MIT");
  });

  it("returns undefined when neither value is set", () => {
    expect(
      resolveLicense({
        rootFrontmatter: {},
        section: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("resolveCompatibility", () => {
  it("returns the section value when it is set", () => {
    expect(
      resolveCompatibility({
        rootFrontmatter: { compatibility: "Requires git" },
        section: { compatibility: { runtime: "node" } },
      }),
    ).toEqual({ runtime: "node" });
  });

  it("lets an empty section value override a root value", () => {
    expect(
      resolveCompatibility({
        rootFrontmatter: { compatibility: { runtime: "node" } },
        section: { compatibility: "" },
      }),
    ).toBe("");
  });

  it("falls back to the root value when the section omits the key", () => {
    expect(
      resolveCompatibility({
        rootFrontmatter: { compatibility: "Requires git" },
        section: {},
      }),
    ).toBe("Requires git");
  });

  it("falls back to the root value when the section is undefined", () => {
    expect(
      resolveCompatibility({
        rootFrontmatter: { compatibility: { runtime: "node" } },
        section: undefined,
      }),
    ).toEqual({ runtime: "node" });
  });

  it("returns undefined when neither value is set", () => {
    expect(
      resolveCompatibility({
        rootFrontmatter: {},
        section: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("resolveMetadata", () => {
  it("returns the section value when it is set", () => {
    expect(
      resolveMetadata({
        rootFrontmatter: { metadata: { author: "root" } },
        section: { metadata: { author: "section" } },
      }),
    ).toEqual({ author: "section" });
  });

  it("lets an empty section map override a root value instead of merging them", () => {
    expect(
      resolveMetadata({
        rootFrontmatter: { metadata: { author: "root" } },
        section: { metadata: {} },
      }),
    ).toEqual({});
  });

  it("falls back to the root value when the section omits the key", () => {
    expect(
      resolveMetadata({
        rootFrontmatter: { metadata: { author: "root" } },
        section: {},
      }),
    ).toEqual({ author: "root" });
  });

  it("falls back to the root value when the section is undefined", () => {
    expect(
      resolveMetadata({
        rootFrontmatter: { metadata: { author: "root" } },
        section: undefined,
      }),
    ).toEqual({ author: "root" });
  });

  it("returns undefined when neither value is set", () => {
    expect(
      resolveMetadata({
        rootFrontmatter: {},
        section: undefined,
      }),
    ).toBeUndefined();
  });
});
