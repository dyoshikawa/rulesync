import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import { fallbackLogger } from "../../utils/logger.js";
import {
  collectSkillNameViolations,
  resolveCompatibility,
  resolveDisableModelInvocation,
  resolveLicense,
  resolveMetadata,
  resolveUserInvocable,
  SKILL_NAME_MAX_LENGTH,
  warnSkillViolations,
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

describe("collectSkillNameViolations", () => {
  it("should accept a name of lowercase alphanumeric runs joined by single hyphens", () => {
    expect(collectSkillNameViolations({ name: "deploy-2-prod", authority: "the spec" })).toEqual(
      [],
    );
    expect(
      collectSkillNameViolations({
        name: "a".repeat(SKILL_NAME_MAX_LENGTH),
        authority: "the spec",
      }),
    ).toEqual([]);
  });

  it.each(["Deploy", "-deploy", "deploy-", "deploy--prod", "deploy_prod", "dé-ploy"])(
    "should reject %j and name the authority only when a consequence is given",
    (name) => {
      expect(collectSkillNameViolations({ name, authority: "the spec" })).toEqual([
        `\`name\` ${JSON.stringify(name)} must contain only lowercase letters, digits and single hyphens, with no leading, trailing or consecutive hyphens`,
      ]);
      expect(
        collectSkillNameViolations({ name, authority: "Zed", consequence: "drops the skill" }),
      ).toEqual([
        `\`name\` ${JSON.stringify(name)} must contain only lowercase letters, digits and single hyphens, with no leading, trailing or consecutive hyphens; Zed drops the skill`,
      ]);
    },
  );

  it("should report the length and phrase the consequence after the limit", () => {
    const name = "a".repeat(SKILL_NAME_MAX_LENGTH + 1);
    expect(collectSkillNameViolations({ name, authority: "the spec" })).toEqual([
      "`name` is 65 characters; the spec allows at most 64",
    ]);
    expect(
      collectSkillNameViolations({ name, authority: "Zed", consequence: "drops the skill" }),
    ).toEqual(["`name` is 65 characters; Zed allows at most 64 and drops the skill"]);
  });

  it("should report both length and character violations for one name", () => {
    const name = `${"A".repeat(SKILL_NAME_MAX_LENGTH)}-`;
    const violations = collectSkillNameViolations({ name, authority: "the spec" });
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain("is 65 characters");
    expect(violations[1]).toContain("must contain only lowercase letters");
  });

  it("should quote the name so control characters cannot forge a log line", () => {
    const [violation] = collectSkillNameViolations({
      name: "deploy \nfake: line",
      authority: "the spec",
    });
    expect(violation).toContain('"deploy fake: line"');
    expect(violation).not.toContain("\n");
  });
});

describe("warnSkillViolations", () => {
  it("should prefix every violation with the POSIX form of the skill path", () => {
    const logger = createMockLogger();
    warnSkillViolations({
      skillPath: join("proj", ".agents", "skills", "deploy", "SKILL.md"),
      violations: ["first", "second"],
      logger,
    });
    expect(logger.warn.mock.calls.map((call) => call[0])).toEqual([
      "proj/.agents/skills/deploy/SKILL.md: first",
      "proj/.agents/skills/deploy/SKILL.md: second",
    ]);
  });

  it("should strip control characters from the path and stay silent with no violations", () => {
    const logger = createMockLogger();
    warnSkillViolations({
      skillPath: join("proj", "skills", "skill\u001b[31m red", "SKILL.md"),
      violations: ["only"],
      logger,
    });
    expect(logger.warn).toHaveBeenCalledWith("proj/skills/skill[31m red/SKILL.md: only");

    warnSkillViolations({ skillPath: "proj/SKILL.md", violations: [], logger });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("should fall back to the shared logger when none is passed", () => {
    const warn = vi.spyOn(fallbackLogger, "warn").mockImplementation(() => {});
    try {
      warnSkillViolations({ skillPath: "proj/SKILL.md", violations: ["only"] });
      expect(warn).toHaveBeenCalledWith("proj/SKILL.md: only");
    } finally {
      warn.mockRestore();
    }
  });
});
