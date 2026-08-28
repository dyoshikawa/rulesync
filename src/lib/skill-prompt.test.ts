import { describe, expect, it, vi } from "vitest";

import {
  isInteractiveTerminal,
  promptSkillSelection,
  SkillSelectionCancelledError,
} from "./skill-prompt.js";

const { checkboxMock } = vi.hoisted(() => ({
  checkboxMock: vi.fn(),
}));

vi.mock("@inquirer/checkbox", () => ({
  default: checkboxMock,
}));

describe("promptSkillSelection", () => {
  // The `shortcuts` assertions below are the point of this test as much as the
  // unchecked boxes are: starting from an empty selection is only reasonable
  // because <a> makes "fetch everything" one keystroke away.
  it("should check no skills when none are preselected", async () => {
    checkboxMock.mockResolvedValue([]);

    const selected = await promptSkillSelection({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: [],
    });

    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select skills to fetch (press <a> to select/deselect all)",
      choices: [
        { name: "skill-a", value: "skill-a", checked: false },
        { name: "skill-b", value: "skill-b", checked: false },
      ],
      shortcuts: { all: "a", invert: "i" },
    });
    expect(selected).toEqual([]);
  });

  it("should check only preselected skills when provided", async () => {
    checkboxMock.mockResolvedValue(["skill-b"]);

    const selected = await promptSkillSelection({
      availableSkills: ["skill-a", "skill-b"],
      preselectedSkills: ["skill-b"],
    });

    expect(checkboxMock).toHaveBeenCalledWith({
      message: "Select skills to fetch (press <a> to select/deselect all)",
      choices: [
        { name: "skill-a", value: "skill-a", checked: false },
        { name: "skill-b", value: "skill-b", checked: true },
      ],
      shortcuts: { all: "a", invert: "i" },
    });
    expect(selected).toEqual(["skill-b"]);
  });

  it("should mark entries that cannot be told apart on sight", async () => {
    checkboxMock.mockResolvedValue([]);
    // "skill" spelled with a Cyrillic U+0441 for the leading s: a different
    // directory that the terminal draws exactly like the Latin one.
    const lookalike = "\u0441kill";

    await promptSkillSelection({
      availableSkills: ["skill", lookalike],
      preselectedSkills: [],
    });

    // The value is still the real name, so a checked box writes the directory
    // it names and not its lookalike; only the label carries the warning.
    expect(checkboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          {
            name: "[!] another entry is the same name in a different script \u2014 skill",
            value: "skill",
            checked: false,
          },
          {
            name:
              "[!] another entry is the same name in a different script; " +
              `mixes characters from Cyrillic and Latin \u2014 ${lookalike}`,
            value: lookalike,
            checked: false,
          },
        ],
      }),
    );
  });

  it("should shorten a name too long to fit on one line", async () => {
    checkboxMock.mockResolvedValue([]);
    // Long enough to wrap on any terminal, and padded so the wrapped part could
    // be drawn to look like a second entry.
    const padded = `pdf${" ".repeat(100)}pdf`;

    await promptSkillSelection({ availableSkills: [padded], preselectedSkills: [] });

    // The value is untouched, so the shortened label still selects the skill it
    // names.
    expect(checkboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [{ name: `pdf${" ".repeat(69)}\u2026`, value: padded, checked: false }],
      }),
    );
  });

  it("should convert ExitPromptError (Ctrl+C) into SkillSelectionCancelledError", async () => {
    const exitError = new Error("User force closed the prompt");
    exitError.name = "ExitPromptError";
    checkboxMock.mockRejectedValue(exitError);

    await expect(
      promptSkillSelection({ availableSkills: ["skill-a"], preselectedSkills: [] }),
    ).rejects.toBeInstanceOf(SkillSelectionCancelledError);
  });

  it("should rethrow non-cancel errors from the prompt", async () => {
    checkboxMock.mockRejectedValue(new Error("terminal exploded"));

    await expect(
      promptSkillSelection({ availableSkills: ["skill-a"], preselectedSkills: [] }),
    ).rejects.toThrow("terminal exploded");
  });
});

describe("isInteractiveTerminal", () => {
  it("should reflect the TTY status of stdin and stdout", () => {
    const expected = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
    expect(isInteractiveTerminal()).toBe(expected);
  });
});
