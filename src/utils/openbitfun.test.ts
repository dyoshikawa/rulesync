import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createMockLogger } from "../test-utils/mock-logger.js";
import { warnOpenbitfunXdgOverride } from "./openbitfun.js";

const { getHomeDirectoryMock } = vi.hoisted(() => ({ getHomeDirectoryMock: vi.fn() }));
vi.mock("./file.js", async () => {
  const actual = await vi.importActual<typeof import("./file.js")>("./file.js");
  return { ...actual, getHomeDirectory: getHomeDirectoryMock };
});

const HOME = join("/", "home", "user");

describe("warnOpenbitfunXdgOverride", () => {
  beforeEach(() => {
    getHomeDirectoryMock.mockReturnValue(HOME);
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("warns when $XDG_CONFIG_HOME points away from ~/.config", () => {
    const logger = createMockLogger();
    vi.stubEnv("XDG_CONFIG_HOME", join("/", "srv", "xdg-config-a"));
    warnOpenbitfunXdgOverride({ kind: "config", logger });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("$XDG_CONFIG_HOME");
    expect(logger.warn.mock.calls[0]?.[0]).toContain(join("~", ".config", "openbitfun"));
  });

  it("warns when $XDG_DATA_HOME points away from ~/.local/share", () => {
    const logger = createMockLogger();
    vi.stubEnv("XDG_DATA_HOME", join("/", "srv", "xdg-data-a"));
    warnOpenbitfunXdgOverride({ kind: "data", logger });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("$XDG_DATA_HOME");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["relative", "relative/config"],
    ["the default", join(HOME, ".config")],
  ])("does not warn when the variable is %s", (_label, value) => {
    const logger = createMockLogger();
    if (value === undefined) {
      vi.stubEnv("XDG_CONFIG_HOME", undefined);
    } else {
      vi.stubEnv("XDG_CONFIG_HOME", value);
    }
    warnOpenbitfunXdgOverride({ kind: "config", logger });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each(["darwin", "win32"] as const)("does not warn on %s", (platform) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    const logger = createMockLogger();
    vi.stubEnv("XDG_CONFIG_HOME", join("/", "srv", `xdg-config-${platform}`));
    warnOpenbitfunXdgOverride({ kind: "config", logger });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
