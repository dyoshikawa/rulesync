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

    it.each(["**/*.env", "/*", "*.pem", "{src,lib}/*.ts"])(
      "skips the deny %s, which has no leading directory",
      (pattern) => {
        const { entry, logger } = build({ action: "read_file", pattern, decision: "deny" });
        expect(entry).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("NOT enforced"));
      },
    );

    it.each([
      ["src/*", "read_file(src)", "src"],
      ["./src/*.ts", "read_file(src)", "src"],
      ["src/lib/**/*.env", "read_file(src/lib)", "src/lib"],
      ["/etc/ssl/*.pem", "read_file(/etc/ssl)", "/etc/ssl"],
      ["src/{a,b}/**", "read_file(src)", "src"],
    ])("widens the deny %s to its leading directories, %s", (pattern, expected, prefix) => {
      const { entry, logger } = build({ action: "read_file", pattern, decision: "deny" });
      expect(entry).toBe(expected);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`The deny now blocks every path under \`${prefix}\``),
      );
    });

    it.each([
      ["~/.ssh/*.pem", "read_file(~/.ssh)"],
      ["$HOME/.aws/*", "read_file($HOME/.aws)"],
    ])("warns that the deny %s, widened to %s, may block nothing", (pattern, expected) => {
      const { entry, logger } = build({ action: "read_file", pattern, decision: "deny" });
      expect(entry).toBe(expected);
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("The deny now blocks"));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("this deny may block nothing"),
      );
    });

    it("does not widen an allow or ask path glob", () => {
      const { entry } = build({ action: "read_file", pattern: "src/*", decision: "allow" });
      expect(entry).toBeUndefined();
    });

    it.each([
      ["~/.ssh/**", "deny", "read_file(~/.ssh)"],
      ["$HOME/.aws/credentials", "deny", "read_file($HOME/.aws/credentials)"],
      ["~/notes", "allow", "read_file(~/notes)"],
      ["config/${XDG_NAME}/x", "deny", "read_file(config/${XDG_NAME}/x)"],
    ] as const)("keeps %s but warns that it may not be expanded", (pattern, decision, expected) => {
      const { entry, logger } = build({ action: "read_file", pattern, decision });
      expect(entry).toBe(expected);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("may not be expanded"));
    });

    it("says a deny with a home path may block nothing", () => {
      const { logger } = build({ action: "read_file", pattern: "~/.ssh/**", decision: "deny" });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("this deny may block nothing"),
      );
    });

    it("says an ask with a home path may run without a prompt", () => {
      const { logger } = build({ action: "read_file", pattern: "~/.ssh/**", decision: "ask" });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "may run without a prompt when Antigravity CLI is set to always proceed",
        ),
      );
    });

    it.each(["app/routes/posts.$postId.tsx", "src/$lib/index.ts", "price$.txt", "~$report.docx"])(
      "does not warn about the ordinary `$` in %s",
      (pattern) => {
        const { entry, logger } = build({ action: "write_file", pattern, decision: "deny" });
        expect(entry).toBe(`write_file(${pattern})`);
        expect(logger.warn).not.toHaveBeenCalled();
      },
    );
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
        expect(deny.logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("the deny also overrides any allow or ask there"),
        );
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

    it("warns that a deny with a path widens to the whole domain", () => {
      const { entry, logger } = build({
        action: "read_url",
        pattern: "https://example.com/private/*",
        decision: "deny",
      });
      expect(entry).toBe("read_url(example.com)");
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "covers all of example.com and its subdomains, so the deny also overrides any allow or ask there",
        ),
      );
    });

    it.each([
      ["example.com", "execute_url(example.com)"],
      ["https://example.com/run/*", "execute_url(example.com)"],
      ["*", "execute_url"],
    ])("translates the execute_url pattern %s to %s like read_url", (pattern, expected) => {
      const { entry } = build({ action: "execute_url", pattern });
      expect(entry).toBe(expected);
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
      // A class escape may start a range in RE2, or follow a lone `-`.
      [
        "regex:[\\d-z] [\\d-\\w] [-\\d] [a\\-\\d]",
        "command(regex:[\\d-z] [\\d-\\w] [-\\d] [a\\-\\d])",
      ],
      [
        "regex:[\\pL-\\d] [\\p{L}-\\d] [[:alpha:]-\\d] [a-]",
        "command(regex:[\\pL-\\d] [\\p{L}-\\d] [[:alpha:]-\\d] [a-])",
      ],
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

    it.each([
      ["npm run *", "unsandboxed(npm run)"],
      ["npm run test:*", "unsandboxed(regex:^npm$ ^run$ ^test:.*$)"],
    ])("translates the unsandboxed pattern %s to %s like a command", (pattern, expected) => {
      const { entry } = build({ action: "unsandboxed", pattern });
      expect(entry).toBe(expected);
    });

    // Earlier releases wrote `unsandboxed` and `execute_url` patterns verbatim.
    it("warns that an execute_url allow covers the whole domain", () => {
      const { entry, logger } = build({
        action: "execute_url",
        pattern: "https://example.com/run/*",
      });
      expect(entry).toBe("execute_url(example.com)");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("all of example.com and its subdomains"),
      );
    });

    it("warns that an exact unsandboxed allow also matches more words", () => {
      const { entry, logger } = build({ action: "unsandboxed", pattern: "git push" });
      expect(entry).toBe("unsandboxed(git push)");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("more words after it"));
    });

    it("no longer writes an unsandboxed glob verbatim", () => {
      const { entry, logger } = build({ action: "unsandboxed", pattern: "rm -rf *" });
      expect(entry).toBe("unsandboxed(rm -rf)");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("widens an untranslatable unsandboxed deny to its leading words", () => {
      const { entry, logger } = build({
        action: "unsandboxed",
        pattern: "git push * --force",
        decision: "deny",
      });
      expect(entry).toBe("unsandboxed(git push)");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("widening"));
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
      // RE2 reads the end of a range as one character, so a class escape
      // there is refused; JavaScript without the `u` flag accepts it.
      "regex:[a-\\d]",
      "regex:[--\\s]",
      "regex:[^a-\\W]",
      "regex:[]-\\d]",
      "regex:[a-\\pL]",
      "regex:[\\x{41}-\\d]",
      "regex:[\\x41-\\w]",
      "regex:[\\--\\d]",
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

    it("skips {a,b} alternatives in an allow, which a command target cannot say", () => {
      const { entry, logger } = build({ action: "command", pattern: "echo {yes,no}" });
      expect(entry).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("{a,b}"));
    });

    it("widens {a,b} alternatives in a deny to the words before them", () => {
      const { entry, logger } = build({
        action: "command",
        pattern: "echo {yes,no}",
        decision: "deny",
      });
      expect(entry).toBe("command(echo)");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("{a,b}"));
    });

    it("keeps a literal {} that is not an alternative", () => {
      expect(build({ action: "command", pattern: "find . -exec {} *" }).entry).toBe(
        "command(find . -exec {})",
      );
    });

    it("skips a {1..3} range, which canonical patterns expand", () => {
      const { entry, logger } = build({
        action: "command",
        pattern: "rm a{1..3}",
        decision: "ask",
      });
      expect(entry).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("falls back"));
      expect(build({ action: "command", pattern: "rm a{1..3}", decision: "deny" }).entry).toBe(
        "command(rm)",
      );
    });

    // Go's `unicode.IsSpace` leaves U+FEFF out, so Antigravity keeps it inside
    // the word, while JavaScript's `\s` would split there.
    it("does not split a word at U+FEFF", () => {
      const word = `foo${String.fromCodePoint(0xfeff)}bar`;
      expect(build({ action: "command", pattern: `${word} *` }).entry).toBe(`command(${word})`);
    });

    it.each([
      ["git push * --force", "command(git push)"],
      ["git * status", "command(git)"],
      ["git commit-* --amend", "command(git)"],
      ["rm *.env", "command(rm)"],
      ["git push *--force", "command(git push)"],
      ["cat a*b", "command(cat)"],
      ["rm a[\t-\r]b", "command(rm)"],
      ["rm a[\u2003]b", "command(rm)"],
      ["rm a[\u0085]b", "command(rm)"],
      ["git status[ ]", "command(git)"],
      ["git status[\t]", "command(git)"],
      ["git push?--force", "command(git)"],
      ["git {push,pull} --force", "command(git)"],
      ["git {push, pull} --force", "command(git)"],
      ["git push {a..c} *", "command(git push)"],
    ])("widens the deny %s, which spans words, to its literal words %s", (pattern, expected) => {
      const { entry, logger } = build({ action: "command", pattern, decision: "deny" });
      expect(entry).toBe(expected);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`widening`));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`to ${expected}`));
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("NOT enforced"));
    });

    it.each([
      "* --force",
      "a[ ]b",
      "a?b",
      "a[!x]b",
      "a[!\t]b",
      "git[! ]status",
      "git[! \t\n\r\f\v]status",
      "git?status",
      "{git,rm} *",
      "regex:^ls( -la)?$",
      " regex:foo * --force",
    ])("skips the deny %s, which has no literal word to widen to", (pattern) => {
      const { entry, logger } = build({ action: "command", pattern, decision: "deny" });
      expect(entry).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("NOT enforced"));
    });

    it.each(["git push * --force", "rm *.env", "git {push,pull} --force"])(
      "does not widen the allow or ask %s",
      (pattern) => {
        for (const decision of ["allow", "ask"] as const) {
          const { entry, logger } = build({ action: "command", pattern, decision });
          expect(entry).toBeUndefined();
          expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("falls back"));
        }
      },
    );

    it("says a skipped ask runs without a prompt when set to always proceed", () => {
      const { logger } = build({
        action: "command",
        pattern: "git push * --force",
        decision: "ask",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "runs without a prompt when Antigravity CLI is set to always proceed",
        ),
      );
    });

    it("says the deny was widened and why", () => {
      const { logger } = build({
        action: "command",
        pattern: "git push * --force",
        decision: "deny",
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("word by word"));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("blocks every command that starts with `git push`"),
      );
    });
  });
});
