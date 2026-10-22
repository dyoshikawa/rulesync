import { describe, expect, it } from "vitest";

import { rulesyncTool, supportedOperationsByFeature } from "../mcp/tools.js";
import { MCP_OPTION_NAME_MAP, MCP_PARITY_EXCLUSIONS, mcpFeatureForCommand } from "./mcp-parity.js";
import { createProgram } from "./program.js";

type ShapeSchema = { shape: Record<string, unknown> };
type OptionalSchema = { def: { innerType: ShapeSchema } };

const program = createProgram();
const toolShape = (rulesyncTool.parameters as unknown as ShapeSchema).shape;
const mcpFeatures = new Set<string>(
  (toolShape.feature as unknown as { options: string[] }).options,
);

/** Keys of `<feature>Options`, or an empty list when the feature takes none. */
function mcpOptionKeys(feature: string): string[] {
  const optionsSchema = toolShape[`${feature}Options`] as OptionalSchema | undefined;
  return optionsSchema ? Object.keys(optionsSchema.def.innerType.shape) : [];
}

const commandExclusions: Record<string, string> = MCP_PARITY_EXCLUSIONS.commands;
const optionExclusions: Record<string, string> = MCP_PARITY_EXCLUSIONS.options;
const commandOptionExclusions: Record<
  string,
  Record<string, string>
> = MCP_PARITY_EXCLUSIONS.commandOptions;

const commands = program.commands.filter((command) => !(command.name() in commandExclusions));

describe("CLI / MCP parity", () => {
  it.each(commands.map((command) => command.name()))(
    "exposes the %s command as an MCP feature with a run operation",
    (name) => {
      const feature = mcpFeatureForCommand(name);
      expect(mcpFeatures).toContain(feature);
      // A file feature that happens to share the command's name (`mcp`,
      // `hooks`, ...) does not count: the command must be runnable.
      const operations: readonly string[] =
        supportedOperationsByFeature[feature as keyof typeof supportedOperationsByFeature] ?? [];
      expect(operations, `'${feature}' has no run operation`).toContain("run");
    },
  );

  it.each(commands.map((command) => [command.name(), command] as const))(
    "exposes every option and argument of %s",
    (name, command) => {
      const keys = new Set(mcpOptionKeys(mcpFeatureForCommand(name)));
      const excluded = commandOptionExclusions[name] ?? {};
      const cliNames = [
        ...command.registeredArguments.map((argument) => argument.name()),
        ...command.options.map((option) => option.attributeName()),
      ];
      const missing = cliNames
        .filter((cliName) => !(cliName in optionExclusions) && !(cliName in excluded))
        .filter((cliName) => !keys.has(MCP_OPTION_NAME_MAP[cliName] ?? cliName));

      expect(missing, `CLI options of '${name}' with no MCP counterpart`).toEqual([]);
    },
  );

  it("covers every program-level option", () => {
    const globalExclusions: Record<string, string> = MCP_PARITY_EXCLUSIONS.globalOptions;
    const missing = program.options
      .map((option) => option.attributeName())
      .filter((name) => !(name in globalExclusions));

    expect(missing).toEqual([]);
  });

  describe("exclusion list", () => {
    const commandNames = new Set(program.commands.map((command) => command.name()));
    const optionNamesOf = (commandName: string) =>
      new Set(
        program.commands
          .find((command) => command.name() === commandName)
          ?.options.map((option) => option.attributeName()) ?? [],
      );

    // Not also "has no MCP feature": the `mcp` feature name is taken by the
    // `.rulesync/mcp.jsonc` file operations, unrelated to the `mcp` command.
    it("names only commands that exist", () => {
      for (const name of Object.keys(commandExclusions)) {
        expect(commandNames, `stale command exclusion '${name}'`).toContain(name);
      }
    });

    it("names only program-level options that exist", () => {
      const programOptions = new Set(program.options.map((option) => option.attributeName()));
      for (const name of Object.keys(MCP_PARITY_EXCLUSIONS.globalOptions)) {
        expect(programOptions, `stale global option exclusion '${name}'`).toContain(name);
      }
    });

    it("names only options some exposed command still has", () => {
      const allOptions = new Set(commands.flatMap((command) => [...optionNamesOf(command.name())]));
      for (const name of Object.keys(optionExclusions)) {
        expect(allOptions, `stale option exclusion '${name}'`).toContain(name);
      }
    });

    it("keeps options excluded from every command out of every MCP options schema", () => {
      for (const feature of mcpFeatures) {
        const keys = mcpOptionKeys(feature);
        for (const name of Object.keys(optionExclusions)) {
          expect(keys, `'${feature}Options' accepts excluded option '${name}'`).not.toContain(
            MCP_OPTION_NAME_MAP[name] ?? name,
          );
        }
      }
    });

    it("names only per-command options that exist and are not exposed", () => {
      for (const [commandName, options] of Object.entries(commandOptionExclusions)) {
        expect(commandNames, `stale command '${commandName}'`).toContain(commandName);
        const keys = new Set(mcpOptionKeys(mcpFeatureForCommand(commandName)));
        for (const name of Object.keys(options)) {
          expect(
            optionNamesOf(commandName),
            `stale exclusion '${commandName} --${name}'`,
          ).toContain(name);
          expect(keys.has(MCP_OPTION_NAME_MAP[name] ?? name), `'${name}' is exposed`).toBe(false);
        }
      }
    });

    it("maps only option names some exposed command still has", () => {
      const allOptions = new Set(commands.flatMap((command) => [...optionNamesOf(command.name())]));
      for (const name of Object.keys(MCP_OPTION_NAME_MAP)) {
        expect(allOptions, `stale option name mapping '${name}'`).toContain(name);
      }
    });
  });

  it("maps command names to MCP features", () => {
    expect(mcpFeatureForCommand("release-notes")).toBe("releaseNotes");
    expect(mcpFeatureForCommand("generate")).toBe("generate");
  });
});
