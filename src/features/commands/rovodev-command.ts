import { basename, join } from "node:path";

import { dump, load } from "js-yaml";

import {
  ROVODEV_DIR,
  ROVODEV_PROMPTS_DIR_PATH,
  ROVODEV_PROMPTS_FILE_NAME,
} from "../../constants/rovodev-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { readFileContent, readFileContentOrNull, toPosixPath } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { isPlainObject, isRecord } from "../../utils/type-guards.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

export type RovodevCommandParams = {
  name: string;
  description: string;
  body: string;
} & Omit<AiFileParams, "fileContent">;

/**
 * Rovo Dev CLI "saved prompts": a file-based custom-command surface made of a
 * `prompts.yml` manifest (`{ name, description, content_file }` entries) plus
 * per-prompt Markdown content files, discovered in repo-root `.rovodev/`, cwd
 * `.rovodev/`, and global `~/.rovodev/`, and invoked via `/prompts [title] [extra]`.
 *
 * This class represents a single prompt's **content file** — pure Markdown,
 * no frontmatter — written to `.rovodev/prompts/<name>.md` (project) or
 * `~/.rovodev/prompts/<name>.md` (global). The `name`/`description` are kept
 * on the instance (not serialized into the content file itself) so that
 * {@link RovodevCommand.getAuxiliaryFiles} can build the sibling
 * `prompts.yml` manifest that indexes every generated prompt.
 *
 * @see https://support.atlassian.com/rovo/docs/save-and-reuse-a-prompt-in-rovo-dev-cli/
 * @see https://support.atlassian.com/rovo/docs/rovo-dev-cli-commands/
 */
export class RovodevCommand extends ToolCommand {
  private readonly name: string;
  private readonly description: string;
  private readonly body: string;

  constructor({ name, description, body, ...rest }: RovodevCommandParams) {
    super({ ...rest, fileContent: body });
    this.name = name;
    this.description = description;
    this.body = body;

    if (rest.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: ROVODEV_PROMPTS_DIR_PATH,
    };
  }

  getName(): string {
    return this.name;
  }

  getDescription(): string {
    return this.description;
  }

  getBody(): string {
    return this.body;
  }

  validate(): ValidationResult {
    if (!this.name) {
      return {
        success: false,
        error: new Error(
          `${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: Rovo Dev saved-prompt name must not be empty`,
        ),
      };
    }
    return { success: true, error: null };
  }

  toRulesyncCommand(): RulesyncCommand {
    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      description: this.description,
    };
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      outputRoot: ".", // RulesyncCommand outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getRelativeFilePath(),
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): RovodevCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const relativeFilePath = rulesyncCommand.getRelativeFilePath();
    const name = basename(relativeFilePath, ".md");
    const paths = this.getSettablePaths({ global });

    return new RovodevCommand({
      outputRoot,
      name,
      description: rulesyncFrontmatter.description ?? "",
      body: rulesyncCommand.getBody(),
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      validate,
      global,
    });
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "rovodev",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<RovodevCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const body = (await readFileContent(filePath)).trim();
    const name = basename(relativeFilePath, ".md");
    const description = await lookupPromptDescription({ outputRoot, relativeFilePath, name });

    return new RovodevCommand({
      outputRoot,
      name,
      description,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      validate,
      global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolCommandForDeletionParams): RovodevCommand {
    return new RovodevCommand({
      outputRoot,
      name: basename(relativeFilePath, ".md"),
      description: "",
      body: "",
      relativeDirPath,
      relativeFilePath,
      validate: false,
      global,
    });
  }

  /**
   * Rebuilds `.rovodev/prompts.yml` (project) / `~/.rovodev/prompts.yml`
   * (global) from every `RovodevCommand` generated in this pass. The `prompts`
   * array is fully replaced with the current set of rulesync-managed prompts
   * (mirrors `RovodevMcp` fully replacing `mcpServers`); any other top-level
   * key in an existing manifest is preserved.
   */
  static async getAuxiliaryFiles({
    toolCommands,
    outputRoot = process.cwd(),
    global = false,
  }: {
    toolCommands: ToolCommand[];
    outputRoot?: string;
    global?: boolean;
  }): Promise<ToolFile[]> {
    const rovodevCommands = toolCommands.filter(
      (command): command is RovodevCommand => command instanceof RovodevCommand,
    );
    if (rovodevCommands.length === 0) {
      return [];
    }

    const manifestPath = join(outputRoot, ROVODEV_DIR, ROVODEV_PROMPTS_FILE_NAME);
    const existingContent = await readFileContentOrNull(manifestPath);
    let existing: Record<string, unknown> = {};
    if (existingContent) {
      try {
        const parsed = load(existingContent);
        // `isPlainObject` (not `isRecord`) rejects class instances / non-plain
        // objects for prototype-pollution hardening before this gets spread
        // into a new object below, mirroring rovodev-mcp.ts's convention.
        if (isPlainObject(parsed)) {
          existing = parsed;
        }
      } catch {
        // The existing manifest is not valid YAML; start fresh rather than
        // throwing, consistent with how a corrupt file is handled elsewhere.
      }
    }

    const prompts = rovodevCommands
      .map((command) => ({
        name: command.getName(),
        description: command.getDescription(),
        content_file: toPosixPath(join("prompts", command.getRelativeFilePath())),
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name));

    return [
      new RovodevPromptsManifest({
        outputRoot,
        relativeDirPath: ROVODEV_DIR,
        relativeFilePath: ROVODEV_PROMPTS_FILE_NAME,
        fileContent: dump({ ...existing, prompts }),
        global,
      }),
    ];
  }
}

/**
 * The `prompts` entry shape read back from `content_file`, matched against
 * either the resolved path (relative to `prompts.yml`, i.e. the `.rovodev/`
 * directory) or the entry `name`, to recover the `description` that isn't
 * stored in the content file itself.
 */
async function lookupPromptDescription({
  outputRoot,
  relativeFilePath,
  name,
}: {
  outputRoot: string;
  relativeFilePath: string;
  name: string;
}): Promise<string> {
  const manifestPath = join(outputRoot, ROVODEV_DIR, ROVODEV_PROMPTS_FILE_NAME);
  const manifestContent = await readFileContentOrNull(manifestPath);
  if (!manifestContent) {
    return "";
  }

  let parsed: unknown;
  try {
    parsed = load(manifestContent);
  } catch {
    return "";
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.prompts)) {
    return "";
  }

  const expectedContentFile = toPosixPath(join("prompts", relativeFilePath));
  const entry = parsed.prompts.find(
    (candidate: unknown) =>
      isRecord(candidate) &&
      (candidate.content_file === expectedContentFile || candidate.name === name),
  );

  return isRecord(entry) && typeof entry.description === "string" ? entry.description : "";
}

/**
 * The shared `.rovodev/prompts.yml` manifest that indexes every saved prompt.
 * Never deleted by orphan cleanup: it is regenerated (not individually
 * discovered) alongside the per-prompt content files it references.
 */
export class RovodevPromptsManifest extends ToolFile {
  override isDeletable(): boolean {
    return false;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
