import checkbox from "@inquirer/checkbox";

/**
 * Thrown when the user cancels the interactive skill selection (e.g. Ctrl+C).
 * Callers should treat this as a graceful cancel, not a failure.
 */
export class SkillSelectionCancelledError extends Error {
  constructor() {
    super("Skill selection was cancelled.");
    this.name = "SkillSelectionCancelledError";
  }
}

/**
 * Key bindings offered by the checkbox prompt, pinned rather than left to the
 * library default. Nothing is checked when the prompt opens, so `a` is the
 * shortcut that makes "fetch everything" a single keystroke and `i` covers the
 * inverse "everything except these" flow. `a` toggles: it checks everything
 * while anything is unchecked, and clears the list once all of it is checked.
 * Both keys are listed in the prompt's own help line, and spelling them out
 * here keeps the binding visible next to the empty default it exists for.
 */
const SKILL_PROMPT_SHORTCUTS = {
  all: "a",
  invert: "i",
} as const;

/**
 * Prompt the user to select skills via an interactive checkbox prompt.
 *
 * Extracted into its own module so tests can mock the prompt without
 * touching the terminal.
 *
 * @param availableSkills - Skill names discovered in the source repository
 * @param preselectedSkills - Skill names to pre-check (from --skills); when
 *   empty, every skill starts unchecked and the user opts in
 * @returns The skill names the user selected
 */
export async function promptSkillSelection(params: {
  availableSkills: string[];
  preselectedSkills: string[];
}): Promise<string[]> {
  const { availableSkills, preselectedSkills } = params;

  try {
    return await checkbox({
      message: `Select skills to fetch (press <${SKILL_PROMPT_SHORTCUTS.all}> to select/deselect all)`,
      choices: availableSkills.map((name) => ({
        name,
        value: name,
        // Start from nothing selected. Fetching writes files into the user's
        // project, so an unattended <enter> should fetch nothing rather than
        // every skill the source repository happens to publish.
        checked: preselectedSkills.includes(name),
      })),
      shortcuts: SKILL_PROMPT_SHORTCUTS,
    });
  } catch (error) {
    // @inquirer prompts reject with ExitPromptError when the user presses
    // Ctrl+C; surface that as a graceful cancel instead of a failure.
    if (error instanceof Error && error.name === "ExitPromptError") {
      throw new SkillSelectionCancelledError();
    }
    throw error;
  }
}

/**
 * Check whether the current process can run an interactive prompt.
 */
export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}
