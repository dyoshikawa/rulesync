import { describe, expect, it } from "vite-plus/test";

import { capitalizedMatcherNames, replaceMatcherNames } from "./hook-matcher-tool-names.js";

const NAMES = { Bash: "RunCommand", Read: "read" };

describe("replaceMatcherNames", () => {
  it("should replace whole names in an alternation", () => {
    expect(replaceMatcherNames("Bash|Read|Edit", NAMES)).toBe("RunCommand|read|Edit");
  });

  it("should leave names inside longer identifiers alone", () => {
    expect(replaceMatcherNames("mcp__srv__Bash|BashTool", NAMES)).toBe("mcp__srv__Bash|BashTool");
  });

  it("should replace names next to escapes but not the escapes themselves", () => {
    expect(replaceMatcherNames("\\bBash\\b", NAMES)).toBe("\\bRunCommand\\b");
    expect(replaceMatcherNames("\\Read", NAMES)).toBe("\\Read");
  });

  it("should leave character classes untouched", () => {
    expect(replaceMatcherNames("[Bash]|Bash", NAMES)).toBe("[Bash]|RunCommand");
  });

  it("should not match inherited object keys", () => {
    expect(replaceMatcherNames("toString|constructor", NAMES)).toBe("toString|constructor");
  });
});

describe("capitalizedMatcherNames", () => {
  it("should list each capitalized whole name once", () => {
    expect(capitalizedMatcherNames("Glob|read|Glob|WebFetch")).toEqual(["Glob", "WebFetch"]);
  });

  it("should ignore lowercase names, longer identifiers, escapes and classes", () => {
    expect(capitalizedMatcherNames("run_command|mcp__srv__Bash|\\Bar|[A-Z]+")).toEqual([]);
  });
});
