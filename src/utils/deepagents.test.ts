import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getDeepagentsHome,
  getDeepagentsRelativeDirPath,
  getDeepagentsRulesyncOutputRoot,
} from "./deepagents.js";

describe("deepagents profile paths", () => {
  const originalDeepagentsHome = process.env.DEEPAGENTS_HOME;
  const originalHomeDir = process.env.HOME_DIR;

  afterEach(() => {
    if (originalDeepagentsHome === undefined) delete process.env.DEEPAGENTS_HOME;
    else process.env.DEEPAGENTS_HOME = originalDeepagentsHome;
    if (originalHomeDir === undefined) delete process.env.HOME_DIR;
    else process.env.HOME_DIR = originalHomeDir;
  });

  describe("getDeepagentsHome", () => {
    it("is unset when DEEPAGENTS_HOME is absent or blank", () => {
      delete process.env.DEEPAGENTS_HOME;
      expect(getDeepagentsHome()).toBeUndefined();

      process.env.DEEPAGENTS_HOME = "   ";
      expect(getDeepagentsHome()).toBeUndefined();
    });

    it("accepts an absolute path, trimmed", () => {
      process.env.DEEPAGENTS_HOME = "  /custom-deepagents  ";
      expect(getDeepagentsHome()).toBe(resolve("/custom-deepagents"));
    });

    it("expands a leading ~/ against the home directory, as dcode does", () => {
      process.env.HOME_DIR = "/rulesync-home";
      process.env.DEEPAGENTS_HOME = "~/profiles/work";
      expect(getDeepagentsHome()).toBe(resolve("/rulesync-home", "profiles", "work"));

      process.env.DEEPAGENTS_HOME = "~/";
      expect(getDeepagentsHome()).toBe(resolve("/rulesync-home"));
    });

    it("rejects the spellings dcode refuses to start with, naming the variable", () => {
      // A relative value would otherwise be resolved against the working
      // directory and produce a tree dcode never reads.
      process.env.DEEPAGENTS_HOME = "profiles/work";
      expect(() => getDeepagentsHome()).toThrow('Invalid DEEPAGENTS_HOME "profiles/work"');

      process.env.DEEPAGENTS_HOME = "~";
      expect(() => getDeepagentsHome()).toThrow("Invalid DEEPAGENTS_HOME");

      process.env.DEEPAGENTS_HOME = "~user/.deepagents";
      expect(() => getDeepagentsHome()).toThrow("Invalid DEEPAGENTS_HOME");
    });
  });

  describe("getDeepagentsRelativeDirPath", () => {
    it("keeps the canonical path in project scope and in global scope without an override", () => {
      process.env.DEEPAGENTS_HOME = "/custom-deepagents";
      expect(
        getDeepagentsRelativeDirPath({
          global: false,
          relativeDirPath: join(".deepagents", "skills"),
        }),
      ).toBe(join(".deepagents", "skills"));

      delete process.env.DEEPAGENTS_HOME;
      expect(
        getDeepagentsRelativeDirPath({
          global: true,
          relativeDirPath: join(".deepagents", "agent", "skills"),
        }),
      ).toBe(join(".deepagents", "agent", "skills"));
    });

    it("strips the .deepagents prefix when DEEPAGENTS_HOME is the profile root itself", () => {
      process.env.DEEPAGENTS_HOME = "/custom-deepagents";
      expect(
        getDeepagentsRelativeDirPath({
          global: true,
          relativeDirPath: join(".deepagents", "agent", "skills"),
        }),
      ).toBe(join("agent", "skills"));
      expect(getDeepagentsRelativeDirPath({ global: true, relativeDirPath: ".deepagents" })).toBe(
        ".",
      );
    });

    it("rejects a global path outside .deepagents", () => {
      process.env.DEEPAGENTS_HOME = "/custom-deepagents";
      expect(() =>
        getDeepagentsRelativeDirPath({ global: true, relativeDirPath: ".other" }),
      ).toThrow("deepagents global path must be within .deepagents");
      expect(() =>
        getDeepagentsRelativeDirPath({
          global: true,
          // Spelled out rather than `join`ed: `join` would normalize the
          // excursion away before the check ever saw it.
          relativeDirPath: ".deepagents/../.deepagents/agent",
        }),
      ).toThrow("deepagents global path must be within .deepagents");
    });
  });

  describe("getDeepagentsRulesyncOutputRoot", () => {
    it("keeps the rulesync source root under the rulesync home when the override is set", () => {
      // DEEPAGENTS_HOME redirects dcode's own output, but the `.rulesync/`
      // sources imported back out of it belong to the user, not the profile.
      process.env.HOME_DIR = "/rulesync-home";
      process.env.DEEPAGENTS_HOME = "/custom-deepagents";
      expect(
        getDeepagentsRulesyncOutputRoot({ nativeOutputRoot: "/custom-deepagents", global: true }),
      ).toBe("/rulesync-home");
      expect(getDeepagentsRulesyncOutputRoot({ nativeOutputRoot: "/project", global: false })).toBe(
        "/project",
      );

      delete process.env.DEEPAGENTS_HOME;
      expect(getDeepagentsRulesyncOutputRoot({ nativeOutputRoot: "/home", global: true })).toBe(
        "/home",
      );
    });
  });
});
