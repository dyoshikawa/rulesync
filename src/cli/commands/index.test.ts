import { describe, expect, it } from "vitest";
import * as commands from "./index.js";

describe("cli/commands/index", () => {
  it("should export all command functions", () => {
    expect(commands.configCommand).toBeDefined();
    expect(commands.generateCommand).toBeDefined();
    expect(commands.gitignoreCommand).toBeDefined();
    expect(commands.importCommand).toBeDefined();
    expect(commands.initCommand).toBeDefined();
  });

  it("should export functions as expected types", () => {
    expect(typeof commands.configCommand).toBe("function");
    expect(typeof commands.generateCommand).toBe("function");
    expect(typeof commands.gitignoreCommand).toBe("function");
    expect(typeof commands.importCommand).toBe("function");
    expect(typeof commands.initCommand).toBe("function");
  });
});
