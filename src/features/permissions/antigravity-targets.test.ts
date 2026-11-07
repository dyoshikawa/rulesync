import { describe, expect, it } from "vite-plus/test";

import { createMockLogger } from "../../test-utils/mock-logger.js";
import type { PermissionAction } from "../../types/permissions.js";
import {
  buildAntigravityPermissionEntry,
  convertAntigravityToRulesyncPermissions,
  convertRulesyncToAntigravityPermissions,
} from "./antigravity-targets.js";

function build({
  action,
  pattern,
  decision = "allow",
  homeDirectory,
}: {
  action: string;
  pattern: string;
  decision?: PermissionAction;
  homeDirectory?: string;
}) {
  const logger = createMockLogger();
  const entry = buildAntigravityPermissionEntry({
    action,
    category: "read",
    pattern,
    decision,
    logger,
    toolLabel: "Antigravity CLI",
    homeDirectory,
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

    it.each(["**/*.env", "/*", "*.pem", "{src,lib}/*.ts", "../*.env", "src/../*.env", "../../a/*"])(
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

  describe("home directory rewrite", () => {
    it.each([
      ["~/x.txt", "deny", "read_file(/home/me/x.txt)"],
      ["~/x.txt", "allow", "read_file(/home/me/x.txt)"],
      ["~/x.txt", "ask", "read_file(/home/me/x.txt)"],
      ["~", "deny", "read_file(/home/me)"],
      ["~/", "deny", "read_file(/home/me/)"],
      ["~/.ssh/**", "deny", "read_file(/home/me/.ssh)"],
      ["~/**", "deny", "read_file(/home/me)"],
    ] as const)(
      "writes %s (%s) with the absolute home directory and no warning",
      (pattern, decision, expected) => {
        const { entry, logger } = build({
          action: "read_file",
          pattern,
          decision,
          homeDirectory: "/home/me",
        });
        expect(entry).toBe(expected);
        expect(logger.warn).not.toHaveBeenCalled();
      },
    );

    it("rewrites the lead a home deny is widened to", () => {
      const { entry, logger } = build({
        action: "write_file",
        pattern: "~/.ssh/*.pem",
        decision: "deny",
        homeDirectory: "/home/me",
      });
      expect(entry).toBe("write_file(/home/me/.ssh)");
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("The deny now blocks every path under `/home/me/.ssh`"),
      );
    });

    it("writes a Windows home directory with forward slashes", () => {
      const { entry } = build({
        action: "read_file",
        pattern: "~/x.txt",
        decision: "deny",
        homeDirectory: "C:\\Users\\me\\",
      });
      expect(entry).toBe("read_file(C:/Users/me/x.txt)");
    });

    it.each(["$HOME/x.txt", "${HOME}/x.txt", "~alice/x.txt"])("keeps %s as written", (pattern) => {
      const { entry } = build({
        action: "read_file",
        pattern,
        decision: "deny",
        homeDirectory: "/home/me",
      });
      expect(entry).toBe(`read_file(${pattern})`);
    });

    it("still warns that a $HOME deny may block nothing", () => {
      const { logger } = build({
        action: "read_file",
        pattern: "$HOME/x.txt",
        decision: "deny",
        homeDirectory: "/home/me",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("this deny may block nothing"),
      );
    });

    it("leaves non-path targets alone", () => {
      const { entry } = build({
        action: "command",
        pattern: "~/bin/tool",
        decision: "deny",
        homeDirectory: "/home/me",
      });
      expect(entry).toBe("command(~/bin/tool)");
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

    it("checks POSIX classes in linear time (#3324)", () => {
      // Each `[:` used to scan the rest of the word again for its `:]`.
      const pattern = `regex:[${"[:".repeat(20_000)}`;
      const start = performance.now();
      const { entry } = build({ action: "command", pattern, decision: "deny" });
      expect(performance.now() - start).toBeLessThan(500);
      expect(entry).toBeUndefined();
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

  describe("mcp targets", () => {
    function buildMcp(category: string, pattern: string, decision: PermissionAction) {
      const logger = createMockLogger();
      const entry = buildAntigravityPermissionEntry({
        action: "mcp",
        category,
        pattern,
        decision,
        logger,
        toolLabel: "Antigravity CLI",
      });
      return { entry, logger };
    }

    it.each([
      ["mcp__s__t", "*", "allow", "mcp(s/t)"],
      ["mcp__s", "*", "allow", "mcp(s/*)"],
      ["mcp__s__*", "*", "ask", "mcp(s/*)"],
      ["mcp__*", "*", "allow", "mcp"],
      ["mcp__*__*", "*", "ask", "mcp"],
      // `mcp__*` names every MCP tool, so its widened deny is the same entry.
      ["mcp__*", "owner:foo", "deny", "mcp"],
      ["mcp__s__t", "owner:foo", "deny", "mcp(s/t)"],
      // An empty or unreadable tool name widens a deny to its server.
      ["mcp__s__", "*", "deny", "mcp(s/*)"],
      ["mcp__s__a/b", "*", "deny", "mcp(s/*)"],
      ["mcp__s__a(b)", "*", "deny", "mcp(s/*)"],
    ] as const)("writes %s { %s: %s } as %s", (category, pattern, decision, expected) => {
      expect(buildMcp(category, pattern, decision).entry).toBe(expected);
    });

    it.each([
      ["mcp__s__", "allow", "*"],
      ["mcp__s__a/b", "ask", "*"],
      ["mcp__s__a(b)", "allow", "*"],
      ["mcp__s(x)__t", "allow", "*"],
      ["mcp__s/x__t", "ask", "*"],
      ["mcp____t", "allow", "*"],
      ["mcp__", "ask", "*"],
      ["mcp__s__t", "allow", "owner:foo"],
      ["mcp__*", "ask", "owner:foo"],
    ] as const)("skips %s as %s rather than widening it", (category, decision, pattern) => {
      const { entry, logger } = buildMcp(category, pattern, decision);
      expect(entry).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("skipping"));
    });

    it.each(["mcp__s(x)__t", "mcp____t", "mcp__", "mcp__git*"])(
      "does not enforce a deny on %s, whose server cannot be named",
      (category) => {
        const { entry, logger } = buildMcp(category, "*", "deny");
        expect(entry).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("NOT enforced"));
      },
    );
  });
});

describe("convertAntigravityToRulesyncPermissions with prototype-pollution names", () => {
  it("drops __proto__ entries without replacing the permission block's prototype", () => {
    const { permission } = convertAntigravityToRulesyncPermissions({
      allow: ["read_file(src/**)", "__proto__(x)"],
      ask: [],
      deny: ["__proto__"],
      toCategory: (action) => (action === "read_file" ? "read" : action),
      toolLabel: "Antigravity",
      logger: createMockLogger(),
    });

    expect(Object.getPrototypeOf(permission)).toBe(Object.prototype);
    expect(Object.hasOwn(permission, "__proto__")).toBe(false);
    expect(permission).toEqual({ read: { "src/**": "allow" } });
  });
});

describe("convertAntigravityToRulesyncPermissions with path targets", () => {
  const convert = (deny: string[]) =>
    convertAntigravityToRulesyncPermissions({
      allow: [],
      ask: [],
      deny,
      toCategory: (action) => (action === "write_file" ? "write" : action),
      toolLabel: "Antigravity",
      logger: createMockLogger(),
    }).permission;

  it("imports a plain path as the path and its subtree, since a directory covers its contents", () => {
    expect(convert(["write_file(src)", "write_file(/etc/ssl/)"])).toEqual({
      write: {
        src: "deny",
        "src/**": "deny",
        "/etc/ssl": "deny",
        "/etc/ssl/**": "deny",
      },
    });
  });

  it("imports the workspace root as . and ./**", () => {
    expect(convert(["write_file(.)"])).toEqual({ write: { ".": "deny", "./**": "deny" } });
  });

  it.each(["src", "src/", "src//", ".", "/", "~/x", "C:/foo", "a b", "../x"])(
    "regenerates the imported %s as the one target it came from",
    (target) => {
      const imported = convertAntigravityToRulesyncPermissions({
        allow: [`read_file(${target})`],
        ask: [],
        deny: [],
        toCategory: (action) => (action === "read_file" ? "read" : action),
        toolLabel: "Antigravity",
        logger: createMockLogger(),
      });
      const regenerated = convertRulesyncToAntigravityPermissions({
        config: imported,
        toAction: (category) => (category === "read" ? "read_file" : category),
        logger: createMockLogger(),
        toolLabel: "Antigravity",
      });
      expect(regenerated.allow).toEqual([`read_file(${target.replace(/(.)\/+$/, "$1")})`]);
    },
  );

  it("keeps the bare * and targets that already hold glob characters as written", () => {
    expect(convert(["write_file(*)", "write_file(**/*.env)"])).toEqual({
      write: { "*": "deny", "**/*.env": "deny" },
    });
  });
});

describe("convertAntigravityToRulesyncPermissions with a home directory", () => {
  const convert = (deny: string[], homeDirectory?: string) =>
    convertAntigravityToRulesyncPermissions({
      allow: [],
      ask: [],
      deny,
      toCategory: (action) => (action === "read_file" ? "read" : action),
      toolLabel: "Antigravity CLI",
      logger: createMockLogger(),
      homeDirectory,
    }).permission;

  it("imports a path in the home directory as ~/...", () => {
    expect(
      convert(
        ["read_file(/home/me/x.txt)", "read_file(/home/me)", "read_file(/home/meme/x)"],
        "/home/me",
      ),
    ).toEqual({
      read: {
        "~/x.txt": "deny",
        "~/x.txt/**": "deny",
        "~": "deny",
        "~/**": "deny",
        "/home/meme/x": "deny",
        "/home/meme/x/**": "deny",
      },
    });
  });

  it("imports a Windows home path written with forward slashes", () => {
    expect(convert(["read_file(C:/Users/me/x.txt)"], "C:\\Users\\me")).toEqual({
      read: { "~/x.txt": "deny", "~/x.txt/**": "deny" },
    });
  });

  it("keeps absolute paths without a home directory", () => {
    expect(convert(["read_file(/home/me/x.txt)"])).toEqual({
      read: { "/home/me/x.txt": "deny", "/home/me/x.txt/**": "deny" },
    });
  });

  it("does not touch targets of other actions", () => {
    expect(convert(["mcp(/home/me/x)"], "/home/me")).toEqual({
      mcp: { "/home/me/x": "deny" },
    });
  });
});
