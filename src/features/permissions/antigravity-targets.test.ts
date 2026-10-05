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
      [".env", "read_file(.env)"],
      ["./secrets/key.pem", "read_file(secrets/key.pem)"],
      ["*", "read_file"],
      ["**", "read_file"],
      ["**/*", "read_file"],
    ])("writes %s as %s", (pattern, expected) => {
      const { entry, logger } = build({ action: "read_file", pattern });
      expect(entry).toBe(expected);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each(["**/*.env", "src/*", "*.pem", "src/{a,b}/**", "a?/**"])(
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
      const { entry, logger } = build({ action: "read_url", pattern });
      expect(entry).toBe(expected);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("warns when an allow covers more of the site than its path", () => {
      const { entry, logger } = build({
        action: "read_url",
        pattern: "https://example.com/docs/*",
      });
      expect(entry).toBe("read_url(example.com)");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("all of example.com"));
    });

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

  it("translates command patterns", () => {
    expect(build({ action: "command", pattern: "npm run *" }).entry).toBe("command(npm run)");
  });
});
