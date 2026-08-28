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
            name: "[!] another entry differs from it only by lookalike letters \u2014 skill",
            value: "skill",
            checked: false,
          },
          {
            name:
              "[!] another entry differs from it only by lookalike letters; " +
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
        choices: [{ name: `pdf${" ".repeat(68)}\u2026`, value: padded, checked: false }],
      }),
    );
  });

  it("should keep the note and the name together within one line", async () => {
    checkboxMock.mockResolvedValue([]);
    // Two entries that share a display form, so both carry a note, and a name
    // long enough that the note plus the name would wrap without a budget.
    const long = `pdf${"o".repeat(100)}`;
    const notedNames = ["skill", "Skill", long];

    await promptSkillSelection({ availableSkills: notedNames, preselectedSkills: [] });

    const choices = checkboxMock.mock.calls.at(-1)?.[0].choices as Array<{ name: string }>;
    for (const choice of choices) {
      // The budget is on the whole label, not on the name alone, so a long note
      // eats into the name rather than pushing it onto a second line.
      expect([...choice.name].length).toBeLessThanOrEqual(72);
    }
  });

  it("should number labels that two different names are shortened into", async () => {
    checkboxMock.mockResolvedValue([]);
    // Neither name is confusable in itself: they are only indistinguishable
    // once the prompt cuts them down, which is the prompt's own doing.
    const shared = "a".repeat(71);
    const first = `${shared}-official`;
    const second = `${shared}-not-official`;

    await promptSkillSelection({ availableSkills: [first, second], preselectedSkills: [] });

    expect(checkboxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          { name: `${shared}\u2026 (1)`, value: first, checked: false },
          { name: `${shared}\u2026 (2)`, value: second, checked: false },
        ],
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
