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
 * Prompt the user to select skills via an interactive checkbox prompt.
 *
 * Extracted into its own module so tests can mock the prompt without
 * touching the terminal.
 *
 * @param availableSkills - Skill names discovered in the source repository
 * @param preselectedSkills - Skill names to pre-check (from --skills); when
 *   empty, all skills start checked
 * @returns The skill names the user selected
 */
export async function promptSkillSelection(params: {
  availableSkills: string[];
  preselectedSkills: string[];
}): Promise<string[]> {
  const { availableSkills, preselectedSkills } = params;

  try {
    return await checkbox({
      message: "Select skills to fetch",
      choices: availableSkills.map((name) => ({
        name,
        value: name,
        checked: preselectedSkills.length === 0 || preselectedSkills.includes(name),
      })),
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
