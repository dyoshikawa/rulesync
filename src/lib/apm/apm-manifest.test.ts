import { describe, expect, it } from "vitest";

import { parseApmManifest } from "./apm-manifest.js";

describe("parseApmManifest", () => {
  it("returns an empty dependency list when the file is empty", () => {
    expect(parseApmManifest("")).toEqual({ dependencies: [] });
  });

  it("parses string shorthand without a ref", () => {
    const manifest = parseApmManifest(
      `name: my-project
version: 1.0.0
dependencies:
  apm:
    - microsoft/apm-sample-package
`,
    );

    expect(manifest).toEqual({
      name: "my-project",
      version: "1.0.0",
      dependencies: [
        {
          gitUrl: "https://github.com/microsoft/apm-sample-package.git",
          owner: "microsoft",
          repo: "apm-sample-package",
        },
      ],
    });
  });

  it("parses string shorthand with a ref", () => {
    const manifest = parseApmManifest(
      `dependencies:
  apm:
    - owner/repo#v1.0.0
`,
    );

    expect(manifest.dependencies).toEqual([
      {
        gitUrl: "https://github.com/owner/repo.git",
        owner: "owner",
        repo: "repo",
        ref: "v1.0.0",
      },
    ]);
  });

  it("parses an HTTPS GitHub URL with a ref", () => {
    const manifest = parseApmManifest(
      `dependencies:
  apm:
    - https://github.com/owner/repo.git#main
`,
    );

    expect(manifest.dependencies).toEqual([
      {
        gitUrl: "https://github.com/owner/repo.git",
        owner: "owner",
        repo: "repo",
        ref: "main",
      },
    ]);
  });

  it("parses the object form with git/path/ref/alias", () => {
    const manifest = parseApmManifest(
      `dependencies:
  apm:
    - git: https://github.com/acme/coding-standards.git
      path: instructions/security
      ref: v2.0
      alias: review
`,
    );

    expect(manifest.dependencies).toEqual([
      {
        gitUrl: "https://github.com/acme/coding-standards.git",
        owner: "acme",
        repo: "coding-standards",
        ref: "v2.0",
        path: "instructions/security",
        alias: "review",
      },
    ]);
  });

  it("rejects local path dependencies with a clear not-yet-supported error", () => {
    expect(() =>
      parseApmManifest(
        `dependencies:
  apm:
    - ./packages/my-skills
`,
      ),
    ).toThrow(/local path dependencies/);
  });

  it("rejects SSH dependencies with a clear not-yet-supported error", () => {
    expect(() =>
      parseApmManifest(
        `dependencies:
  apm:
    - git@github.com:owner/repo.git
`,
      ),
    ).toThrow(/SSH URL/);
  });

  it("rejects marketplace dependencies with a clear not-yet-supported error", () => {
    expect(() =>
      parseApmManifest(
        `dependencies:
  apm:
    - awesome@marketplace
`,
      ),
    ).toThrow(/marketplace/);
  });

  it("rejects FQDN/sub-path shorthand with a clear not-yet-supported error", () => {
    expect(() =>
      parseApmManifest(
        `dependencies:
  apm:
    - gitlab.com/acme/rules
`,
      ),
    ).toThrow(/FQDN shorthand|sub-path/);
  });

  it("rejects non-GitHub HTTPS URLs", () => {
    expect(() =>
      parseApmManifest(
        `dependencies:
  apm:
    - https://gitlab.com/acme/rules.git
`,
      ),
    ).toThrow(/Only HTTPS GitHub URLs/);
  });

  it("rejects object-form entries with a '..' segment in path", () => {
    expect(() =>
      parseApmManifest(
        `dependencies:
  apm:
    - git: https://github.com/acme/rules.git
      path: ../escape
`,
      ),
    ).toThrow(/"path" must not contain ".." segments/);
  });

  it("rejects object-form entries with an absolute path", () => {
    expect(() =>
      parseApmManifest(
        `dependencies:
  apm:
    - git: https://github.com/acme/rules.git
      path: /etc/passwd
`,
      ),
    ).toThrow(/must be a non-empty relative path without a leading slash/);
  });

  it("canonicalizes owner and repo to lower-case (shorthand)", () => {
    const manifest = parseApmManifest(
      `dependencies:
  apm:
    - Owner/Repo#v1.0.0
`,
    );
    expect(manifest.dependencies[0]).toMatchObject({
      owner: "owner",
      repo: "repo",
      gitUrl: "https://github.com/owner/repo.git",
    });
  });

  it("canonicalizes owner and repo to lower-case (object form URL)", () => {
    const manifest = parseApmManifest(
      `dependencies:
  apm:
    - git: https://github.com/Acme/Coding-Standards.git
`,
    );
    expect(manifest.dependencies[0]).toMatchObject({
      owner: "acme",
      repo: "coding-standards",
    });
  });

  it("rejects object-form entries missing the git field", () => {
    expect(() =>
      parseApmManifest(
        `dependencies:
  apm:
    - path: some/path
`,
      ),
    ).toThrow(/"git" field/);
  });
});
