import { describe, expect, it } from "vitest";

import { createProgram } from "./program.js";

describe("createProgram", () => {
  it.each(["generate", "import", "convert", "fetch", "gitignore"])(
    "should mark ignore as deprecated in %s feature help",
    (commandName) => {
      const command = createProgram().commands.find(
        (candidate) => candidate.name() === commandName,
      );

      expect(command?.helpInformation()).toContain("ignore is deprecated, use permissions");
    },
  );

  it("should mark the ignore scaffold as deprecated in add help", () => {
    const command = createProgram().commands.find((candidate) => candidate.name() === "add");

    expect(command?.description()).toContain("ignore is deprecated; use permissions");
  });
});
