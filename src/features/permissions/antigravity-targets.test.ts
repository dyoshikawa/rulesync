import { describe, expect, it } from "vitest";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import type { PermissionAction } from "../../types/permissions.js";
import { buildAntigravityPermissionEntry } from "./antigravity-targets.js";

function build({
  action,
  pattern,
  decision = "allow",
}: {
  action: string;
  pattern: string;
  decision?: PermissionAction;
}) {
  const logger = createMockLogger();
  const entry = buildAntigravityPermissionEntry({
    action,
    category: "read",
    pattern,
    decision,
    logger,
    toolLabel: "Antigravity CLI",
  });
  return { entry, logger };
}

describe("buildAntigravityPermissionEntry", () => {
  describe("file targets", () => {
    it.each([
      ["src/**", "read_file(src)"],
      ["src/**/*", "read_file(src)"],
      ["./src/**", "read_file(src)"],
      ["/etc/**", "read_file(/etc)"],
      ["/**", "read_file(/)"],
      ["./**", "read_file(.)"],
      ["./**/*", "read_file(.)"],
      ["./", "read_file(.)"],
      [".", "read_file(.)"],
      ["/**/*", "read_file(/)"],
      [".env", "read_file(.env)"],
      ["./secrets/key.pem", "read_file(secrets/key.pem)"],
      ["state/{current}/data", "read_file(state/{current}/data)"],
      ["state/{}/**", "read_file(state/{})"],
      ["*", "read_file"],
      ["**", "read_file"],
      ["**/*", "read_file"],
    ])("writes %s as %s", (pattern, expected) => {
      const { entry, logger } = build({ action: "read_file", pattern });
      expect(entry).toBe(expected);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each(["**/*.env", "src/*", "*.pem", "src/{a,b}/**", "log{1..3}/**", "a?/**", "./*"])(
      "skips the glob %s with a warning",
      (pattern) => {
        const { entry, logger } = build({ action: "write_file", pattern, decision: "ask" });
        expect(entry).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("falls back"));
      },
    );

    it("says a skipped deny is not enforced", () => {
      const { entry, logger } = build({
        action: "read_file",
        pattern: "**/*.env",
        decision: "deny",
      });
      expect(entry).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("NOT enforced"));
    });
  });

  describe("URL targets", () => {
    it.each([
      ["example.com", "read_url(example.com)"],
      ["https://example.com", "read_url(example.com)"],
      ["https://example.com/*", "read_url(example.com)"],
      ["domain:Example.COM", "read_url(example.com)"],
      ["*.example.com", "read_url(example.com)"],
      ["http://user@example.com:8080/", "read_url(example.com)"],
      ["*", "read_url"],
      ["domain:*", "read_url"],
    ])("writes %s as %s", (pattern, expected) => {
      const { entry } = build({ action: "read_url", pattern });
      expect(entry).toBe(expected);
    });

    it.each(["https://*", "https://*/*", "http://*/"])(
      "writes %s as the bare action, warning an allow that it covers every URL",
      (pattern) => {
        const allow = build({ action: "read_url", pattern });
        expect(allow.entry).toBe("read_url");
        expect(allow.logger.warn).toHaveBeenCalledWith(expect.stringContaining("every URL"));
        const deny = build({ action: "read_url", pattern, decision: "deny" });
        expect(deny.entry).toBe("read_url");
        expect(deny.logger.warn).not.toHaveBeenCalled();
      },
    );

    it("does not warn when the allow * already covers every domain", () => {
      const { logger } = build({ action: "read_url", pattern: "*" });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    // `*.example.com` leaves out `example.com` itself, which the target covers.
    it.each([
      "example.com",
      "https://example.com/*",
      "domain:example.com",
      "*.example.com",
      "https://*.example.com/*",
    ])("warns that the allow %s also covers the domain and its subdomains", (pattern) => {
      const { entry, logger } = build({ action: "read_url", pattern });
      expect(entry).toBe("read_url(example.com)");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("all of example.com and its subdomains"),
      );
    });

    it("warns when an allow covers more of the site than its path", () => {
      const { entry, logger } = build({
        action: "read_url",
        pattern: "https://example.com/docs/*",
      });
      expect(entry).toBe("read_url(example.com)");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("all of example.com"));
    });

    it.each(["https://example.com?key=*", "https://example.com#top"])(
      "ends the hostname of %s at the query or fragment",
      (pattern) => {
        const { entry, logger } = build({ action: "read_url", pattern });
        expect(entry).toBe("read_url(example.com)");
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("all of example.com"));
      },
    );

    it("widens a deny with a path to the whole domain without a warning", () => {
      const { entry, logger } = build({
        action: "read_url",
        pattern: "https://example.com/private/*",
        decision: "deny",
      });
      expect(entry).toBe("read_url(example.com)");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each(["https://*/x", "a*b.example.com", "how to bake bread"])(
      "skips %s, which has no hostname",
      (pattern) => {
        const { entry, logger } = build({ action: "read_url", pattern, decision: "deny" });
        expect(entry).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("NOT enforced"));
      },
    );
  });

  it("passes other actions through", () => {
    expect(build({ action: "mcp", pattern: "linter/*" }).entry).toBe("mcp(linter/*)");
  });

  describe("command targets", () => {
    it.each([
      ["npm run *", "command(npm run)"],
      ["npm   run *", "command(npm run)"],
      ["npm run test:*", "command(regex:^npm$ ^run$ ^test:.*$)"],
      // Each `*` word needs a word; only `<words> *` is a plain prefix.
      ["docker * *", "command(regex:^docker$ ^.*$ ^.*$)"],
      ["git log*", "command(regex:^git$ ^log.*$)"],
      ["regex:^ls$ ^-la$", "command(regex:^ls$ ^-la$)"],
      ["regex:^ls$ ^-(la|l)$", "command(regex:^ls$ ^-(la|l)$)"],
      // RE2 spellings JavaScript lacks are still valid.
      ["regex:(?P<cmd>ls) (?i)^-LA$", "command(regex:(?P<cmd>ls) (?i)^-LA$)"],
      ["regex:(?-i)^npm$ (?i-s:run)", "command(regex:(?-i)^npm$ (?i-s:run))"],
      ["regex:(?<cmd>ls)", "command(regex:(?<cmd>ls))"],
      ["regex:^ls$ ^\\pl+$", "command(regex:^ls$ ^\\pl+$)"],
      // Braces inside a class are literal, not a repeat count.
      [
        "regex:^[a{1001}b]$ []{1001}] [\\]{1001}]",
        "command(regex:^[a{1001}b]$ []{1001}] [\\]{1001}])",
      ],
      ["regex:^[\\-a\\d]$ \\x{10ffff}", "command(regex:^[\\-a\\d]$ \\x{10ffff})"],
      ["regex:^echo$ ^\\\\Q$", "command(regex:^echo$ ^\\\\Q$)"],
      // Braced escapes are not repeat counts.
      ["regex:^a\\x{2003}b$ \\p{Greek}{2}", "command(regex:^a\\x{2003}b$ \\p{Greek}{2})"],
      [
        "regex:^foo\\xbar$ \\x{41} \\pL\\PL \\p{Greek}\\p{^Greek}\\p{greek} \\p{L}\\p{Lu}\\p{Any}",
        "command(regex:^foo\\xbar$ \\x{41} \\pL\\PL \\p{Greek}\\p{^Greek}\\p{greek} \\p{L}\\p{Lu}\\p{Any})",
      ],
      // Only inside a bracket is `[:name:]` a POSIX class.
      ["regex:[:foobar:] []:foo:] [\\[:foo:]]", "command(regex:[:foobar:] []:foo:] [\\[:foo:]])"],
      ["regex:[a[:alpha:]] [^[:digit:]]", "command(regex:[a[:alpha:]] [^[:digit:]])"],
      // Quoted text is literal, even what would be an escape or a group.
      ["regex:\\Q(a.\\k\\E ^-\\Qx", "command(regex:\\Q(a.\\k\\E ^-\\Qx)"],
      ["regex:a{2,1000} \\d\\x41 [[:^space:]]", "command(regex:a{2,1000} \\d\\x41 [[:^space:]])"],
      ["regex:\\Als\\z [[:alpha:]]+", "command(regex:\\Als\\z [[:alpha:]]+)"],
      // Range endpoints are escaped, so `\\` through `z` stays a range.
      ["x[\\-z]*", "command(regex:^x[\\\\-z].*$)"],
      ["x[]-a]*", "command(regex:^x[\\]-a].*$)"],
    ])("writes %s as %s", (pattern, expected) => {
      const { entry, logger } = build({ action: "command", pattern });
      expect(entry).toBe(expected);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each([
      ["git status", "command(git status)"],
      ["rm /tmp/?", "command(regex:^rm$ ^/tmp/.$)"],
    ])("warns that the allow %s also matches more words", (pattern, expected) => {
      const { entry, logger } = build({ action: "command", pattern });
      expect(entry).toBe(expected);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("more words after it"));
    });

    it("does not warn when a deny matches more words", () => {
      const { entry, logger } = build({
        action: "command",
        pattern: "git status",
        decision: "deny",
      });
      expect(entry).toBe("command(git status)");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("skips a regex that a space splits into invalid words", () => {
      const { entry, logger } = build({
        action: "command",
        pattern: "regex:^ls( -la)?$",
        decision: "deny",
      });
      expect(entry).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("`^ls(` is not a valid regex"),
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("NOT enforced"));
    });

    it.each([
      "regex:(?=ls)ls",
      "regex:(ls) \\1",
      "regex:ls (?<!x)-la",
      "regex:(?<c>l)\\k<c>",
      "regex:\\cA",
      "regex:\\y",
      "regex:a{1001}",
      "regex:a{1,1001}",
      "regex:[[:foobar:]]",
      "regex:[a[:foo:]]",
      "regex:[[:FOO:]]",
      "regex:^[\\A]$",
      "regex:^[\\z]$",
      "regex:^[\\b]$",
      "regex:^\\x{110000}$",
      "regex:a{1001}[x]",
      "regex:[[:Alpha:]]",
      "regex:[[:alpha1:]]",
      "regex:\\u0061",
      "regex:\\U0001f600",
      "regex:\\C",
      "regex:a\\Eb",
      "regex:\\xg1",
      "regex:\\x4",
      "regex:\\x{41",
      "regex:\\p",
      "regex:\\pX",
      "regex:\\p{Foo}",
      "regex:\\p{Emoji}",
    ])("skips %s, which RE2 cannot compile", (pattern) => {
      const { entry, logger } = build({ action: "command", pattern, decision: "deny" });
      expect(entry).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("not a valid regex"));
    });

    it.each(["regex:", "regex:   "])("skips the empty regex %j", (pattern) => {
      const { entry, logger } = build({ action: "command", pattern, decision: "deny" });
      expect(entry).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("NOT enforced"));
    });

    it("skips a bracket range that runs backwards", () => {
      const { entry, logger } = build({ action: "command", pattern: "x[z-a] *", decision: "deny" });
      expect(entry).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("runs backwards"));
    });

    it("writes whitespace in a class as an escape, so it does not split the word", () => {
      expect(build({ action: "command", pattern: "git status[! ]", decision: "deny" }).entry).toBe(
        "command(regex:^git$ ^status[^\\x{20}]$)",
      );
      expect(
        build({ action: "command", pattern: "git status[!\u2003]", decision: "deny" }).entry,
      ).toBe("command(regex:^git$ ^status[^\\x{2003}]$)");
    });

    it.each(["deny", "allow"] as const)(
      "skips {a,b} alternatives in a %s, which a command target cannot say",
      (decision) => {
        const { entry, logger } = build({ action: "command", pattern: "echo {yes,no}", decision });
        expect(entry).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("{a,b}"));
      },
    );

    it("keeps a literal {} that is not an alternative", () => {
      expect(build({ action: "command", pattern: "find . -exec {} *" }).entry).toBe(
        "command(find . -exec {})",
      );
    });

    it("skips a {1..3} range, which canonical patterns expand", () => {
      const { entry, logger } = build({
        action: "command",
        pattern: "rm a{1..3}",
        decision: "deny",
      });
      expect(entry).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("NOT enforced"));
    });

    // Go's `unicode.IsSpace` leaves U+FEFF out, so Antigravity keeps it inside
    // the word, while JavaScript's `\s` would split there.
    it("does not split a word at U+FEFF", () => {
      const word = `foo${String.fromCodePoint(0xfeff)}bar`;
      expect(build({ action: "command", pattern: `${word} *` }).entry).toBe(`command(${word})`);
    });

    it.each([
      "git push * --force",
      "git * status",
      "* --force",
      "git commit-* --amend",
      "rm *.env",
      "git push *--force",
      "cat a*b",
      "a[ ]b",
      "a?b",
      "a[!x]b",
      "a[!\t]b",
      "git[! ]status",
      "git[! \t\n\r\f\v]status",
      "rm a[\t-\r]b",
      "rm a[\u2003]b",
      "rm a[\u0085]b",
      "git status[ ]",
      "git status[\t]",
    ])("skips %s, which spans words, and says the deny is not enforced", (pattern) => {
      const { entry, logger } = build({ action: "command", pattern, decision: "deny" });
      expect(entry).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("NOT enforced"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("word by word"));
    });
  });
});
