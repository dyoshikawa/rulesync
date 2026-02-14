#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli/index.ts
var import_commander = require("commander");

// src/constants/announcements.ts
var ANNOUNCEMENT = "".trim();

// src/types/features.ts
var import_mini = require("zod/mini");
var ALL_FEATURES = [
  "rules",
  "ignore",
  "mcp",
  "subagents",
  "commands",
  "skills",
  "hooks"
];
var ALL_FEATURES_WITH_WILDCARD = [...ALL_FEATURES, "*"];
var FeatureSchema = import_mini.z.enum(ALL_FEATURES);
var FeaturesSchema = import_mini.z.array(FeatureSchema);
var RulesyncFeaturesSchema = import_mini.z.union([
  import_mini.z.array(import_mini.z.enum(ALL_FEATURES_WITH_WILDCARD)),
  import_mini.z.record(import_mini.z.string(), import_mini.z.array(import_mini.z.enum(ALL_FEATURES_WITH_WILDCARD)))
]);

// src/utils/error.ts
var import_zod = require("zod");
function isZodErrorLike(error) {
  return error !== null && typeof error === "object" && "issues" in error && Array.isArray(error.issues) && error.issues.every(
    (issue) => issue !== null && typeof issue === "object" && "path" in issue && Array.isArray(issue.path) && "message" in issue && typeof issue.message === "string"
  );
}
function formatError(error) {
  if (error instanceof import_zod.ZodError || isZodErrorLike(error)) {
    return `Zod raw error: ${JSON.stringify(error.issues)}`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

// src/utils/logger.ts
var import_consola = require("consola");

// src/utils/vitest.ts
var isEnvTest = process.env.NODE_ENV === "test";

// src/utils/logger.ts
var Logger = class {
  _verbose = false;
  _silent = false;
  console = import_consola.consola.withDefaults({
    tag: "rulesync"
  });
  /**
   * Configure logger with verbose and silent mode settings.
   * Handles conflicting flags where silent takes precedence.
   * @param verbose - Enable verbose logging
   * @param silent - Enable silent mode (suppresses all output except errors)
   */
  configure({ verbose, silent }) {
    if (verbose && silent) {
      this._silent = false;
      this.warn("Both --verbose and --silent specified; --silent takes precedence");
    }
    this._silent = silent;
    this._verbose = verbose && !silent;
  }
  get verbose() {
    return this._verbose;
  }
  get silent() {
    return this._silent;
  }
  info(message, ...args) {
    if (isEnvTest || this._silent) return;
    this.console.info(message, ...args);
  }
  // Success (always shown unless silent)
  success(message, ...args) {
    if (isEnvTest || this._silent) return;
    this.console.success(message, ...args);
  }
  // Warning (always shown unless silent)
  warn(message, ...args) {
    if (isEnvTest || this._silent) return;
    this.console.warn(message, ...args);
  }
  // Error (always shown, even in silent mode)
  error(message, ...args) {
    if (isEnvTest) return;
    this.console.error(message, ...args);
  }
  // Debug level (shown only in verbose mode)
  debug(message, ...args) {
    if (isEnvTest || this._silent) return;
    if (this._verbose) {
      this.console.info(message, ...args);
    }
  }
};
var logger = new Logger();

// src/lib/fetch.ts
var import_promise = require("es-toolkit/promise");
var import_node_path109 = require("path");

// src/constants/rulesync-paths.ts
var import_node_path = require("path");
var RULESYNC_CONFIG_RELATIVE_FILE_PATH = "rulesync.jsonc";
var RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH = "rulesync.local.jsonc";
var RULESYNC_RELATIVE_DIR_PATH = ".rulesync";
var RULESYNC_RULES_RELATIVE_DIR_PATH = (0, import_node_path.join)(RULESYNC_RELATIVE_DIR_PATH, "rules");
var RULESYNC_COMMANDS_RELATIVE_DIR_PATH = (0, import_node_path.join)(RULESYNC_RELATIVE_DIR_PATH, "commands");
var RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH = (0, import_node_path.join)(RULESYNC_RELATIVE_DIR_PATH, "subagents");
var RULESYNC_MCP_RELATIVE_FILE_PATH = (0, import_node_path.join)(RULESYNC_RELATIVE_DIR_PATH, "mcp.json");
var RULESYNC_HOOKS_RELATIVE_FILE_PATH = (0, import_node_path.join)(RULESYNC_RELATIVE_DIR_PATH, "hooks.json");
var RULESYNC_AIIGNORE_FILE_NAME = ".aiignore";
var RULESYNC_AIIGNORE_RELATIVE_FILE_PATH = (0, import_node_path.join)(RULESYNC_RELATIVE_DIR_PATH, ".aiignore");
var RULESYNC_IGNORE_RELATIVE_FILE_PATH = ".rulesyncignore";
var RULESYNC_OVERVIEW_FILE_NAME = "overview.md";
var RULESYNC_SKILLS_RELATIVE_DIR_PATH = (0, import_node_path.join)(RULESYNC_RELATIVE_DIR_PATH, "skills");
var RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH = (0, import_node_path.join)(
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  ".curated"
);
var RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH = "rulesync.lock";
var RULESYNC_MCP_FILE_NAME = "mcp.json";
var RULESYNC_HOOKS_FILE_NAME = "hooks.json";
var MAX_FILE_SIZE = 10 * 1024 * 1024;
var FETCH_CONCURRENCY_LIMIT = 10;

// src/features/commands/commands-processor.ts
var import_node_path19 = require("path");
var import_mini11 = require("zod/mini");

// src/utils/file.ts
var import_es_toolkit = require("es-toolkit");
var import_globby = require("globby");
var import_promises = require("fs/promises");
var import_node_os = __toESM(require("os"), 1);
var import_node_path2 = require("path");
async function ensureDir(dirPath) {
  try {
    await (0, import_promises.stat)(dirPath);
  } catch {
    await (0, import_promises.mkdir)(dirPath, { recursive: true });
  }
}
async function readOrInitializeFileContent(filePath, initialContent = "") {
  if (await fileExists(filePath)) {
    return await readFileContent(filePath);
  } else {
    await ensureDir((0, import_node_path2.dirname)(filePath));
    await writeFileContent(filePath, initialContent);
    return initialContent;
  }
}
function checkPathTraversal({
  relativePath,
  intendedRootDir
}) {
  const segments = relativePath.split(/[/\\]/);
  if (segments.includes("..")) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
  const resolved = (0, import_node_path2.resolve)(intendedRootDir, relativePath);
  const rel = (0, import_node_path2.relative)(intendedRootDir, resolved);
  if (rel.startsWith("..") || (0, import_node_path2.resolve)(resolved) !== resolved) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
}
function resolvePath(relativePath, baseDir) {
  if (!baseDir) return relativePath;
  checkPathTraversal({ relativePath, intendedRootDir: baseDir });
  return (0, import_node_path2.resolve)(baseDir, relativePath);
}
async function directoryExists(dirPath) {
  try {
    const stats = await (0, import_promises.stat)(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
async function readFileContent(filepath) {
  logger.debug(`Reading file: ${filepath}`);
  return (0, import_promises.readFile)(filepath, "utf-8");
}
async function readFileContentOrNull(filepath) {
  if (await fileExists(filepath)) {
    return readFileContent(filepath);
  }
  return null;
}
async function readFileBuffer(filepath) {
  logger.debug(`Reading file buffer: ${filepath}`);
  return (0, import_promises.readFile)(filepath);
}
function addTrailingNewline(content) {
  if (!content) {
    return "\n";
  }
  return content.trimEnd() + "\n";
}
async function writeFileContent(filepath, content) {
  logger.debug(`Writing file: ${filepath}`);
  await ensureDir((0, import_node_path2.dirname)(filepath));
  await (0, import_promises.writeFile)(filepath, content, "utf-8");
}
async function fileExists(filepath) {
  try {
    await (0, import_promises.stat)(filepath);
    return true;
  } catch {
    return false;
  }
}
async function listDirectoryFiles(dir) {
  try {
    return await (0, import_promises.readdir)(dir);
  } catch {
    return [];
  }
}
async function findFilesByGlobs(globs, options = {}) {
  const { type = "all" } = options;
  const globbyOptions = type === "file" ? { onlyFiles: true, onlyDirectories: false } : type === "dir" ? { onlyFiles: false, onlyDirectories: true } : { onlyFiles: false, onlyDirectories: false };
  const normalizedGlobs = Array.isArray(globs) ? globs.map((g) => g.replaceAll("\\", "/")) : globs.replaceAll("\\", "/");
  const results = (0, import_globby.globbySync)(normalizedGlobs, { absolute: true, ...globbyOptions });
  return results.toSorted();
}
async function removeDirectory(dirPath) {
  const dangerousPaths = [".", "/", "~", "src", "node_modules"];
  if (dangerousPaths.includes(dirPath) || dirPath === "") {
    logger.warn(`Skipping deletion of dangerous path: ${dirPath}`);
    return;
  }
  try {
    if (await fileExists(dirPath)) {
      await (0, import_promises.rm)(dirPath, { recursive: true, force: true });
    }
  } catch (error) {
    logger.warn(`Failed to remove directory ${dirPath}:`, error);
  }
}
async function removeFile(filepath) {
  logger.debug(`Removing file: ${filepath}`);
  try {
    if (await fileExists(filepath)) {
      await (0, import_promises.rm)(filepath);
    }
  } catch (error) {
    logger.warn(`Failed to remove file ${filepath}:`, error);
  }
}
function getHomeDirectory() {
  if (isEnvTest) {
    throw new Error("getHomeDirectory() must be mocked in test environment");
  }
  return import_node_os.default.homedir();
}
function validateBaseDir(baseDir) {
  if (baseDir.trim() === "") {
    throw new Error("baseDir cannot be an empty string");
  }
  checkPathTraversal({ relativePath: baseDir, intendedRootDir: process.cwd() });
}
function toKebabCaseFilename(filename) {
  const lastDotIndex = filename.lastIndexOf(".");
  const extension = lastDotIndex > 0 ? filename.slice(lastDotIndex) : "";
  const nameWithoutExt = lastDotIndex > 0 ? filename.slice(0, lastDotIndex) : filename;
  const kebabName = (0, import_es_toolkit.kebabCase)(nameWithoutExt);
  return kebabName + extension;
}
async function createTempDirectory(prefix = "rulesync-fetch-") {
  return (0, import_promises.mkdtemp)((0, import_node_path2.join)(import_node_os.default.tmpdir(), prefix));
}
async function removeTempDirectory(tempDir) {
  try {
    await (0, import_promises.rm)(tempDir, { recursive: true, force: true });
    logger.debug(`Removed temp directory: ${tempDir}`);
  } catch {
    logger.debug(`Failed to clean up temp directory: ${tempDir}`);
  }
}

// src/types/feature-processor.ts
var FeatureProcessor = class {
  baseDir;
  dryRun;
  constructor({ baseDir = process.cwd(), dryRun = false }) {
    this.baseDir = baseDir;
    this.dryRun = dryRun;
  }
  /**
   * Return tool targets that this feature supports.
   */
  static getToolTargets(_params = {}) {
    throw new Error("Not implemented");
  }
  /**
   * Once converted to rulesync/tool files, write them to the filesystem.
   * Returns the count and paths of files written.
   */
  async writeAiFiles(aiFiles) {
    let changedCount = 0;
    const changedPaths = [];
    for (const aiFile of aiFiles) {
      const filePath = aiFile.getFilePath();
      const contentWithNewline = addTrailingNewline(aiFile.getFileContent());
      const existingContent = await readFileContentOrNull(filePath);
      if (existingContent === contentWithNewline) {
        continue;
      }
      if (this.dryRun) {
        logger.info(`[DRY RUN] Would write: ${filePath}`);
      } else {
        await writeFileContent(filePath, contentWithNewline);
      }
      changedCount++;
      changedPaths.push(aiFile.getRelativePathFromCwd());
    }
    return { count: changedCount, paths: changedPaths };
  }
  async removeAiFiles(aiFiles) {
    for (const aiFile of aiFiles) {
      await removeFile(aiFile.getFilePath());
    }
  }
  /**
   * Remove orphan files that exist in the tool directory but not in the generated files.
   * This only deletes files that are no longer in the rulesync source, not files that will be overwritten.
   */
  async removeOrphanAiFiles(existingFiles, generatedFiles) {
    const generatedPaths = new Set(generatedFiles.map((f) => f.getFilePath()));
    const orphanFiles = existingFiles.filter((f) => !generatedPaths.has(f.getFilePath()));
    for (const aiFile of orphanFiles) {
      const filePath = aiFile.getFilePath();
      if (this.dryRun) {
        logger.info(`[DRY RUN] Would delete: ${filePath}`);
      } else {
        await removeFile(filePath);
      }
    }
    return orphanFiles.length;
  }
};

// src/features/commands/agentsmd-command.ts
var import_node_path5 = require("path");

// src/utils/frontmatter.ts
var import_gray_matter = __toESM(require("gray-matter"), 1);
function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function deepRemoveNullishValue(value) {
  if (value === null || value === void 0) {
    return void 0;
  }
  if (Array.isArray(value)) {
    const cleanedArray = value.map((item) => deepRemoveNullishValue(item)).filter((item) => item !== void 0);
    return cleanedArray;
  }
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      const cleaned = deepRemoveNullishValue(val);
      if (cleaned !== void 0) {
        result[key] = cleaned;
      }
    }
    return result;
  }
  return value;
}
function deepRemoveNullishObject(obj) {
  if (!obj || typeof obj !== "object") {
    return {};
  }
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    const cleaned = deepRemoveNullishValue(val);
    if (cleaned !== void 0) {
      result[key] = cleaned;
    }
  }
  return result;
}
function stringifyFrontmatter(body, frontmatter) {
  const cleanFrontmatter = deepRemoveNullishObject(frontmatter);
  return import_gray_matter.default.stringify(body, cleanFrontmatter);
}
function parseFrontmatter(content) {
  const { data: frontmatter, content: body } = (0, import_gray_matter.default)(content);
  return { frontmatter, body };
}

// src/features/commands/simulated-command.ts
var import_node_path4 = require("path");
var import_mini2 = require("zod/mini");

// src/types/ai-file.ts
var import_node_path3 = __toESM(require("path"), 1);
var AiFile = class {
  /**
   * @example "."
   */
  baseDir;
  /**
   * @example ".claude/agents"
   */
  relativeDirPath;
  /**
   * @example "planner.md"
   */
  relativeFilePath;
  /**
   * Whole raw file content
   */
  fileContent;
  /**
   * @example true
   */
  global;
  constructor({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    fileContent,
    global = false
  }) {
    this.baseDir = baseDir;
    this.relativeDirPath = relativeDirPath;
    this.relativeFilePath = relativeFilePath;
    this.fileContent = fileContent;
    this.global = global;
  }
  static async fromFile(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  getBaseDir() {
    return this.baseDir;
  }
  getRelativeDirPath() {
    return this.relativeDirPath;
  }
  getRelativeFilePath() {
    return this.relativeFilePath;
  }
  getFilePath() {
    const fullPath = import_node_path3.default.join(this.baseDir, this.relativeDirPath, this.relativeFilePath);
    const resolvedFull = (0, import_node_path3.resolve)(fullPath);
    const resolvedBase = (0, import_node_path3.resolve)(this.baseDir);
    const rel = (0, import_node_path3.relative)(resolvedBase, resolvedFull);
    if (rel.startsWith("..") || import_node_path3.default.isAbsolute(rel)) {
      throw new Error(
        `Path traversal detected: Final path escapes baseDir. baseDir="${this.baseDir}", relativeDirPath="${this.relativeDirPath}", relativeFilePath="${this.relativeFilePath}"`
      );
    }
    return fullPath;
  }
  getFileContent() {
    return this.fileContent;
  }
  getRelativePathFromCwd() {
    return import_node_path3.default.join(this.relativeDirPath, this.relativeFilePath);
  }
  setFileContent(newFileContent) {
    this.fileContent = newFileContent;
  }
  /**
   * Returns whether this file can be deleted by rulesync.
   * Override in subclasses that should not be deleted (e.g., user-managed config files).
   */
  isDeletable() {
    return true;
  }
};

// src/features/commands/tool-command.ts
var ToolCommand = class extends AiFile {
  static getSettablePaths() {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Load a command from a tool-specific file path.
   *
   * This method should:
   * 1. Read the file content
   * 2. Parse tool-specific frontmatter format
   * 3. Validate the parsed data
   * 4. Return a concrete ToolCommand instance
   *
   * @param params - Parameters including the file path to load
   * @returns Promise resolving to a concrete ToolCommand instance
   */
  static async fromFile(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse file content, making it safe to use
   * even when files have old/incompatible formats.
   *
   * @param params - Parameters including the file path
   * @returns A concrete ToolCommand instance with minimal data for deletion
   */
  static forDeletion(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Convert a RulesyncCommand to the tool-specific command format.
   *
   * This method should:
   * 1. Extract relevant data from the RulesyncCommand
   * 2. Transform frontmatter to tool-specific format
   * 3. Transform body content if needed
   * 4. Return a concrete ToolCommand instance
   *
   * @param params - Parameters including the RulesyncCommand to convert
   * @returns A concrete ToolCommand instance
   */
  static fromRulesyncCommand(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Check if this tool is targeted by a RulesyncCommand based on its targets field.
   * Subclasses should override this to provide specific targeting logic.
   *
   * @param rulesyncCommand - The RulesyncCommand to check
   * @returns True if this tool is targeted by the command
   */
  static isTargetedByRulesyncCommand(_rulesyncCommand) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Default implementation for checking if a tool is targeted by a RulesyncCommand.
   * Checks if the command's targets include the tool target or a wildcard.
   *
   * @param params - Parameters including the RulesyncCommand and tool target
   * @returns True if the tool target is included in the command's targets
   */
  static isTargetedByRulesyncCommandDefault({
    rulesyncCommand,
    toolTarget
  }) {
    const targets = rulesyncCommand.getFrontmatter().targets;
    if (!targets) {
      return true;
    }
    if (targets.includes("*")) {
      return true;
    }
    if (targets.includes(toolTarget)) {
      return true;
    }
    return false;
  }
};

// src/features/commands/simulated-command.ts
var SimulatedCommandFrontmatterSchema = import_mini2.z.object({
  description: import_mini2.z.string()
});
var SimulatedCommand = class _SimulatedCommand extends ToolCommand {
  frontmatter;
  body;
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate) {
      const result = SimulatedCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path4.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter)
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  getBody() {
    return this.body;
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  toRulesyncCommand() {
    throw new Error("Not implemented because it is a SIMULATED file.");
  }
  static fromRulesyncCommandDefault({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true
  }) {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const claudecodeFrontmatter = {
      description: rulesyncFrontmatter.description
    };
    const body = rulesyncCommand.getBody();
    return {
      baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate
    };
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = SimulatedCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path4.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  static async fromFileDefault({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const filePath = (0, import_node_path4.join)(
      baseDir,
      _SimulatedCommand.getSettablePaths().relativeDirPath,
      relativeFilePath
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = SimulatedCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return {
      baseDir,
      relativeDirPath: _SimulatedCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: (0, import_node_path4.basename)(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate
    };
  }
  static forDeletionDefault({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return {
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false
    };
  }
};

// src/features/commands/agentsmd-command.ts
var AgentsmdCommand = class _AgentsmdCommand extends SimulatedCommand {
  static getSettablePaths() {
    return {
      relativeDirPath: (0, import_node_path5.join)(".agents", "commands")
    };
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true
  }) {
    return new _AgentsmdCommand(
      this.fromRulesyncCommandDefault({ baseDir, rulesyncCommand, validate })
    );
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const filePath = (0, import_node_path5.join)(
      baseDir,
      _AgentsmdCommand.getSettablePaths().relativeDirPath,
      relativeFilePath
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = SimulatedCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return new _AgentsmdCommand({
      baseDir,
      relativeDirPath: _AgentsmdCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: (0, import_node_path5.basename)(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate
    });
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "agentsmd"
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _AgentsmdCommand(
      this.forDeletionDefault({ baseDir, relativeDirPath, relativeFilePath })
    );
  }
};

// src/features/commands/antigravity-command.ts
var import_node_path7 = require("path");
var import_mini5 = require("zod/mini");

// src/utils/type-guards.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/features/commands/rulesync-command.ts
var import_node_path6 = require("path");
var import_mini4 = require("zod/mini");

// src/types/rulesync-file.ts
var RulesyncFile = class extends AiFile {
  static async fromFile(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
};

// src/types/tool-targets.ts
var import_mini3 = require("zod/mini");
var ALL_TOOL_TARGETS = [
  "agentsmd",
  "agentsskills",
  "antigravity",
  "augmentcode",
  "augmentcode-legacy",
  "claudecode",
  "claudecode-legacy",
  "cline",
  "codexcli",
  "copilot",
  "cursor",
  "factorydroid",
  "geminicli",
  "junie",
  "kilo",
  "kiro",
  "opencode",
  "qwencode",
  "replit",
  "roo",
  "warp",
  "windsurf",
  "zed"
];
var ALL_TOOL_TARGETS_WITH_WILDCARD = [...ALL_TOOL_TARGETS, "*"];
var ToolTargetSchema = import_mini3.z.enum(ALL_TOOL_TARGETS);
var ToolTargetsSchema = import_mini3.z.array(ToolTargetSchema);
var RulesyncTargetsSchema = import_mini3.z.array(import_mini3.z.enum(ALL_TOOL_TARGETS_WITH_WILDCARD));

// src/features/commands/rulesync-command.ts
var RulesyncCommandFrontmatterSchema = import_mini4.z.looseObject({
  targets: import_mini4.z._default(RulesyncTargetsSchema, ["*"]),
  description: import_mini4.z.string()
});
var RulesyncCommand = class _RulesyncCommand extends RulesyncFile {
  frontmatter;
  body;
  constructor({ frontmatter, body, ...rest }) {
    const parseResult = RulesyncCommandFrontmatterSchema.safeParse(frontmatter);
    if (!parseResult.success && rest.validate) {
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path6.join)(rest.baseDir ?? process.cwd(), rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(parseResult.error)}`
      );
    }
    const parsedFrontmatter = parseResult.success ? { ...frontmatter, ...parseResult.data } : { ...frontmatter, targets: frontmatter.targets ?? ["*"] };
    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, parsedFrontmatter)
    });
    this.frontmatter = parsedFrontmatter;
    this.body = body;
  }
  static getSettablePaths() {
    return {
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH
    };
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  getBody() {
    return this.body;
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = RulesyncCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path6.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  static async fromFile({
    relativeFilePath
  }) {
    const filePath = (0, import_node_path6.join)(
      process.cwd(),
      _RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = RulesyncCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${relativeFilePath}: ${formatError(result.error)}`);
    }
    const filename = (0, import_node_path6.basename)(relativeFilePath);
    return new _RulesyncCommand({
      baseDir: process.cwd(),
      relativeDirPath: _RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: filename,
      frontmatter: result.data,
      body: content.trim(),
      fileContent
    });
  }
};

// src/features/commands/antigravity-command.ts
var AntigravityWorkflowFrontmatterSchema = import_mini5.z.looseObject({
  trigger: import_mini5.z.optional(import_mini5.z.string()),
  turbo: import_mini5.z.optional(import_mini5.z.boolean())
});
var AntigravityCommandFrontmatterSchema = import_mini5.z.looseObject({
  description: import_mini5.z.string(),
  // Support for workflow-specific configuration
  ...AntigravityWorkflowFrontmatterSchema.shape
});
var AntigravityCommand = class _AntigravityCommand extends ToolCommand {
  frontmatter;
  body;
  static getSettablePaths() {
    return {
      relativeDirPath: (0, import_node_path7.join)(".agent", "workflows")
    };
  }
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate) {
      const result = AntigravityCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path7.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter)
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  getBody() {
    return this.body;
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  toRulesyncCommand() {
    const { description, ...restFields } = this.frontmatter;
    const rulesyncFrontmatter = {
      targets: ["antigravity"],
      description,
      // Preserve extra fields in antigravity section
      ...Object.keys(restFields).length > 0 && { antigravity: restFields }
    };
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);
    return new RulesyncCommand({
      baseDir: ".",
      // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true
    });
  }
  static extractAntigravityConfig(rulesyncCommand) {
    const antigravity = rulesyncCommand.getFrontmatter().antigravity;
    return isRecord(antigravity) ? antigravity : void 0;
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true
  }) {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const antigravityConfig = this.extractAntigravityConfig(rulesyncCommand);
    const trigger = this.resolveTrigger(rulesyncCommand, antigravityConfig);
    const turbo = typeof antigravityConfig?.turbo === "boolean" ? antigravityConfig.turbo : true;
    let relativeFilePath = rulesyncCommand.getRelativeFilePath();
    let body = rulesyncCommand.getBody().replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
    const sanitizedTrigger = trigger.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/^-+|-+$/g, "");
    if (!sanitizedTrigger) {
      throw new Error(`Invalid trigger: sanitization resulted in empty string from "${trigger}"`);
    }
    const validFilename = sanitizedTrigger + ".md";
    relativeFilePath = validFilename;
    const turboDirective = turbo ? "\n\n// turbo" : "";
    body = `# Workflow: ${trigger}

${body}${turboDirective}`;
    const description = rulesyncFrontmatter.description;
    const antigravityFrontmatter = {
      description,
      trigger,
      turbo
    };
    const fileContent = stringifyFrontmatter(body, antigravityFrontmatter);
    return new _AntigravityCommand({
      baseDir,
      frontmatter: antigravityFrontmatter,
      body,
      relativeDirPath: _AntigravityCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
      fileContent,
      validate
    });
  }
  static resolveTrigger(rulesyncCommand, antigravityConfig) {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const antigravityTrigger = antigravityConfig && typeof antigravityConfig.trigger === "string" ? antigravityConfig.trigger : void 0;
    const rootTrigger = typeof rulesyncFrontmatter.trigger === "string" ? rulesyncFrontmatter.trigger : void 0;
    const bodyTriggerMatch = rulesyncCommand.getBody().match(/trigger:\s*(\/[\w-]+)/);
    const filenameTrigger = `/${(0, import_node_path7.basename)(rulesyncCommand.getRelativeFilePath(), ".md")}`;
    return antigravityTrigger || rootTrigger || (bodyTriggerMatch ? bodyTriggerMatch[1] : void 0) || filenameTrigger;
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = AntigravityCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path7.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "antigravity"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const filePath = (0, import_node_path7.join)(
      baseDir,
      _AntigravityCommand.getSettablePaths().relativeDirPath,
      relativeFilePath
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = AntigravityCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return new _AntigravityCommand({
      baseDir,
      relativeDirPath: _AntigravityCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: (0, import_node_path7.basename)(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _AntigravityCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      fileContent: "",
      validate: false
    });
  }
};

// src/features/commands/claudecode-command.ts
var import_node_path8 = require("path");
var import_mini6 = require("zod/mini");
var ClaudecodeCommandFrontmatterSchema = import_mini6.z.looseObject({
  description: import_mini6.z.string(),
  "allowed-tools": import_mini6.z.optional(import_mini6.z.union([import_mini6.z.string(), import_mini6.z.array(import_mini6.z.string())])),
  "argument-hint": import_mini6.z.optional(import_mini6.z.string()),
  model: import_mini6.z.optional(import_mini6.z.string()),
  "disable-model-invocation": import_mini6.z.optional(import_mini6.z.boolean())
});
var ClaudecodeCommand = class _ClaudecodeCommand extends ToolCommand {
  frontmatter;
  body;
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate) {
      const result = ClaudecodeCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path8.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter)
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  static getSettablePaths(_options = {}) {
    return {
      relativeDirPath: (0, import_node_path8.join)(".claude", "commands")
    };
  }
  getBody() {
    return this.body;
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  toRulesyncCommand() {
    const { description, ...restFields } = this.frontmatter;
    const rulesyncFrontmatter = {
      targets: ["*"],
      description,
      // Preserve extra fields in claudecode section
      ...Object.keys(restFields).length > 0 && { claudecode: restFields }
    };
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);
    return new RulesyncCommand({
      baseDir: ".",
      // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true
    });
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false
  }) {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const claudecodeFields = rulesyncFrontmatter.claudecode ?? {};
    const claudecodeFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...claudecodeFields
    };
    const body = rulesyncCommand.getBody();
    const paths = this.getSettablePaths({ global });
    return new _ClaudecodeCommand({
      baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate
    });
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = ClaudecodeCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path8.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "claudecode"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const filePath = (0, import_node_path8.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = ClaudecodeCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return new _ClaudecodeCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: (0, import_node_path8.basename)(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _ClaudecodeCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false
    });
  }
};

// src/features/commands/cline-command.ts
var import_node_path9 = require("path");
var ClineCommand = class _ClineCommand extends ToolCommand {
  static getSettablePaths({ global } = {}) {
    if (global) {
      return {
        relativeDirPath: (0, import_node_path9.join)("Documents", "Cline", "Workflows")
      };
    }
    return {
      relativeDirPath: (0, import_node_path9.join)(".clinerules", "workflows")
    };
  }
  toRulesyncCommand() {
    const rulesyncFrontmatter = {
      targets: ["*"],
      description: ""
    };
    return new RulesyncCommand({
      baseDir: process.cwd(),
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: this.getFileContent(),
      validate: true
    });
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    return new _ClineCommand({
      baseDir,
      fileContent: rulesyncCommand.getBody(),
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate
    });
  }
  validate() {
    return { success: true, error: null };
  }
  getBody() {
    return this.getFileContent();
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "cline"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const filePath = (0, import_node_path9.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { body: content } = parseFrontmatter(fileContent);
    return new _ClineCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: (0, import_node_path9.basename)(relativeFilePath),
      fileContent: content.trim(),
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _ClineCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/commands/codexcli-command.ts
var import_node_path10 = require("path");
var CodexcliCommand = class _CodexcliCommand extends ToolCommand {
  static getSettablePaths({ global } = {}) {
    if (!global) {
      throw new Error("CodexcliCommand only supports global mode. Please pass { global: true }.");
    }
    return {
      relativeDirPath: (0, import_node_path10.join)(".codex", "prompts")
    };
  }
  toRulesyncCommand() {
    const rulesyncFrontmatter = {
      targets: ["*"],
      description: ""
    };
    return new RulesyncCommand({
      baseDir: ".",
      // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: this.getFileContent(),
      validate: true
    });
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    return new _CodexcliCommand({
      baseDir,
      fileContent: rulesyncCommand.getBody(),
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate
    });
  }
  validate() {
    return { success: true, error: null };
  }
  getBody() {
    return this.getFileContent();
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "codexcli"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const filePath = (0, import_node_path10.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { body: content } = parseFrontmatter(fileContent);
    return new _CodexcliCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: (0, import_node_path10.basename)(relativeFilePath),
      fileContent: content.trim(),
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _CodexcliCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/commands/copilot-command.ts
var import_node_path11 = require("path");
var import_mini7 = require("zod/mini");
var CopilotCommandFrontmatterSchema = import_mini7.z.looseObject({
  mode: import_mini7.z.optional(import_mini7.z.string()),
  description: import_mini7.z.string()
});
var CopilotCommand = class _CopilotCommand extends ToolCommand {
  frontmatter;
  body;
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate) {
      const result = CopilotCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path11.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter)
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  static getSettablePaths() {
    return {
      relativeDirPath: (0, import_node_path11.join)(".github", "prompts")
    };
  }
  getBody() {
    return this.body;
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  toRulesyncCommand() {
    const { mode: _mode, description, ...restFields } = this.frontmatter;
    const rulesyncFrontmatter = {
      targets: ["*"],
      description,
      // Preserve extra fields in copilot section (excluding mode which is fixed)
      ...Object.keys(restFields).length > 0 && { copilot: restFields }
    };
    const originalFilePath = this.relativeFilePath;
    const relativeFilePath = originalFilePath.replace(/\.prompt\.md$/, ".md");
    return new RulesyncCommand({
      baseDir: this.baseDir,
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
      fileContent: this.getFileContent(),
      validate: true
    });
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = CopilotCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path11.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true
  }) {
    const paths = this.getSettablePaths();
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const copilotFields = rulesyncFrontmatter.copilot ?? {};
    const copilotFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...copilotFields
    };
    const body = rulesyncCommand.getBody();
    const originalFilePath = rulesyncCommand.getRelativeFilePath();
    const relativeFilePath = originalFilePath.replace(/\.md$/, ".prompt.md");
    return new _CopilotCommand({
      baseDir,
      frontmatter: copilotFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      validate
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const paths = this.getSettablePaths();
    const filePath = (0, import_node_path11.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = CopilotCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return new _CopilotCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: (0, import_node_path11.basename)(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate
    });
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "copilot"
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _CopilotCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false
    });
  }
};

// src/features/commands/cursor-command.ts
var import_node_path12 = require("path");
var CursorCommand = class _CursorCommand extends ToolCommand {
  static getSettablePaths(_options = {}) {
    return {
      relativeDirPath: (0, import_node_path12.join)(".cursor", "commands")
    };
  }
  toRulesyncCommand() {
    const rulesyncFrontmatter = {
      targets: ["*"],
      description: ""
    };
    return new RulesyncCommand({
      baseDir: process.cwd(),
      // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: this.getFileContent(),
      validate: true
    });
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    return new _CursorCommand({
      baseDir,
      fileContent: rulesyncCommand.getBody(),
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate
    });
  }
  validate() {
    return { success: true, error: null };
  }
  getBody() {
    return this.getFileContent();
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "cursor"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const filePath = (0, import_node_path12.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { body: content } = parseFrontmatter(fileContent);
    return new _CursorCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: (0, import_node_path12.basename)(relativeFilePath),
      fileContent: content.trim(),
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _CursorCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/commands/factorydroid-command.ts
var import_node_path13 = require("path");
var FactorydroidCommand = class _FactorydroidCommand extends SimulatedCommand {
  static getSettablePaths(_options) {
    return {
      relativeDirPath: (0, import_node_path13.join)(".factory", "commands")
    };
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false
  }) {
    return new _FactorydroidCommand(
      this.fromRulesyncCommandDefault({ baseDir, rulesyncCommand, validate, global })
    );
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = _FactorydroidCommand.getSettablePaths({ global });
    const filePath = (0, import_node_path13.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = SimulatedCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return new _FactorydroidCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: (0, import_node_path13.basename)(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate
    });
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "factorydroid"
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _FactorydroidCommand(
      this.forDeletionDefault({ baseDir, relativeDirPath, relativeFilePath })
    );
  }
};

// src/features/commands/geminicli-command.ts
var import_node_path14 = require("path");
var import_smol_toml = require("smol-toml");
var import_mini8 = require("zod/mini");
var GeminiCliCommandFrontmatterSchema = import_mini8.z.looseObject({
  description: import_mini8.z.optional(import_mini8.z.string()),
  prompt: import_mini8.z.string()
});
var GeminiCliCommand = class _GeminiCliCommand extends ToolCommand {
  frontmatter;
  body;
  constructor(params) {
    super(params);
    const parsed = this.parseTomlContent(this.fileContent);
    this.frontmatter = parsed;
    this.body = parsed.prompt;
  }
  static getSettablePaths(_options = {}) {
    return {
      relativeDirPath: (0, import_node_path14.join)(".gemini", "commands")
    };
  }
  parseTomlContent(content) {
    try {
      const parsed = (0, import_smol_toml.parse)(content);
      const result = GeminiCliCommandFrontmatterSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in Gemini CLI command file: ${formatError(result.error)}`
        );
      }
      return {
        ...result.data,
        description: result.data.description || ""
      };
    } catch (error) {
      throw new Error(`Failed to parse TOML command file: ${error}`, { cause: error });
    }
  }
  getBody() {
    return this.body;
  }
  getFrontmatter() {
    return {
      description: this.frontmatter.description,
      prompt: this.frontmatter.prompt
    };
  }
  toRulesyncCommand() {
    const { description, prompt: _prompt, ...restFields } = this.frontmatter;
    const rulesyncFrontmatter = {
      targets: ["geminicli"],
      description: description ?? "",
      // Preserve extra fields in geminicli section (excluding prompt which is the body)
      ...Object.keys(restFields).length > 0 && { geminicli: restFields }
    };
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);
    return new RulesyncCommand({
      baseDir: process.cwd(),
      // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true
    });
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false
  }) {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const geminicliFields = rulesyncFrontmatter.geminicli ?? {};
    const geminiFrontmatter = {
      description: rulesyncFrontmatter.description,
      prompt: rulesyncCommand.getBody(),
      ...geminicliFields
    };
    const tomlContent = `description = "${geminiFrontmatter.description}"
prompt = """
${geminiFrontmatter.prompt}
"""`;
    const paths = this.getSettablePaths({ global });
    return new _GeminiCliCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath().replace(".md", ".toml"),
      fileContent: tomlContent,
      validate
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const filePath = (0, import_node_path14.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    return new _GeminiCliCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: (0, import_node_path14.basename)(relativeFilePath),
      fileContent,
      validate
    });
  }
  validate() {
    try {
      this.parseTomlContent(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "geminicli"
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    const placeholderToml = `description = ""
prompt = ""`;
    return new _GeminiCliCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: placeholderToml,
      validate: false
    });
  }
};

// src/features/commands/kilo-command.ts
var import_node_path15 = require("path");
var KiloCommand = class _KiloCommand extends ToolCommand {
  static getSettablePaths(_options = {}) {
    return {
      relativeDirPath: (0, import_node_path15.join)(".kilocode", "workflows")
    };
  }
  toRulesyncCommand() {
    const rulesyncFrontmatter = {
      targets: ["*"],
      description: ""
    };
    return new RulesyncCommand({
      baseDir: process.cwd(),
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: this.getFileContent(),
      validate: true
    });
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true
  }) {
    const paths = this.getSettablePaths();
    return new _KiloCommand({
      baseDir,
      fileContent: rulesyncCommand.getBody(),
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate
    });
  }
  validate() {
    return { success: true, error: null };
  }
  getBody() {
    return this.getFileContent();
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "kilo"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const paths = this.getSettablePaths();
    const filePath = (0, import_node_path15.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { body: content } = parseFrontmatter(fileContent);
    return new _KiloCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: (0, import_node_path15.basename)(relativeFilePath),
      fileContent: content.trim(),
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _KiloCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/commands/kiro-command.ts
var import_node_path16 = require("path");
var KiroCommand = class _KiroCommand extends ToolCommand {
  static getSettablePaths(_options = {}) {
    return {
      relativeDirPath: (0, import_node_path16.join)(".kiro", "prompts")
    };
  }
  toRulesyncCommand() {
    const rulesyncFrontmatter = {
      targets: ["*"],
      description: ""
    };
    return new RulesyncCommand({
      baseDir: process.cwd(),
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: this.getFileContent(),
      validate: true
    });
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true
  }) {
    const paths = this.getSettablePaths();
    return new _KiroCommand({
      baseDir,
      fileContent: rulesyncCommand.getBody(),
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate
    });
  }
  validate() {
    return { success: true, error: null };
  }
  getBody() {
    return this.getFileContent();
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "kiro"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const paths = this.getSettablePaths();
    const filePath = (0, import_node_path16.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { body: content } = parseFrontmatter(fileContent);
    return new _KiroCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: (0, import_node_path16.basename)(relativeFilePath),
      fileContent: content.trim(),
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _KiroCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/commands/opencode-command.ts
var import_node_path17 = require("path");
var import_mini9 = require("zod/mini");
var OpenCodeCommandFrontmatterSchema = import_mini9.z.looseObject({
  description: import_mini9.z.string(),
  agent: (0, import_mini9.optional)(import_mini9.z.string()),
  subtask: (0, import_mini9.optional)(import_mini9.z.boolean()),
  model: (0, import_mini9.optional)(import_mini9.z.string())
});
var OpenCodeCommand = class _OpenCodeCommand extends ToolCommand {
  frontmatter;
  body;
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate) {
      const result = OpenCodeCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path17.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter)
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  static getSettablePaths({ global } = {}) {
    return {
      relativeDirPath: global ? (0, import_node_path17.join)(".config", "opencode", "command") : (0, import_node_path17.join)(".opencode", "command")
    };
  }
  getBody() {
    return this.body;
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  toRulesyncCommand() {
    const { description, ...restFields } = this.frontmatter;
    const rulesyncFrontmatter = {
      targets: ["*"],
      description,
      ...Object.keys(restFields).length > 0 && { opencode: restFields }
    };
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);
    return new RulesyncCommand({
      baseDir: process.cwd(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true
    });
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false
  }) {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const opencodeFields = rulesyncFrontmatter.opencode ?? {};
    const opencodeFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...opencodeFields
    };
    const body = rulesyncCommand.getBody();
    const paths = this.getSettablePaths({ global });
    return new _OpenCodeCommand({
      baseDir,
      frontmatter: opencodeFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate
    });
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = OpenCodeCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    }
    return {
      success: false,
      error: new Error(
        `Invalid frontmatter in ${(0, import_node_path17.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
      )
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const filePath = (0, import_node_path17.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = OpenCodeCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return new _OpenCodeCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: (0, import_node_path17.basename)(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate
    });
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "opencode"
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _OpenCodeCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false
    });
  }
};

// src/features/commands/roo-command.ts
var import_node_path18 = require("path");
var import_mini10 = require("zod/mini");
var RooCommandFrontmatterSchema = import_mini10.z.looseObject({
  description: import_mini10.z.string(),
  "argument-hint": (0, import_mini10.optional)(import_mini10.z.string())
});
var RooCommand = class _RooCommand extends ToolCommand {
  frontmatter;
  body;
  static getSettablePaths() {
    return {
      relativeDirPath: (0, import_node_path18.join)(".roo", "commands")
    };
  }
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate) {
      const result = RooCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path18.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter)
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  getBody() {
    return this.body;
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  toRulesyncCommand() {
    const { description, ...restFields } = this.frontmatter;
    const rulesyncFrontmatter = {
      targets: ["roo"],
      description,
      // Preserve extra fields in roo section
      ...Object.keys(restFields).length > 0 && { roo: restFields }
    };
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);
    return new RulesyncCommand({
      baseDir: ".",
      // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true
    });
  }
  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true
  }) {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const rooFields = rulesyncFrontmatter.roo ?? {};
    const rooFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...rooFields
    };
    const body = rulesyncCommand.getBody();
    const fileContent = stringifyFrontmatter(body, rooFrontmatter);
    return new _RooCommand({
      baseDir,
      frontmatter: rooFrontmatter,
      body,
      relativeDirPath: _RooCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      fileContent,
      validate
    });
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = RooCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path18.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  static isTargetedByRulesyncCommand(rulesyncCommand) {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "roo"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const filePath = (0, import_node_path18.join)(baseDir, _RooCommand.getSettablePaths().relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = RooCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return new _RooCommand({
      baseDir,
      relativeDirPath: _RooCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: (0, import_node_path18.basename)(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _RooCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      fileContent: "",
      validate: false
    });
  }
};

// src/features/commands/commands-processor.ts
var commandsProcessorToolTargetTuple = [
  "agentsmd",
  "antigravity",
  "claudecode",
  "claudecode-legacy",
  "cline",
  "codexcli",
  "copilot",
  "cursor",
  "factorydroid",
  "geminicli",
  "kilo",
  "kiro",
  "opencode",
  "roo"
];
var CommandsProcessorToolTargetSchema = import_mini11.z.enum(commandsProcessorToolTargetTuple);
var toolCommandFactories = /* @__PURE__ */ new Map([
  [
    "agentsmd",
    {
      class: AgentsmdCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: false, isSimulated: true }
    }
  ],
  [
    "antigravity",
    {
      class: AntigravityCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: false, isSimulated: false }
    }
  ],
  [
    "claudecode",
    {
      class: ClaudecodeCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: true, isSimulated: false }
    }
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: true, isSimulated: false }
    }
  ],
  [
    "cline",
    {
      class: ClineCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: true, isSimulated: false }
    }
  ],
  [
    "codexcli",
    {
      class: CodexcliCommand,
      meta: { extension: "md", supportsProject: false, supportsGlobal: true, isSimulated: false }
    }
  ],
  [
    "copilot",
    {
      class: CopilotCommand,
      meta: {
        extension: "prompt.md",
        supportsProject: true,
        supportsGlobal: false,
        isSimulated: false
      }
    }
  ],
  [
    "cursor",
    {
      class: CursorCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: true, isSimulated: false }
    }
  ],
  [
    "factorydroid",
    {
      class: FactorydroidCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: true, isSimulated: true }
    }
  ],
  [
    "geminicli",
    {
      class: GeminiCliCommand,
      meta: { extension: "toml", supportsProject: true, supportsGlobal: true, isSimulated: false }
    }
  ],
  [
    "kilo",
    {
      class: KiloCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: true, isSimulated: false }
    }
  ],
  [
    "kiro",
    {
      class: KiroCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: false, isSimulated: false }
    }
  ],
  [
    "opencode",
    {
      class: OpenCodeCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: true, isSimulated: false }
    }
  ],
  [
    "roo",
    {
      class: RooCommand,
      meta: { extension: "md", supportsProject: true, supportsGlobal: false, isSimulated: false }
    }
  ]
]);
var defaultGetFactory = (target) => {
  const factory = toolCommandFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};
var allToolTargetKeys = [...toolCommandFactories.keys()];
var commandsProcessorToolTargets = allToolTargetKeys.filter((target) => {
  const factory = toolCommandFactories.get(target);
  return factory?.meta.supportsProject ?? false;
});
var commandsProcessorToolTargetsSimulated = allToolTargetKeys.filter((target) => {
  const factory = toolCommandFactories.get(target);
  return factory?.meta.isSimulated ?? false;
});
var commandsProcessorToolTargetsGlobal = allToolTargetKeys.filter(
  (target) => {
    const factory = toolCommandFactories.get(target);
    return factory?.meta.supportsGlobal ?? false;
  }
);
var CommandsProcessor = class extends FeatureProcessor {
  toolTarget;
  global;
  getFactory;
  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
    getFactory = defaultGetFactory,
    dryRun = false
  }) {
    super({ baseDir, dryRun });
    const result = CommandsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for CommandsProcessor: ${toolTarget}. ${formatError(result.error)}`
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.getFactory = getFactory;
  }
  async convertRulesyncFilesToToolFiles(rulesyncFiles) {
    const rulesyncCommands = rulesyncFiles.filter(
      (file) => file instanceof RulesyncCommand
    );
    const factory = this.getFactory(this.toolTarget);
    const toolCommands = rulesyncCommands.map((rulesyncCommand) => {
      if (!factory.class.isTargetedByRulesyncCommand(rulesyncCommand)) {
        return null;
      }
      return factory.class.fromRulesyncCommand({
        baseDir: this.baseDir,
        rulesyncCommand,
        global: this.global
      });
    }).filter((command) => command !== null);
    return toolCommands;
  }
  async convertToolFilesToRulesyncFiles(toolFiles) {
    const toolCommands = toolFiles.filter(
      (file) => file instanceof ToolCommand
    );
    const rulesyncCommands = toolCommands.map((toolCommand) => {
      return toolCommand.toRulesyncCommand();
    });
    return rulesyncCommands;
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync command files from .rulesync/commands/ directory
   */
  async loadRulesyncFiles() {
    const rulesyncCommandPaths = await findFilesByGlobs(
      (0, import_node_path19.join)(RulesyncCommand.getSettablePaths().relativeDirPath, "*.md")
    );
    const rulesyncCommands = await Promise.all(
      rulesyncCommandPaths.map(
        (path4) => RulesyncCommand.fromFile({ relativeFilePath: (0, import_node_path19.basename)(path4) })
      )
    );
    logger.debug(`Successfully loaded ${rulesyncCommands.length} rulesync commands`);
    return rulesyncCommands;
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific command configurations and parse them into ToolCommand instances
   */
  async loadToolFiles({
    forDeletion = false
  } = {}) {
    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });
    const commandFilePaths = await findFilesByGlobs(
      (0, import_node_path19.join)(this.baseDir, paths.relativeDirPath, `*.${factory.meta.extension}`)
    );
    if (forDeletion) {
      const toolCommands2 = commandFilePaths.map(
        (path4) => factory.class.forDeletion({
          baseDir: this.baseDir,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: (0, import_node_path19.basename)(path4),
          global: this.global
        })
      ).filter((cmd) => cmd.isDeletable());
      logger.debug(`Successfully loaded ${toolCommands2.length} ${paths.relativeDirPath} commands`);
      return toolCommands2;
    }
    const toolCommands = await Promise.all(
      commandFilePaths.map(
        (path4) => factory.class.fromFile({
          baseDir: this.baseDir,
          relativeFilePath: (0, import_node_path19.basename)(path4),
          global: this.global
        })
      )
    );
    logger.debug(`Successfully loaded ${toolCommands.length} ${paths.relativeDirPath} commands`);
    return toolCommands;
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({
    global = false,
    includeSimulated = false
  } = {}) {
    if (global) {
      return [...commandsProcessorToolTargetsGlobal];
    }
    if (!includeSimulated) {
      return commandsProcessorToolTargets.filter(
        (target) => !commandsProcessorToolTargetsSimulated.includes(target)
      );
    }
    return [...commandsProcessorToolTargets];
  }
  static getToolTargetsSimulated() {
    return [...commandsProcessorToolTargetsSimulated];
  }
  /**
   * Get the factory for a specific tool target.
   * This is a static version of the internal getFactory for external use.
   * @param target - The tool target. Must be a valid CommandsProcessorToolTarget.
   * @returns The factory for the target, or undefined if not found.
   */
  static getFactory(target) {
    const result = CommandsProcessorToolTargetSchema.safeParse(target);
    if (!result.success) {
      return void 0;
    }
    return toolCommandFactories.get(result.data);
  }
};

// src/features/hooks/hooks-processor.ts
var import_mini13 = require("zod/mini");

// src/types/hooks.ts
var import_mini12 = require("zod/mini");
var hasControlChars = (val) => val.includes("\n") || val.includes("\r") || val.includes("\0");
var safeString = import_mini12.z.pipe(
  import_mini12.z.string(),
  import_mini12.z.custom(
    (val) => typeof val === "string" && !hasControlChars(val),
    "must not contain newline, carriage return, or NUL characters"
  )
);
var HookDefinitionSchema = import_mini12.z.looseObject({
  command: import_mini12.z.optional(safeString),
  type: import_mini12.z.optional(import_mini12.z.enum(["command", "prompt"])),
  timeout: import_mini12.z.optional(import_mini12.z.number()),
  matcher: import_mini12.z.optional(safeString),
  prompt: import_mini12.z.optional(import_mini12.z.string()),
  loop_limit: import_mini12.z.optional(import_mini12.z.nullable(import_mini12.z.number()))
});
var CURSOR_HOOK_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "stop",
  "subagentStop",
  "preCompact",
  "postToolUseFailure",
  "subagentStart",
  "beforeShellExecution",
  "afterShellExecution",
  "beforeMCPExecution",
  "afterMCPExecution",
  "beforeReadFile",
  "afterFileEdit",
  "afterAgentResponse",
  "afterAgentThought",
  "beforeTabFileRead",
  "afterTabFileEdit"
];
var CLAUDE_HOOK_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "preToolUse",
  "postToolUse",
  "beforeSubmitPrompt",
  "stop",
  "subagentStop",
  "preCompact",
  "permissionRequest",
  "notification",
  "setup"
];
var OPENCODE_HOOK_EVENTS = [
  "sessionStart",
  "preToolUse",
  "postToolUse",
  "stop",
  "afterFileEdit",
  "afterShellExecution",
  "permissionRequest"
];
var hooksRecordSchema = import_mini12.z.record(import_mini12.z.string(), import_mini12.z.array(HookDefinitionSchema));
var HooksConfigSchema = import_mini12.z.looseObject({
  version: import_mini12.z.optional(import_mini12.z.number()),
  hooks: hooksRecordSchema,
  cursor: import_mini12.z.optional(import_mini12.z.looseObject({ hooks: import_mini12.z.optional(hooksRecordSchema) })),
  claudecode: import_mini12.z.optional(import_mini12.z.looseObject({ hooks: import_mini12.z.optional(hooksRecordSchema) })),
  opencode: import_mini12.z.optional(import_mini12.z.looseObject({ hooks: import_mini12.z.optional(hooksRecordSchema) })),
  factorydroid: import_mini12.z.optional(import_mini12.z.looseObject({ hooks: import_mini12.z.optional(hooksRecordSchema) }))
});
var CURSOR_TO_CLAUDE_EVENT_NAMES = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  beforeSubmitPrompt: "UserPromptSubmit",
  stop: "Stop",
  subagentStop: "SubagentStop",
  preCompact: "PreCompact",
  permissionRequest: "PermissionRequest",
  notification: "Notification",
  setup: "Setup"
};
var CLAUDE_TO_CURSOR_EVENT_NAMES = Object.fromEntries(
  Object.entries(CURSOR_TO_CLAUDE_EVENT_NAMES).map(([k, v]) => [v, k])
);
var CURSOR_TO_OPENCODE_EVENT_NAMES = {
  sessionStart: "session.created",
  preToolUse: "tool.execute.before",
  postToolUse: "tool.execute.after",
  stop: "session.idle",
  afterFileEdit: "file.edited",
  afterShellExecution: "command.executed",
  permissionRequest: "permission.asked"
};

// src/features/hooks/claudecode-hooks.ts
var import_node_path21 = require("path");

// src/types/tool-file.ts
var ToolFile = class extends AiFile {
};

// src/features/hooks/rulesync-hooks.ts
var import_node_path20 = require("path");
var RulesyncHooks = class _RulesyncHooks extends RulesyncFile {
  json;
  constructor(params) {
    super({ ...params });
    this.json = JSON.parse(this.fileContent);
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths() {
    return {
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json"
    };
  }
  validate() {
    const result = HooksConfigSchema.safeParse(this.json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const paths = _RulesyncHooks.getSettablePaths();
    const filePath = (0, import_node_path20.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    if (!await fileExists(filePath)) {
      throw new Error(`No ${RULESYNC_HOOKS_RELATIVE_FILE_PATH} found.`);
    }
    const fileContent = await readFileContent(filePath);
    return new _RulesyncHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  getJson() {
    return this.json;
  }
};

// src/features/hooks/tool-hooks.ts
var ToolHooks = class extends ToolFile {
  constructor(params) {
    super({
      ...params,
      validate: true
    });
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths(_options) {
    throw new Error("Please implement this method in the subclass.");
  }
  toRulesyncHooksDefault({
    fileContent = void 0
  } = {}) {
    return new RulesyncHooks({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: "hooks.json",
      fileContent: fileContent ?? this.fileContent
    });
  }
  static async fromFile(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  static forDeletion(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
};

// src/features/hooks/claudecode-hooks.ts
function canonicalToClaudeHooks(config) {
  const claudeSupported = new Set(CLAUDE_HOOK_EVENTS);
  const sharedHooks = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (claudeSupported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effectiveHooks = {
    ...sharedHooks,
    ...config.claudecode?.hooks
  };
  const claude = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const claudeEventName = CURSOR_TO_CLAUDE_EVENT_NAMES[eventName] ?? eventName;
    const byMatcher = /* @__PURE__ */ new Map();
    for (const def of definitions) {
      const key = def.matcher ?? "";
      const list = byMatcher.get(key);
      if (list) list.push(def);
      else byMatcher.set(key, [def]);
    }
    const entries = [];
    for (const [matcherKey, defs] of byMatcher) {
      const hooks = defs.map((def) => {
        const command = def.command !== void 0 && def.command !== null && !def.command.startsWith("$") ? `$CLAUDE_PROJECT_DIR/${def.command.replace(/^\.\//, "")}` : def.command;
        return {
          type: def.type ?? "command",
          ...command !== void 0 && command !== null && { command },
          ...def.timeout !== void 0 && def.timeout !== null && { timeout: def.timeout },
          ...def.prompt !== void 0 && def.prompt !== null && { prompt: def.prompt }
        };
      });
      entries.push(matcherKey ? { matcher: matcherKey, hooks } : { hooks });
    }
    claude[claudeEventName] = entries;
  }
  return claude;
}
function isClaudeMatcherEntry(x) {
  if (x === null || typeof x !== "object") {
    return false;
  }
  if ("matcher" in x && typeof x.matcher !== "string") {
    return false;
  }
  if ("hooks" in x && !Array.isArray(x.hooks)) {
    return false;
  }
  return true;
}
function claudeHooksToCanonical(claudeHooks) {
  if (claudeHooks === null || claudeHooks === void 0 || typeof claudeHooks !== "object") {
    return {};
  }
  const canonical = {};
  for (const [claudeEventName, matcherEntries] of Object.entries(claudeHooks)) {
    const eventName = CLAUDE_TO_CURSOR_EVENT_NAMES[claudeEventName] ?? claudeEventName;
    if (!Array.isArray(matcherEntries)) continue;
    const defs = [];
    for (const rawEntry of matcherEntries) {
      if (!isClaudeMatcherEntry(rawEntry)) continue;
      const entry = rawEntry;
      const hooks = entry.hooks ?? [];
      for (const h of hooks) {
        const cmd = typeof h.command === "string" ? h.command : void 0;
        const command = typeof cmd === "string" && cmd.includes("$CLAUDE_PROJECT_DIR/") ? cmd.replace(/^\$CLAUDE_PROJECT_DIR\/?/, "./") : cmd;
        const hookType = h.type === "command" || h.type === "prompt" ? h.type : "command";
        const timeout = typeof h.timeout === "number" ? h.timeout : void 0;
        const prompt = typeof h.prompt === "string" ? h.prompt : void 0;
        defs.push({
          type: hookType,
          ...command !== void 0 && command !== null && { command },
          ...timeout !== void 0 && timeout !== null && { timeout },
          ...prompt !== void 0 && prompt !== null && { prompt },
          ...entry.matcher !== void 0 && entry.matcher !== null && entry.matcher !== "" && { matcher: entry.matcher }
        });
      }
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}
var ClaudecodeHooks = class _ClaudecodeHooks extends ToolHooks {
  constructor(params) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}"
    });
  }
  isDeletable() {
    return false;
  }
  static getSettablePaths(_options = {}) {
    return { relativeDirPath: ".claude", relativeFilePath: "settings.json" };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false
  }) {
    const paths = _ClaudecodeHooks.getSettablePaths({ global });
    const filePath = (0, import_node_path21.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = await readFileContentOrNull(filePath) ?? '{"hooks":{}}';
    return new _ClaudecodeHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  static async fromRulesyncHooks({
    baseDir = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false
  }) {
    const paths = _ClaudecodeHooks.getSettablePaths({ global });
    const filePath = (0, import_node_path21.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2)
    );
    let settings;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Claude settings at ${filePath}: ${formatError(error)}`,
        { cause: error }
      );
    }
    const config = rulesyncHooks.getJson();
    const claudeHooks = canonicalToClaudeHooks(config);
    const merged = { ...settings, hooks: claudeHooks };
    const fileContent = JSON.stringify(merged, null, 2);
    return new _ClaudecodeHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  toRulesyncHooks() {
    let settings;
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(`Failed to parse Claude hooks content: ${formatError(error)}`, {
        cause: error
      });
    }
    const hooks = claudeHooksToCanonical(settings.hooks);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify({ version: 1, hooks }, null, 2)
    });
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _ClaudecodeHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false
    });
  }
};

// src/features/hooks/cursor-hooks.ts
var import_node_path22 = require("path");
var CursorHooks = class _CursorHooks extends ToolHooks {
  constructor(params) {
    const { rulesyncHooks: _r, ...rest } = params;
    super({
      ...rest,
      fileContent: rest.fileContent ?? "{}"
    });
  }
  static getSettablePaths() {
    return {
      relativeDirPath: ".cursor",
      relativeFilePath: "hooks.json"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const paths = _CursorHooks.getSettablePaths();
    const fileContent = await readFileContent(
      (0, import_node_path22.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath)
    );
    return new _CursorHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  static fromRulesyncHooks({
    baseDir = process.cwd(),
    rulesyncHooks,
    validate = true
  }) {
    const config = rulesyncHooks.getJson();
    const cursorSupported = new Set(CURSOR_HOOK_EVENTS);
    const sharedHooks = {};
    for (const [event, defs] of Object.entries(config.hooks)) {
      if (cursorSupported.has(event)) {
        sharedHooks[event] = defs;
      }
    }
    const mergedHooks = {
      ...sharedHooks,
      ...config.cursor?.hooks
    };
    const cursorConfig = {
      version: config.version ?? 1,
      hooks: mergedHooks
    };
    const fileContent = JSON.stringify(cursorConfig, null, 2);
    const paths = _CursorHooks.getSettablePaths();
    return new _CursorHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      rulesyncHooks
    });
  }
  toRulesyncHooks() {
    const content = this.getFileContent();
    const parsed = JSON.parse(content);
    const hooks = parsed.hooks ?? {};
    const version = parsed.version ?? 1;
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify({ version, hooks }, null, 2)
    });
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _CursorHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false
    });
  }
};

// src/features/hooks/factorydroid-hooks.ts
var import_node_path23 = require("path");
function canonicalToFactorydroidHooks(config) {
  const supported = new Set(CLAUDE_HOOK_EVENTS);
  const sharedHooks = {};
  for (const [event, defs] of Object.entries(config.hooks)) {
    if (supported.has(event)) {
      sharedHooks[event] = defs;
    }
  }
  const effectiveHooks = {
    ...sharedHooks,
    ...config.claudecode?.hooks
  };
  const result = {};
  for (const [eventName, definitions] of Object.entries(effectiveHooks)) {
    const pascalEventName = CURSOR_TO_CLAUDE_EVENT_NAMES[eventName] ?? eventName;
    const byMatcher = /* @__PURE__ */ new Map();
    for (const def of definitions) {
      const key = def.matcher ?? "";
      const list = byMatcher.get(key);
      if (list) list.push(def);
      else byMatcher.set(key, [def]);
    }
    const entries = [];
    for (const [matcherKey, defs] of byMatcher) {
      const hooks = defs.map((def) => {
        const command = def.command !== void 0 && def.command !== null && !def.command.startsWith("$") ? `$FACTORY_PROJECT_DIR/${def.command.replace(/^\.\//, "")}` : def.command;
        return {
          type: def.type ?? "command",
          ...command !== void 0 && command !== null && { command },
          ...def.timeout !== void 0 && def.timeout !== null && { timeout: def.timeout },
          ...def.prompt !== void 0 && def.prompt !== null && { prompt: def.prompt }
        };
      });
      entries.push(matcherKey ? { matcher: matcherKey, hooks } : { hooks });
    }
    result[pascalEventName] = entries;
  }
  return result;
}
function isFactorydroidMatcherEntry(x) {
  if (x === null || typeof x !== "object") {
    return false;
  }
  if ("matcher" in x && typeof x.matcher !== "string") {
    return false;
  }
  if ("hooks" in x && !Array.isArray(x.hooks)) {
    return false;
  }
  return true;
}
function factorydroidHooksToCanonical(hooks) {
  if (hooks === null || hooks === void 0 || typeof hooks !== "object") {
    return {};
  }
  const canonical = {};
  for (const [pascalEventName, matcherEntries] of Object.entries(hooks)) {
    const eventName = CLAUDE_TO_CURSOR_EVENT_NAMES[pascalEventName] ?? pascalEventName;
    if (!Array.isArray(matcherEntries)) continue;
    const defs = [];
    for (const rawEntry of matcherEntries) {
      if (!isFactorydroidMatcherEntry(rawEntry)) continue;
      const entry = rawEntry;
      const hookDefs = entry.hooks ?? [];
      for (const h of hookDefs) {
        const cmd = typeof h.command === "string" ? h.command : void 0;
        const command = typeof cmd === "string" && cmd.includes("$FACTORY_PROJECT_DIR/") ? cmd.replace(/^\$FACTORY_PROJECT_DIR\/?/, "./") : cmd;
        const hookType = h.type === "command" || h.type === "prompt" ? h.type : "command";
        const timeout = typeof h.timeout === "number" ? h.timeout : void 0;
        const prompt = typeof h.prompt === "string" ? h.prompt : void 0;
        defs.push({
          type: hookType,
          ...command !== void 0 && command !== null && { command },
          ...timeout !== void 0 && timeout !== null && { timeout },
          ...prompt !== void 0 && prompt !== null && { prompt },
          ...entry.matcher !== void 0 && entry.matcher !== null && entry.matcher !== "" && { matcher: entry.matcher }
        });
      }
    }
    if (defs.length > 0) {
      canonical[eventName] = defs;
    }
  }
  return canonical;
}
var FactorydroidHooks = class _FactorydroidHooks extends ToolHooks {
  constructor(params) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}"
    });
  }
  isDeletable() {
    return false;
  }
  static getSettablePaths(_options = {}) {
    return { relativeDirPath: ".factory", relativeFilePath: "settings.json" };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false
  }) {
    const paths = _FactorydroidHooks.getSettablePaths({ global });
    const filePath = (0, import_node_path23.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = await readFileContentOrNull(filePath) ?? '{"hooks":{}}';
    return new _FactorydroidHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  static async fromRulesyncHooks({
    baseDir = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false
  }) {
    const paths = _FactorydroidHooks.getSettablePaths({ global });
    const filePath = (0, import_node_path23.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2)
    );
    let settings;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Factory Droid settings at ${filePath}: ${formatError(error)}`,
        { cause: error }
      );
    }
    const config = rulesyncHooks.getJson();
    const factorydroidHooks = canonicalToFactorydroidHooks(config);
    const merged = { ...settings, hooks: factorydroidHooks };
    const fileContent = JSON.stringify(merged, null, 2);
    return new _FactorydroidHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  toRulesyncHooks() {
    let settings;
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(`Failed to parse Factory Droid hooks content: ${formatError(error)}`, {
        cause: error
      });
    }
    const hooks = factorydroidHooksToCanonical(settings.hooks);
    return this.toRulesyncHooksDefault({
      fileContent: JSON.stringify({ version: 1, hooks }, null, 2)
    });
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _FactorydroidHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ hooks: {} }, null, 2),
      validate: false
    });
  }
};

// src/features/hooks/opencode-hooks.ts
var import_node_path24 = require("path");
var NAMED_HOOKS = /* @__PURE__ */ new Set(["tool.execute.before", "tool.execute.after"]);
function escapeForTemplateLiteral(command) {
  return command.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}
function validateAndSanitizeMatcher(matcher) {
  const sanitized = matcher.replaceAll("\n", "").replaceAll("\r", "").replaceAll("\0", "");
  try {
    new RegExp(sanitized);
  } catch {
    throw new Error(`Invalid regex pattern in hook matcher: ${sanitized}`);
  }
  return sanitized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function groupByOpencodeEvent(config) {
  const opencodeSupported = new Set(OPENCODE_HOOK_EVENTS);
  const configHooks = { ...config.hooks, ...config.opencode?.hooks };
  const effectiveHooks = {};
  for (const [event, defs] of Object.entries(configHooks)) {
    if (opencodeSupported.has(event)) {
      effectiveHooks[event] = defs;
    }
  }
  const namedEventHandlers = {};
  const genericEventHandlers = {};
  for (const [canonicalEvent, definitions] of Object.entries(effectiveHooks)) {
    const opencodeEvent = CURSOR_TO_OPENCODE_EVENT_NAMES[canonicalEvent];
    if (!opencodeEvent) continue;
    const handlers = [];
    for (const def of definitions) {
      if (def.type === "prompt") continue;
      if (!def.command) continue;
      handlers.push({
        command: def.command,
        matcher: def.matcher ? def.matcher : void 0
      });
    }
    if (handlers.length > 0) {
      const grouped = NAMED_HOOKS.has(opencodeEvent) ? namedEventHandlers : genericEventHandlers;
      const existing = grouped[opencodeEvent];
      if (existing) {
        existing.push(...handlers);
      } else {
        grouped[opencodeEvent] = handlers;
      }
    }
  }
  return { namedEventHandlers, genericEventHandlers };
}
function generatePluginCode(config) {
  const { namedEventHandlers, genericEventHandlers } = groupByOpencodeEvent(config);
  const lines = [];
  lines.push("export const RulesyncHooksPlugin = async ({ $ }) => {");
  lines.push("  return {");
  if (Object.keys(genericEventHandlers).length > 0) {
    lines.push("    event: async ({ event }) => {");
    for (const [eventName, handlers] of Object.entries(genericEventHandlers)) {
      lines.push(`      if (event.type === "${eventName}") {`);
      for (const handler of handlers) {
        const escapedCommand = escapeForTemplateLiteral(handler.command);
        lines.push(`        await $\`${escapedCommand}\``);
      }
      lines.push("      }");
    }
    lines.push("    },");
  }
  for (const [eventName, handlers] of Object.entries(namedEventHandlers)) {
    lines.push(`    "${eventName}": async (input) => {`);
    for (const handler of handlers) {
      const escapedCommand = escapeForTemplateLiteral(handler.command);
      if (handler.matcher) {
        const safeMatcher = validateAndSanitizeMatcher(handler.matcher);
        lines.push(`      if (new RegExp("${safeMatcher}").test(input.tool)) {`);
        lines.push(`        await $\`${escapedCommand}\``);
        lines.push("      }");
      } else {
        lines.push(`      await $\`${escapedCommand}\``);
      }
    }
    lines.push("    },");
  }
  lines.push("  }");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}
var OpencodeHooks = class _OpencodeHooks extends ToolHooks {
  constructor(params) {
    super({
      ...params,
      fileContent: params.fileContent ?? ""
    });
  }
  static getSettablePaths(options) {
    return {
      relativeDirPath: options?.global ? (0, import_node_path24.join)(".config", "opencode", "plugins") : (0, import_node_path24.join)(".opencode", "plugins"),
      relativeFilePath: "rulesync-hooks.js"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false
  }) {
    const paths = _OpencodeHooks.getSettablePaths({ global });
    const fileContent = await readFileContent(
      (0, import_node_path24.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath)
    );
    return new _OpencodeHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  static fromRulesyncHooks({
    baseDir = process.cwd(),
    rulesyncHooks,
    validate = true,
    global = false
  }) {
    const config = rulesyncHooks.getJson();
    const fileContent = generatePluginCode(config);
    const paths = _OpencodeHooks.getSettablePaths({ global });
    return new _OpencodeHooks({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  toRulesyncHooks() {
    throw new Error("Not implemented because OpenCode hooks are generated as a plugin file.");
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _OpencodeHooks({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/hooks/hooks-processor.ts
var hooksProcessorToolTargetTuple = ["cursor", "claudecode", "opencode", "factorydroid"];
var HooksProcessorToolTargetSchema = import_mini13.z.enum(hooksProcessorToolTargetTuple);
var toolHooksFactories = /* @__PURE__ */ new Map([
  [
    "cursor",
    {
      class: CursorHooks,
      meta: { supportsProject: true, supportsGlobal: false, supportsImport: true },
      supportedEvents: CURSOR_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt"]
    }
  ],
  [
    "claudecode",
    {
      class: ClaudecodeHooks,
      meta: { supportsProject: true, supportsGlobal: true, supportsImport: true },
      supportedEvents: CLAUDE_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt"]
    }
  ],
  [
    "opencode",
    {
      class: OpencodeHooks,
      meta: { supportsProject: true, supportsGlobal: true, supportsImport: false },
      supportedEvents: OPENCODE_HOOK_EVENTS,
      supportedHookTypes: ["command"]
    }
  ],
  [
    "factorydroid",
    {
      class: FactorydroidHooks,
      meta: { supportsProject: true, supportsGlobal: true, supportsImport: true },
      supportedEvents: CLAUDE_HOOK_EVENTS,
      supportedHookTypes: ["command", "prompt"]
    }
  ]
]);
var hooksProcessorToolTargets = [...toolHooksFactories.keys()];
var hooksProcessorToolTargetsGlobal = [...toolHooksFactories.entries()].filter(([, f]) => f.meta.supportsGlobal).map(([t]) => t);
var hooksProcessorToolTargetsImportable = [...toolHooksFactories.entries()].filter(([, f]) => f.meta.supportsImport).map(([t]) => t);
var hooksProcessorToolTargetsGlobalImportable = [...toolHooksFactories.entries()].filter(([, f]) => f.meta.supportsGlobal && f.meta.supportsImport).map(([t]) => t);
var HooksProcessor = class extends FeatureProcessor {
  toolTarget;
  global;
  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
    dryRun = false
  }) {
    super({ baseDir, dryRun });
    const result = HooksProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for HooksProcessor: ${toolTarget}. ${formatError(result.error)}`
      );
    }
    this.toolTarget = result.data;
    this.global = global;
  }
  async loadRulesyncFiles() {
    try {
      return [
        await RulesyncHooks.fromFile({
          baseDir: this.baseDir,
          validate: true
        })
      ];
    } catch (error) {
      logger.error(`Failed to load Rulesync hooks file: ${formatError(error)}`);
      return [];
    }
  }
  async loadToolFiles({ forDeletion = false } = {}) {
    try {
      const factory = toolHooksFactories.get(this.toolTarget);
      if (!factory) throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      const paths = factory.class.getSettablePaths({ global: this.global });
      if (forDeletion) {
        const toolHooks2 = factory.class.forDeletion({
          baseDir: this.baseDir,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath,
          global: this.global
        });
        const list = toolHooks2.isDeletable?.() !== false ? [toolHooks2] : [];
        logger.debug(
          `Successfully loaded ${list.length} ${this.toolTarget} hooks files for deletion`
        );
        return list;
      }
      const toolHooks = await factory.class.fromFile({
        baseDir: this.baseDir,
        validate: true,
        global: this.global
      });
      logger.debug(`Successfully loaded 1 ${this.toolTarget} hooks file`);
      return [toolHooks];
    } catch (error) {
      const msg = `Failed to load hooks files for tool target: ${this.toolTarget}: ${formatError(error)}`;
      if (error instanceof Error && error.message.includes("no such file or directory")) {
        logger.debug(msg);
      } else {
        logger.error(msg);
      }
      return [];
    }
  }
  async convertRulesyncFilesToToolFiles(rulesyncFiles) {
    const rulesyncHooks = rulesyncFiles.find((f) => f instanceof RulesyncHooks);
    if (!rulesyncHooks) {
      throw new Error(`No ${RULESYNC_HOOKS_RELATIVE_FILE_PATH} found.`);
    }
    const factory = toolHooksFactories.get(this.toolTarget);
    if (!factory) throw new Error(`Unsupported tool target: ${this.toolTarget}`);
    const config = rulesyncHooks.getJson();
    const sharedHooks = config.hooks;
    const overrideHooks = config[this.toolTarget]?.hooks ?? {};
    const effectiveHooks = { ...sharedHooks, ...overrideHooks };
    {
      const supportedEvents = new Set(factory.supportedEvents);
      const configEventNames = new Set(Object.keys(effectiveHooks));
      const skipped = [...configEventNames].filter((e) => !supportedEvents.has(e));
      if (skipped.length > 0) {
        logger.warn(
          `Skipped hook event(s) for ${this.toolTarget} (not supported): ${skipped.join(", ")}`
        );
      }
    }
    {
      const supportedHookTypes = new Set(factory.supportedHookTypes);
      const unsupportedTypeToEvents = /* @__PURE__ */ new Map();
      for (const [event, defs] of Object.entries(effectiveHooks)) {
        for (const def of defs) {
          const hookType = def.type ?? "command";
          if (!supportedHookTypes.has(hookType)) {
            const events = unsupportedTypeToEvents.get(hookType) ?? /* @__PURE__ */ new Set();
            events.add(event);
            unsupportedTypeToEvents.set(hookType, events);
          }
        }
      }
      for (const [hookType, events] of unsupportedTypeToEvents) {
        logger.warn(
          `Skipped ${hookType}-type hook(s) for ${this.toolTarget} (not supported): ${Array.from(events).join(", ")}`
        );
      }
    }
    const toolHooks = await factory.class.fromRulesyncHooks({
      baseDir: this.baseDir,
      rulesyncHooks,
      validate: true,
      global: this.global
    });
    return [toolHooks];
  }
  async convertToolFilesToRulesyncFiles(toolFiles) {
    const hooks = toolFiles.filter((f) => f instanceof ToolHooks);
    return hooks.map((h) => h.toRulesyncHooks());
  }
  static getToolTargets({
    global = false,
    importOnly = false
  } = {}) {
    if (global) {
      return importOnly ? hooksProcessorToolTargetsGlobalImportable : hooksProcessorToolTargetsGlobal;
    }
    return importOnly ? hooksProcessorToolTargetsImportable : hooksProcessorToolTargets;
  }
};

// src/features/ignore/ignore-processor.ts
var import_mini14 = require("zod/mini");

// src/features/ignore/augmentcode-ignore.ts
var import_node_path26 = require("path");

// src/features/ignore/rulesync-ignore.ts
var import_node_path25 = require("path");
var RulesyncIgnore = class _RulesyncIgnore extends RulesyncFile {
  validate() {
    return { success: true, error: null };
  }
  static getSettablePaths() {
    return {
      recommended: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME
      },
      legacy: {
        relativeDirPath: ".",
        relativeFilePath: RULESYNC_IGNORE_RELATIVE_FILE_PATH
      }
    };
  }
  static async fromFile() {
    const baseDir = process.cwd();
    const paths = this.getSettablePaths();
    const recommendedPath = (0, import_node_path25.join)(
      baseDir,
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath
    );
    const legacyPath = (0, import_node_path25.join)(baseDir, paths.legacy.relativeDirPath, paths.legacy.relativeFilePath);
    if (await fileExists(recommendedPath)) {
      const fileContent2 = await readFileContent(recommendedPath);
      return new _RulesyncIgnore({
        baseDir,
        relativeDirPath: paths.recommended.relativeDirPath,
        relativeFilePath: paths.recommended.relativeFilePath,
        fileContent: fileContent2
      });
    }
    if (await fileExists(legacyPath)) {
      const fileContent2 = await readFileContent(legacyPath);
      return new _RulesyncIgnore({
        baseDir,
        relativeDirPath: paths.legacy.relativeDirPath,
        relativeFilePath: paths.legacy.relativeFilePath,
        fileContent: fileContent2
      });
    }
    const fileContent = await readFileContent(recommendedPath);
    return new _RulesyncIgnore({
      baseDir,
      relativeDirPath: paths.recommended.relativeDirPath,
      relativeFilePath: paths.recommended.relativeFilePath,
      fileContent
    });
  }
};

// src/features/ignore/tool-ignore.ts
var ToolIgnore = class extends ToolFile {
  patterns;
  constructor(params) {
    super({
      ...params,
      validate: true
    });
    this.patterns = this.fileContent.split(/\r?\n|\r/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths() {
    throw new Error("Please implement this method in the subclass.");
  }
  getPatterns() {
    return this.patterns;
  }
  validate() {
    return { success: true, error: null };
  }
  static fromRulesyncIgnore(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  toRulesyncIgnoreDefault() {
    return new RulesyncIgnore({
      baseDir: ".",
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_AIIGNORE_FILE_NAME,
      fileContent: this.fileContent
    });
  }
  static async fromFile(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse file content, making it safe to use
   * even when files have old/incompatible formats.
   */
  static forDeletion(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
};

// src/features/ignore/augmentcode-ignore.ts
var AugmentcodeIgnore = class _AugmentcodeIgnore extends ToolIgnore {
  static getSettablePaths() {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".augmentignore"
    };
  }
  /**
   * Convert to RulesyncIgnore format
   */
  toRulesyncIgnore() {
    return this.toRulesyncIgnoreDefault();
  }
  /**
   * Create AugmentcodeIgnore from RulesyncIgnore
   * Supports conversion from unified rulesync format to AugmentCode specific format
   */
  static fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore
  }) {
    return new _AugmentcodeIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent()
    });
  }
  /**
   * Create AugmentcodeIgnore from file path
   * Reads and parses .augmentignore file
   */
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path26.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _AugmentcodeIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _AugmentcodeIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/ignore/claudecode-ignore.ts
var import_es_toolkit2 = require("es-toolkit");
var import_node_path27 = require("path");
var ClaudecodeIgnore = class _ClaudecodeIgnore extends ToolIgnore {
  constructor(params) {
    super(params);
    const jsonValue = JSON.parse(this.fileContent);
    this.patterns = jsonValue.permissions?.deny ?? [];
  }
  static getSettablePaths() {
    return {
      relativeDirPath: ".claude",
      relativeFilePath: "settings.local.json"
    };
  }
  /**
   * ClaudecodeIgnore uses settings.local.json which is a user-managed config file.
   * It should not be deleted by rulesync.
   */
  isDeletable() {
    return false;
  }
  toRulesyncIgnore() {
    const rulesyncPatterns = this.patterns.map((pattern) => {
      if (pattern.startsWith("Read(") && pattern.endsWith(")")) {
        return pattern.slice(5, -1);
      }
      return pattern;
    }).filter((pattern) => pattern.length > 0);
    const fileContent = rulesyncPatterns.join("\n");
    return new RulesyncIgnore({
      baseDir: this.baseDir,
      relativeDirPath: RulesyncIgnore.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: RulesyncIgnore.getSettablePaths().recommended.relativeFilePath,
      fileContent
    });
  }
  static async fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore
  }) {
    const fileContent = rulesyncIgnore.getFileContent();
    const patterns = fileContent.split(/\r?\n|\r/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
    const deniedValues = patterns.map((pattern) => `Read(${pattern})`);
    const filePath = (0, import_node_path27.join)(
      baseDir,
      this.getSettablePaths().relativeDirPath,
      this.getSettablePaths().relativeFilePath
    );
    const exists = await fileExists(filePath);
    const existingFileContent = exists ? await readFileContent(filePath) : "{}";
    const existingJsonValue = JSON.parse(existingFileContent);
    const existingDenies = existingJsonValue.permissions?.deny ?? [];
    const preservedDenies = existingDenies.filter((deny) => {
      const isReadPattern = deny.startsWith("Read(") && deny.endsWith(")");
      if (isReadPattern) {
        return deniedValues.includes(deny);
      }
      return true;
    });
    const jsonValue = {
      ...existingJsonValue,
      permissions: {
        ...existingJsonValue.permissions,
        deny: (0, import_es_toolkit2.uniq)([...preservedDenies, ...deniedValues].toSorted())
      }
    };
    return new _ClaudecodeIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: JSON.stringify(jsonValue, null, 2),
      validate: true
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path27.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _ClaudecodeIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _ClaudecodeIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false
    });
  }
};

// src/features/ignore/cline-ignore.ts
var import_node_path28 = require("path");
var ClineIgnore = class _ClineIgnore extends ToolIgnore {
  static getSettablePaths() {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".clineignore"
    };
  }
  /**
   * Convert ClineIgnore to RulesyncIgnore format
   */
  toRulesyncIgnore() {
    return this.toRulesyncIgnoreDefault();
  }
  /**
   * Create ClineIgnore from RulesyncIgnore
   */
  static fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore
  }) {
    const body = rulesyncIgnore.getFileContent();
    return new _ClineIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: body
    });
  }
  /**
   * Load ClineIgnore from .clineignore file
   */
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path28.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _ClineIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _ClineIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/ignore/cursor-ignore.ts
var import_node_path29 = require("path");
var CursorIgnore = class _CursorIgnore extends ToolIgnore {
  static getSettablePaths() {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".cursorignore"
    };
  }
  toRulesyncIgnore() {
    return new RulesyncIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
      fileContent: this.fileContent
    });
  }
  static fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore
  }) {
    const body = rulesyncIgnore.getFileContent();
    return new _CursorIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: body
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path29.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _CursorIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _CursorIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/ignore/geminicli-ignore.ts
var import_node_path30 = require("path");
var GeminiCliIgnore = class _GeminiCliIgnore extends ToolIgnore {
  static getSettablePaths() {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".geminiignore"
    };
  }
  toRulesyncIgnore() {
    return this.toRulesyncIgnoreDefault();
  }
  static fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore
  }) {
    return new _GeminiCliIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent()
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path30.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _GeminiCliIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _GeminiCliIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/ignore/junie-ignore.ts
var import_node_path31 = require("path");
var JunieIgnore = class _JunieIgnore extends ToolIgnore {
  static getSettablePaths() {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".aiignore"
    };
  }
  toRulesyncIgnore() {
    return this.toRulesyncIgnoreDefault();
  }
  static fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore
  }) {
    return new _JunieIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent()
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path31.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _JunieIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _JunieIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/ignore/kilo-ignore.ts
var import_node_path32 = require("path");
var KiloIgnore = class _KiloIgnore extends ToolIgnore {
  static getSettablePaths() {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".kilocodeignore"
    };
  }
  /**
   * Convert KiloIgnore to RulesyncIgnore format
   */
  toRulesyncIgnore() {
    return this.toRulesyncIgnoreDefault();
  }
  /**
   * Create KiloIgnore from RulesyncIgnore
   */
  static fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore
  }) {
    const body = rulesyncIgnore.getFileContent();
    return new _KiloIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: body
    });
  }
  /**
   * Load KiloIgnore from .kilocodeignore file
   */
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path32.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _KiloIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _KiloIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/ignore/kiro-ignore.ts
var import_node_path33 = require("path");
var KiroIgnore = class _KiroIgnore extends ToolIgnore {
  static getSettablePaths() {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".aiignore"
    };
  }
  toRulesyncIgnore() {
    return this.toRulesyncIgnoreDefault();
  }
  static fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore
  }) {
    return new _KiroIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent()
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path33.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _KiroIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _KiroIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/ignore/qwencode-ignore.ts
var import_node_path34 = require("path");
var QwencodeIgnore = class _QwencodeIgnore extends ToolIgnore {
  static getSettablePaths() {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".geminiignore"
    };
  }
  toRulesyncIgnore() {
    return this.toRulesyncIgnoreDefault();
  }
  static fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore
  }) {
    return new _QwencodeIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent()
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path34.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _QwencodeIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _QwencodeIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/ignore/roo-ignore.ts
var import_node_path35 = require("path");
var RooIgnore = class _RooIgnore extends ToolIgnore {
  static getSettablePaths() {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".rooignore"
    };
  }
  toRulesyncIgnore() {
    return this.toRulesyncIgnoreDefault();
  }
  static fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore
  }) {
    return new _RooIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent()
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path35.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _RooIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _RooIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/ignore/windsurf-ignore.ts
var import_node_path36 = require("path");
var WindsurfIgnore = class _WindsurfIgnore extends ToolIgnore {
  static getSettablePaths() {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".codeiumignore"
    };
  }
  toRulesyncIgnore() {
    return this.toRulesyncIgnoreDefault();
  }
  static fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore
  }) {
    return new _WindsurfIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent()
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path36.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _WindsurfIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _WindsurfIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/ignore/zed-ignore.ts
var import_es_toolkit3 = require("es-toolkit");
var import_node_path37 = require("path");
var ZedIgnore = class _ZedIgnore extends ToolIgnore {
  constructor(params) {
    super(params);
    const jsonValue = JSON.parse(this.fileContent);
    this.patterns = jsonValue.private_files ?? [];
  }
  static getSettablePaths() {
    return {
      relativeDirPath: ".zed",
      relativeFilePath: "settings.json"
    };
  }
  /**
   * ZedIgnore uses settings.json which is a user-managed config file.
   * It should not be deleted by rulesync.
   */
  isDeletable() {
    return false;
  }
  toRulesyncIgnore() {
    const rulesyncPatterns = this.patterns.filter((pattern) => pattern.length > 0);
    const fileContent = rulesyncPatterns.join("\n");
    return new RulesyncIgnore({
      baseDir: this.baseDir,
      relativeDirPath: RulesyncIgnore.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: RulesyncIgnore.getSettablePaths().recommended.relativeFilePath,
      fileContent
    });
  }
  static async fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore
  }) {
    const fileContent = rulesyncIgnore.getFileContent();
    const patterns = fileContent.split(/\r?\n|\r/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
    const filePath = (0, import_node_path37.join)(
      baseDir,
      this.getSettablePaths().relativeDirPath,
      this.getSettablePaths().relativeFilePath
    );
    const exists = await fileExists(filePath);
    const existingFileContent = exists ? await readFileContent(filePath) : "{}";
    const existingJsonValue = JSON.parse(existingFileContent);
    const existingPrivateFiles = existingJsonValue.private_files ?? [];
    const mergedPatterns = (0, import_es_toolkit3.uniq)([...existingPrivateFiles, ...patterns].toSorted());
    const jsonValue = {
      ...existingJsonValue,
      private_files: mergedPatterns
    };
    return new _ZedIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: JSON.stringify(jsonValue, null, 2),
      validate: true
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path37.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _ZedIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _ZedIgnore({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false
    });
  }
};

// src/features/ignore/ignore-processor.ts
var ignoreProcessorToolTargets = [
  "augmentcode",
  "claudecode",
  "claudecode-legacy",
  "cline",
  "cursor",
  "geminicli",
  "junie",
  "kilo",
  "kiro",
  "qwencode",
  "roo",
  "windsurf",
  "zed"
];
var IgnoreProcessorToolTargetSchema = import_mini14.z.enum(ignoreProcessorToolTargets);
var toolIgnoreFactories = /* @__PURE__ */ new Map([
  ["augmentcode", { class: AugmentcodeIgnore }],
  ["claudecode", { class: ClaudecodeIgnore }],
  ["claudecode-legacy", { class: ClaudecodeIgnore }],
  ["cline", { class: ClineIgnore }],
  ["cursor", { class: CursorIgnore }],
  ["geminicli", { class: GeminiCliIgnore }],
  ["junie", { class: JunieIgnore }],
  ["kilo", { class: KiloIgnore }],
  ["kiro", { class: KiroIgnore }],
  ["qwencode", { class: QwencodeIgnore }],
  ["roo", { class: RooIgnore }],
  ["windsurf", { class: WindsurfIgnore }],
  ["zed", { class: ZedIgnore }]
]);
var defaultGetFactory2 = (target) => {
  const factory = toolIgnoreFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};
var IgnoreProcessor = class extends FeatureProcessor {
  toolTarget;
  getFactory;
  constructor({
    baseDir = process.cwd(),
    toolTarget,
    getFactory = defaultGetFactory2,
    dryRun = false
  }) {
    super({ baseDir, dryRun });
    const result = IgnoreProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for IgnoreProcessor: ${toolTarget}. ${formatError(result.error)}`
      );
    }
    this.toolTarget = result.data;
    this.getFactory = getFactory;
  }
  async writeToolIgnoresFromRulesyncIgnores(rulesyncIgnores) {
    const toolIgnores = await this.convertRulesyncFilesToToolFiles(rulesyncIgnores);
    await this.writeAiFiles(toolIgnores);
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync ignore files from .rulesync/ignore/ directory
   */
  async loadRulesyncFiles() {
    try {
      return [await RulesyncIgnore.fromFile()];
    } catch (error) {
      logger.error(`Failed to load rulesync files: ${formatError(error)}`);
      return [];
    }
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific ignore configurations and parse them into ToolIgnore instances
   */
  async loadToolFiles({
    forDeletion = false
  } = {}) {
    try {
      const factory = this.getFactory(this.toolTarget);
      const paths = factory.class.getSettablePaths();
      if (forDeletion) {
        const toolIgnore = factory.class.forDeletion({
          baseDir: this.baseDir,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath
        });
        const toolIgnores2 = toolIgnore.isDeletable() ? [toolIgnore] : [];
        return toolIgnores2;
      }
      const toolIgnores = await this.loadToolIgnores();
      return toolIgnores;
    } catch (error) {
      const errorMessage = `Failed to load tool files: ${formatError(error)}`;
      if (error instanceof Error && error.message.includes("no such file or directory")) {
        logger.debug(errorMessage);
      } else {
        logger.error(errorMessage);
      }
      return [];
    }
  }
  async loadToolIgnores() {
    const factory = this.getFactory(this.toolTarget);
    return [await factory.class.fromFile({ baseDir: this.baseDir })];
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert RulesyncFile[] to ToolFile[]
   */
  async convertRulesyncFilesToToolFiles(rulesyncFiles) {
    const rulesyncIgnore = rulesyncFiles.find(
      (file) => file instanceof RulesyncIgnore
    );
    if (!rulesyncIgnore) {
      throw new Error(`No ${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH} found.`);
    }
    const factory = this.getFactory(this.toolTarget);
    const toolIgnore = await factory.class.fromRulesyncIgnore({
      baseDir: this.baseDir,
      rulesyncIgnore
    });
    return [toolIgnore];
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert ToolFile[] to RulesyncFile[]
   */
  async convertToolFilesToRulesyncFiles(toolFiles) {
    const toolIgnores = toolFiles.filter((file) => file instanceof ToolIgnore);
    const rulesyncIgnores = toolIgnores.map((toolIgnore) => {
      return toolIgnore.toRulesyncIgnore();
    });
    return rulesyncIgnores;
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({ global = false } = {}) {
    if (global) {
      throw new Error("IgnoreProcessor does not support global mode");
    }
    return ignoreProcessorToolTargets;
  }
};

// src/features/mcp/mcp-processor.ts
var import_mini18 = require("zod/mini");

// src/features/mcp/claudecode-mcp.ts
var import_node_path39 = require("path");

// src/features/mcp/rulesync-mcp.ts
var import_object = require("es-toolkit/object");
var import_node_path38 = require("path");
var import_mini16 = require("zod/mini");

// src/types/mcp.ts
var import_mini15 = require("zod/mini");
var McpServerSchema = import_mini15.z.object({
  type: import_mini15.z.optional(import_mini15.z.enum(["stdio", "sse", "http"])),
  command: import_mini15.z.optional(import_mini15.z.union([import_mini15.z.string(), import_mini15.z.array(import_mini15.z.string())])),
  args: import_mini15.z.optional(import_mini15.z.array(import_mini15.z.string())),
  url: import_mini15.z.optional(import_mini15.z.string()),
  httpUrl: import_mini15.z.optional(import_mini15.z.string()),
  env: import_mini15.z.optional(import_mini15.z.record(import_mini15.z.string(), import_mini15.z.string())),
  disabled: import_mini15.z.optional(import_mini15.z.boolean()),
  networkTimeout: import_mini15.z.optional(import_mini15.z.number()),
  timeout: import_mini15.z.optional(import_mini15.z.number()),
  trust: import_mini15.z.optional(import_mini15.z.boolean()),
  cwd: import_mini15.z.optional(import_mini15.z.string()),
  transport: import_mini15.z.optional(import_mini15.z.enum(["stdio", "sse", "http"])),
  alwaysAllow: import_mini15.z.optional(import_mini15.z.array(import_mini15.z.string())),
  tools: import_mini15.z.optional(import_mini15.z.array(import_mini15.z.string())),
  kiroAutoApprove: import_mini15.z.optional(import_mini15.z.array(import_mini15.z.string())),
  kiroAutoBlock: import_mini15.z.optional(import_mini15.z.array(import_mini15.z.string())),
  headers: import_mini15.z.optional(import_mini15.z.record(import_mini15.z.string(), import_mini15.z.string()))
});
var McpServersSchema = import_mini15.z.record(import_mini15.z.string(), McpServerSchema);

// src/features/mcp/rulesync-mcp.ts
var RulesyncMcpServerSchema = import_mini16.z.extend(McpServerSchema, {
  targets: import_mini16.z.optional(RulesyncTargetsSchema),
  description: import_mini16.z.optional(import_mini16.z.string()),
  exposed: import_mini16.z.optional(import_mini16.z.boolean())
});
var RulesyncMcpConfigSchema = import_mini16.z.object({
  mcpServers: import_mini16.z.record(import_mini16.z.string(), RulesyncMcpServerSchema)
});
var RulesyncMcp = class _RulesyncMcp extends RulesyncFile {
  json;
  constructor(params) {
    super(params);
    this.json = JSON.parse(this.fileContent);
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths() {
    return {
      recommended: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "mcp.json"
      },
      legacy: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: ".mcp.json"
      }
    };
  }
  validate() {
    const result = RulesyncMcpConfigSchema.safeParse(this.json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }
  static async fromFile({ validate = true }) {
    const baseDir = process.cwd();
    const paths = this.getSettablePaths();
    const recommendedPath = (0, import_node_path38.join)(
      baseDir,
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath
    );
    const legacyPath = (0, import_node_path38.join)(baseDir, paths.legacy.relativeDirPath, paths.legacy.relativeFilePath);
    if (await fileExists(recommendedPath)) {
      const fileContent2 = await readFileContent(recommendedPath);
      return new _RulesyncMcp({
        baseDir,
        relativeDirPath: paths.recommended.relativeDirPath,
        relativeFilePath: paths.recommended.relativeFilePath,
        fileContent: fileContent2,
        validate
      });
    }
    if (await fileExists(legacyPath)) {
      logger.warn(
        `\u26A0\uFE0F  Using deprecated path "${legacyPath}". Please migrate to "${recommendedPath}"`
      );
      const fileContent2 = await readFileContent(legacyPath);
      return new _RulesyncMcp({
        baseDir,
        relativeDirPath: paths.legacy.relativeDirPath,
        relativeFilePath: paths.legacy.relativeFilePath,
        fileContent: fileContent2,
        validate
      });
    }
    const fileContent = await readFileContent(recommendedPath);
    return new _RulesyncMcp({
      baseDir,
      relativeDirPath: paths.recommended.relativeDirPath,
      relativeFilePath: paths.recommended.relativeFilePath,
      fileContent,
      validate
    });
  }
  getMcpServers() {
    const entries = Object.entries(this.json.mcpServers);
    return Object.fromEntries(
      entries.map(([serverName, serverConfig]) => {
        return [serverName, (0, import_object.omit)(serverConfig, ["targets", "description", "exposed"])];
      })
    );
  }
  getJson() {
    return this.json;
  }
};

// src/features/mcp/tool-mcp.ts
var ToolMcp = class extends ToolFile {
  constructor({ ...rest }) {
    super({
      ...rest,
      validate: true
      // Skip validation during construction
    });
    if (rest.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths() {
    throw new Error("Please implement this method in the subclass.");
  }
  static getToolTargetsGlobal() {
    throw new Error("Please implement this method in the subclass.");
  }
  toRulesyncMcpDefault({
    fileContent = void 0
  } = {}) {
    return new RulesyncMcp({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: ".mcp.json",
      fileContent: fileContent ?? this.fileContent
    });
  }
  static async fromFile(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse file content, making it safe to use
   * even when files have old/incompatible formats.
   */
  static forDeletion(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  static fromRulesyncMcp(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
};

// src/features/mcp/claudecode-mcp.ts
var ClaudecodeMcp = class _ClaudecodeMcp extends ToolMcp {
  json;
  constructor(params) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }
  getJson() {
    return this.json;
  }
  /**
   * In global mode, ~/.claude/.claude.json should not be deleted
   * as it may contain other user settings.
   * In local mode, .mcp.json can be safely deleted.
   */
  isDeletable() {
    return !this.global;
  }
  static getSettablePaths({ global } = {}) {
    if (global) {
      return {
        relativeDirPath: ".claude",
        relativeFilePath: ".claude.json"
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: ".mcp.json"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContentOrNull((0, import_node_path39.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath)) ?? '{"mcpServers":{}}';
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };
    return new _ClaudecodeMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate
    });
  }
  static async fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readOrInitializeFileContent(
      (0, import_node_path39.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2)
    );
    const json = JSON.parse(fileContent);
    const mcpJson = { ...json, mcpServers: rulesyncMcp.getMcpServers() };
    return new _ClaudecodeMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(mcpJson, null, 2),
      validate
    });
  }
  toRulesyncMcp() {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: this.json.mcpServers }, null, 2)
    });
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false
  }) {
    return new _ClaudecodeMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global
    });
  }
};

// src/features/mcp/cline-mcp.ts
var import_node_path40 = require("path");
var ClineMcp = class _ClineMcp extends ToolMcp {
  json;
  constructor(params) {
    super(params);
    this.json = this.fileContent !== void 0 ? JSON.parse(this.fileContent) : {};
  }
  getJson() {
    return this.json;
  }
  static getSettablePaths() {
    return {
      relativeDirPath: ".cline",
      relativeFilePath: "mcp.json"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path40.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _ClineMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true
  }) {
    return new _ClineMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncMcp.getFileContent(),
      validate
    });
  }
  toRulesyncMcp() {
    return this.toRulesyncMcpDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _ClineMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false
    });
  }
};

// src/features/mcp/codexcli-mcp.ts
var import_node_path41 = require("path");
var smolToml = __toESM(require("smol-toml"), 1);
var CodexcliMcp = class _CodexcliMcp extends ToolMcp {
  toml;
  constructor({ ...rest }) {
    super({
      ...rest,
      validate: false
    });
    this.toml = smolToml.parse(this.fileContent);
    if (rest.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  getToml() {
    return this.toml;
  }
  static getSettablePaths({ global } = {}) {
    if (!global) {
      throw new Error("CodexcliMcp only supports global mode. Please pass { global: true }.");
    }
    return {
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      (0, import_node_path41.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath)
    );
    return new _CodexcliMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  static async fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const configTomlFilePath = (0, import_node_path41.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath);
    const configTomlFileContent = await readOrInitializeFileContent(
      configTomlFilePath,
      smolToml.stringify({})
    );
    const configToml = smolToml.parse(configTomlFileContent);
    const mcpServers = rulesyncMcp.getJson().mcpServers;
    const filteredMcpServers = this.removeEmptyEntries(mcpServers);
    configToml["mcp_servers"] = filteredMcpServers;
    return new _CodexcliMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(configToml),
      validate
    });
  }
  toRulesyncMcp() {
    return new RulesyncMcp({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: ".mcp.json",
      fileContent: JSON.stringify({ mcpServers: this.toml.mcp_servers ?? {} }, null, 2)
    });
  }
  validate() {
    return { success: true, error: null };
  }
  static removeEmptyEntries(obj) {
    if (!obj) return {};
    const filtered = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === null) continue;
      if (typeof value === "object" && Object.keys(value).length === 0) continue;
      filtered[key] = value;
    }
    return filtered;
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _CodexcliMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/mcp/copilot-mcp.ts
var import_node_path42 = require("path");
function convertToCopilotFormat(mcpServers) {
  return { servers: mcpServers };
}
function convertFromCopilotFormat(copilotConfig) {
  return copilotConfig.servers ?? {};
}
var CopilotMcp = class _CopilotMcp extends ToolMcp {
  json;
  constructor(params) {
    super(params);
    this.json = this.fileContent !== void 0 ? JSON.parse(this.fileContent) : {};
  }
  getJson() {
    return this.json;
  }
  static getSettablePaths() {
    return {
      relativeDirPath: ".vscode",
      relativeFilePath: "mcp.json"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path42.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _CopilotMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true
  }) {
    const copilotConfig = convertToCopilotFormat(rulesyncMcp.getMcpServers());
    return new _CopilotMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: JSON.stringify(copilotConfig, null, 2),
      validate
    });
  }
  toRulesyncMcp() {
    const mcpServers = convertFromCopilotFormat(this.json);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2)
    });
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _CopilotMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false
    });
  }
};

// src/features/mcp/cursor-mcp.ts
var import_node_path43 = require("path");
var CURSOR_ENV_VAR_PATTERN = /\$\{env:([^}]+)\}/g;
function isMcpServers(value) {
  return value !== void 0 && value !== null && typeof value === "object";
}
function convertEnvFromCursorFormat(mcpServers) {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, config]) => [
      name,
      {
        ...config,
        ...config.env && {
          env: Object.fromEntries(
            Object.entries(config.env).map(([k, v]) => [
              k,
              v.replace(CURSOR_ENV_VAR_PATTERN, "${$1}")
            ])
          )
        }
      }
    ])
  );
}
function convertEnvToCursorFormat(mcpServers) {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, config]) => [
      name,
      {
        ...config,
        ...config.env && {
          env: Object.fromEntries(
            Object.entries(config.env).map(([k, v]) => [
              k,
              v.replace(/\$\{(?!env:)([^}:]+)\}/g, "${env:$1}")
            ])
          )
        }
      }
    ])
  );
}
var CursorMcp = class _CursorMcp extends ToolMcp {
  json;
  constructor(params) {
    super(params);
    this.json = this.fileContent !== void 0 ? JSON.parse(this.fileContent) : {};
  }
  getJson() {
    return this.json;
  }
  static getSettablePaths() {
    return {
      relativeDirPath: ".cursor",
      relativeFilePath: "mcp.json"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path43.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _CursorMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true
  }) {
    const json = rulesyncMcp.getJson();
    const mcpServers = isMcpServers(json.mcpServers) ? json.mcpServers : {};
    const transformedServers = convertEnvToCursorFormat(mcpServers);
    const cursorConfig = {
      mcpServers: transformedServers
    };
    const fileContent = JSON.stringify(cursorConfig, null, 2);
    return new _CursorMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  toRulesyncMcp() {
    const mcpServers = isMcpServers(this.json.mcpServers) ? this.json.mcpServers : {};
    const transformedServers = convertEnvFromCursorFormat(mcpServers);
    const transformedJson = {
      ...this.json,
      mcpServers: transformedServers
    };
    return new RulesyncMcp({
      baseDir: this.baseDir,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: "rulesync.mcp.json",
      fileContent: JSON.stringify(transformedJson),
      validate: true
    });
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _CursorMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false
    });
  }
};

// src/features/mcp/factorydroid-mcp.ts
var import_node_path44 = require("path");
var FactorydroidMcp = class _FactorydroidMcp extends ToolMcp {
  json;
  constructor(params) {
    super(params);
    this.json = this.fileContent !== void 0 ? JSON.parse(this.fileContent) : {};
  }
  getJson() {
    return this.json;
  }
  static getSettablePaths() {
    return {
      relativeDirPath: ".factory",
      relativeFilePath: "mcp.json"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path44.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _FactorydroidMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true
  }) {
    const json = rulesyncMcp.getJson();
    const factorydroidConfig = {
      mcpServers: json.mcpServers || {}
    };
    const fileContent = JSON.stringify(factorydroidConfig, null, 2);
    return new _FactorydroidMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  toRulesyncMcp() {
    return new RulesyncMcp({
      baseDir: this.baseDir,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: "rulesync.mcp.json",
      fileContent: JSON.stringify(this.json),
      validate: true
    });
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _FactorydroidMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false
    });
  }
};

// src/features/mcp/geminicli-mcp.ts
var import_node_path45 = require("path");
var GeminiCliMcp = class _GeminiCliMcp extends ToolMcp {
  json;
  constructor(params) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }
  getJson() {
    return this.json;
  }
  static getSettablePaths({ global } = {}) {
    if (global) {
      return {
        relativeDirPath: ".gemini",
        relativeFilePath: "settings.json"
      };
    }
    return {
      relativeDirPath: ".gemini",
      relativeFilePath: "settings.json"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContentOrNull((0, import_node_path45.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath)) ?? '{"mcpServers":{}}';
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };
    return new _GeminiCliMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate
    });
  }
  static async fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readOrInitializeFileContent(
      (0, import_node_path45.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2)
    );
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: rulesyncMcp.getJson().mcpServers };
    return new _GeminiCliMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate
    });
  }
  toRulesyncMcp() {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: this.json.mcpServers }, null, 2)
    });
  }
  validate() {
    return { success: true, error: null };
  }
  /**
   * settings.json may contain other settings, so it should not be deleted.
   */
  isDeletable() {
    return false;
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false
  }) {
    return new _GeminiCliMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global
    });
  }
};

// src/features/mcp/junie-mcp.ts
var import_node_path46 = require("path");
var JunieMcp = class _JunieMcp extends ToolMcp {
  json;
  constructor(params) {
    super(params);
    this.json = this.fileContent !== void 0 ? JSON.parse(this.fileContent) : {};
  }
  getJson() {
    return this.json;
  }
  static getSettablePaths() {
    return {
      relativeDirPath: (0, import_node_path46.join)(".junie", "mcp"),
      relativeFilePath: "mcp.json"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path46.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _JunieMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true
  }) {
    return new _JunieMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncMcp.getFileContent(),
      validate
    });
  }
  toRulesyncMcp() {
    return this.toRulesyncMcpDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _JunieMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false
    });
  }
};

// src/features/mcp/kilo-mcp.ts
var import_node_path47 = require("path");
var KiloMcp = class _KiloMcp extends ToolMcp {
  json;
  constructor(params) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }
  getJson() {
    return this.json;
  }
  static getSettablePaths() {
    return {
      relativeDirPath: ".kilocode",
      relativeFilePath: "mcp.json"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const paths = this.getSettablePaths();
    const fileContent = await readFileContentOrNull((0, import_node_path47.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath)) ?? '{"mcpServers":{}}';
    return new _KiloMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  static fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true
  }) {
    const paths = this.getSettablePaths();
    const fileContent = JSON.stringify({ mcpServers: rulesyncMcp.getMcpServers() }, null, 2);
    return new _KiloMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  toRulesyncMcp() {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: this.json.mcpServers ?? {} }, null, 2)
    });
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _KiloMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false
    });
  }
};

// src/features/mcp/kiro-mcp.ts
var import_node_path48 = require("path");
var KiroMcp = class _KiroMcp extends ToolMcp {
  json;
  constructor(params) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }
  getJson() {
    return this.json;
  }
  static getSettablePaths() {
    return {
      relativeDirPath: (0, import_node_path48.join)(".kiro", "settings"),
      relativeFilePath: "mcp.json"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const paths = this.getSettablePaths();
    const fileContent = await readFileContentOrNull((0, import_node_path48.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath)) ?? '{"mcpServers":{}}';
    return new _KiroMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  static fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true
  }) {
    const paths = this.getSettablePaths();
    const fileContent = JSON.stringify({ mcpServers: rulesyncMcp.getMcpServers() }, null, 2);
    return new _KiroMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate
    });
  }
  toRulesyncMcp() {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: this.json.mcpServers ?? {} }, null, 2)
    });
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _KiroMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false
    });
  }
};

// src/features/mcp/opencode-mcp.ts
var import_node_path49 = require("path");
var import_mini17 = require("zod/mini");
var OpencodeMcpLocalServerSchema = import_mini17.z.object({
  type: import_mini17.z.literal("local"),
  command: import_mini17.z.array(import_mini17.z.string()),
  environment: import_mini17.z.optional(import_mini17.z.record(import_mini17.z.string(), import_mini17.z.string())),
  enabled: import_mini17.z._default(import_mini17.z.boolean(), true),
  cwd: import_mini17.z.optional(import_mini17.z.string())
});
var OpencodeMcpRemoteServerSchema = import_mini17.z.object({
  type: import_mini17.z.literal("remote"),
  url: import_mini17.z.string(),
  headers: import_mini17.z.optional(import_mini17.z.record(import_mini17.z.string(), import_mini17.z.string())),
  enabled: import_mini17.z._default(import_mini17.z.boolean(), true)
});
var OpencodeMcpServerSchema = import_mini17.z.union([
  OpencodeMcpLocalServerSchema,
  OpencodeMcpRemoteServerSchema
]);
var OpencodeConfigSchema = import_mini17.z.looseObject({
  $schema: import_mini17.z.optional(import_mini17.z.string()),
  mcp: import_mini17.z.optional(import_mini17.z.record(import_mini17.z.string(), OpencodeMcpServerSchema))
});
function convertFromOpencodeFormat(opencodeMcp) {
  return Object.fromEntries(
    Object.entries(opencodeMcp).map(([serverName, serverConfig]) => {
      if (serverConfig.type === "remote") {
        return [
          serverName,
          {
            type: "sse",
            url: serverConfig.url,
            ...serverConfig.enabled === false && { disabled: true },
            ...serverConfig.headers && { headers: serverConfig.headers }
          }
        ];
      }
      const [command, ...args] = serverConfig.command;
      if (!command) {
        throw new Error(`Server "${serverName}" has an empty command array`);
      }
      return [
        serverName,
        {
          type: "stdio",
          command,
          ...args.length > 0 && { args },
          ...serverConfig.enabled === false && { disabled: true },
          ...serverConfig.environment && { env: serverConfig.environment },
          ...serverConfig.cwd && { cwd: serverConfig.cwd }
        }
      ];
    })
  );
}
function convertToOpencodeFormat(mcpServers) {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const isRemote = serverConfig.type === "sse" || serverConfig.type === "http" || serverConfig.url;
      if (isRemote) {
        const remoteServer = {
          type: "remote",
          url: serverConfig.url ?? serverConfig.httpUrl ?? "",
          enabled: serverConfig.disabled !== void 0 ? !serverConfig.disabled : true,
          ...serverConfig.headers && { headers: serverConfig.headers }
        };
        return [serverName, remoteServer];
      }
      const commandArray = [];
      if (serverConfig.command) {
        if (Array.isArray(serverConfig.command)) {
          commandArray.push(...serverConfig.command);
        } else {
          commandArray.push(serverConfig.command);
        }
      }
      if (serverConfig.args) {
        commandArray.push(...serverConfig.args);
      }
      const localServer = {
        type: "local",
        command: commandArray,
        enabled: serverConfig.disabled !== void 0 ? !serverConfig.disabled : true,
        ...serverConfig.env && { environment: serverConfig.env },
        ...serverConfig.cwd && { cwd: serverConfig.cwd }
      };
      return [serverName, localServer];
    })
  );
}
var OpencodeMcp = class _OpencodeMcp extends ToolMcp {
  json;
  constructor(params) {
    super(params);
    this.json = OpencodeConfigSchema.parse(JSON.parse(this.fileContent || "{}"));
  }
  getJson() {
    return this.json;
  }
  /**
   * opencode.json may contain other settings, so it should not be deleted.
   */
  isDeletable() {
    return false;
  }
  static getSettablePaths({ global } = {}) {
    if (global) {
      return {
        relativeDirPath: (0, import_node_path49.join)(".config", "opencode"),
        relativeFilePath: "opencode.json"
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: "opencode.json"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContentOrNull((0, import_node_path49.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath)) ?? '{"mcp":{}}';
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcp: json.mcp ?? {} };
    return new _OpencodeMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate
    });
  }
  static async fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readOrInitializeFileContent(
      (0, import_node_path49.join)(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcp: {} }, null, 2)
    );
    const json = JSON.parse(fileContent);
    const convertedMcp = convertToOpencodeFormat(rulesyncMcp.getMcpServers());
    const newJson = { ...json, mcp: convertedMcp };
    return new _OpencodeMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate
    });
  }
  toRulesyncMcp() {
    const convertedMcpServers = convertFromOpencodeFormat(this.json.mcp ?? {});
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: convertedMcpServers }, null, 2)
    });
  }
  validate() {
    const json = JSON.parse(this.fileContent || "{}");
    const result = OpencodeConfigSchema.safeParse(json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false
  }) {
    return new _OpencodeMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global
    });
  }
};

// src/features/mcp/roo-mcp.ts
var import_node_path50 = require("path");
function isRooMcpServers(value) {
  return value !== void 0 && value !== null && typeof value === "object";
}
function convertToRooFormat(mcpServers) {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const converted = { ...serverConfig };
      if (serverConfig.type === "http") {
        converted.type = "streamable-http";
      }
      if (serverConfig.transport === "http") {
        converted.transport = "streamable-http";
      }
      return [serverName, converted];
    })
  );
}
function convertFromRooFormat(mcpServers) {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const converted = { ...serverConfig };
      if (serverConfig.type === "streamable-http") {
        converted.type = "http";
      }
      if (serverConfig.transport === "streamable-http") {
        converted.transport = "http";
      }
      return [serverName, converted];
    })
  );
}
var RooMcp = class _RooMcp extends ToolMcp {
  json;
  constructor(params) {
    super(params);
    this.json = this.fileContent !== void 0 ? JSON.parse(this.fileContent) : {};
  }
  getJson() {
    return this.json;
  }
  static getSettablePaths() {
    return {
      relativeDirPath: ".roo",
      relativeFilePath: "mcp.json"
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path50.join)(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath
      )
    );
    return new _RooMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  static fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true
  }) {
    const mcpServers = rulesyncMcp.getMcpServers();
    const convertedMcpServers = convertToRooFormat(mcpServers);
    const fileContent = JSON.stringify({ mcpServers: convertedMcpServers }, null, 2);
    return new _RooMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate
    });
  }
  toRulesyncMcp() {
    const rawMcpServers = isRooMcpServers(this.json.mcpServers) ? this.json.mcpServers : {};
    const convertedMcpServers = convertFromRooFormat(rawMcpServers);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: convertedMcpServers }, null, 2)
    });
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _RooMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false
    });
  }
};

// src/features/mcp/mcp-processor.ts
var mcpProcessorToolTargetTuple = [
  "claudecode",
  "claudecode-legacy",
  "cline",
  "codexcli",
  "copilot",
  "cursor",
  "factorydroid",
  "geminicli",
  "kilo",
  "kiro",
  "junie",
  "opencode",
  "roo"
];
var McpProcessorToolTargetSchema = import_mini18.z.enum(mcpProcessorToolTargetTuple);
var toolMcpFactories = /* @__PURE__ */ new Map([
  [
    "claudecode",
    {
      class: ClaudecodeMcp,
      meta: { supportsProject: true, supportsGlobal: true }
    }
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeMcp,
      meta: { supportsProject: true, supportsGlobal: true }
    }
  ],
  [
    "cline",
    {
      class: ClineMcp,
      meta: { supportsProject: true, supportsGlobal: false }
    }
  ],
  [
    "codexcli",
    {
      class: CodexcliMcp,
      meta: { supportsProject: false, supportsGlobal: true }
    }
  ],
  [
    "copilot",
    {
      class: CopilotMcp,
      meta: { supportsProject: true, supportsGlobal: false }
    }
  ],
  [
    "cursor",
    {
      class: CursorMcp,
      meta: { supportsProject: true, supportsGlobal: false }
    }
  ],
  [
    "factorydroid",
    {
      class: FactorydroidMcp,
      meta: { supportsProject: true, supportsGlobal: true }
    }
  ],
  [
    "geminicli",
    {
      class: GeminiCliMcp,
      meta: { supportsProject: true, supportsGlobal: true }
    }
  ],
  [
    "kilo",
    {
      class: KiloMcp,
      meta: { supportsProject: true, supportsGlobal: false }
    }
  ],
  [
    "kiro",
    {
      class: KiroMcp,
      meta: { supportsProject: true, supportsGlobal: false }
    }
  ],
  [
    "junie",
    {
      class: JunieMcp,
      meta: { supportsProject: true, supportsGlobal: false }
    }
  ],
  [
    "opencode",
    {
      class: OpencodeMcp,
      meta: { supportsProject: true, supportsGlobal: true }
    }
  ],
  [
    "roo",
    {
      class: RooMcp,
      meta: { supportsProject: true, supportsGlobal: false }
    }
  ]
]);
var allToolTargetKeys2 = [...toolMcpFactories.keys()];
var mcpProcessorToolTargets = allToolTargetKeys2.filter((target) => {
  const factory = toolMcpFactories.get(target);
  return factory?.meta.supportsProject ?? false;
});
var mcpProcessorToolTargetsGlobal = allToolTargetKeys2.filter((target) => {
  const factory = toolMcpFactories.get(target);
  return factory?.meta.supportsGlobal ?? false;
});
var defaultGetFactory3 = (target) => {
  const factory = toolMcpFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};
var McpProcessor = class extends FeatureProcessor {
  toolTarget;
  global;
  getFactory;
  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
    getFactory = defaultGetFactory3,
    dryRun = false
  }) {
    super({ baseDir, dryRun });
    const result = McpProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for McpProcessor: ${toolTarget}. ${formatError(result.error)}`
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.getFactory = getFactory;
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync MCP files from .rulesync/ directory
   */
  async loadRulesyncFiles() {
    try {
      return [await RulesyncMcp.fromFile({})];
    } catch (error) {
      logger.error(`Failed to load a Rulesync MCP file: ${formatError(error)}`);
      return [];
    }
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific MCP configurations and parse them into ToolMcp instances
   */
  async loadToolFiles({
    forDeletion = false
  } = {}) {
    try {
      const factory = this.getFactory(this.toolTarget);
      const paths = factory.class.getSettablePaths({ global: this.global });
      if (forDeletion) {
        const toolMcp = factory.class.forDeletion({
          baseDir: this.baseDir,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath,
          global: this.global
        });
        const toolMcps2 = toolMcp.isDeletable() ? [toolMcp] : [];
        logger.debug(`Successfully loaded ${toolMcps2.length} ${this.toolTarget} MCP files`);
        return toolMcps2;
      }
      const toolMcps = [
        await factory.class.fromFile({
          baseDir: this.baseDir,
          validate: true,
          global: this.global
        })
      ];
      logger.debug(`Successfully loaded ${toolMcps.length} ${this.toolTarget} MCP files`);
      return toolMcps;
    } catch (error) {
      const errorMessage = `Failed to load MCP files for tool target: ${this.toolTarget}: ${formatError(error)}`;
      if (error instanceof Error && error.message.includes("no such file or directory")) {
        logger.debug(errorMessage);
      } else {
        logger.error(errorMessage);
      }
      return [];
    }
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert RulesyncFile[] to ToolFile[]
   */
  async convertRulesyncFilesToToolFiles(rulesyncFiles) {
    const rulesyncMcp = rulesyncFiles.find(
      (file) => file instanceof RulesyncMcp
    );
    if (!rulesyncMcp) {
      throw new Error(`No ${RULESYNC_MCP_RELATIVE_FILE_PATH} found.`);
    }
    const factory = this.getFactory(this.toolTarget);
    const toolMcps = await Promise.all(
      [rulesyncMcp].map(async (rulesyncMcp2) => {
        return await factory.class.fromRulesyncMcp({
          baseDir: this.baseDir,
          rulesyncMcp: rulesyncMcp2,
          global: this.global
        });
      })
    );
    return toolMcps;
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Convert ToolFile[] to RulesyncFile[]
   */
  async convertToolFilesToRulesyncFiles(toolFiles) {
    const toolMcps = toolFiles.filter((file) => file instanceof ToolMcp);
    const rulesyncMcps = toolMcps.map((toolMcp) => {
      return toolMcp.toRulesyncMcp();
    });
    return rulesyncMcps;
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({ global = false } = {}) {
    if (global) {
      return mcpProcessorToolTargetsGlobal;
    }
    return mcpProcessorToolTargets;
  }
};

// src/features/rules/rules-processor.ts
var import_toon = require("@toon-format/toon");
var import_node_path108 = require("path");
var import_mini48 = require("zod/mini");

// src/constants/general.ts
var SKILL_FILE_NAME = "SKILL.md";

// src/features/skills/agentsmd-skill.ts
var import_node_path54 = require("path");

// src/features/skills/simulated-skill.ts
var import_node_path53 = require("path");
var import_mini19 = require("zod/mini");

// src/features/skills/tool-skill.ts
var import_node_path52 = require("path");

// src/types/ai-dir.ts
var import_node_path51 = __toESM(require("path"), 1);
var AiDir = class {
  /**
   * @example "."
   */
  baseDir;
  /**
   * @example ".rulesync/skills"
   */
  relativeDirPath;
  /**
   * @example "my-skill"
   */
  dirName;
  /**
   * Optional main file with frontmatter support
   */
  mainFile;
  /**
   * Additional files in the directory
   */
  otherFiles;
  /**
   * @example false
   */
  global;
  constructor({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    mainFile,
    otherFiles = [],
    global = false
  }) {
    if (dirName.includes(import_node_path51.default.sep) || dirName.includes("/") || dirName.includes("\\")) {
      throw new Error(`Directory name cannot contain path separators: dirName="${dirName}"`);
    }
    this.baseDir = baseDir;
    this.relativeDirPath = relativeDirPath;
    this.dirName = dirName;
    this.mainFile = mainFile;
    this.otherFiles = otherFiles;
    this.global = global;
  }
  static async fromDir(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  getBaseDir() {
    return this.baseDir;
  }
  getRelativeDirPath() {
    return this.relativeDirPath;
  }
  getDirName() {
    return this.dirName;
  }
  getDirPath() {
    const fullPath = import_node_path51.default.join(this.baseDir, this.relativeDirPath, this.dirName);
    const resolvedFull = (0, import_node_path51.resolve)(fullPath);
    const resolvedBase = (0, import_node_path51.resolve)(this.baseDir);
    const rel = (0, import_node_path51.relative)(resolvedBase, resolvedFull);
    if (rel.startsWith("..") || import_node_path51.default.isAbsolute(rel)) {
      throw new Error(
        `Path traversal detected: Final path escapes baseDir. baseDir="${this.baseDir}", relativeDirPath="${this.relativeDirPath}", dirName="${this.dirName}"`
      );
    }
    return fullPath;
  }
  getMainFile() {
    return this.mainFile;
  }
  getOtherFiles() {
    return this.otherFiles;
  }
  getRelativePathFromCwd() {
    return import_node_path51.default.join(this.relativeDirPath, this.dirName);
  }
  getGlobal() {
    return this.global;
  }
  setMainFile(name, body, frontmatter) {
    this.mainFile = { name, body, frontmatter };
  }
  /**
   * Recursively collects all files from a directory, excluding the specified main file.
   * This is a common utility for loading additional files alongside the main file.
   *
   * @param baseDir - The base directory path
   * @param relativeDirPath - The relative path to the directory containing the skill
   * @param dirName - The name of the directory
   * @param excludeFileName - The name of the file to exclude (typically the main file)
   * @returns Array of files with their relative paths and buffers
   */
  static async collectOtherFiles(baseDir, relativeDirPath, dirName, excludeFileName) {
    const dirPath = (0, import_node_path51.join)(baseDir, relativeDirPath, dirName);
    const glob = (0, import_node_path51.join)(dirPath, "**", "*");
    const filePaths = await findFilesByGlobs(glob, { type: "file" });
    const filteredPaths = filePaths.filter((filePath) => (0, import_node_path51.basename)(filePath) !== excludeFileName);
    const files = await Promise.all(
      filteredPaths.map(async (filePath) => {
        const fileBuffer = await readFileBuffer(filePath);
        return {
          relativeFilePathToDirPath: (0, import_node_path51.relative)(dirPath, filePath),
          fileBuffer
        };
      })
    );
    return files;
  }
};

// src/features/skills/tool-skill.ts
var ToolSkill = class extends AiDir {
  /**
   * Get the settable paths for this tool's skill directories.
   *
   * @param options - Optional configuration including global mode
   * @returns Object containing the relative directory path
   */
  static getSettablePaths(_options) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Load a skill from a tool-specific directory.
   *
   * This method should:
   * 1. Read the SKILL.md file content
   * 2. Parse tool-specific frontmatter format
   * 3. Validate the parsed data
   * 4. Collect other skill files in the directory
   * 5. Return a concrete ToolSkill instance
   *
   * @param params - Parameters including the skill directory name
   * @returns Promise resolving to a concrete ToolSkill instance
   */
  static async fromDir(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse directory content, making it safe to use
   * even when skill files have old/incompatible formats.
   */
  static forDeletion(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Convert a RulesyncSkill to the tool-specific skill format.
   *
   * This method should:
   * 1. Extract relevant data from the RulesyncSkill
   * 2. Transform frontmatter to tool-specific format
   * 3. Transform body content if needed
   * 4. Preserve other skill files
   * 5. Return a concrete ToolSkill instance
   *
   * @param params - Parameters including the RulesyncSkill to convert
   * @returns A concrete ToolSkill instance
   */
  static fromRulesyncSkill(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Check if this tool is targeted by a RulesyncSkill.
   * Since skills don't have targets field like commands/subagents,
   * the default behavior may vary by tool.
   *
   * @param rulesyncSkill - The RulesyncSkill to check
   * @returns True if this tool should use the skill
   */
  static isTargetedByRulesyncSkill(_rulesyncSkill) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Load and parse skill directory content.
   * This is a helper method that handles the common logic of reading SKILL.md,
   * parsing frontmatter, and collecting other files.
   *
   * Subclasses should call this method and then validate the frontmatter
   * against their specific schema.
   *
   * @param params - Parameters including settablePaths callback to get tool-specific paths
   * @returns Parsed skill directory content
   */
  static async loadSkillDirContent({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
    getSettablePaths
  }) {
    const settablePaths = getSettablePaths({ global });
    const actualRelativeDirPath = relativeDirPath ?? settablePaths.relativeDirPath;
    const skillDirPath = (0, import_node_path52.join)(baseDir, actualRelativeDirPath, dirName);
    const skillFilePath = (0, import_node_path52.join)(skillDirPath, SKILL_FILE_NAME);
    if (!await fileExists(skillFilePath)) {
      throw new Error(`${SKILL_FILE_NAME} not found in ${skillDirPath}`);
    }
    const fileContent = await readFileContent(skillFilePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const otherFiles = await this.collectOtherFiles(
      baseDir,
      actualRelativeDirPath,
      dirName,
      SKILL_FILE_NAME
    );
    return {
      baseDir,
      relativeDirPath: actualRelativeDirPath,
      dirName,
      frontmatter,
      body: content.trim(),
      otherFiles,
      global
    };
  }
};

// src/features/skills/simulated-skill.ts
var SimulatedSkillFrontmatterSchema = import_mini19.z.looseObject({
  name: import_mini19.z.string(),
  description: import_mini19.z.string()
});
var SimulatedSkill = class extends ToolSkill {
  frontmatter;
  body;
  constructor({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global: false
      // Simulated skills are project mode only
    });
    if (validate) {
      const result = SimulatedSkillFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path53.join)(relativeDirPath, dirName)}: ${formatError(result.error)}`
        );
      }
    }
    this.frontmatter = frontmatter;
    this.body = body;
  }
  getBody() {
    return this.body;
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  toRulesyncSkill() {
    throw new Error("Not implemented because it is a SIMULATED skill.");
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = SimulatedSkillFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
  }
  static fromRulesyncSkillDefault({
    rulesyncSkill,
    validate = true
  }) {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const simulatedFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description
    };
    return {
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: simulatedFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate
    };
  }
  static async fromDirDefault({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName
  }) {
    const settablePaths = this.getSettablePaths();
    const actualRelativeDirPath = relativeDirPath ?? settablePaths.relativeDirPath;
    const skillDirPath = (0, import_node_path53.join)(baseDir, actualRelativeDirPath, dirName);
    const skillFilePath = (0, import_node_path53.join)(skillDirPath, SKILL_FILE_NAME);
    if (!await fileExists(skillFilePath)) {
      throw new Error(`${SKILL_FILE_NAME} not found in ${skillDirPath}`);
    }
    const fileContent = await readFileContent(skillFilePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = SimulatedSkillFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${skillFilePath}: ${formatError(result.error)}`);
    }
    const otherFiles = await this.collectOtherFiles(
      baseDir,
      actualRelativeDirPath,
      dirName,
      SKILL_FILE_NAME
    );
    return {
      baseDir,
      relativeDirPath: actualRelativeDirPath,
      dirName,
      frontmatter: result.data,
      body: content.trim(),
      otherFiles,
      validate: true
    };
  }
  /**
   * Create minimal params for deletion purposes.
   * This method does not read or parse directory content, making it safe to use
   * even when skill files have old/incompatible formats.
   */
  static forDeletionDefault({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName
  }) {
    return {
      baseDir,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false
    };
  }
  /**
   * Check if a RulesyncSkill should be converted to this simulated skill type.
   * Uses the targets field in the RulesyncSkill frontmatter to determine targeting.
   */
  static isTargetedByRulesyncSkillDefault({
    rulesyncSkill,
    toolTarget
  }) {
    const frontmatter = rulesyncSkill.getFrontmatter();
    const targets = frontmatter.targets;
    if (targets.includes("*")) {
      return true;
    }
    return targets.includes(toolTarget);
  }
  /**
   * Get the settable paths for this tool's skill directories.
   * Must be implemented by concrete subclasses.
   */
  static getSettablePaths(_options) {
    throw new Error("Please implement this method in the subclass.");
  }
};

// src/features/skills/agentsmd-skill.ts
var AgentsmdSkill = class _AgentsmdSkill extends SimulatedSkill {
  static getSettablePaths(options) {
    if (options?.global) {
      throw new Error("AgentsmdSkill does not support global mode.");
    }
    return {
      relativeDirPath: (0, import_node_path54.join)(".agents", "skills")
    };
  }
  static async fromDir(params) {
    const baseParams = await this.fromDirDefault(params);
    return new _AgentsmdSkill(baseParams);
  }
  static fromRulesyncSkill(params) {
    const baseParams = {
      ...this.fromRulesyncSkillDefault(params),
      relativeDirPath: this.getSettablePaths().relativeDirPath
    };
    return new _AgentsmdSkill(baseParams);
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    return this.isTargetedByRulesyncSkillDefault({
      rulesyncSkill,
      toolTarget: "agentsmd"
    });
  }
  static forDeletion(params) {
    const baseParams = this.forDeletionDefault(params);
    return new _AgentsmdSkill(baseParams);
  }
};

// src/features/skills/factorydroid-skill.ts
var import_node_path55 = require("path");
var FactorydroidSkill = class _FactorydroidSkill extends SimulatedSkill {
  static getSettablePaths(_options) {
    return {
      relativeDirPath: (0, import_node_path55.join)(".factory", "skills")
    };
  }
  static async fromDir(params) {
    const baseParams = await this.fromDirDefault(params);
    return new _FactorydroidSkill(baseParams);
  }
  static fromRulesyncSkill(params) {
    const baseParams = {
      ...this.fromRulesyncSkillDefault(params),
      relativeDirPath: this.getSettablePaths().relativeDirPath
    };
    return new _FactorydroidSkill(baseParams);
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    return this.isTargetedByRulesyncSkillDefault({
      rulesyncSkill,
      toolTarget: "factorydroid"
    });
  }
  static forDeletion(params) {
    const baseParams = this.forDeletionDefault(params);
    return new _FactorydroidSkill(baseParams);
  }
};

// src/features/skills/skills-processor.ts
var import_node_path71 = require("path");
var import_mini33 = require("zod/mini");

// src/types/dir-feature-processor.ts
var import_node_path56 = require("path");
var DirFeatureProcessor = class {
  baseDir;
  dryRun;
  constructor({ baseDir = process.cwd(), dryRun = false }) {
    this.baseDir = baseDir;
    this.dryRun = dryRun;
  }
  /**
   * Return tool targets that this feature supports.
   */
  static getToolTargets(_params = {}) {
    throw new Error("Not implemented");
  }
  /**
   * Once converted to rulesync/tool dirs, write them to the filesystem.
   * Returns the number of directories written.
   *
   * Note: This method uses directory-level change detection. If any file within
   * a directory has changed, ALL files in that directory are rewritten. This is
   * an intentional design decision to ensure consistency within directory units.
   */
  async writeAiDirs(aiDirs) {
    let changedCount = 0;
    const changedPaths = [];
    for (const aiDir of aiDirs) {
      const dirPath = aiDir.getDirPath();
      let dirHasChanges = false;
      const mainFile = aiDir.getMainFile();
      let mainFileContent;
      if (mainFile) {
        const mainFilePath = (0, import_node_path56.join)(dirPath, mainFile.name);
        const content = stringifyFrontmatter(mainFile.body, mainFile.frontmatter);
        mainFileContent = addTrailingNewline(content);
        const existingContent = await readFileContentOrNull(mainFilePath);
        if (existingContent !== mainFileContent) {
          dirHasChanges = true;
        }
      }
      const otherFiles = aiDir.getOtherFiles();
      const otherFileContents = [];
      for (const file of otherFiles) {
        const contentWithNewline = addTrailingNewline(file.fileBuffer.toString("utf-8"));
        otherFileContents.push(contentWithNewline);
        if (!dirHasChanges) {
          const filePath = (0, import_node_path56.join)(dirPath, file.relativeFilePathToDirPath);
          const existingContent = await readFileContentOrNull(filePath);
          if (existingContent !== contentWithNewline) {
            dirHasChanges = true;
          }
        }
      }
      if (!dirHasChanges) {
        continue;
      }
      const relativeDir = aiDir.getRelativePathFromCwd();
      if (this.dryRun) {
        logger.info(`[DRY RUN] Would create directory: ${dirPath}`);
        if (mainFile) {
          logger.info(`[DRY RUN] Would write: ${(0, import_node_path56.join)(dirPath, mainFile.name)}`);
          changedPaths.push((0, import_node_path56.join)(relativeDir, mainFile.name));
        }
        for (const file of otherFiles) {
          logger.info(`[DRY RUN] Would write: ${(0, import_node_path56.join)(dirPath, file.relativeFilePathToDirPath)}`);
          changedPaths.push((0, import_node_path56.join)(relativeDir, file.relativeFilePathToDirPath));
        }
      } else {
        await ensureDir(dirPath);
        if (mainFile && mainFileContent) {
          const mainFilePath = (0, import_node_path56.join)(dirPath, mainFile.name);
          await writeFileContent(mainFilePath, mainFileContent);
          changedPaths.push((0, import_node_path56.join)(relativeDir, mainFile.name));
        }
        for (const [i, file] of otherFiles.entries()) {
          const filePath = (0, import_node_path56.join)(dirPath, file.relativeFilePathToDirPath);
          const content = otherFileContents[i];
          if (content === void 0) {
            throw new Error(
              `Internal error: content for file ${file.relativeFilePathToDirPath} is undefined. This indicates a synchronization issue between otherFiles and otherFileContents arrays.`
            );
          }
          await writeFileContent(filePath, content);
          changedPaths.push((0, import_node_path56.join)(relativeDir, file.relativeFilePathToDirPath));
        }
      }
      changedCount++;
    }
    return { count: changedCount, paths: changedPaths };
  }
  async removeAiDirs(aiDirs) {
    for (const aiDir of aiDirs) {
      await removeDirectory(aiDir.getDirPath());
    }
  }
  /**
   * Remove orphan directories that exist in the tool directory but not in the generated directories.
   * This only deletes directories that are no longer in the rulesync source, not directories that will be overwritten.
   */
  async removeOrphanAiDirs(existingDirs, generatedDirs) {
    const generatedPaths = new Set(generatedDirs.map((d) => d.getDirPath()));
    const orphanDirs = existingDirs.filter((d) => !generatedPaths.has(d.getDirPath()));
    for (const aiDir of orphanDirs) {
      const dirPath = aiDir.getDirPath();
      if (this.dryRun) {
        logger.info(`[DRY RUN] Would delete directory: ${dirPath}`);
      } else {
        await removeDirectory(dirPath);
      }
    }
    return orphanDirs.length;
  }
};

// src/features/skills/agentsskills-skill.ts
var import_node_path58 = require("path");
var import_mini21 = require("zod/mini");

// src/features/skills/rulesync-skill.ts
var import_node_path57 = require("path");
var import_mini20 = require("zod/mini");
var RulesyncSkillFrontmatterSchemaInternal = import_mini20.z.looseObject({
  name: import_mini20.z.string(),
  description: import_mini20.z.string(),
  targets: import_mini20.z._default(RulesyncTargetsSchema, ["*"]),
  claudecode: import_mini20.z.optional(
    import_mini20.z.looseObject({
      "allowed-tools": import_mini20.z.optional(import_mini20.z.array(import_mini20.z.string()))
    })
  ),
  codexcli: import_mini20.z.optional(
    import_mini20.z.looseObject({
      "short-description": import_mini20.z.optional(import_mini20.z.string())
    })
  ),
  opencode: import_mini20.z.optional(
    import_mini20.z.looseObject({
      "allowed-tools": import_mini20.z.optional(import_mini20.z.array(import_mini20.z.string()))
    })
  ),
  copilot: import_mini20.z.optional(
    import_mini20.z.looseObject({
      license: import_mini20.z.optional(import_mini20.z.string())
    })
  ),
  roo: import_mini20.z.optional(import_mini20.z.looseObject({}))
});
var RulesyncSkillFrontmatterSchema = RulesyncSkillFrontmatterSchemaInternal;
var RulesyncSkill = class _RulesyncSkill extends AiDir {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = RULESYNC_SKILLS_RELATIVE_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths() {
    return {
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = RulesyncSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    const result = RulesyncSkillFrontmatterSchema.safeParse(this.mainFile?.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    return { success: true, error: null };
  }
  static async fromDir({
    baseDir = process.cwd(),
    relativeDirPath = RULESYNC_SKILLS_RELATIVE_DIR_PATH,
    dirName,
    global = false
  }) {
    const skillDirPath = (0, import_node_path57.join)(baseDir, relativeDirPath, dirName);
    const skillFilePath = (0, import_node_path57.join)(skillDirPath, SKILL_FILE_NAME);
    if (!await fileExists(skillFilePath)) {
      throw new Error(`${SKILL_FILE_NAME} not found in ${skillDirPath}`);
    }
    const fileContent = await readFileContent(skillFilePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${skillFilePath}: ${formatError(result.error)}`);
    }
    const otherFiles = await this.collectOtherFiles(
      baseDir,
      relativeDirPath,
      dirName,
      SKILL_FILE_NAME
    );
    return new _RulesyncSkill({
      baseDir,
      relativeDirPath,
      dirName,
      frontmatter: result.data,
      body: content.trim(),
      otherFiles,
      validate: true,
      global
    });
  }
};

// src/features/skills/agentsskills-skill.ts
var AgentsSkillsSkillFrontmatterSchema = import_mini21.z.looseObject({
  name: import_mini21.z.string(),
  description: import_mini21.z.string()
});
var AgentsSkillsSkill = class _AgentsSkillsSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = (0, import_node_path58.join)(".agents", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths(options) {
    if (options?.global) {
      throw new Error("AgentsSkillsSkill does not support global mode.");
    }
    return {
      relativeDirPath: (0, import_node_path58.join)(".agents", "skills")
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = AgentsSkillsSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    if (!this.mainFile) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`)
      };
    }
    const result = AgentsSkillsSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    return { success: true, error: null };
  }
  toRulesyncSkill() {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"]
    };
    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global
    });
  }
  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false
  }) {
    const settablePaths = _AgentsSkillsSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const agentsSkillsFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description
    };
    return new _AgentsSkillsSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: agentsSkillsFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global
    });
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("agentsskills");
  }
  static async fromDir(params) {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: _AgentsSkillsSkill.getSettablePaths
    });
    const result = AgentsSkillsSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = (0, import_node_path58.join)(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path58.join)(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`
      );
    }
    return new _AgentsSkillsSkill({
      baseDir: loaded.baseDir,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false
  }) {
    const settablePaths = _AgentsSkillsSkill.getSettablePaths({ global });
    return new _AgentsSkillsSkill({
      baseDir,
      relativeDirPath: relativeDirPath ?? settablePaths.relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global
    });
  }
};

// src/features/skills/antigravity-skill.ts
var import_node_path59 = require("path");
var import_mini22 = require("zod/mini");
var AntigravitySkillFrontmatterSchema = import_mini22.z.looseObject({
  name: import_mini22.z.string(),
  description: import_mini22.z.string()
});
var AntigravitySkill = class _AntigravitySkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = (0, import_node_path59.join)(".agent", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths({
    global = false
  } = {}) {
    if (global) {
      return {
        relativeDirPath: (0, import_node_path59.join)(".gemini", "antigravity", "skills")
      };
    }
    return {
      relativeDirPath: (0, import_node_path59.join)(".agent", "skills")
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = AntigravitySkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    if (this.mainFile === void 0) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`)
      };
    }
    const result = AntigravitySkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    return { success: true, error: null };
  }
  toRulesyncSkill() {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"]
    };
    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global
    });
  }
  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false
  }) {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const antigravityFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description
    };
    const settablePaths = _AntigravitySkill.getSettablePaths({ global });
    return new _AntigravitySkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: antigravityFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global
    });
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("antigravity");
  }
  static async fromDir(params) {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: _AntigravitySkill.getSettablePaths
    });
    const result = AntigravitySkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = (0, import_node_path59.join)(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path59.join)(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`
      );
    }
    return new _AntigravitySkill({
      baseDir: loaded.baseDir,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false
  }) {
    return new _AntigravitySkill({
      baseDir,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global
    });
  }
};

// src/features/skills/claudecode-skill.ts
var import_node_path60 = require("path");
var import_mini23 = require("zod/mini");
var ClaudecodeSkillFrontmatterSchema = import_mini23.z.looseObject({
  name: import_mini23.z.string(),
  description: import_mini23.z.string(),
  "allowed-tools": import_mini23.z.optional(import_mini23.z.array(import_mini23.z.string()))
});
var ClaudecodeSkill = class _ClaudecodeSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = (0, import_node_path60.join)(".claude", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths({
    global: _global = false
  } = {}) {
    return {
      relativeDirPath: (0, import_node_path60.join)(".claude", "skills")
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = ClaudecodeSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    if (this.mainFile === void 0) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`)
      };
    }
    const result = ClaudecodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    return { success: true, error: null };
  }
  toRulesyncSkill() {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...frontmatter["allowed-tools"] && {
        claudecode: {
          "allowed-tools": frontmatter["allowed-tools"]
        }
      }
    };
    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global
    });
  }
  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false
  }) {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const claudecodeFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      "allowed-tools": rulesyncFrontmatter.claudecode?.["allowed-tools"]
    };
    const settablePaths = _ClaudecodeSkill.getSettablePaths({ global });
    return new _ClaudecodeSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: claudecodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global
    });
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("claudecode");
  }
  static async fromDir(params) {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: _ClaudecodeSkill.getSettablePaths
    });
    const result = ClaudecodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = (0, import_node_path60.join)(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path60.join)(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`
      );
    }
    return new _ClaudecodeSkill({
      baseDir: loaded.baseDir,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false
  }) {
    return new _ClaudecodeSkill({
      baseDir,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global
    });
  }
};

// src/features/skills/codexcli-skill.ts
var import_node_path61 = require("path");
var import_mini24 = require("zod/mini");
var CodexCliSkillFrontmatterSchema = import_mini24.z.looseObject({
  name: import_mini24.z.string(),
  description: import_mini24.z.string(),
  metadata: import_mini24.z.optional(
    import_mini24.z.looseObject({
      "short-description": import_mini24.z.optional(import_mini24.z.string())
    })
  )
});
var CodexCliSkill = class _CodexCliSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = (0, import_node_path61.join)(".codex", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths({
    global: _global = false
  } = {}) {
    return {
      relativeDirPath: (0, import_node_path61.join)(".codex", "skills")
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = CodexCliSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    if (!this.mainFile) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`)
      };
    }
    const result = CodexCliSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    return { success: true, error: null };
  }
  toRulesyncSkill() {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...frontmatter.metadata?.["short-description"] && {
        codexcli: {
          "short-description": frontmatter.metadata["short-description"]
        }
      }
    };
    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global
    });
  }
  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false
  }) {
    const settablePaths = _CodexCliSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const codexFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...rulesyncFrontmatter.codexcli?.["short-description"] && {
        metadata: {
          "short-description": rulesyncFrontmatter.codexcli["short-description"]
        }
      }
    };
    return new _CodexCliSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: codexFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global
    });
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("codexcli");
  }
  static async fromDir(params) {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: _CodexCliSkill.getSettablePaths
    });
    const result = CodexCliSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = (0, import_node_path61.join)(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path61.join)(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`
      );
    }
    return new _CodexCliSkill({
      baseDir: loaded.baseDir,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false
  }) {
    return new _CodexCliSkill({
      baseDir,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global
    });
  }
};

// src/features/skills/copilot-skill.ts
var import_node_path62 = require("path");
var import_mini25 = require("zod/mini");
var CopilotSkillFrontmatterSchema = import_mini25.z.looseObject({
  name: import_mini25.z.string(),
  description: import_mini25.z.string(),
  license: import_mini25.z.optional(import_mini25.z.string())
});
var CopilotSkill = class _CopilotSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = (0, import_node_path62.join)(".github", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths(options) {
    if (options?.global) {
      throw new Error("CopilotSkill does not support global mode.");
    }
    return {
      relativeDirPath: (0, import_node_path62.join)(".github", "skills")
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = CopilotSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    if (!this.mainFile) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`)
      };
    }
    const result = CopilotSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    return { success: true, error: null };
  }
  toRulesyncSkill() {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...frontmatter.license && {
        copilot: {
          license: frontmatter.license
        }
      }
    };
    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global
    });
  }
  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false
  }) {
    const settablePaths = _CopilotSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const copilotFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      license: rulesyncFrontmatter.copilot?.license
    };
    return new _CopilotSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: copilotFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global
    });
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("copilot");
  }
  static async fromDir(params) {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: _CopilotSkill.getSettablePaths
    });
    const result = CopilotSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = (0, import_node_path62.join)(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path62.join)(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`
      );
    }
    return new _CopilotSkill({
      baseDir: loaded.baseDir,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false
  }) {
    const settablePaths = _CopilotSkill.getSettablePaths({ global });
    return new _CopilotSkill({
      baseDir,
      relativeDirPath: relativeDirPath ?? settablePaths.relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global
    });
  }
};

// src/features/skills/cursor-skill.ts
var import_node_path63 = require("path");
var import_mini26 = require("zod/mini");
var CursorSkillFrontmatterSchema = import_mini26.z.looseObject({
  name: import_mini26.z.string(),
  description: import_mini26.z.string()
});
var CursorSkill = class _CursorSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = (0, import_node_path63.join)(".cursor", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths(_options) {
    return {
      relativeDirPath: (0, import_node_path63.join)(".cursor", "skills")
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = CursorSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    if (!this.mainFile) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`)
      };
    }
    const result = CursorSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    return { success: true, error: null };
  }
  toRulesyncSkill() {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"]
    };
    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global
    });
  }
  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false
  }) {
    const settablePaths = _CursorSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const cursorFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description
    };
    return new _CursorSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: cursorFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global
    });
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("cursor");
  }
  static async fromDir(params) {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: _CursorSkill.getSettablePaths
    });
    const result = CursorSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = (0, import_node_path63.join)(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path63.join)(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`
      );
    }
    return new _CursorSkill({
      baseDir: loaded.baseDir,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false
  }) {
    const settablePaths = _CursorSkill.getSettablePaths({ global });
    return new _CursorSkill({
      baseDir,
      relativeDirPath: relativeDirPath ?? settablePaths.relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global
    });
  }
};

// src/features/skills/geminicli-skill.ts
var import_node_path64 = require("path");
var import_mini27 = require("zod/mini");
var GeminiCliSkillFrontmatterSchema = import_mini27.z.looseObject({
  name: import_mini27.z.string(),
  description: import_mini27.z.string()
});
var GeminiCliSkill = class _GeminiCliSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = _GeminiCliSkill.getSettablePaths().relativeDirPath,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths({
    global: _global = false
  } = {}) {
    return {
      relativeDirPath: (0, import_node_path64.join)(".gemini", "skills")
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = GeminiCliSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    if (this.mainFile === void 0) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`)
      };
    }
    const result = GeminiCliSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    return { success: true, error: null };
  }
  toRulesyncSkill() {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"]
    };
    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global
    });
  }
  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false
  }) {
    const settablePaths = _GeminiCliSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const geminiCliFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description
    };
    return new _GeminiCliSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: geminiCliFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global
    });
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("geminicli");
  }
  static async fromDir(params) {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: _GeminiCliSkill.getSettablePaths
    });
    const result = GeminiCliSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = (0, import_node_path64.join)(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path64.join)(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`
      );
    }
    return new _GeminiCliSkill({
      baseDir: loaded.baseDir,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false
  }) {
    const settablePaths = _GeminiCliSkill.getSettablePaths({ global });
    return new _GeminiCliSkill({
      baseDir,
      relativeDirPath: relativeDirPath ?? settablePaths.relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global
    });
  }
};

// src/features/skills/kilo-skill.ts
var import_node_path65 = require("path");
var import_mini28 = require("zod/mini");
var KiloSkillFrontmatterSchema = import_mini28.z.looseObject({
  name: import_mini28.z.string(),
  description: import_mini28.z.string()
});
var KiloSkill = class _KiloSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = (0, import_node_path65.join)(".kilocode", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths({
    global: _global = false
  } = {}) {
    return {
      relativeDirPath: (0, import_node_path65.join)(".kilocode", "skills")
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = KiloSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    if (!this.mainFile) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`)
      };
    }
    const result = KiloSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    if (result.data.name !== this.getDirName()) {
      return {
        success: false,
        error: new Error(
          `${this.getDirPath()}: frontmatter name (${result.data.name}) must match directory name (${this.getDirName()})`
        )
      };
    }
    return { success: true, error: null };
  }
  toRulesyncSkill() {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"]
    };
    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global
    });
  }
  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false
  }) {
    const settablePaths = _KiloSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const kiloFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description
    };
    return new _KiloSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: kiloFrontmatter.name,
      frontmatter: kiloFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global
    });
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("kilo");
  }
  static async fromDir(params) {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: _KiloSkill.getSettablePaths
    });
    const result = KiloSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = (0, import_node_path65.join)(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path65.join)(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`
      );
    }
    if (result.data.name !== loaded.dirName) {
      const skillFilePath = (0, import_node_path65.join)(
        loaded.baseDir,
        loaded.relativeDirPath,
        loaded.dirName,
        SKILL_FILE_NAME
      );
      throw new Error(
        `Frontmatter name (${result.data.name}) must match directory name (${loaded.dirName}) in ${skillFilePath}`
      );
    }
    return new _KiloSkill({
      baseDir: loaded.baseDir,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false
  }) {
    return new _KiloSkill({
      baseDir,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global
    });
  }
};

// src/features/skills/kiro-skill.ts
var import_node_path66 = require("path");
var import_mini29 = require("zod/mini");
var KiroSkillFrontmatterSchema = import_mini29.z.looseObject({
  name: import_mini29.z.string(),
  description: import_mini29.z.string()
});
var KiroSkill = class _KiroSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = (0, import_node_path66.join)(".kiro", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths(options) {
    if (options?.global) {
      throw new Error("KiroSkill does not support global mode.");
    }
    return {
      relativeDirPath: (0, import_node_path66.join)(".kiro", "skills")
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = KiroSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    if (!this.mainFile) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`)
      };
    }
    const result = KiroSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    if (result.data.name !== this.getDirName()) {
      return {
        success: false,
        error: new Error(
          `${this.getDirPath()}: frontmatter name (${result.data.name}) must match directory name (${this.getDirName()})`
        )
      };
    }
    return { success: true, error: null };
  }
  toRulesyncSkill() {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"]
    };
    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global
    });
  }
  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false
  }) {
    const settablePaths = _KiroSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const kiroFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description
    };
    return new _KiroSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: kiroFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global
    });
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("kiro");
  }
  static async fromDir(params) {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: _KiroSkill.getSettablePaths
    });
    const result = KiroSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = (0, import_node_path66.join)(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path66.join)(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`
      );
    }
    if (result.data.name !== loaded.dirName) {
      const skillFilePath = (0, import_node_path66.join)(
        loaded.baseDir,
        loaded.relativeDirPath,
        loaded.dirName,
        SKILL_FILE_NAME
      );
      throw new Error(
        `Frontmatter name (${result.data.name}) must match directory name (${loaded.dirName}) in ${skillFilePath}`
      );
    }
    return new _KiroSkill({
      baseDir: loaded.baseDir,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false
  }) {
    const settablePaths = _KiroSkill.getSettablePaths({ global });
    return new _KiroSkill({
      baseDir,
      relativeDirPath: relativeDirPath ?? settablePaths.relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global
    });
  }
};

// src/features/skills/opencode-skill.ts
var import_node_path67 = require("path");
var import_mini30 = require("zod/mini");
var OpenCodeSkillFrontmatterSchema = import_mini30.z.looseObject({
  name: import_mini30.z.string(),
  description: import_mini30.z.string(),
  "allowed-tools": import_mini30.z.optional(import_mini30.z.array(import_mini30.z.string()))
});
var OpenCodeSkill = class _OpenCodeSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = (0, import_node_path67.join)(".opencode", "skill"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths({ global = false } = {}) {
    return {
      relativeDirPath: global ? (0, import_node_path67.join)(".config", "opencode", "skill") : (0, import_node_path67.join)(".opencode", "skill")
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = OpenCodeSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    if (this.mainFile === void 0) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`)
      };
    }
    const result = OpenCodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    return { success: true, error: null };
  }
  toRulesyncSkill() {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...frontmatter["allowed-tools"] && {
        opencode: {
          "allowed-tools": frontmatter["allowed-tools"]
        }
      }
    };
    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global
    });
  }
  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false
  }) {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const opencodeFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      "allowed-tools": rulesyncFrontmatter.opencode?.["allowed-tools"]
    };
    const settablePaths = _OpenCodeSkill.getSettablePaths({ global });
    return new _OpenCodeSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: opencodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global
    });
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("opencode");
  }
  static async fromDir(params) {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: _OpenCodeSkill.getSettablePaths
    });
    const result = OpenCodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = (0, import_node_path67.join)(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path67.join)(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`
      );
    }
    return new _OpenCodeSkill({
      baseDir: loaded.baseDir,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false
  }) {
    return new _OpenCodeSkill({
      baseDir,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global
    });
  }
};

// src/features/skills/replit-skill.ts
var import_node_path68 = require("path");
var import_mini31 = require("zod/mini");
var ReplitSkillFrontmatterSchema = import_mini31.z.looseObject({
  name: import_mini31.z.string(),
  description: import_mini31.z.string()
});
var ReplitSkill = class _ReplitSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = (0, import_node_path68.join)(".agents", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths(options) {
    if (options?.global) {
      throw new Error("ReplitSkill does not support global mode.");
    }
    return {
      relativeDirPath: (0, import_node_path68.join)(".agents", "skills")
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = ReplitSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    if (!this.mainFile) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`)
      };
    }
    const result = ReplitSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    return { success: true, error: null };
  }
  toRulesyncSkill() {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"]
    };
    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global
    });
  }
  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false
  }) {
    const settablePaths = _ReplitSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const replitFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description
    };
    return new _ReplitSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: replitFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global
    });
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("replit");
  }
  static async fromDir(params) {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: _ReplitSkill.getSettablePaths
    });
    const result = ReplitSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = (0, import_node_path68.join)(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path68.join)(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`
      );
    }
    return new _ReplitSkill({
      baseDir: loaded.baseDir,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false
  }) {
    const settablePaths = _ReplitSkill.getSettablePaths({ global });
    return new _ReplitSkill({
      baseDir,
      relativeDirPath: relativeDirPath ?? settablePaths.relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global
    });
  }
};

// src/features/skills/roo-skill.ts
var import_node_path69 = require("path");
var import_mini32 = require("zod/mini");
var RooSkillFrontmatterSchema = import_mini32.z.looseObject({
  name: import_mini32.z.string(),
  description: import_mini32.z.string()
});
var RooSkill = class _RooSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = (0, import_node_path69.join)(".roo", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false
  }) {
    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter }
      },
      otherFiles,
      global
    });
    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }
  static getSettablePaths({
    global: _global = false
  } = {}) {
    return {
      relativeDirPath: (0, import_node_path69.join)(".roo", "skills")
    };
  }
  getFrontmatter() {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = RooSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }
  getBody() {
    return this.mainFile?.body ?? "";
  }
  validate() {
    if (!this.mainFile) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`)
      };
    }
    const result = RooSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`
        )
      };
    }
    if (result.data.name !== this.getDirName()) {
      return {
        success: false,
        error: new Error(
          `${this.getDirPath()}: frontmatter name (${result.data.name}) must match directory name (${this.getDirName()})`
        )
      };
    }
    return { success: true, error: null };
  }
  toRulesyncSkill() {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"]
    };
    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global
    });
  }
  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false
  }) {
    const settablePaths = _RooSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const rooFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description
    };
    return new _RooSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rooFrontmatter.name,
      frontmatter: rooFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global
    });
  }
  static isTargetedByRulesyncSkill(rulesyncSkill) {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("roo");
  }
  static async fromDir(params) {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: _RooSkill.getSettablePaths
    });
    const result = RooSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = (0, import_node_path69.join)(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path69.join)(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`
      );
    }
    if (result.data.name !== loaded.dirName) {
      const skillFilePath = (0, import_node_path69.join)(
        loaded.baseDir,
        loaded.relativeDirPath,
        loaded.dirName,
        SKILL_FILE_NAME
      );
      throw new Error(
        `Frontmatter name (${result.data.name}) must match directory name (${loaded.dirName}) in ${skillFilePath}`
      );
    }
    return new _RooSkill({
      baseDir: loaded.baseDir,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false
  }) {
    return new _RooSkill({
      baseDir,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global
    });
  }
};

// src/features/skills/skills-utils.ts
var import_node_path70 = require("path");
async function getLocalSkillDirNames(baseDir) {
  const skillsDir = (0, import_node_path70.join)(baseDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH);
  const names = /* @__PURE__ */ new Set();
  if (!await directoryExists(skillsDir)) {
    return names;
  }
  const dirPaths = await findFilesByGlobs((0, import_node_path70.join)(skillsDir, "*"), { type: "dir" });
  for (const dirPath of dirPaths) {
    const name = (0, import_node_path70.basename)(dirPath);
    if (name === (0, import_node_path70.basename)(RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH)) continue;
    names.add(name);
  }
  return names;
}

// src/features/skills/skills-processor.ts
var skillsProcessorToolTargetTuple = [
  "agentsmd",
  "agentsskills",
  "antigravity",
  "claudecode",
  "claudecode-legacy",
  "codexcli",
  "copilot",
  "cursor",
  "factorydroid",
  "geminicli",
  "kilo",
  "kiro",
  "opencode",
  "replit",
  "roo"
];
var SkillsProcessorToolTargetSchema = import_mini33.z.enum(skillsProcessorToolTargetTuple);
var toolSkillFactories = /* @__PURE__ */ new Map([
  [
    "agentsmd",
    {
      class: AgentsmdSkill,
      meta: { supportsProject: true, supportsSimulated: true, supportsGlobal: false }
    }
  ],
  [
    "agentsskills",
    {
      class: AgentsSkillsSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false }
    }
  ],
  [
    "antigravity",
    {
      class: AntigravitySkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true }
    }
  ],
  [
    "claudecode",
    {
      class: ClaudecodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true }
    }
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true }
    }
  ],
  [
    "codexcli",
    {
      class: CodexCliSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true }
    }
  ],
  [
    "copilot",
    {
      class: CopilotSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false }
    }
  ],
  [
    "cursor",
    {
      class: CursorSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true }
    }
  ],
  [
    "factorydroid",
    {
      class: FactorydroidSkill,
      meta: { supportsProject: true, supportsSimulated: true, supportsGlobal: true }
    }
  ],
  [
    "geminicli",
    {
      class: GeminiCliSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true }
    }
  ],
  [
    "kilo",
    {
      class: KiloSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true }
    }
  ],
  [
    "kiro",
    {
      class: KiroSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false }
    }
  ],
  [
    "opencode",
    {
      class: OpenCodeSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true }
    }
  ],
  [
    "replit",
    {
      class: ReplitSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: false }
    }
  ],
  [
    "roo",
    {
      class: RooSkill,
      meta: { supportsProject: true, supportsSimulated: false, supportsGlobal: true }
    }
  ]
]);
var defaultGetFactory4 = (target) => {
  const factory = toolSkillFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};
var allToolTargetKeys3 = [...toolSkillFactories.keys()];
var skillsProcessorToolTargetsProject = allToolTargetKeys3.filter((target) => {
  const factory = toolSkillFactories.get(target);
  return factory?.meta.supportsProject ?? true;
});
var skillsProcessorToolTargetsSimulated = allToolTargetKeys3.filter(
  (target) => {
    const factory = toolSkillFactories.get(target);
    return factory?.meta.supportsSimulated ?? false;
  }
);
var skillsProcessorToolTargetsGlobal = allToolTargetKeys3.filter((target) => {
  const factory = toolSkillFactories.get(target);
  return factory?.meta.supportsGlobal ?? false;
});
var SkillsProcessor = class extends DirFeatureProcessor {
  toolTarget;
  global;
  getFactory;
  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
    getFactory = defaultGetFactory4,
    dryRun = false
  }) {
    super({ baseDir, dryRun });
    const result = SkillsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for SkillsProcessor: ${toolTarget}. ${formatError(result.error)}`
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.getFactory = getFactory;
  }
  async convertRulesyncDirsToToolDirs(rulesyncDirs) {
    const rulesyncSkills = rulesyncDirs.filter(
      (dir) => dir instanceof RulesyncSkill
    );
    const factory = this.getFactory(this.toolTarget);
    const toolSkills = rulesyncSkills.map((rulesyncSkill) => {
      if (!factory.class.isTargetedByRulesyncSkill(rulesyncSkill)) {
        return null;
      }
      return factory.class.fromRulesyncSkill({
        rulesyncSkill,
        global: this.global
      });
    }).filter((skill) => skill !== null);
    return toolSkills;
  }
  async convertToolDirsToRulesyncDirs(toolDirs) {
    const toolSkills = toolDirs.filter((dir) => dir instanceof ToolSkill);
    const rulesyncSkills = [];
    for (const toolSkill of toolSkills) {
      if (toolSkill instanceof SimulatedSkill) {
        logger.debug(`Skipping simulated skill conversion: ${toolSkill.getDirPath()}`);
        continue;
      }
      rulesyncSkills.push(toolSkill.toRulesyncSkill());
    }
    return rulesyncSkills;
  }
  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Load and parse rulesync skill directories from .rulesync/skills/ directory
   * and also from .rulesync/skills/.curated/ for remote skills.
   * Local skills take precedence over curated skills with the same name.
   */
  async loadRulesyncDirs() {
    const localDirNames = [...await getLocalSkillDirNames(this.baseDir)];
    const localSkills = await Promise.all(
      localDirNames.map(
        (dirName) => RulesyncSkill.fromDir({ baseDir: this.baseDir, dirName, global: this.global })
      )
    );
    const localSkillNames = new Set(localDirNames);
    const curatedDirPath = (0, import_node_path71.join)(this.baseDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
    let curatedSkills = [];
    if (await directoryExists(curatedDirPath)) {
      const curatedDirPaths = await findFilesByGlobs((0, import_node_path71.join)(curatedDirPath, "*"), { type: "dir" });
      const curatedDirNames = curatedDirPaths.map((path4) => (0, import_node_path71.basename)(path4));
      const nonConflicting = curatedDirNames.filter((name) => {
        if (localSkillNames.has(name)) {
          logger.debug(`Skipping curated skill "${name}": local skill takes precedence.`);
          return false;
        }
        return true;
      });
      const curatedRelativeDirPath = RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH;
      curatedSkills = await Promise.all(
        nonConflicting.map(
          (dirName) => RulesyncSkill.fromDir({
            baseDir: this.baseDir,
            relativeDirPath: curatedRelativeDirPath,
            dirName,
            global: this.global
          })
        )
      );
    }
    const allSkills = [...localSkills, ...curatedSkills];
    logger.debug(
      `Successfully loaded ${allSkills.length} rulesync skills (${localSkills.length} local, ${curatedSkills.length} curated)`
    );
    return allSkills;
  }
  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Load tool-specific skill configurations and parse them into ToolSkill instances
   */
  async loadToolDirs() {
    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });
    const skillsDirPath = (0, import_node_path71.join)(this.baseDir, paths.relativeDirPath);
    const dirPaths = await findFilesByGlobs((0, import_node_path71.join)(skillsDirPath, "*"), { type: "dir" });
    const dirNames = dirPaths.map((path4) => (0, import_node_path71.basename)(path4));
    const toolSkills = await Promise.all(
      dirNames.map(
        (dirName) => factory.class.fromDir({
          baseDir: this.baseDir,
          dirName,
          global: this.global
        })
      )
    );
    logger.debug(`Successfully loaded ${toolSkills.length} ${paths.relativeDirPath} skills`);
    return toolSkills;
  }
  async loadToolDirsToDelete() {
    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });
    const skillsDirPath = (0, import_node_path71.join)(this.baseDir, paths.relativeDirPath);
    const dirPaths = await findFilesByGlobs((0, import_node_path71.join)(skillsDirPath, "*"), { type: "dir" });
    const dirNames = dirPaths.map((path4) => (0, import_node_path71.basename)(path4));
    const toolSkills = dirNames.map(
      (dirName) => factory.class.forDeletion({
        baseDir: this.baseDir,
        relativeDirPath: paths.relativeDirPath,
        dirName,
        global: this.global
      })
    );
    logger.debug(
      `Successfully loaded ${toolSkills.length} ${paths.relativeDirPath} skills for deletion`
    );
    return toolSkills;
  }
  /**
   * Implementation of abstract method from DirFeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({
    global = false,
    includeSimulated = false
  } = {}) {
    if (global) {
      return skillsProcessorToolTargetsGlobal;
    }
    const projectTargets = skillsProcessorToolTargetsProject;
    if (!includeSimulated) {
      return projectTargets.filter(
        (target) => !skillsProcessorToolTargetsSimulated.includes(target)
      );
    }
    return projectTargets;
  }
  /**
   * Return the simulated tool targets
   */
  static getToolTargetsSimulated() {
    return skillsProcessorToolTargetsSimulated;
  }
  /**
   * Return the tool targets that this processor supports in global mode
   */
  static getToolTargetsGlobal() {
    return skillsProcessorToolTargetsGlobal;
  }
  /**
   * Get the factory for a specific tool target.
   * This is a static version of the internal getFactory for external use.
   * @param target - The tool target. Must be a valid SkillsProcessorToolTarget.
   * @returns The factory for the target, or undefined if not found.
   */
  static getFactory(target) {
    const result = SkillsProcessorToolTargetSchema.safeParse(target);
    if (!result.success) {
      return void 0;
    }
    return toolSkillFactories.get(result.data);
  }
};

// src/features/subagents/agentsmd-subagent.ts
var import_node_path73 = require("path");

// src/features/subagents/simulated-subagent.ts
var import_node_path72 = require("path");
var import_mini34 = require("zod/mini");

// src/features/subagents/tool-subagent.ts
var ToolSubagent = class extends ToolFile {
  static getSettablePaths() {
    throw new Error("Please implement this method in the subclass.");
  }
  static async fromFile(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse file content, making it safe to use
   * even when files have old/incompatible formats.
   */
  static forDeletion(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  static fromRulesyncSubagent(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  static isTargetedByRulesyncSubagent(_rulesyncSubagent) {
    throw new Error("Please implement this method in the subclass.");
  }
  static isTargetedByRulesyncSubagentDefault({
    rulesyncSubagent,
    toolTarget
  }) {
    const targets = rulesyncSubagent.getFrontmatter().targets;
    if (!targets) {
      return true;
    }
    if (targets.includes("*")) {
      return true;
    }
    if (targets.includes(toolTarget)) {
      return true;
    }
    return false;
  }
};

// src/features/subagents/simulated-subagent.ts
var SimulatedSubagentFrontmatterSchema = import_mini34.z.object({
  name: import_mini34.z.string(),
  description: import_mini34.z.string()
});
var SimulatedSubagent = class extends ToolSubagent {
  frontmatter;
  body;
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate) {
      const result = SimulatedSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path72.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter)
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  getBody() {
    return this.body;
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  toRulesyncSubagent() {
    throw new Error("Not implemented because it is a SIMULATED file.");
  }
  static fromRulesyncSubagentDefault({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true
  }) {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const simulatedFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description
    };
    const body = rulesyncSubagent.getBody();
    return {
      baseDir,
      frontmatter: simulatedFrontmatter,
      body,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      validate
    };
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = SimulatedSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path72.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  static async fromFileDefault({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const filePath = (0, import_node_path72.join)(baseDir, this.getSettablePaths().relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = SimulatedSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return {
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: (0, import_node_path72.basename)(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate
    };
  }
  static forDeletionDefault({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return {
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      validate: false
    };
  }
};

// src/features/subagents/agentsmd-subagent.ts
var AgentsmdSubagent = class _AgentsmdSubagent extends SimulatedSubagent {
  static getSettablePaths() {
    return {
      relativeDirPath: (0, import_node_path73.join)(".agents", "subagents")
    };
  }
  static async fromFile(params) {
    const baseParams = await this.fromFileDefault(params);
    return new _AgentsmdSubagent(baseParams);
  }
  static fromRulesyncSubagent(params) {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new _AgentsmdSubagent(baseParams);
  }
  static isTargetedByRulesyncSubagent(rulesyncSubagent) {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "agentsmd"
    });
  }
  static forDeletion(params) {
    return new _AgentsmdSubagent(this.forDeletionDefault(params));
  }
};

// src/features/subagents/codexcli-subagent.ts
var import_node_path74 = require("path");
var CodexCliSubagent = class _CodexCliSubagent extends SimulatedSubagent {
  static getSettablePaths() {
    return {
      relativeDirPath: (0, import_node_path74.join)(".codex", "subagents")
    };
  }
  static async fromFile(params) {
    const baseParams = await this.fromFileDefault(params);
    return new _CodexCliSubagent(baseParams);
  }
  static fromRulesyncSubagent(params) {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new _CodexCliSubagent(baseParams);
  }
  static isTargetedByRulesyncSubagent(rulesyncSubagent) {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "codexcli"
    });
  }
  static forDeletion(params) {
    return new _CodexCliSubagent(this.forDeletionDefault(params));
  }
};

// src/features/subagents/factorydroid-subagent.ts
var import_node_path75 = require("path");
var FactorydroidSubagent = class _FactorydroidSubagent extends SimulatedSubagent {
  static getSettablePaths(_options) {
    return {
      relativeDirPath: (0, import_node_path75.join)(".factory", "droids")
    };
  }
  static async fromFile(params) {
    const baseParams = await this.fromFileDefault(params);
    return new _FactorydroidSubagent(baseParams);
  }
  static fromRulesyncSubagent(params) {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new _FactorydroidSubagent(baseParams);
  }
  static isTargetedByRulesyncSubagent(rulesyncSubagent) {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "factorydroid"
    });
  }
  static forDeletion(params) {
    return new _FactorydroidSubagent(this.forDeletionDefault(params));
  }
};

// src/features/subagents/geminicli-subagent.ts
var import_node_path76 = require("path");
var GeminiCliSubagent = class _GeminiCliSubagent extends SimulatedSubagent {
  static getSettablePaths() {
    return {
      relativeDirPath: (0, import_node_path76.join)(".gemini", "subagents")
    };
  }
  static async fromFile(params) {
    const baseParams = await this.fromFileDefault(params);
    return new _GeminiCliSubagent(baseParams);
  }
  static fromRulesyncSubagent(params) {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new _GeminiCliSubagent(baseParams);
  }
  static isTargetedByRulesyncSubagent(rulesyncSubagent) {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "geminicli"
    });
  }
  static forDeletion(params) {
    return new _GeminiCliSubagent(this.forDeletionDefault(params));
  }
};

// src/features/subagents/roo-subagent.ts
var import_node_path77 = require("path");
var RooSubagent = class _RooSubagent extends SimulatedSubagent {
  static getSettablePaths() {
    return {
      relativeDirPath: (0, import_node_path77.join)(".roo", "subagents")
    };
  }
  static async fromFile(params) {
    const baseParams = await this.fromFileDefault(params);
    return new _RooSubagent(baseParams);
  }
  static fromRulesyncSubagent(params) {
    const baseParams = this.fromRulesyncSubagentDefault(params);
    return new _RooSubagent(baseParams);
  }
  static isTargetedByRulesyncSubagent(rulesyncSubagent) {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "roo"
    });
  }
  static forDeletion(params) {
    return new _RooSubagent(this.forDeletionDefault(params));
  }
};

// src/features/subagents/subagents-processor.ts
var import_node_path84 = require("path");
var import_mini41 = require("zod/mini");

// src/features/subagents/claudecode-subagent.ts
var import_node_path79 = require("path");
var import_mini36 = require("zod/mini");

// src/features/subagents/rulesync-subagent.ts
var import_node_path78 = require("path");
var import_mini35 = require("zod/mini");
var RulesyncSubagentFrontmatterSchema = import_mini35.z.looseObject({
  targets: import_mini35.z._default(RulesyncTargetsSchema, ["*"]),
  name: import_mini35.z.string(),
  description: import_mini35.z.string()
});
var RulesyncSubagent = class _RulesyncSubagent extends RulesyncFile {
  frontmatter;
  body;
  constructor({ frontmatter, body, ...rest }) {
    const parseResult = RulesyncSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!parseResult.success && rest.validate !== false) {
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path78.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(parseResult.error)}`
      );
    }
    const parsedFrontmatter = parseResult.success ? { ...frontmatter, ...parseResult.data } : { ...frontmatter, targets: frontmatter?.targets ?? ["*"] };
    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, parsedFrontmatter)
    });
    this.frontmatter = parsedFrontmatter;
    this.body = body;
  }
  static getSettablePaths() {
    return {
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH
    };
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  getBody() {
    return this.body;
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = RulesyncSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path78.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  static async fromFile({
    relativeFilePath
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path78.join)(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, relativeFilePath)
    );
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = RulesyncSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${relativeFilePath}: ${formatError(result.error)}`);
    }
    const filename = (0, import_node_path78.basename)(relativeFilePath);
    return new _RulesyncSubagent({
      baseDir: process.cwd(),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: filename,
      frontmatter: result.data,
      body: content.trim()
    });
  }
};

// src/features/subagents/claudecode-subagent.ts
var ClaudecodeSubagentFrontmatterSchema = import_mini36.z.looseObject({
  name: import_mini36.z.string(),
  description: import_mini36.z.string(),
  model: import_mini36.z.optional(import_mini36.z.string()),
  tools: import_mini36.z.optional(import_mini36.z.union([import_mini36.z.string(), import_mini36.z.array(import_mini36.z.string())])),
  permissionMode: import_mini36.z.optional(import_mini36.z.string()),
  skills: import_mini36.z.optional(import_mini36.z.union([import_mini36.z.string(), import_mini36.z.array(import_mini36.z.string())]))
});
var ClaudecodeSubagent = class _ClaudecodeSubagent extends ToolSubagent {
  frontmatter;
  body;
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate !== false) {
      const result = ClaudecodeSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path79.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  static getSettablePaths(_options = {}) {
    return {
      relativeDirPath: (0, import_node_path79.join)(".claude", "agents")
    };
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  getBody() {
    return this.body;
  }
  toRulesyncSubagent() {
    const { name, description, model, ...restFields } = this.frontmatter;
    const claudecodeSection = {
      ...model && { model },
      ...restFields
    };
    const rulesyncFrontmatter = {
      targets: ["*"],
      name,
      description,
      // Only include claudecode section if there are fields
      ...Object.keys(claudecodeSection).length > 0 && { claudecode: claudecodeSection }
    };
    return new RulesyncSubagent({
      baseDir: ".",
      // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true
    });
  }
  static fromRulesyncSubagent({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false
  }) {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const claudecodeSection = rulesyncFrontmatter.claudecode ?? {};
    const rawClaudecodeFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...claudecodeSection
    };
    const result = ClaudecodeSubagentFrontmatterSchema.safeParse(rawClaudecodeFrontmatter);
    if (!result.success) {
      throw new Error(`Invalid claudecode subagent frontmatter: ${formatError(result.error)}`);
    }
    const claudecodeFrontmatter = result.data;
    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, claudecodeFrontmatter);
    const paths = this.getSettablePaths({ global });
    return new _ClaudecodeSubagent({
      baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate
    });
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = ClaudecodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path79.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  static isTargetedByRulesyncSubagent(rulesyncSubagent) {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "claudecode"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const filePath = (0, import_node_path79.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = ClaudecodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return new _ClaudecodeSubagent({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _ClaudecodeSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false
    });
  }
};

// src/features/subagents/copilot-subagent.ts
var import_node_path80 = require("path");
var import_mini37 = require("zod/mini");
var REQUIRED_TOOL = "agent/runSubagent";
var CopilotSubagentFrontmatterSchema = import_mini37.z.looseObject({
  name: import_mini37.z.string(),
  description: import_mini37.z.string(),
  tools: import_mini37.z.optional(import_mini37.z.union([import_mini37.z.string(), import_mini37.z.array(import_mini37.z.string())]))
});
var normalizeTools = (tools) => {
  if (!tools) {
    return [];
  }
  return Array.isArray(tools) ? tools : [tools];
};
var ensureRequiredTool = (tools) => {
  const mergedTools = /* @__PURE__ */ new Set([REQUIRED_TOOL, ...tools]);
  return Array.from(mergedTools);
};
var CopilotSubagent = class _CopilotSubagent extends ToolSubagent {
  frontmatter;
  body;
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate !== false) {
      const result = CopilotSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path80.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  static getSettablePaths(_options = {}) {
    return {
      relativeDirPath: (0, import_node_path80.join)(".github", "agents")
    };
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  getBody() {
    return this.body;
  }
  toRulesyncSubagent() {
    const { name, description, tools, ...rest } = this.frontmatter;
    const rulesyncFrontmatter = {
      targets: ["*"],
      name,
      description,
      copilot: {
        ...tools && { tools },
        ...rest
      }
    };
    return new RulesyncSubagent({
      baseDir: ".",
      // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true
    });
  }
  static fromRulesyncSubagent({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false
  }) {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const copilotSection = rulesyncFrontmatter.copilot ?? {};
    const toolsField = copilotSection.tools;
    const userTools = normalizeTools(
      Array.isArray(toolsField) || typeof toolsField === "string" ? toolsField : void 0
    );
    const mergedTools = ensureRequiredTool(userTools);
    const copilotFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...copilotSection,
      ...mergedTools.length > 0 && { tools: mergedTools }
    };
    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, copilotFrontmatter);
    const paths = this.getSettablePaths({ global });
    return new _CopilotSubagent({
      baseDir,
      frontmatter: copilotFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
      global
    });
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = CopilotSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path80.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  static isTargetedByRulesyncSubagent(rulesyncSubagent) {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "copilot"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const filePath = (0, import_node_path80.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = CopilotSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return new _CopilotSubagent({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
      global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _CopilotSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false
    });
  }
};

// src/features/subagents/cursor-subagent.ts
var import_node_path81 = require("path");
var import_mini38 = require("zod/mini");
var CursorSubagentFrontmatterSchema = import_mini38.z.looseObject({
  name: import_mini38.z.string(),
  description: import_mini38.z.string()
});
var CursorSubagent = class _CursorSubagent extends ToolSubagent {
  frontmatter;
  body;
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate !== false) {
      const result = CursorSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path81.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  static getSettablePaths(_options = {}) {
    return {
      relativeDirPath: (0, import_node_path81.join)(".cursor", "agents")
    };
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  getBody() {
    return this.body;
  }
  toRulesyncSubagent() {
    const { name, description, ...rest } = this.frontmatter;
    const rulesyncFrontmatter = {
      targets: ["*"],
      name,
      description,
      cursor: {
        ...rest
      }
    };
    return new RulesyncSubagent({
      baseDir: ".",
      // RulesyncSubagent baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true
    });
  }
  static fromRulesyncSubagent({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false
  }) {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const cursorSection = rulesyncFrontmatter.cursor ?? {};
    const cursorFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...cursorSection
    };
    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, cursorFrontmatter);
    const paths = this.getSettablePaths({ global });
    return new _CursorSubagent({
      baseDir,
      frontmatter: cursorFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
      global
    });
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = CursorSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path81.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  static isTargetedByRulesyncSubagent(rulesyncSubagent) {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "cursor"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const filePath = (0, import_node_path81.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = CursorSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return new _CursorSubagent({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
      global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _CursorSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false
    });
  }
};

// src/features/subagents/kiro-subagent.ts
var import_node_path82 = require("path");
var import_mini39 = require("zod/mini");
var KiroCliSubagentJsonSchema = import_mini39.z.looseObject({
  name: import_mini39.z.string(),
  description: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.string())),
  prompt: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.string())),
  tools: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.array(import_mini39.z.string()))),
  toolAliases: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.record(import_mini39.z.string(), import_mini39.z.string()))),
  toolSettings: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.unknown())),
  toolSchema: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.unknown())),
  hooks: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.record(import_mini39.z.string(), import_mini39.z.array(import_mini39.z.unknown())))),
  model: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.string())),
  mcpServers: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.record(import_mini39.z.string(), import_mini39.z.unknown()))),
  useLegacyMcpJson: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.boolean())),
  resources: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.array(import_mini39.z.string()))),
  allowedTools: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.array(import_mini39.z.string()))),
  includeMcpJson: import_mini39.z.optional(import_mini39.z.nullable(import_mini39.z.boolean()))
});
var KiroSubagent = class _KiroSubagent extends ToolSubagent {
  body;
  constructor({ body, ...rest }) {
    super({
      ...rest
    });
    this.body = body;
  }
  static getSettablePaths(_options = {}) {
    return {
      relativeDirPath: (0, import_node_path82.join)(".kiro", "agents")
    };
  }
  getBody() {
    return this.body;
  }
  toRulesyncSubagent() {
    const parsed = JSON.parse(this.body);
    const { name, description, prompt, ...restFields } = parsed;
    const kiroSection = {
      ...restFields
    };
    const rulesyncFrontmatter = {
      targets: ["kiro"],
      name,
      description: description ?? "",
      // Only include kiro section if there are fields
      ...Object.keys(kiroSection).length > 0 && { kiro: kiroSection }
    };
    return new RulesyncSubagent({
      baseDir: ".",
      frontmatter: rulesyncFrontmatter,
      body: prompt ?? "",
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath().replace(/\.json$/, ".md"),
      validate: true
    });
  }
  static fromRulesyncSubagent({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false
  }) {
    const frontmatter = rulesyncSubagent.getFrontmatter();
    const kiroSection = frontmatter.kiro ?? {};
    const json = {
      name: frontmatter.name,
      description: frontmatter.description || null,
      prompt: rulesyncSubagent.getBody() || null,
      ...kiroSection
    };
    const body = JSON.stringify(json, null, 2);
    const paths = this.getSettablePaths({ global });
    const relativeFilePath = rulesyncSubagent.getRelativeFilePath().replace(/\.md$/, ".json");
    return new _KiroSubagent({
      baseDir,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent: body,
      validate,
      global
    });
  }
  validate() {
    try {
      const parsed = JSON.parse(this.body);
      KiroCliSubagentJsonSchema.parse(parsed);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }
  static isTargetedByRulesyncSubagent(rulesyncSubagent) {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "kiro"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const filePath = (0, import_node_path82.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    return new _KiroSubagent({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      body: fileContent.trim(),
      fileContent,
      validate,
      global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _KiroSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      body: "",
      fileContent: "",
      validate: false
    });
  }
};

// src/features/subagents/opencode-subagent.ts
var import_node_path83 = require("path");
var import_mini40 = require("zod/mini");
var OpenCodeSubagentFrontmatterSchema = import_mini40.z.looseObject({
  description: import_mini40.z.string(),
  mode: import_mini40.z.literal("subagent"),
  name: import_mini40.z.optional(import_mini40.z.string())
});
var OpenCodeSubagent = class _OpenCodeSubagent extends ToolSubagent {
  frontmatter;
  body;
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate !== false) {
      const result = OpenCodeSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path83.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  static getSettablePaths({
    global = false
  } = {}) {
    return {
      relativeDirPath: global ? (0, import_node_path83.join)(".config", "opencode", "agent") : (0, import_node_path83.join)(".opencode", "agent")
    };
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  getBody() {
    return this.body;
  }
  toRulesyncSubagent() {
    const { description, mode, name, ...opencodeSection } = this.frontmatter;
    const rulesyncFrontmatter = {
      targets: ["*"],
      name: name ?? (0, import_node_path83.basename)(this.getRelativeFilePath(), ".md"),
      description,
      opencode: { mode, ...opencodeSection }
    };
    return new RulesyncSubagent({
      baseDir: ".",
      // RulesyncSubagent baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true
    });
  }
  static fromRulesyncSubagent({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false
  }) {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const opencodeSection = rulesyncFrontmatter.opencode ?? {};
    const opencodeFrontmatter = {
      ...opencodeSection,
      description: rulesyncFrontmatter.description,
      mode: "subagent",
      ...rulesyncFrontmatter.name && { name: rulesyncFrontmatter.name }
    };
    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, opencodeFrontmatter);
    const paths = this.getSettablePaths({ global });
    return new _OpenCodeSubagent({
      baseDir,
      frontmatter: opencodeFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
      global
    });
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = OpenCodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    }
    return {
      success: false,
      error: new Error(
        `Invalid frontmatter in ${(0, import_node_path83.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
      )
    };
  }
  static isTargetedByRulesyncSubagent(rulesyncSubagent) {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "opencode"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const filePath = (0, import_node_path83.join)(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = OpenCodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    return new _OpenCodeSubagent({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
      global
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _OpenCodeSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "", mode: "subagent" },
      body: "",
      fileContent: "",
      validate: false
    });
  }
};

// src/features/subagents/subagents-processor.ts
var subagentsProcessorToolTargetTuple = [
  "agentsmd",
  "claudecode",
  "claudecode-legacy",
  "codexcli",
  "copilot",
  "cursor",
  "factorydroid",
  "geminicli",
  "kiro",
  "opencode",
  "roo"
];
var SubagentsProcessorToolTargetSchema = import_mini41.z.enum(subagentsProcessorToolTargetTuple);
var toolSubagentFactories = /* @__PURE__ */ new Map([
  [
    "agentsmd",
    {
      class: AgentsmdSubagent,
      meta: { supportsSimulated: true, supportsGlobal: false, filePattern: "*.md" }
    }
  ],
  [
    "claudecode",
    {
      class: ClaudecodeSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" }
    }
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" }
    }
  ],
  [
    "codexcli",
    {
      class: CodexCliSubagent,
      meta: { supportsSimulated: true, supportsGlobal: false, filePattern: "*.md" }
    }
  ],
  [
    "copilot",
    {
      class: CopilotSubagent,
      meta: { supportsSimulated: false, supportsGlobal: false, filePattern: "*.md" }
    }
  ],
  [
    "cursor",
    {
      class: CursorSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" }
    }
  ],
  [
    "factorydroid",
    {
      class: FactorydroidSubagent,
      meta: { supportsSimulated: true, supportsGlobal: true, filePattern: "*.md" }
    }
  ],
  [
    "geminicli",
    {
      class: GeminiCliSubagent,
      meta: { supportsSimulated: true, supportsGlobal: false, filePattern: "*.md" }
    }
  ],
  [
    "kiro",
    {
      class: KiroSubagent,
      meta: { supportsSimulated: false, supportsGlobal: false, filePattern: "*.json" }
    }
  ],
  [
    "opencode",
    {
      class: OpenCodeSubagent,
      meta: { supportsSimulated: false, supportsGlobal: true, filePattern: "*.md" }
    }
  ],
  [
    "roo",
    {
      class: RooSubagent,
      meta: { supportsSimulated: true, supportsGlobal: false, filePattern: "*.md" }
    }
  ]
]);
var defaultGetFactory5 = (target) => {
  const factory = toolSubagentFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};
var allToolTargetKeys4 = [...toolSubagentFactories.keys()];
var subagentsProcessorToolTargets = allToolTargetKeys4;
var subagentsProcessorToolTargetsSimulated = allToolTargetKeys4.filter(
  (target) => {
    const factory = toolSubagentFactories.get(target);
    return factory?.meta.supportsSimulated ?? false;
  }
);
var subagentsProcessorToolTargetsGlobal = allToolTargetKeys4.filter(
  (target) => {
    const factory = toolSubagentFactories.get(target);
    return factory?.meta.supportsGlobal ?? false;
  }
);
var SubagentsProcessor = class extends FeatureProcessor {
  toolTarget;
  global;
  getFactory;
  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
    getFactory = defaultGetFactory5,
    dryRun = false
  }) {
    super({ baseDir, dryRun });
    const result = SubagentsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for SubagentsProcessor: ${toolTarget}. ${formatError(result.error)}`
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.getFactory = getFactory;
  }
  async convertRulesyncFilesToToolFiles(rulesyncFiles) {
    const rulesyncSubagents = rulesyncFiles.filter(
      (file) => file instanceof RulesyncSubagent
    );
    const factory = this.getFactory(this.toolTarget);
    const toolSubagents = rulesyncSubagents.map((rulesyncSubagent) => {
      if (!factory.class.isTargetedByRulesyncSubagent(rulesyncSubagent)) {
        return null;
      }
      return factory.class.fromRulesyncSubagent({
        baseDir: this.baseDir,
        relativeDirPath: RulesyncSubagent.getSettablePaths().relativeDirPath,
        rulesyncSubagent,
        global: this.global
      });
    }).filter((subagent) => subagent !== null);
    return toolSubagents;
  }
  async convertToolFilesToRulesyncFiles(toolFiles) {
    const toolSubagents = toolFiles.filter(
      (file) => file instanceof ToolSubagent
    );
    const rulesyncSubagents = [];
    for (const toolSubagent of toolSubagents) {
      if (toolSubagent instanceof SimulatedSubagent) {
        logger.debug(
          `Skipping simulated subagent conversion: ${toolSubagent.getRelativeFilePath()}`
        );
        continue;
      }
      rulesyncSubagents.push(toolSubagent.toRulesyncSubagent());
    }
    return rulesyncSubagents;
  }
  /**
   * Implementation of abstract method from Processor
   * Load and parse rulesync subagent files from .rulesync/subagents/ directory
   */
  async loadRulesyncFiles() {
    const subagentsDir = (0, import_node_path84.join)(this.baseDir, RulesyncSubagent.getSettablePaths().relativeDirPath);
    const dirExists = await directoryExists(subagentsDir);
    if (!dirExists) {
      logger.debug(`Rulesync subagents directory not found: ${subagentsDir}`);
      return [];
    }
    const entries = await listDirectoryFiles(subagentsDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));
    if (mdFiles.length === 0) {
      logger.debug(`No markdown files found in rulesync subagents directory: ${subagentsDir}`);
      return [];
    }
    logger.debug(`Found ${mdFiles.length} subagent files in ${subagentsDir}`);
    const rulesyncSubagents = [];
    for (const mdFile of mdFiles) {
      const filepath = (0, import_node_path84.join)(subagentsDir, mdFile);
      try {
        const rulesyncSubagent = await RulesyncSubagent.fromFile({
          relativeFilePath: mdFile,
          validate: true
        });
        rulesyncSubagents.push(rulesyncSubagent);
        logger.debug(`Successfully loaded subagent: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load subagent file ${filepath}:`, error);
        continue;
      }
    }
    if (rulesyncSubagents.length === 0) {
      logger.debug(`No valid subagents found in ${subagentsDir}`);
      return [];
    }
    logger.debug(`Successfully loaded ${rulesyncSubagents.length} rulesync subagents`);
    return rulesyncSubagents;
  }
  /**
   * Implementation of abstract method from Processor
   * Load tool-specific subagent configurations and parse them into ToolSubagent instances
   */
  async loadToolFiles({
    forDeletion = false
  } = {}) {
    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });
    const subagentFilePaths = await findFilesByGlobs(
      (0, import_node_path84.join)(this.baseDir, paths.relativeDirPath, factory.meta.filePattern)
    );
    if (forDeletion) {
      const toolSubagents2 = subagentFilePaths.map(
        (path4) => factory.class.forDeletion({
          baseDir: this.baseDir,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: (0, import_node_path84.basename)(path4),
          global: this.global
        })
      ).filter((subagent) => subagent.isDeletable());
      logger.debug(
        `Successfully loaded ${toolSubagents2.length} ${paths.relativeDirPath} subagents`
      );
      return toolSubagents2;
    }
    const toolSubagents = await Promise.all(
      subagentFilePaths.map(
        (path4) => factory.class.fromFile({
          baseDir: this.baseDir,
          relativeFilePath: (0, import_node_path84.basename)(path4),
          global: this.global
        })
      )
    );
    logger.debug(`Successfully loaded ${toolSubagents.length} ${paths.relativeDirPath} subagents`);
    return toolSubagents;
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({
    global = false,
    includeSimulated = false
  } = {}) {
    if (global) {
      return [...subagentsProcessorToolTargetsGlobal];
    }
    if (!includeSimulated) {
      return subagentsProcessorToolTargets.filter(
        (target) => !subagentsProcessorToolTargetsSimulated.includes(target)
      );
    }
    return [...subagentsProcessorToolTargets];
  }
  static getToolTargetsSimulated() {
    return [...subagentsProcessorToolTargetsSimulated];
  }
  /**
   * Get the factory for a specific tool target.
   * This is a static version of the internal getFactory for external use.
   * @param target - The tool target. Must be a valid SubagentsProcessorToolTarget.
   * @returns The factory for the target, or undefined if not found.
   */
  static getFactory(target) {
    const result = SubagentsProcessorToolTargetSchema.safeParse(target);
    if (!result.success) {
      return void 0;
    }
    return toolSubagentFactories.get(result.data);
  }
};

// src/features/rules/agentsmd-rule.ts
var import_node_path87 = require("path");

// src/features/rules/tool-rule.ts
var import_node_path86 = require("path");

// src/features/rules/rulesync-rule.ts
var import_node_path85 = require("path");
var import_mini42 = require("zod/mini");
var RulesyncRuleFrontmatterSchema = import_mini42.z.object({
  root: import_mini42.z.optional(import_mini42.z.boolean()),
  localRoot: import_mini42.z.optional(import_mini42.z.boolean()),
  targets: import_mini42.z._default(RulesyncTargetsSchema, ["*"]),
  description: import_mini42.z.optional(import_mini42.z.string()),
  globs: import_mini42.z.optional(import_mini42.z.array(import_mini42.z.string())),
  agentsmd: import_mini42.z.optional(
    import_mini42.z.object({
      // @example "path/to/subproject"
      subprojectPath: import_mini42.z.optional(import_mini42.z.string())
    })
  ),
  claudecode: import_mini42.z.optional(
    import_mini42.z.object({
      // Glob patterns for conditional rules (takes precedence over globs)
      // @example ["src/**/*.ts", "tests/**/*.test.ts"]
      paths: import_mini42.z.optional(import_mini42.z.array(import_mini42.z.string()))
    })
  ),
  cursor: import_mini42.z.optional(
    import_mini42.z.object({
      alwaysApply: import_mini42.z.optional(import_mini42.z.boolean()),
      description: import_mini42.z.optional(import_mini42.z.string()),
      globs: import_mini42.z.optional(import_mini42.z.array(import_mini42.z.string()))
    })
  ),
  copilot: import_mini42.z.optional(
    import_mini42.z.object({
      excludeAgent: import_mini42.z.optional(import_mini42.z.union([import_mini42.z.literal("code-review"), import_mini42.z.literal("coding-agent")]))
    })
  ),
  antigravity: import_mini42.z.optional(
    import_mini42.z.looseObject({
      trigger: import_mini42.z.optional(import_mini42.z.string()),
      globs: import_mini42.z.optional(import_mini42.z.array(import_mini42.z.string()))
    })
  )
});
var RulesyncRule = class _RulesyncRule extends RulesyncFile {
  frontmatter;
  body;
  constructor({ frontmatter, body, ...rest }) {
    const parseResult = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
    if (!parseResult.success && rest.validate !== false) {
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path85.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(parseResult.error)}`
      );
    }
    const parsedFrontmatter = parseResult.success ? parseResult.data : { ...frontmatter, targets: frontmatter.targets ?? ["*"] };
    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, parsedFrontmatter)
    });
    this.frontmatter = parsedFrontmatter;
    this.body = body;
  }
  static getSettablePaths() {
    return {
      recommended: {
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH
      },
      legacy: {
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH
      }
    };
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = RulesyncRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path85.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  static async fromFile({
    relativeFilePath,
    validate = true
  }) {
    const filePath = (0, import_node_path85.join)(
      process.cwd(),
      this.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = RulesyncRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }
    const validatedFrontmatter = {
      root: result.data.root ?? false,
      localRoot: result.data.localRoot ?? false,
      targets: result.data.targets ?? ["*"],
      description: result.data.description ?? "",
      globs: result.data.globs ?? [],
      agentsmd: result.data.agentsmd,
      cursor: result.data.cursor
    };
    return new _RulesyncRule({
      baseDir: process.cwd(),
      relativeDirPath: this.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath,
      frontmatter: validatedFrontmatter,
      body: content.trim(),
      validate
    });
  }
  getBody() {
    return this.body;
  }
};

// src/features/rules/tool-rule.ts
var ToolRule = class extends ToolFile {
  root;
  description;
  globs;
  constructor({ root = false, description, globs, ...rest }) {
    super(rest);
    this.root = root;
    this.description = description;
    this.globs = globs;
  }
  static getSettablePaths(_options = {}) {
    throw new Error("Please implement this method in the subclass.");
  }
  static async fromFile(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  /**
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse file content, making it safe to use
   * even when files have old/incompatible formats.
   */
  static forDeletion(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  static fromRulesyncRule(_params) {
    throw new Error("Please implement this method in the subclass.");
  }
  static buildToolRuleParamsDefault({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    rootPath = { relativeDirPath: ".", relativeFilePath: "AGENTS.md" },
    nonRootPath
  }) {
    const fileContent = rulesyncRule.getBody();
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;
    if (isRoot) {
      return {
        baseDir,
        relativeDirPath: rootPath.relativeDirPath,
        relativeFilePath: rootPath.relativeFilePath,
        fileContent,
        validate,
        root: true,
        description: rulesyncRule.getFrontmatter().description,
        globs: rulesyncRule.getFrontmatter().globs
      };
    }
    if (!nonRootPath) {
      throw new Error("nonRootPath is not set");
    }
    return {
      baseDir,
      relativeDirPath: nonRootPath.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      fileContent,
      validate,
      root: false,
      description: rulesyncRule.getFrontmatter().description,
      globs: rulesyncRule.getFrontmatter().globs
    };
  }
  static buildToolRuleParamsAgentsmd({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    rootPath = { relativeDirPath: ".", relativeFilePath: "AGENTS.md" },
    nonRootPath = { relativeDirPath: (0, import_node_path86.join)(".agents", "memories") }
  }) {
    const params = this.buildToolRuleParamsDefault({
      baseDir,
      rulesyncRule,
      validate,
      rootPath,
      nonRootPath
    });
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    if (!rulesyncFrontmatter.root && rulesyncFrontmatter.agentsmd?.subprojectPath) {
      params.relativeDirPath = (0, import_node_path86.join)(rulesyncFrontmatter.agentsmd.subprojectPath);
      params.relativeFilePath = "AGENTS.md";
    }
    return params;
  }
  toRulesyncRuleDefault() {
    return new RulesyncRule({
      baseDir: process.cwd(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.isRoot() ? RULESYNC_OVERVIEW_FILE_NAME : this.getRelativeFilePath(),
      frontmatter: {
        root: this.isRoot(),
        targets: ["*"],
        description: this.description ?? "",
        globs: this.globs ?? (this.isRoot() ? ["**/*"] : [])
      },
      body: this.getFileContent()
    });
  }
  isRoot() {
    return this.root;
  }
  getDescription() {
    return this.description;
  }
  getGlobs() {
    return this.globs;
  }
  static isTargetedByRulesyncRule(_rulesyncRule) {
    throw new Error("Please implement this method in the subclass.");
  }
  static isTargetedByRulesyncRuleDefault({
    rulesyncRule,
    toolTarget
  }) {
    const targets = rulesyncRule.getFrontmatter().targets;
    if (!targets) {
      return true;
    }
    if (targets.includes("*")) {
      return true;
    }
    if (targets.includes(toolTarget)) {
      return true;
    }
    return false;
  }
};
function buildToolPath(toolDir, subDir, excludeToolDir) {
  return excludeToolDir ? subDir : (0, import_node_path86.join)(toolDir, subDir);
}

// src/features/rules/agentsmd-rule.ts
var AgentsMdRule = class _AgentsMdRule extends ToolRule {
  constructor({ fileContent, root, ...rest }) {
    super({
      ...rest,
      fileContent,
      root: root ?? false
    });
  }
  static getSettablePaths(_options = {}) {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md"
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".agents", "memories", _options.excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const isRoot = relativeFilePath === "AGENTS.md";
    const relativePath = isRoot ? "AGENTS.md" : (0, import_node_path87.join)(".agents", "memories", relativeFilePath);
    const fileContent = await readFileContent((0, import_node_path87.join)(baseDir, relativePath));
    return new _AgentsMdRule({
      baseDir,
      relativeDirPath: isRoot ? this.getSettablePaths().root.relativeDirPath : this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? "AGENTS.md" : relativeFilePath,
      fileContent,
      validate,
      root: isRoot
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    const isRoot = relativeFilePath === "AGENTS.md" && relativeDirPath === ".";
    return new _AgentsMdRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    return new _AgentsMdRule(
      this.buildToolRuleParamsAgentsmd({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "agentsmd"
    });
  }
};

// src/features/rules/antigravity-rule.ts
var import_node_path88 = require("path");
var import_mini43 = require("zod/mini");
var AntigravityRuleFrontmatterSchema = import_mini43.z.looseObject({
  trigger: import_mini43.z.optional(
    import_mini43.z.union([
      import_mini43.z.literal("always_on"),
      import_mini43.z.literal("glob"),
      import_mini43.z.literal("manual"),
      import_mini43.z.literal("model_decision"),
      import_mini43.z.string()
      // accepts any string for forward compatibility
    ])
  ),
  globs: import_mini43.z.optional(import_mini43.z.string()),
  description: import_mini43.z.optional(import_mini43.z.string())
});
function parseGlobsString(globs) {
  if (!globs) {
    return [];
  }
  if (Array.isArray(globs)) {
    return globs;
  }
  if (globs.trim() === "") {
    return [];
  }
  return globs.split(",").map((g) => g.trim());
}
function stringifyGlobs(globs) {
  if (!globs || globs.length === 0) {
    return void 0;
  }
  return globs.join(",");
}
function normalizeStoredAntigravity(stored) {
  if (!stored) {
    return void 0;
  }
  const { globs, ...rest } = stored;
  return {
    ...rest,
    globs: Array.isArray(globs) ? stringifyGlobs(globs) : globs
  };
}
var globStrategy = {
  canHandle: (trigger) => trigger === "glob",
  generateFrontmatter: (normalized, rulesyncFrontmatter) => {
    const effectiveGlobsArray = normalized?.globs ? parseGlobsString(normalized.globs) : rulesyncFrontmatter.globs ?? [];
    return {
      ...normalized,
      trigger: "glob",
      globs: stringifyGlobs(effectiveGlobsArray)
    };
  },
  exportRulesyncData: ({ description, ...frontmatter }) => ({
    globs: parseGlobsString(frontmatter.globs),
    description: description || "",
    antigravity: frontmatter
  })
};
var manualStrategy = {
  canHandle: (trigger) => trigger === "manual",
  generateFrontmatter: (normalized) => ({
    ...normalized,
    trigger: "manual"
  }),
  exportRulesyncData: ({ description, ...frontmatter }) => ({
    globs: [],
    description: description || "",
    antigravity: frontmatter
  })
};
var alwaysOnStrategy = {
  canHandle: (trigger) => trigger === "always_on",
  generateFrontmatter: (normalized) => ({
    ...normalized,
    trigger: "always_on"
  }),
  exportRulesyncData: ({ description, ...frontmatter }) => ({
    globs: ["**/*"],
    description: description || "",
    antigravity: frontmatter
  })
};
var modelDecisionStrategy = {
  canHandle: (trigger) => trigger === "model_decision",
  generateFrontmatter: (normalized, rulesyncFrontmatter) => ({
    ...normalized,
    trigger: "model_decision",
    description: rulesyncFrontmatter.description
  }),
  exportRulesyncData: ({ description, ...frontmatter }) => ({
    globs: [],
    description: description || "",
    antigravity: frontmatter
  })
};
var unknownStrategy = {
  canHandle: (trigger) => trigger !== void 0,
  generateFrontmatter: (normalized) => {
    const trigger = typeof normalized?.trigger === "string" ? normalized.trigger : "manual";
    return {
      ...normalized,
      trigger
    };
  },
  exportRulesyncData: ({ description, ...frontmatter }) => ({
    globs: frontmatter.globs ? parseGlobsString(frontmatter.globs) : ["**/*"],
    description: description || "",
    antigravity: frontmatter
  })
};
var inferenceStrategy = {
  canHandle: (trigger) => trigger === void 0,
  generateFrontmatter: (normalized, rulesyncFrontmatter) => {
    const effectiveGlobsArray = normalized?.globs ? parseGlobsString(normalized.globs) : rulesyncFrontmatter.globs ?? [];
    if (effectiveGlobsArray.length > 0 && !effectiveGlobsArray.includes("**/*") && !effectiveGlobsArray.includes("*")) {
      return {
        ...normalized,
        trigger: "glob",
        globs: stringifyGlobs(effectiveGlobsArray)
      };
    }
    return {
      ...normalized,
      trigger: "always_on"
    };
  },
  exportRulesyncData: ({ description, ...frontmatter }) => ({
    globs: frontmatter.globs ? parseGlobsString(frontmatter.globs) : ["**/*"],
    description: description || "",
    antigravity: frontmatter
  })
};
var STRATEGIES = [
  globStrategy,
  manualStrategy,
  alwaysOnStrategy,
  modelDecisionStrategy,
  unknownStrategy,
  inferenceStrategy
];
var AntigravityRule = class _AntigravityRule extends ToolRule {
  frontmatter;
  body;
  /**
   * Creates an AntigravityRule instance.
   *
   * @param params - Rule parameters including frontmatter and body
   * @param params.frontmatter - Antigravity-specific frontmatter configuration
   * @param params.body - The markdown body content (without frontmatter)
   *
   * Note: Files without frontmatter will default to always_on trigger during fromFile().
   */
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate !== false) {
      const result = AntigravityRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path88.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest,
      // Ensure fileContent includes frontmatter when constructed directly
      fileContent: stringifyFrontmatter(body, frontmatter)
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  static getSettablePaths(_options = {}) {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".agent", "rules", _options.excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const filePath = (0, import_node_path88.join)(
      baseDir,
      this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent);
    let parsedFrontmatter;
    if (validate) {
      const result = AntigravityRuleFrontmatterSchema.safeParse(frontmatter);
      if (result.success) {
        parsedFrontmatter = result.data;
      } else {
        throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
      }
    } else {
      parsedFrontmatter = frontmatter;
    }
    return new _AntigravityRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
      body,
      frontmatter: parsedFrontmatter,
      validate,
      root: false
    });
  }
  /**
   * Converts a RulesyncRule to an AntigravityRule.
   *
   * Trigger inference:
   * - If antigravity.trigger is set, it's preserved
   * - If specific globs are set, infers "glob" trigger
   * - Otherwise, infers "always_on" trigger
   */
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const storedAntigravity = rulesyncFrontmatter.antigravity;
    const normalized = normalizeStoredAntigravity(storedAntigravity);
    const storedTrigger = storedAntigravity?.trigger;
    const strategy = STRATEGIES.find((s) => s.canHandle(storedTrigger));
    if (!strategy) {
      throw new Error(`No strategy found for trigger: ${storedTrigger}`);
    }
    const frontmatter = strategy.generateFrontmatter(normalized, rulesyncFrontmatter);
    const paths = this.getSettablePaths();
    const kebabCaseFilename = toKebabCaseFilename(rulesyncRule.getRelativeFilePath());
    return new _AntigravityRule({
      baseDir,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: kebabCaseFilename,
      frontmatter,
      body: rulesyncRule.getBody(),
      validate,
      root: false
    });
  }
  /**
   * Converts this AntigravityRule to a RulesyncRule.
   *
   * The Antigravity configuration is preserved in the RulesyncRule's
   * frontmatter.antigravity field for round-trip compatibility.
   *
   * Note: All Antigravity rules are treated as non-root (root: false),
   * as they are all placed in the .agent/rules directory.
   *
   * @returns RulesyncRule instance with Antigravity config preserved
   */
  toRulesyncRule() {
    const strategy = STRATEGIES.find((s) => s.canHandle(this.frontmatter.trigger));
    let rulesyncData = {
      globs: [],
      description: "",
      antigravity: this.frontmatter
    };
    if (strategy) {
      rulesyncData = strategy.exportRulesyncData(this.frontmatter);
    }
    const antigravityForRulesync = {
      ...rulesyncData.antigravity,
      globs: this.frontmatter.globs ? parseGlobsString(this.frontmatter.globs) : void 0
    };
    return new RulesyncRule({
      baseDir: process.cwd(),
      relativeDirPath: RulesyncRule.getSettablePaths().recommended.relativeDirPath,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: {
        root: false,
        targets: ["*"],
        ...rulesyncData,
        antigravity: antigravityForRulesync
      },
      // When converting back, we only want the body content
      body: this.body
    });
  }
  getBody() {
    return this.body;
  }
  // Helper to access raw file content including frontmatter is `this.fileContent` (from ToolFile)
  // But we might want `body` only for some operations?
  // ToolFile.getFileContent() returns the whole string.
  getFrontmatter() {
    return this.frontmatter;
  }
  validate() {
    const result = AntigravityRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (!result.success) {
      return { success: false, error: new Error(formatError(result.error)) };
    }
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _AntigravityRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: false
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "antigravity"
    });
  }
};

// src/features/rules/augmentcode-legacy-rule.ts
var import_node_path89 = require("path");
var AugmentcodeLegacyRule = class _AugmentcodeLegacyRule extends ToolRule {
  toRulesyncRule() {
    const rulesyncFrontmatter = {
      root: this.isRoot(),
      targets: ["*"],
      description: "",
      globs: this.isRoot() ? ["**/*"] : []
    };
    return new RulesyncRule({
      baseDir: ".",
      // RulesyncRule baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.getFileContent(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true
    });
  }
  static getSettablePaths(_options = {}) {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: ".augment-guidelines"
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".augment", "rules", _options.excludeToolDir)
      }
    };
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    return new _AugmentcodeLegacyRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot
      })
    );
  }
  validate() {
    return { success: true, error: null };
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "augmentcode-legacy"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const settablePaths = this.getSettablePaths();
    const isRoot = relativeFilePath === settablePaths.root.relativeFilePath;
    const relativePath = isRoot ? settablePaths.root.relativeFilePath : (0, import_node_path89.join)(settablePaths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent((0, import_node_path89.join)(baseDir, relativePath));
    return new _AugmentcodeLegacyRule({
      baseDir,
      relativeDirPath: isRoot ? settablePaths.root.relativeDirPath : settablePaths.nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? settablePaths.root.relativeFilePath : relativeFilePath,
      fileContent,
      validate,
      root: isRoot
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    const settablePaths = this.getSettablePaths();
    const isRoot = relativeFilePath === settablePaths.root.relativeFilePath;
    return new _AugmentcodeLegacyRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot
    });
  }
};

// src/features/rules/augmentcode-rule.ts
var import_node_path90 = require("path");
var AugmentcodeRule = class _AugmentcodeRule extends ToolRule {
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  static getSettablePaths(_options = {}) {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".augment", "rules", _options.excludeToolDir)
      }
    };
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    return new _AugmentcodeRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: this.getSettablePaths().nonRoot
      })
    );
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path90.join)(baseDir, this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath)
    );
    const { body: content } = parseFrontmatter(fileContent);
    return new _AugmentcodeRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent: content.trim(),
      validate
    });
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _AugmentcodeRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "augmentcode"
    });
  }
};

// src/features/rules/claudecode-legacy-rule.ts
var import_node_path91 = require("path");
var ClaudecodeLegacyRule = class _ClaudecodeLegacyRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir
  } = {}) {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(".claude", ".", excludeToolDir),
          relativeFilePath: "CLAUDE.md"
        }
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md"
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".claude", "memories", excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    if (isRoot) {
      const relativePath2 = paths.root.relativeFilePath;
      const fileContent2 = await readFileContent(
        (0, import_node_path91.join)(baseDir, paths.root.relativeDirPath, relativePath2)
      );
      return new _ClaudecodeLegacyRule({
        baseDir,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent: fileContent2,
        validate,
        root: true
      });
    }
    if (!paths.nonRoot) {
      throw new Error("nonRoot path is not set");
    }
    const relativePath = (0, import_node_path91.join)(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent((0, import_node_path91.join)(baseDir, relativePath));
    return new _ClaudecodeLegacyRule({
      baseDir,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: false
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    return new _ClaudecodeLegacyRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: paths.root,
        nonRootPath: paths.nonRoot
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    return new _ClaudecodeLegacyRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "claudecode-legacy"
    });
  }
};

// src/features/rules/claudecode-rule.ts
var import_node_path92 = require("path");
var import_mini44 = require("zod/mini");
var ClaudecodeRuleFrontmatterSchema = import_mini44.z.object({
  paths: import_mini44.z.optional(import_mini44.z.array(import_mini44.z.string()))
});
var ClaudecodeRule = class _ClaudecodeRule extends ToolRule {
  frontmatter;
  body;
  static getSettablePaths({
    global,
    excludeToolDir
  } = {}) {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(".claude", ".", excludeToolDir),
          relativeFilePath: "CLAUDE.md"
        }
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md"
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".claude", "rules", excludeToolDir)
      }
    };
  }
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate) {
      const result = ClaudecodeRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path92.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest,
      // Root file: no frontmatter; Non-root file: with optional paths frontmatter
      fileContent: rest.root ? body : _ClaudecodeRule.generateFileContent(body, frontmatter)
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  static generateFileContent(body, frontmatter) {
    if (frontmatter.paths) {
      return stringifyFrontmatter(body, { paths: frontmatter.paths });
    }
    return body;
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    if (isRoot) {
      const fileContent2 = await readFileContent(
        (0, import_node_path92.join)(baseDir, paths.root.relativeDirPath, paths.root.relativeFilePath)
      );
      return new _ClaudecodeRule({
        baseDir,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        frontmatter: {},
        body: fileContent2.trim(),
        validate,
        root: true
      });
    }
    if (!paths.nonRoot) {
      throw new Error("nonRoot path is not set");
    }
    const relativePath = (0, import_node_path92.join)(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent((0, import_node_path92.join)(baseDir, relativePath));
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = ClaudecodeRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path92.join)(baseDir, relativePath)}: ${formatError(result.error)}`
      );
    }
    return new _ClaudecodeRule({
      baseDir,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
      root: false
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    return new _ClaudecodeRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: isRoot
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false
  }) {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const root = rulesyncFrontmatter.root ?? false;
    const paths = this.getSettablePaths({ global });
    const claudecodePaths = rulesyncFrontmatter.claudecode?.paths;
    const globs = rulesyncFrontmatter.globs;
    const pathsValue = claudecodePaths ?? (globs?.length ? globs : void 0);
    const claudecodeFrontmatter = {
      paths: root ? void 0 : pathsValue
    };
    const body = rulesyncRule.getBody();
    if (root) {
      return new _ClaudecodeRule({
        baseDir,
        frontmatter: claudecodeFrontmatter,
        body,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        validate,
        root
      });
    }
    if (!paths.nonRoot) {
      throw new Error("nonRoot path is not set");
    }
    return new _ClaudecodeRule({
      baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      validate,
      root
    });
  }
  toRulesyncRule() {
    let globs;
    if (this.isRoot()) {
      globs = ["**/*"];
    } else if (this.frontmatter.paths) {
      globs = this.frontmatter.paths;
    }
    const rulesyncFrontmatter = {
      targets: ["*"],
      root: this.isRoot(),
      description: this.description,
      globs,
      ...this.frontmatter.paths && {
        claudecode: { paths: this.frontmatter.paths }
      }
    };
    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true
    });
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = ClaudecodeRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path92.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  getBody() {
    return this.body;
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "claudecode"
    });
  }
};

// src/features/rules/cline-rule.ts
var import_node_path93 = require("path");
var import_mini45 = require("zod/mini");
var ClineRuleFrontmatterSchema = import_mini45.z.object({
  description: import_mini45.z.string()
});
var ClineRule = class _ClineRule extends ToolRule {
  static getSettablePaths(_options = {}) {
    return {
      nonRoot: {
        // .clinerules is a flat directory, so excludeToolDir has no effect
        relativeDirPath: ".clinerules"
      }
    };
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    return new _ClineRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: this.getSettablePaths().nonRoot
      })
    );
  }
  validate() {
    return { success: true, error: null };
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "cline"
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path93.join)(baseDir, this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath)
    );
    return new _ClineRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _ClineRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
};

// src/features/rules/codexcli-rule.ts
var import_node_path94 = require("path");
var CodexcliRule = class _CodexcliRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir
  } = {}) {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(".codex", ".", excludeToolDir),
          relativeFilePath: "AGENTS.md"
        }
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md"
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".codex", "memories", excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    if (isRoot) {
      const relativePath2 = paths.root.relativeFilePath;
      const fileContent2 = await readFileContent(
        (0, import_node_path94.join)(baseDir, paths.root.relativeDirPath, relativePath2)
      );
      return new _CodexcliRule({
        baseDir,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent: fileContent2,
        validate,
        root: true
      });
    }
    if (!paths.nonRoot) {
      throw new Error("nonRoot path is not set");
    }
    const relativePath = (0, import_node_path94.join)(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent((0, import_node_path94.join)(baseDir, relativePath));
    return new _CodexcliRule({
      baseDir,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: false
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    return new _CodexcliRule(
      this.buildToolRuleParamsAgentsmd({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: paths.root,
        nonRootPath: paths.nonRoot
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    return new _CodexcliRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "codexcli"
    });
  }
};

// src/features/rules/copilot-rule.ts
var import_node_path95 = require("path");
var import_mini46 = require("zod/mini");
var CopilotRuleFrontmatterSchema = import_mini46.z.object({
  description: import_mini46.z.optional(import_mini46.z.string()),
  applyTo: import_mini46.z.optional(import_mini46.z.string()),
  excludeAgent: import_mini46.z.optional(import_mini46.z.union([import_mini46.z.literal("code-review"), import_mini46.z.literal("coding-agent")]))
});
var CopilotRule = class _CopilotRule extends ToolRule {
  frontmatter;
  body;
  static getSettablePaths(_options = {}) {
    return {
      root: {
        relativeDirPath: buildToolPath(".github", ".", _options.excludeToolDir),
        relativeFilePath: "copilot-instructions.md"
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".github", "instructions", _options.excludeToolDir)
      }
    };
  }
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate) {
      const result = CopilotRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path95.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest,
      // If the rule is a root rule, the file content does not contain frontmatter.
      fileContent: rest.root ? body : stringifyFrontmatter(body, frontmatter)
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  toRulesyncRule() {
    let globs;
    if (this.isRoot()) {
      globs = ["**/*"];
    } else if (this.frontmatter.applyTo) {
      globs = this.frontmatter.applyTo.split(",").map((g) => g.trim());
    }
    const rulesyncFrontmatter = {
      targets: ["*"],
      root: this.isRoot(),
      description: this.frontmatter.description,
      globs,
      ...this.frontmatter.excludeAgent && {
        copilot: { excludeAgent: this.frontmatter.excludeAgent }
      }
    };
    const originalFilePath = this.getRelativeFilePath();
    const relativeFilePath = originalFilePath.replace(/\.instructions\.md$/, ".md");
    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath,
      validate: true
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const root = rulesyncFrontmatter.root;
    const copilotFrontmatter = {
      description: rulesyncFrontmatter.description,
      applyTo: rulesyncFrontmatter.globs?.length ? rulesyncFrontmatter.globs.join(",") : void 0,
      excludeAgent: rulesyncFrontmatter.copilot?.excludeAgent
    };
    const body = rulesyncRule.getBody();
    if (root) {
      return new _CopilotRule({
        baseDir,
        frontmatter: copilotFrontmatter,
        body,
        relativeDirPath: this.getSettablePaths().root.relativeDirPath,
        relativeFilePath: this.getSettablePaths().root.relativeFilePath,
        validate,
        root
      });
    }
    const originalFileName = rulesyncRule.getRelativeFilePath();
    const nameWithoutExt = originalFileName.replace(/\.md$/, "");
    const newFileName = `${nameWithoutExt}.instructions.md`;
    return new _CopilotRule({
      baseDir,
      frontmatter: copilotFrontmatter,
      body,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: newFileName,
      validate,
      root
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const isRoot = relativeFilePath === "copilot-instructions.md";
    const relativePath = isRoot ? (0, import_node_path95.join)(
      this.getSettablePaths().root.relativeDirPath,
      this.getSettablePaths().root.relativeFilePath
    ) : (0, import_node_path95.join)(this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent((0, import_node_path95.join)(baseDir, relativePath));
    if (isRoot) {
      return new _CopilotRule({
        baseDir,
        relativeDirPath: this.getSettablePaths().root.relativeDirPath,
        relativeFilePath: this.getSettablePaths().root.relativeFilePath,
        frontmatter: {},
        body: fileContent.trim(),
        validate,
        root: isRoot
      });
    }
    const { frontmatter, body: content } = parseFrontmatter(fileContent);
    const result = CopilotRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path95.join)(baseDir, relativeFilePath)}: ${formatError(result.error)}`
      );
    }
    return new _CopilotRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath.endsWith(".instructions.md") ? relativeFilePath : relativeFilePath.replace(/\.md$/, ".instructions.md"),
      frontmatter: result.data,
      body: content.trim(),
      validate,
      root: isRoot
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    const isRoot = relativeFilePath === this.getSettablePaths().root.relativeFilePath;
    return new _CopilotRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      root: isRoot
    });
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = CopilotRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path95.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  getBody() {
    return this.body;
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "copilot"
    });
  }
};

// src/features/rules/cursor-rule.ts
var import_node_path96 = require("path");
var import_mini47 = require("zod/mini");
var CursorRuleFrontmatterSchema = import_mini47.z.object({
  description: import_mini47.z.optional(import_mini47.z.string()),
  globs: import_mini47.z.optional(import_mini47.z.string()),
  alwaysApply: import_mini47.z.optional(import_mini47.z.boolean())
});
var CursorRule = class _CursorRule extends ToolRule {
  frontmatter;
  body;
  static getSettablePaths(_options = {}) {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".cursor", "rules", _options.excludeToolDir)
      }
    };
  }
  constructor({ frontmatter, body, ...rest }) {
    if (rest.validate) {
      const result = CursorRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${(0, import_node_path96.join)(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`
        );
      }
    }
    super({
      ...rest,
      fileContent: _CursorRule.stringifyCursorFrontmatter(body, frontmatter)
    });
    this.frontmatter = frontmatter;
    this.body = body;
  }
  /**
   * Custom stringify function for Cursor MDC files
   * MDC files don't support quotes in YAML, so globs patterns must be output without quotes
   */
  static stringifyCursorFrontmatter(body, frontmatter) {
    const lines = ["---"];
    if (frontmatter.alwaysApply !== void 0) {
      lines.push(`alwaysApply: ${frontmatter.alwaysApply}`);
    }
    if (frontmatter.description !== void 0) {
      lines.push(`description: ${frontmatter.description}`);
    }
    if (frontmatter.globs !== void 0) {
      lines.push(`globs: ${frontmatter.globs}`);
    }
    lines.push("---");
    lines.push("");
    if (body) {
      lines.push(body);
    }
    return lines.join("\n");
  }
  /**
   * Custom parse function for Cursor MDC files
   * MDC files don't support quotes in YAML, so we need to handle patterns like *.ts specially
   */
  static parseCursorFrontmatter(fileContent) {
    const preprocessedContent = fileContent.replace(
      /^globs:\s*(\*[^\n]*?)$/m,
      (_match, globPattern) => {
        return `globs: "${globPattern}"`;
      }
    );
    return parseFrontmatter(preprocessedContent);
  }
  toRulesyncRule() {
    const targets = ["*"];
    const isAlways = this.frontmatter.alwaysApply === true;
    const hasGlobs = this.frontmatter.globs && this.frontmatter.globs.trim() !== "";
    let globs;
    if (hasGlobs && this.frontmatter.globs) {
      globs = this.frontmatter.globs.split(",").map((g) => g.trim()).filter((g) => g.length > 0);
    } else if (isAlways) {
      globs = ["**/*"];
    } else {
      globs = [];
    }
    const rulesyncFrontmatter = {
      targets,
      root: false,
      description: this.frontmatter.description,
      globs,
      cursor: {
        alwaysApply: this.frontmatter.alwaysApply,
        description: this.frontmatter.description,
        globs: globs.length > 0 ? globs : void 0
      }
    };
    return new RulesyncRule({
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.relativeFilePath.replace(/\.mdc$/, ".md"),
      validate: true
    });
  }
  /**
   * Resolve cursor globs with priority: cursor-specific > parent
   * Returns comma-separated string for Cursor format, or undefined if no globs
   * @param cursorSpecificGlobs - Cursor-specific globs (takes priority if defined)
   * @param parentGlobs - Parent globs (used if cursorSpecificGlobs is undefined)
   */
  static resolveCursorGlobs(cursorSpecificGlobs, parentGlobs) {
    const targetGlobs = cursorSpecificGlobs !== void 0 ? cursorSpecificGlobs : parentGlobs;
    return targetGlobs && targetGlobs.length > 0 ? targetGlobs.join(",") : void 0;
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const cursorFrontmatter = {
      description: rulesyncFrontmatter.description,
      globs: this.resolveCursorGlobs(rulesyncFrontmatter.cursor?.globs, rulesyncFrontmatter.globs),
      alwaysApply: rulesyncFrontmatter.cursor?.alwaysApply ?? void 0
    };
    const body = rulesyncRule.getBody();
    const originalFileName = rulesyncRule.getRelativeFilePath();
    const nameWithoutExt = originalFileName.replace(/\.md$/, "");
    const newFileName = `${nameWithoutExt}.mdc`;
    return new _CursorRule({
      baseDir,
      frontmatter: cursorFrontmatter,
      body,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: newFileName,
      validate
    });
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path96.join)(baseDir, this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath)
    );
    const { frontmatter, body: content } = _CursorRule.parseCursorFrontmatter(fileContent);
    const result = CursorRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid frontmatter in ${(0, import_node_path96.join)(baseDir, relativeFilePath)}: ${formatError(result.error)}`
      );
    }
    return new _CursorRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _CursorRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false
    });
  }
  validate() {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = CursorRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${(0, import_node_path96.join)(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`
        )
      };
    }
  }
  getFrontmatter() {
    return this.frontmatter;
  }
  getBody() {
    return this.body;
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "cursor"
    });
  }
};

// src/features/rules/factorydroid-rule.ts
var import_node_path97 = require("path");
var FactorydroidRule = class _FactorydroidRule extends ToolRule {
  constructor({ fileContent, root, ...rest }) {
    super({
      ...rest,
      fileContent,
      root: root ?? false
    });
  }
  static getSettablePaths({
    global,
    excludeToolDir
  } = {}) {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(".factory", ".", excludeToolDir),
          relativeFilePath: "AGENTS.md"
        }
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md"
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".factory", "rules", excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    if (isRoot) {
      const relativePath2 = (0, import_node_path97.join)(paths.root.relativeDirPath, paths.root.relativeFilePath);
      const fileContent2 = await readFileContent((0, import_node_path97.join)(baseDir, relativePath2));
      return new _FactorydroidRule({
        baseDir,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent: fileContent2,
        validate,
        root: true
      });
    }
    if (!paths.nonRoot) {
      throw new Error("nonRoot path is not set");
    }
    const relativePath = (0, import_node_path97.join)(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent((0, import_node_path97.join)(baseDir, relativePath));
    return new _FactorydroidRule({
      baseDir,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: false
    });
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath && relativeDirPath === paths.root.relativeDirPath;
    return new _FactorydroidRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    return new _FactorydroidRule(
      this.buildToolRuleParamsAgentsmd({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: paths.root,
        nonRootPath: paths.nonRoot
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "factorydroid"
    });
  }
};

// src/features/rules/geminicli-rule.ts
var import_node_path98 = require("path");
var GeminiCliRule = class _GeminiCliRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir
  } = {}) {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(".gemini", ".", excludeToolDir),
          relativeFilePath: "GEMINI.md"
        }
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "GEMINI.md"
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".gemini", "memories", excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    if (isRoot) {
      const relativePath2 = paths.root.relativeFilePath;
      const fileContent2 = await readFileContent(
        (0, import_node_path98.join)(baseDir, paths.root.relativeDirPath, relativePath2)
      );
      return new _GeminiCliRule({
        baseDir,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent: fileContent2,
        validate,
        root: true
      });
    }
    if (!paths.nonRoot) {
      throw new Error("nonRoot path is not set");
    }
    const relativePath = (0, import_node_path98.join)(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent((0, import_node_path98.join)(baseDir, relativePath));
    return new _GeminiCliRule({
      baseDir,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: false
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    return new _GeminiCliRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: paths.root,
        nonRootPath: paths.nonRoot
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false
  }) {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    return new _GeminiCliRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "geminicli"
    });
  }
};

// src/features/rules/junie-rule.ts
var import_node_path99 = require("path");
var JunieRule = class _JunieRule extends ToolRule {
  static getSettablePaths(_options = {}) {
    return {
      root: {
        relativeDirPath: buildToolPath(".junie", ".", _options.excludeToolDir),
        relativeFilePath: "guidelines.md"
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".junie", "memories", _options.excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const isRoot = relativeFilePath === "guidelines.md";
    const relativePath = isRoot ? "guidelines.md" : (0, import_node_path99.join)(".junie", "memories", relativeFilePath);
    const fileContent = await readFileContent((0, import_node_path99.join)(baseDir, relativePath));
    return new _JunieRule({
      baseDir,
      relativeDirPath: isRoot ? this.getSettablePaths().root.relativeDirPath : this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? "guidelines.md" : relativeFilePath,
      fileContent,
      validate,
      root: isRoot
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    return new _JunieRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    const isRoot = relativeFilePath === "guidelines.md";
    return new _JunieRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "junie"
    });
  }
};

// src/features/rules/kilo-rule.ts
var import_node_path100 = require("path");
var KiloRule = class _KiloRule extends ToolRule {
  static getSettablePaths(_options = {}) {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".kilocode", "rules", _options.excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path100.join)(baseDir, this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath)
    );
    return new _KiloRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    return new _KiloRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: this.getSettablePaths().nonRoot
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _KiloRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "kilo"
    });
  }
};

// src/features/rules/kiro-rule.ts
var import_node_path101 = require("path");
var KiroRule = class _KiroRule extends ToolRule {
  static getSettablePaths(_options = {}) {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".kiro", "steering", _options.excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path101.join)(baseDir, this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath)
    );
    return new _KiroRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: false
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    return new _KiroRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: this.getSettablePaths().nonRoot
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _KiroRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: false
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "kiro"
    });
  }
};

// src/features/rules/opencode-rule.ts
var import_node_path102 = require("path");
var OpenCodeRule = class _OpenCodeRule extends ToolRule {
  static getSettablePaths(_options = {}) {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md"
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".opencode", "memories", _options.excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const isRoot = relativeFilePath === "AGENTS.md";
    const relativePath = isRoot ? "AGENTS.md" : (0, import_node_path102.join)(".opencode", "memories", relativeFilePath);
    const fileContent = await readFileContent((0, import_node_path102.join)(baseDir, relativePath));
    return new _OpenCodeRule({
      baseDir,
      relativeDirPath: isRoot ? this.getSettablePaths().root.relativeDirPath : this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? "AGENTS.md" : relativeFilePath,
      validate,
      root: isRoot,
      fileContent
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    return new _OpenCodeRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    const isRoot = relativeFilePath === "AGENTS.md" && relativeDirPath === ".";
    return new _OpenCodeRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "opencode"
    });
  }
};

// src/features/rules/qwencode-rule.ts
var import_node_path103 = require("path");
var QwencodeRule = class _QwencodeRule extends ToolRule {
  static getSettablePaths(_options = {}) {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "QWEN.md"
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".qwen", "memories", _options.excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const isRoot = relativeFilePath === "QWEN.md";
    const relativePath = isRoot ? "QWEN.md" : (0, import_node_path103.join)(".qwen", "memories", relativeFilePath);
    const fileContent = await readFileContent((0, import_node_path103.join)(baseDir, relativePath));
    return new _QwencodeRule({
      baseDir,
      relativeDirPath: isRoot ? this.getSettablePaths().root.relativeDirPath : this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? "QWEN.md" : relativeFilePath,
      fileContent,
      validate,
      root: isRoot
    });
  }
  static fromRulesyncRule(params) {
    const { baseDir = process.cwd(), rulesyncRule, validate = true } = params;
    return new _QwencodeRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    const isRoot = relativeFilePath === "QWEN.md" && relativeDirPath === ".";
    return new _QwencodeRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "qwencode"
    });
  }
};

// src/features/rules/replit-rule.ts
var import_node_path104 = require("path");
var ReplitRule = class _ReplitRule extends ToolRule {
  static getSettablePaths(_options = {}) {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "replit.md"
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const paths = this.getSettablePaths();
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    if (!isRoot) {
      throw new Error("ReplitRule only supports root rules");
    }
    const relativePath = paths.root.relativeFilePath;
    const fileContent = await readFileContent(
      (0, import_node_path104.join)(baseDir, paths.root.relativeDirPath, relativePath)
    );
    return new _ReplitRule({
      baseDir,
      relativeDirPath: paths.root.relativeDirPath,
      relativeFilePath: paths.root.relativeFilePath,
      fileContent,
      validate,
      root: true
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    const paths = this.getSettablePaths();
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;
    if (!isRoot) {
      throw new Error("ReplitRule only supports root rules");
    }
    return new _ReplitRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: paths.root,
        nonRootPath: void 0
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    const paths = this.getSettablePaths();
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    return new _ReplitRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;
    if (!isRoot) {
      return false;
    }
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "replit"
    });
  }
};

// src/features/rules/roo-rule.ts
var import_node_path105 = require("path");
var RooRule = class _RooRule extends ToolRule {
  static getSettablePaths(_options = {}) {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".roo", "rules", _options.excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path105.join)(baseDir, this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath)
    );
    return new _RooRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
      root: false
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    return new _RooRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: this.getSettablePaths().nonRoot
      })
    );
  }
  /**
   * Extract mode slug from file path for mode-specific rules
   * Returns undefined for non-mode-specific rules
   */
  static extractModeFromPath(filePath) {
    const directoryMatch = filePath.match(/\.roo\/rules-([a-zA-Z0-9-]+)\//);
    if (directoryMatch) {
      return directoryMatch[1];
    }
    const singleFileMatch = filePath.match(/\.(roo|cline)rules-([a-zA-Z0-9-]+)$/);
    if (singleFileMatch) {
      return singleFileMatch[2];
    }
    return void 0;
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _RooRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: false
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "roo"
    });
  }
};

// src/features/rules/warp-rule.ts
var import_node_path106 = require("path");
var WarpRule = class _WarpRule extends ToolRule {
  constructor({ fileContent, root, ...rest }) {
    super({
      ...rest,
      fileContent,
      root: root ?? false
    });
  }
  static getSettablePaths(_options = {}) {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "WARP.md"
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".warp", "memories", _options.excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const isRoot = relativeFilePath === this.getSettablePaths().root.relativeFilePath;
    const relativePath = isRoot ? this.getSettablePaths().root.relativeFilePath : (0, import_node_path106.join)(this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent((0, import_node_path106.join)(baseDir, relativePath));
    return new _WarpRule({
      baseDir,
      relativeDirPath: isRoot ? this.getSettablePaths().root.relativeDirPath : ".warp",
      relativeFilePath: isRoot ? this.getSettablePaths().root.relativeFilePath : relativeFilePath,
      fileContent,
      validate,
      root: isRoot
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    return new _WarpRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    const isRoot = relativeFilePath === this.getSettablePaths().root.relativeFilePath;
    return new _WarpRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "warp"
    });
  }
};

// src/features/rules/windsurf-rule.ts
var import_node_path107 = require("path");
var WindsurfRule = class _WindsurfRule extends ToolRule {
  static getSettablePaths(_options = {}) {
    return {
      nonRoot: {
        relativeDirPath: buildToolPath(".windsurf", "rules", _options.excludeToolDir)
      }
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true
  }) {
    const fileContent = await readFileContent(
      (0, import_node_path107.join)(baseDir, this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath)
    );
    return new _WindsurfRule({
      baseDir,
      relativeDirPath: this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate
    });
  }
  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true
  }) {
    return new _WindsurfRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        nonRootPath: this.getSettablePaths().nonRoot
      })
    );
  }
  toRulesyncRule() {
    return this.toRulesyncRuleDefault();
  }
  validate() {
    return { success: true, error: null };
  }
  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath
  }) {
    return new _WindsurfRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false
    });
  }
  static isTargetedByRulesyncRule(rulesyncRule) {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "windsurf"
    });
  }
};

// src/features/rules/rules-processor.ts
var rulesProcessorToolTargets = [
  "agentsmd",
  "antigravity",
  "augmentcode",
  "augmentcode-legacy",
  "claudecode",
  "claudecode-legacy",
  "cline",
  "codexcli",
  "copilot",
  "cursor",
  "factorydroid",
  "geminicli",
  "junie",
  "kilo",
  "kiro",
  "opencode",
  "qwencode",
  "replit",
  "roo",
  "warp",
  "windsurf"
];
var RulesProcessorToolTargetSchema = import_mini48.z.enum(rulesProcessorToolTargets);
var toolRuleFactories = /* @__PURE__ */ new Map([
  [
    "agentsmd",
    {
      class: AgentsMdRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "toon",
        additionalConventions: {
          commands: { commandClass: AgentsmdCommand },
          subagents: { subagentClass: AgentsmdSubagent },
          skills: { skillClass: AgentsmdSkill }
        }
      }
    }
  ],
  [
    "antigravity",
    {
      class: AntigravityRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "auto" }
    }
  ],
  [
    "augmentcode",
    {
      class: AugmentcodeRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "auto" }
    }
  ],
  [
    "augmentcode-legacy",
    {
      class: AugmentcodeLegacyRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "toon" }
    }
  ],
  [
    "claudecode",
    {
      class: ClaudecodeRule,
      meta: { extension: "md", supportsGlobal: true, ruleDiscoveryMode: "auto" }
    }
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeLegacyRule,
      meta: { extension: "md", supportsGlobal: true, ruleDiscoveryMode: "claudecode-legacy" }
    }
  ],
  [
    "cline",
    {
      class: ClineRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "auto" }
    }
  ],
  [
    "codexcli",
    {
      class: CodexcliRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        additionalConventions: {
          subagents: { subagentClass: CodexCliSubagent }
        }
      }
    }
  ],
  [
    "copilot",
    {
      class: CopilotRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto"
      }
    }
  ],
  [
    "cursor",
    {
      class: CursorRule,
      meta: {
        extension: "mdc",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto"
      }
    }
  ],
  [
    "factorydroid",
    {
      class: FactorydroidRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        additionalConventions: {
          commands: { commandClass: FactorydroidCommand },
          subagents: { subagentClass: FactorydroidSubagent },
          skills: { skillClass: FactorydroidSkill }
        }
      }
    }
  ],
  [
    "geminicli",
    {
      class: GeminiCliRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        additionalConventions: {
          subagents: { subagentClass: GeminiCliSubagent }
        }
      }
    }
  ],
  [
    "junie",
    {
      class: JunieRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "toon" }
    }
  ],
  [
    "kilo",
    {
      class: KiloRule,
      meta: { extension: "md", supportsGlobal: true, ruleDiscoveryMode: "auto" }
    }
  ],
  [
    "kiro",
    {
      class: KiroRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "toon" }
    }
  ],
  [
    "opencode",
    {
      class: OpenCodeRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "toon" }
    }
  ],
  [
    "qwencode",
    {
      class: QwencodeRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "toon" }
    }
  ],
  [
    "replit",
    {
      class: ReplitRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "auto" }
    }
  ],
  [
    "roo",
    {
      class: RooRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
        additionalConventions: {
          subagents: { subagentClass: RooSubagent }
        },
        createsSeparateConventionsRule: true
      }
    }
  ],
  [
    "warp",
    {
      class: WarpRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "toon" }
    }
  ],
  [
    "windsurf",
    {
      class: WindsurfRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "auto" }
    }
  ]
]);
var rulesProcessorToolTargetsGlobal = Array.from(toolRuleFactories.entries()).filter(([_, factory]) => factory.meta.supportsGlobal).map(([target]) => target);
var defaultGetFactory6 = (target) => {
  const factory = toolRuleFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};
var RulesProcessor = class extends FeatureProcessor {
  toolTarget;
  simulateCommands;
  simulateSubagents;
  simulateSkills;
  global;
  getFactory;
  skills;
  constructor({
    baseDir = process.cwd(),
    toolTarget,
    simulateCommands = false,
    simulateSubagents = false,
    simulateSkills = false,
    global = false,
    getFactory = defaultGetFactory6,
    skills,
    dryRun = false
  }) {
    super({ baseDir, dryRun });
    const result = RulesProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for RulesProcessor: ${toolTarget}. ${formatError(result.error)}`
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.simulateCommands = simulateCommands;
    this.simulateSubagents = simulateSubagents;
    this.simulateSkills = simulateSkills;
    this.getFactory = getFactory;
    this.skills = skills;
  }
  async convertRulesyncFilesToToolFiles(rulesyncFiles) {
    const rulesyncRules = rulesyncFiles.filter(
      (file) => file instanceof RulesyncRule
    );
    const localRootRules = rulesyncRules.filter((rule) => rule.getFrontmatter().localRoot);
    const nonLocalRootRules = rulesyncRules.filter((rule) => !rule.getFrontmatter().localRoot);
    const factory = this.getFactory(this.toolTarget);
    const { meta } = factory;
    const toolRules = nonLocalRootRules.map((rulesyncRule) => {
      if (!factory.class.isTargetedByRulesyncRule(rulesyncRule)) {
        return null;
      }
      return factory.class.fromRulesyncRule({
        baseDir: this.baseDir,
        rulesyncRule,
        validate: true,
        global: this.global
      });
    }).filter((rule) => rule !== null);
    if (localRootRules.length > 0 && !this.global) {
      const localRootRule = localRootRules[0];
      if (localRootRule && factory.class.isTargetedByRulesyncRule(localRootRule)) {
        this.handleLocalRootRule(toolRules, localRootRule, factory);
      }
    }
    const isSimulated = this.simulateCommands || this.simulateSubagents || this.simulateSkills;
    if (isSimulated && meta.createsSeparateConventionsRule && meta.additionalConventions) {
      const conventionsContent = this.generateAdditionalConventionsSectionFromMeta(meta);
      const settablePaths = factory.class.getSettablePaths();
      const nonRootPath = "nonRoot" in settablePaths ? settablePaths.nonRoot : null;
      if (nonRootPath) {
        toolRules.push(
          factory.class.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: new RulesyncRule({
              baseDir: this.baseDir,
              relativeDirPath: nonRootPath.relativeDirPath,
              relativeFilePath: "additional-conventions.md",
              frontmatter: {
                root: false,
                targets: [this.toolTarget]
              },
              body: conventionsContent
            }),
            validate: true,
            global: this.global
          })
        );
      }
    }
    const rootRuleIndex = toolRules.findIndex((rule) => rule.isRoot());
    if (rootRuleIndex === -1) {
      return toolRules;
    }
    const rootRule = toolRules[rootRuleIndex];
    if (!rootRule) {
      return toolRules;
    }
    const referenceSection = this.generateReferenceSectionFromMeta(meta, toolRules);
    const conventionsSection = !meta.createsSeparateConventionsRule && meta.additionalConventions ? this.generateAdditionalConventionsSectionFromMeta(meta) : "";
    const newContent = referenceSection + conventionsSection + rootRule.getFileContent();
    rootRule.setFileContent(newContent);
    return toolRules;
  }
  buildSkillList(skillClass) {
    if (!this.skills) return [];
    const toolRelativeDirPath = skillClass.getSettablePaths({
      global: this.global
    }).relativeDirPath;
    return this.skills.filter((skill) => skillClass.isTargetedByRulesyncSkill(skill)).map((skill) => {
      const frontmatter = skill.getFrontmatter();
      const relativePath = (0, import_node_path108.join)(toolRelativeDirPath, skill.getDirName(), SKILL_FILE_NAME);
      return {
        name: frontmatter.name,
        description: frontmatter.description,
        path: relativePath
      };
    });
  }
  /**
   * Handle localRoot rule generation based on tool target.
   * - Claude Code: generates `./CLAUDE.local.md`
   * - Claude Code Legacy: generates `./CLAUDE.local.md`
   * - Other tools: appends content to the root file with one blank line separator
   */
  handleLocalRootRule(toolRules, localRootRule, _factory) {
    const localRootBody = localRootRule.getBody();
    if (this.toolTarget === "claudecode") {
      const paths = ClaudecodeRule.getSettablePaths({ global: this.global });
      toolRules.push(
        new ClaudecodeRule({
          baseDir: this.baseDir,
          relativeDirPath: paths.root.relativeDirPath,
          relativeFilePath: "CLAUDE.local.md",
          frontmatter: {},
          body: localRootBody,
          validate: true,
          root: true
          // Treat as root so it doesn't have frontmatter
        })
      );
    } else if (this.toolTarget === "claudecode-legacy") {
      const paths = ClaudecodeLegacyRule.getSettablePaths({ global: this.global });
      toolRules.push(
        new ClaudecodeLegacyRule({
          baseDir: this.baseDir,
          relativeDirPath: paths.root.relativeDirPath,
          relativeFilePath: "CLAUDE.local.md",
          fileContent: localRootBody,
          validate: true,
          root: true
          // Treat as root so it doesn't have frontmatter
        })
      );
    } else {
      const rootRule = toolRules.find((rule) => rule.isRoot());
      if (rootRule) {
        const currentContent = rootRule.getFileContent();
        const newContent = currentContent + "\n\n" + localRootBody;
        rootRule.setFileContent(newContent);
      }
    }
  }
  /**
   * Generate reference section based on meta configuration.
   */
  generateReferenceSectionFromMeta(meta, toolRules) {
    switch (meta.ruleDiscoveryMode) {
      case "toon":
        return this.generateToonReferencesSection(toolRules);
      case "claudecode-legacy":
        return this.generateReferencesSection(toolRules);
      case "auto":
      default:
        return "";
    }
  }
  /**
   * Generate additional conventions section based on meta configuration.
   */
  generateAdditionalConventionsSectionFromMeta(meta) {
    const { additionalConventions } = meta;
    if (!additionalConventions) {
      return "";
    }
    const conventions = {};
    if (additionalConventions.commands) {
      const { commandClass } = additionalConventions.commands;
      const relativeDirPath = commandClass.getSettablePaths({
        global: this.global
      }).relativeDirPath;
      conventions.commands = { relativeDirPath };
    }
    if (additionalConventions.subagents) {
      const { subagentClass } = additionalConventions.subagents;
      const relativeDirPath = subagentClass.getSettablePaths({
        global: this.global
      }).relativeDirPath;
      conventions.subagents = { relativeDirPath };
    }
    if (additionalConventions.skills) {
      const { skillClass, globalOnly } = additionalConventions.skills;
      if (!globalOnly || this.global) {
        conventions.skills = {
          skillList: this.buildSkillList(skillClass)
        };
      }
    }
    return this.generateAdditionalConventionsSection(conventions);
  }
  async convertToolFilesToRulesyncFiles(toolFiles) {
    const toolRules = toolFiles.filter((file) => file instanceof ToolRule);
    const rulesyncRules = toolRules.map((toolRule) => {
      return toolRule.toRulesyncRule();
    });
    return rulesyncRules;
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync rule files from .rulesync/rules/ directory
   */
  async loadRulesyncFiles() {
    const rulesyncBaseDir = (0, import_node_path108.join)(this.baseDir, RULESYNC_RULES_RELATIVE_DIR_PATH);
    const files = await findFilesByGlobs((0, import_node_path108.join)(rulesyncBaseDir, "**", "*.md"));
    logger.debug(`Found ${files.length} rulesync files`);
    const rulesyncRules = await Promise.all(
      files.map((file) => {
        const relativeFilePath = (0, import_node_path108.relative)(rulesyncBaseDir, file);
        checkPathTraversal({ relativePath: relativeFilePath, intendedRootDir: rulesyncBaseDir });
        return RulesyncRule.fromFile({
          relativeFilePath
        });
      })
    );
    const rootRules = rulesyncRules.filter((rule) => rule.getFrontmatter().root);
    if (rootRules.length > 1) {
      throw new Error("Multiple root rulesync rules found");
    }
    if (rootRules.length === 0 && rulesyncRules.length > 0) {
      logger.warn(
        `No root rulesync rule file found. Consider adding 'root: true' to one of your rule files in ${RULESYNC_RULES_RELATIVE_DIR_PATH}.`
      );
    }
    const localRootRules = rulesyncRules.filter((rule) => rule.getFrontmatter().localRoot);
    if (localRootRules.length > 1) {
      throw new Error("Multiple localRoot rules found. Only one rule can have localRoot: true");
    }
    if (localRootRules.length > 0 && rootRules.length === 0) {
      throw new Error("localRoot: true requires a root: true rule to exist");
    }
    if (this.global) {
      const nonRootRules = rulesyncRules.filter((rule) => !rule.getFrontmatter().root);
      if (nonRootRules.length > 0) {
        logger.warn(
          `${nonRootRules.length} non-root rulesync rules found, but it's in global mode, so ignoring them`
        );
      }
      if (localRootRules.length > 0) {
        logger.warn(
          `${localRootRules.length} localRoot rules found, but localRoot is not supported in global mode, ignoring them`
        );
      }
      return rootRules;
    }
    return rulesyncRules;
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific rule configurations and parse them into ToolRule instances
   */
  async loadToolFiles({
    forDeletion = false
  } = {}) {
    try {
      const factory = this.getFactory(this.toolTarget);
      const settablePaths = factory.class.getSettablePaths({ global: this.global });
      const rootToolRules = await (async () => {
        if (!settablePaths.root) {
          return [];
        }
        const rootFilePaths = await findFilesByGlobs(
          (0, import_node_path108.join)(
            this.baseDir,
            settablePaths.root.relativeDirPath ?? ".",
            settablePaths.root.relativeFilePath
          )
        );
        if (forDeletion) {
          return rootFilePaths.map(
            (filePath) => factory.class.forDeletion({
              baseDir: this.baseDir,
              relativeDirPath: settablePaths.root?.relativeDirPath ?? ".",
              relativeFilePath: (0, import_node_path108.basename)(filePath),
              global: this.global
            })
          ).filter((rule) => rule.isDeletable());
        }
        return await Promise.all(
          rootFilePaths.map(
            (filePath) => factory.class.fromFile({
              baseDir: this.baseDir,
              relativeFilePath: (0, import_node_path108.basename)(filePath),
              global: this.global
            })
          )
        );
      })();
      logger.debug(`Found ${rootToolRules.length} root tool rule files`);
      const localRootToolRules = await (async () => {
        if (!forDeletion) {
          return [];
        }
        if (this.toolTarget !== "claudecode" && this.toolTarget !== "claudecode-legacy") {
          return [];
        }
        if (!settablePaths.root) {
          return [];
        }
        const localRootFilePaths = await findFilesByGlobs(
          (0, import_node_path108.join)(this.baseDir, settablePaths.root.relativeDirPath ?? ".", "CLAUDE.local.md")
        );
        return localRootFilePaths.map(
          (filePath) => factory.class.forDeletion({
            baseDir: this.baseDir,
            relativeDirPath: settablePaths.root?.relativeDirPath ?? ".",
            relativeFilePath: (0, import_node_path108.basename)(filePath),
            global: this.global
          })
        ).filter((rule) => rule.isDeletable());
      })();
      logger.debug(`Found ${localRootToolRules.length} local root tool rule files for deletion`);
      const nonRootToolRules = await (async () => {
        if (!settablePaths.nonRoot) {
          return [];
        }
        const nonRootBaseDir = (0, import_node_path108.join)(this.baseDir, settablePaths.nonRoot.relativeDirPath);
        const nonRootFilePaths = await findFilesByGlobs(
          (0, import_node_path108.join)(nonRootBaseDir, "**", `*.${factory.meta.extension}`)
        );
        if (forDeletion) {
          return nonRootFilePaths.map((filePath) => {
            const relativeFilePath = (0, import_node_path108.relative)(nonRootBaseDir, filePath);
            checkPathTraversal({
              relativePath: relativeFilePath,
              intendedRootDir: nonRootBaseDir
            });
            return factory.class.forDeletion({
              baseDir: this.baseDir,
              relativeDirPath: settablePaths.nonRoot?.relativeDirPath ?? ".",
              relativeFilePath,
              global: this.global
            });
          }).filter((rule) => rule.isDeletable());
        }
        return await Promise.all(
          nonRootFilePaths.map((filePath) => {
            const relativeFilePath = (0, import_node_path108.relative)(nonRootBaseDir, filePath);
            checkPathTraversal({ relativePath: relativeFilePath, intendedRootDir: nonRootBaseDir });
            return factory.class.fromFile({
              baseDir: this.baseDir,
              relativeFilePath,
              global: this.global
            });
          })
        );
      })();
      logger.debug(`Found ${nonRootToolRules.length} non-root tool rule files`);
      return [...rootToolRules, ...localRootToolRules, ...nonRootToolRules];
    } catch (error) {
      logger.error(`Failed to load tool files: ${formatError(error)}`);
      return [];
    }
  }
  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({ global = false } = {}) {
    if (global) {
      return rulesProcessorToolTargetsGlobal;
    }
    return rulesProcessorToolTargets;
  }
  /**
   * Get the factory for a specific tool target.
   * This is a static version of the internal getFactory for external use.
   * @param target - The tool target. Must be a valid RulesProcessorToolTarget.
   * @returns The factory for the target, or undefined if not found.
   */
  static getFactory(target) {
    const result = RulesProcessorToolTargetSchema.safeParse(target);
    if (!result.success) {
      return void 0;
    }
    return toolRuleFactories.get(result.data);
  }
  generateToonReferencesSection(toolRules) {
    const toolRulesWithoutRoot = toolRules.filter((rule) => !rule.isRoot());
    if (toolRulesWithoutRoot.length === 0) {
      return "";
    }
    const lines = [];
    lines.push(
      "Please also reference the following rules as needed. The list below is provided in TOON format, and `@` stands for the project root directory."
    );
    lines.push("");
    const rules = toolRulesWithoutRoot.map((toolRule) => {
      const rulesyncRule = toolRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();
      const rule = {
        path: `@${toolRule.getRelativePathFromCwd()}`
      };
      if (frontmatter.description) {
        rule.description = frontmatter.description;
      }
      if (frontmatter.globs && frontmatter.globs.length > 0) {
        rule.applyTo = frontmatter.globs;
      }
      return rule;
    });
    const toonContent = (0, import_toon.encode)({
      rules
    });
    lines.push(toonContent);
    return lines.join("\n") + "\n\n";
  }
  generateReferencesSection(toolRules) {
    const toolRulesWithoutRoot = toolRules.filter((rule) => !rule.isRoot());
    if (toolRulesWithoutRoot.length === 0) {
      return "";
    }
    const lines = [];
    lines.push("Please also reference the following rules as needed:");
    lines.push("");
    for (const toolRule of toolRulesWithoutRoot) {
      const escapedDescription = toolRule.getDescription()?.replace(/"/g, '\\"');
      const globsText = toolRule.getGlobs()?.join(",");
      lines.push(
        `@${toolRule.getRelativePathFromCwd()} description: "${escapedDescription}" applyTo: "${globsText}"`
      );
    }
    return lines.join("\n") + "\n\n";
  }
  generateAdditionalConventionsSection({
    commands,
    subagents,
    skills
  }) {
    const overview = `# Additional Conventions Beyond the Built-in Functions

As this project's AI coding tool, you must follow the additional conventions below, in addition to the built-in functions.`;
    const commandsSection = commands ? `## Simulated Custom Slash Commands

Custom slash commands allow you to define frequently-used prompts as Markdown files that you can execute.

### Syntax

Users can use following syntax to invoke a custom command.

\`\`\`txt
s/<command> [arguments]
\`\`\`

This syntax employs a double slash (\`s/\`) to prevent conflicts with built-in slash commands.
The \`s\` in \`s/\` stands for *simulate*. Because custom slash commands are not built-in, this syntax provides a pseudo way to invoke them.

When users call a custom slash command, you have to look for the markdown file, \`${(0, import_node_path108.join)(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "{command}.md")}\`, then execute the contents of that file as the block of operations.` : "";
    const subagentsSection = subagents ? `## Simulated Subagents

Simulated subagents are specialized AI assistants that can be invoked to handle specific types of tasks. In this case, it can be appear something like custom slash commands simply. Simulated subagents can be called by custom slash commands.

When users call a simulated subagent, it will look for the corresponding markdown file, \`${(0, import_node_path108.join)(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "{subagent}.md")}\`, and execute its contents as the block of operations.

For example, if the user instructs \`Call planner subagent to plan the refactoring\`, you have to look for the markdown file, \`${(0, import_node_path108.join)(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md")}\`, and execute its contents as the block of operations.` : "";
    const skillsSection = skills ? this.generateSkillsSection(skills) : "";
    const result = [
      overview,
      ...this.simulateCommands && CommandsProcessor.getToolTargetsSimulated().includes(this.toolTarget) ? [commandsSection] : [],
      ...this.simulateSubagents && SubagentsProcessor.getToolTargetsSimulated().includes(this.toolTarget) ? [subagentsSection] : [],
      ...this.simulateSkills && SkillsProcessor.getToolTargetsSimulated().includes(this.toolTarget) ? [skillsSection] : []
    ].join("\n\n") + "\n\n";
    return result;
  }
  generateSkillsSection(skills) {
    if (!skills.skillList || skills.skillList.length === 0) {
      return "";
    }
    const skillListWithAtPrefix = skills.skillList.map((skill) => ({
      ...skill,
      path: `@${skill.path}`
    }));
    const toonContent = (0, import_toon.encode)({ skillList: skillListWithAtPrefix });
    return `## Simulated Skills

Simulated skills are specialized capabilities that can be invoked to handle specific types of tasks. When you determine that a skill would be helpful for the current task, read the corresponding SKILL.md file and execute its instructions.

${toonContent}`;
  }
};

// src/lib/github-client.ts
var import_request_error = require("@octokit/request-error");
var import_rest = require("@octokit/rest");

// src/types/fetch.ts
var import_mini50 = require("zod/mini");

// src/types/fetch-targets.ts
var import_mini49 = require("zod/mini");
var ALL_FETCH_TARGETS = ["rulesync", ...ALL_TOOL_TARGETS];
var FetchTargetSchema = import_mini49.z.enum(ALL_FETCH_TARGETS);

// src/types/fetch.ts
var ConflictStrategySchema = import_mini50.z.enum(["skip", "overwrite"]);
var GitHubFileTypeSchema = import_mini50.z.enum(["file", "dir", "symlink", "submodule"]);
var GitHubFileEntrySchema = import_mini50.z.looseObject({
  name: import_mini50.z.string(),
  path: import_mini50.z.string(),
  sha: import_mini50.z.string(),
  size: import_mini50.z.number(),
  type: GitHubFileTypeSchema,
  download_url: import_mini50.z.nullable(import_mini50.z.string())
});
var FetchOptionsSchema = import_mini50.z.looseObject({
  target: import_mini50.z.optional(FetchTargetSchema),
  features: import_mini50.z.optional(import_mini50.z.array(import_mini50.z.enum(ALL_FEATURES_WITH_WILDCARD))),
  ref: import_mini50.z.optional(import_mini50.z.string()),
  path: import_mini50.z.optional(import_mini50.z.string()),
  output: import_mini50.z.optional(import_mini50.z.string()),
  conflict: import_mini50.z.optional(ConflictStrategySchema),
  token: import_mini50.z.optional(import_mini50.z.string()),
  verbose: import_mini50.z.optional(import_mini50.z.boolean()),
  silent: import_mini50.z.optional(import_mini50.z.boolean())
});
var FetchFileStatusSchema = import_mini50.z.enum(["created", "overwritten", "skipped"]);
var GitHubRepoInfoSchema = import_mini50.z.looseObject({
  default_branch: import_mini50.z.string(),
  private: import_mini50.z.boolean()
});
var GitHubReleaseAssetSchema = import_mini50.z.looseObject({
  name: import_mini50.z.string(),
  browser_download_url: import_mini50.z.string(),
  size: import_mini50.z.number()
});
var GitHubReleaseSchema = import_mini50.z.looseObject({
  tag_name: import_mini50.z.string(),
  name: import_mini50.z.nullable(import_mini50.z.string()),
  prerelease: import_mini50.z.boolean(),
  draft: import_mini50.z.boolean(),
  assets: import_mini50.z.array(GitHubReleaseAssetSchema)
});

// src/lib/github-client.ts
var GitHubClientError = class extends Error {
  constructor(message, statusCode, apiError) {
    super(message);
    this.statusCode = statusCode;
    this.apiError = apiError;
    this.name = "GitHubClientError";
  }
};
function logGitHubAuthHints(error) {
  logger.error(`GitHub API Error: ${error.message}`);
  if (error.statusCode === 401 || error.statusCode === 403) {
    logger.info(
      "Tip: Set GITHUB_TOKEN or GH_TOKEN environment variable for private repositories or better rate limits."
    );
    logger.info(
      "Tip: If you use GitHub CLI, you can use `GITHUB_TOKEN=$(gh auth token) rulesync fetch ...`"
    );
  }
}
var GitHubClient = class {
  octokit;
  hasToken;
  constructor(config = {}) {
    if (config.baseUrl && !config.baseUrl.startsWith("https://")) {
      throw new GitHubClientError("GitHub API base URL must use HTTPS");
    }
    this.hasToken = !!config.token;
    this.octokit = new import_rest.Octokit({
      auth: config.token,
      baseUrl: config.baseUrl
    });
  }
  /**
   * Get authentication token from various sources
   */
  static resolveToken(explicitToken) {
    if (explicitToken) {
      return explicitToken;
    }
    return process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  }
  /**
   * Get the default branch of a repository
   */
  async getDefaultBranch(owner, repo) {
    const repoInfo = await this.getRepoInfo(owner, repo);
    return repoInfo.default_branch;
  }
  /**
   * Get repository information
   */
  async getRepoInfo(owner, repo) {
    try {
      const { data } = await this.octokit.repos.get({ owner, repo });
      const parsed = GitHubRepoInfoSchema.safeParse(data);
      if (!parsed.success) {
        throw new GitHubClientError(
          `Invalid repository info response: ${formatError(parsed.error)}`
        );
      }
      return parsed.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }
  /**
   * List contents of a directory in a repository
   */
  async listDirectory(owner, repo, path4, ref) {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: path4,
        ref
      });
      if (!Array.isArray(data)) {
        throw new GitHubClientError(`Path "${path4}" is not a directory`);
      }
      const entries = [];
      for (const item of data) {
        const parsed = GitHubFileEntrySchema.safeParse(item);
        if (parsed.success) {
          entries.push(parsed.data);
        }
      }
      return entries;
    } catch (error) {
      throw this.handleError(error);
    }
  }
  /**
   * Get raw file content from a repository
   */
  async getFileContent(owner, repo, path4, ref) {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: path4,
        ref,
        mediaType: {
          format: "raw"
        }
      });
      if (typeof data === "string") {
        return data;
      }
      if (!Array.isArray(data) && "content" in data && data.content) {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      throw new GitHubClientError(`Unexpected response format for file content`);
    } catch (error) {
      throw this.handleError(error);
    }
  }
  /**
   * Check if a file exists and is within size limits
   */
  async getFileInfo(owner, repo, path4, ref) {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: path4,
        ref
      });
      if (Array.isArray(data)) {
        return null;
      }
      const parsed = GitHubFileEntrySchema.safeParse(data);
      if (!parsed.success) {
        return null;
      }
      if (parsed.data.size > MAX_FILE_SIZE) {
        throw new GitHubClientError(
          `File "${path4}" exceeds maximum size limit of ${MAX_FILE_SIZE / 1024 / 1024}MB`
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof import_request_error.RequestError && error.status === 404) {
        return null;
      }
      if (error instanceof GitHubClientError && error.statusCode === 404) {
        return null;
      }
      throw this.handleError(error);
    }
  }
  /**
   * Validate that a repository exists and is accessible
   */
  async validateRepository(owner, repo) {
    try {
      await this.getRepoInfo(owner, repo);
      return true;
    } catch (error) {
      if (error instanceof GitHubClientError && error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }
  /**
   * Resolve a ref (branch, tag, or SHA) to a full commit SHA.
   */
  async resolveRefToSha(owner, repo, ref) {
    try {
      const { data } = await this.octokit.repos.getCommit({
        owner,
        repo,
        ref
      });
      return data.sha;
    } catch (error) {
      throw this.handleError(error);
    }
  }
  /**
   * Get the latest release from a repository
   */
  async getLatestRelease(owner, repo) {
    try {
      const { data } = await this.octokit.repos.getLatestRelease({ owner, repo });
      const parsed = GitHubReleaseSchema.safeParse(data);
      if (!parsed.success) {
        throw new GitHubClientError(`Invalid release info response: ${formatError(parsed.error)}`);
      }
      return parsed.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }
  /**
   * Handle errors from Octokit and convert to GitHubClientError
   */
  handleError(error) {
    if (error instanceof GitHubClientError) {
      return error;
    }
    if (error instanceof import_request_error.RequestError) {
      const responseData = error.response?.data;
      const message = this.extractErrorMessage(responseData, error.message);
      const apiError = message ? { message } : void 0;
      const errorMessage = this.getErrorMessage(error.status, apiError);
      return new GitHubClientError(errorMessage, error.status, apiError);
    }
    if (error instanceof Error) {
      return new GitHubClientError(error.message);
    }
    return new GitHubClientError("Unknown error occurred");
  }
  /**
   * Extract error message from response data
   */
  extractErrorMessage(data, fallback) {
    if (typeof data === "object" && data !== null && "message" in data) {
      const record = data;
      const msg = record["message"];
      if (typeof msg === "string") {
        return msg;
      }
    }
    return fallback;
  }
  /**
   * Get human-readable error message for HTTP status codes
   */
  getErrorMessage(statusCode, apiError) {
    const baseMessage = apiError?.message ?? `HTTP ${statusCode}`;
    switch (statusCode) {
      case 401:
        return `Authentication failed: ${baseMessage}. Check your GitHub token.`;
      case 403:
        if (baseMessage.toLowerCase().includes("rate limit")) {
          return `GitHub API rate limit exceeded. ${this.hasToken ? "Try again later." : "Consider using a GitHub token."}`;
        }
        return `Access forbidden: ${baseMessage}. Check repository permissions.`;
      case 404:
        return `Not found: ${baseMessage}`;
      case 422:
        return `Invalid request: ${baseMessage}`;
      default:
        return `GitHub API error: ${baseMessage}`;
    }
  }
};

// src/lib/github-utils.ts
var MAX_RECURSION_DEPTH = 15;
async function withSemaphore(semaphore, fn) {
  await semaphore.acquire();
  try {
    return await fn();
  } finally {
    semaphore.release();
  }
}
async function listDirectoryRecursive(params) {
  const { client, owner, repo, path: path4, ref, depth = 0, semaphore } = params;
  if (depth > MAX_RECURSION_DEPTH) {
    throw new Error(
      `Maximum recursion depth (${MAX_RECURSION_DEPTH}) exceeded while listing directory: ${path4}`
    );
  }
  const entries = await withSemaphore(
    semaphore,
    () => client.listDirectory(owner, repo, path4, ref)
  );
  const files = [];
  const directories = [];
  for (const entry of entries) {
    if (entry.type === "file") {
      files.push(entry);
    } else if (entry.type === "dir") {
      directories.push(entry);
    }
  }
  const subResults = await Promise.all(
    directories.map(
      (dir) => listDirectoryRecursive({
        client,
        owner,
        repo,
        path: dir.path,
        ref,
        depth: depth + 1,
        semaphore
      })
    )
  );
  return [...files, ...subResults.flat()];
}

// src/types/git-provider.ts
var import_mini51 = require("zod/mini");
var ALL_GIT_PROVIDERS = ["github", "gitlab"];
var GitProviderSchema = import_mini51.z.enum(ALL_GIT_PROVIDERS);

// src/lib/source-parser.ts
var GITHUB_HOSTS = /* @__PURE__ */ new Set(["github.com", "www.github.com"]);
var GITLAB_HOSTS = /* @__PURE__ */ new Set(["gitlab.com", "www.gitlab.com"]);
function parseSource(source) {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return parseUrl(source);
  }
  if (source.includes(":") && !source.includes("://")) {
    const colonIndex = source.indexOf(":");
    const prefix = source.substring(0, colonIndex);
    const rest = source.substring(colonIndex + 1);
    const provider = ALL_GIT_PROVIDERS.find((p) => p === prefix);
    if (provider) {
      return { provider, ...parseShorthand(rest) };
    }
    return { provider: "github", ...parseShorthand(source) };
  }
  return { provider: "github", ...parseShorthand(source) };
}
function parseUrl(url) {
  const urlObj = new URL(url);
  const host = urlObj.hostname.toLowerCase();
  let provider;
  if (GITHUB_HOSTS.has(host)) {
    provider = "github";
  } else if (GITLAB_HOSTS.has(host)) {
    provider = "gitlab";
  } else {
    throw new Error(
      `Unknown Git provider for host: ${host}. Supported providers: ${ALL_GIT_PROVIDERS.join(", ")}`
    );
  }
  const segments = urlObj.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new Error(`Invalid ${provider} URL: ${url}. Expected format: https://${host}/owner/repo`);
  }
  const owner = segments[0];
  const repo = segments[1]?.replace(/\.git$/, "");
  if (segments.length > 2 && (segments[2] === "tree" || segments[2] === "blob")) {
    const ref = segments[3];
    const path4 = segments.length > 4 ? segments.slice(4).join("/") : void 0;
    return {
      provider,
      owner: owner ?? "",
      repo: repo ?? "",
      ref,
      path: path4
    };
  }
  return {
    provider,
    owner: owner ?? "",
    repo: repo ?? ""
  };
}
function parseShorthand(source) {
  let remaining = source;
  let path4;
  let ref;
  const colonIndex = remaining.indexOf(":");
  if (colonIndex !== -1) {
    path4 = remaining.substring(colonIndex + 1);
    if (!path4) {
      throw new Error(`Invalid source: ${source}. Path cannot be empty after ":".`);
    }
    remaining = remaining.substring(0, colonIndex);
  }
  const atIndex = remaining.indexOf("@");
  if (atIndex !== -1) {
    ref = remaining.substring(atIndex + 1);
    if (!ref) {
      throw new Error(`Invalid source: ${source}. Ref cannot be empty after "@".`);
    }
    remaining = remaining.substring(0, atIndex);
  }
  const slashIndex = remaining.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `Invalid source: ${source}. Expected format: owner/repo, owner/repo@ref, or owner/repo:path`
    );
  }
  const owner = remaining.substring(0, slashIndex);
  const repo = remaining.substring(slashIndex + 1);
  if (!owner || !repo) {
    throw new Error(`Invalid source: ${source}. Both owner and repo are required.`);
  }
  return {
    owner,
    repo,
    ref,
    path: path4
  };
}

// src/lib/fetch.ts
var FEATURE_PATHS = {
  rules: ["rules"],
  commands: ["commands"],
  subagents: ["subagents"],
  skills: ["skills"],
  ignore: [RULESYNC_AIIGNORE_FILE_NAME],
  mcp: [RULESYNC_MCP_FILE_NAME],
  hooks: [RULESYNC_HOOKS_FILE_NAME]
};
function isToolTarget(target) {
  return target !== "rulesync";
}
function validateFileSize(relativePath, size) {
  if (size > MAX_FILE_SIZE) {
    throw new GitHubClientError(
      `File "${relativePath}" exceeds maximum size limit (${(size / 1024 / 1024).toFixed(2)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB)`
    );
  }
}
async function processFeatureConversion(params) {
  const { processor, outputDir } = params;
  const paths = [];
  const toolFiles = await processor.loadToolFiles();
  if (toolFiles.length === 0) {
    return { paths: [] };
  }
  const rulesyncFiles = await processor.convertToolFilesToRulesyncFiles(toolFiles);
  for (const file of rulesyncFiles) {
    const relativePath = (0, import_node_path109.join)(file.getRelativeDirPath(), file.getRelativeFilePath());
    const outputPath = (0, import_node_path109.join)(outputDir, relativePath);
    await writeFileContent(outputPath, file.getFileContent());
    paths.push(relativePath);
  }
  return { paths };
}
async function convertFetchedFilesToRulesync(params) {
  const { tempDir, outputDir, target, features } = params;
  const convertedPaths = [];
  const featureConfigs = [
    {
      feature: "rules",
      getTargets: () => RulesProcessor.getToolTargets({ global: false }),
      createProcessor: () => new RulesProcessor({ baseDir: tempDir, toolTarget: target, global: false })
    },
    {
      feature: "commands",
      getTargets: () => CommandsProcessor.getToolTargets({ global: false, includeSimulated: false }),
      createProcessor: () => new CommandsProcessor({ baseDir: tempDir, toolTarget: target, global: false })
    },
    {
      feature: "subagents",
      getTargets: () => SubagentsProcessor.getToolTargets({ global: false, includeSimulated: false }),
      createProcessor: () => new SubagentsProcessor({ baseDir: tempDir, toolTarget: target, global: false })
    },
    {
      feature: "ignore",
      getTargets: () => IgnoreProcessor.getToolTargets(),
      createProcessor: () => new IgnoreProcessor({ baseDir: tempDir, toolTarget: target })
    },
    {
      feature: "mcp",
      getTargets: () => McpProcessor.getToolTargets({ global: false }),
      createProcessor: () => new McpProcessor({ baseDir: tempDir, toolTarget: target, global: false })
    },
    {
      feature: "hooks",
      getTargets: () => HooksProcessor.getToolTargets({ global: false }),
      createProcessor: () => new HooksProcessor({ baseDir: tempDir, toolTarget: target, global: false })
    }
  ];
  for (const config of featureConfigs) {
    if (!features.includes(config.feature)) {
      continue;
    }
    const supportedTargets = config.getTargets();
    if (!supportedTargets.includes(target)) {
      continue;
    }
    const processor = config.createProcessor();
    const result = await processFeatureConversion({ processor, outputDir });
    convertedPaths.push(...result.paths);
  }
  if (features.includes("skills")) {
    logger.debug(
      "Skills conversion is not yet supported in fetch command. Use import command instead."
    );
  }
  return { converted: convertedPaths.length, convertedPaths };
}
function resolveFeatures(features) {
  if (!features || features.length === 0 || features.includes("*")) {
    return [...ALL_FEATURES];
  }
  return features.filter((f) => ALL_FEATURES.includes(f));
}
function hasStatusCode(error) {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return false;
  }
  const maybeStatus = Object.getOwnPropertyDescriptor(error, "statusCode")?.value;
  return typeof maybeStatus === "number";
}
function isNotFoundError(error) {
  if (error instanceof GitHubClientError && error.statusCode === 404) {
    return true;
  }
  if (hasStatusCode(error) && error.statusCode === 404) {
    return true;
  }
  return false;
}
async function fetchFiles(params) {
  const { source, options = {}, baseDir = process.cwd() } = params;
  const parsed = parseSource(source);
  if (parsed.provider === "gitlab") {
    throw new Error(
      "GitLab is not yet supported. Currently only GitHub repositories are supported."
    );
  }
  const resolvedRef = options.ref ?? parsed.ref;
  const resolvedPath = options.path ?? parsed.path ?? ".";
  const outputDir = options.output ?? RULESYNC_RELATIVE_DIR_PATH;
  const conflictStrategy = options.conflict ?? "overwrite";
  const enabledFeatures = resolveFeatures(options.features);
  const target = options.target ?? "rulesync";
  checkPathTraversal({
    relativePath: outputDir,
    intendedRootDir: baseDir
  });
  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });
  logger.debug(`Validating repository: ${parsed.owner}/${parsed.repo}`);
  const isValid = await client.validateRepository(parsed.owner, parsed.repo);
  if (!isValid) {
    throw new GitHubClientError(
      `Repository not found: ${parsed.owner}/${parsed.repo}. Check the repository name and your access permissions.`,
      404
    );
  }
  const ref = resolvedRef ?? await client.getDefaultBranch(parsed.owner, parsed.repo);
  logger.debug(`Using ref: ${ref}`);
  if (isToolTarget(target)) {
    return fetchAndConvertToolFiles({
      client,
      parsed,
      ref,
      resolvedPath,
      enabledFeatures,
      target,
      outputDir,
      baseDir,
      conflictStrategy
    });
  }
  const semaphore = new import_promise.Semaphore(FETCH_CONCURRENCY_LIMIT);
  const filesToFetch = await collectFeatureFiles({
    client,
    owner: parsed.owner,
    repo: parsed.repo,
    basePath: resolvedPath,
    ref,
    enabledFeatures,
    semaphore
  });
  if (filesToFetch.length === 0) {
    logger.warn(`No files found matching enabled features: ${enabledFeatures.join(", ")}`);
    return {
      source: `${parsed.owner}/${parsed.repo}`,
      ref,
      files: [],
      created: 0,
      overwritten: 0,
      skipped: 0
    };
  }
  const outputBasePath = (0, import_node_path109.join)(baseDir, outputDir);
  for (const { relativePath, size } of filesToFetch) {
    checkPathTraversal({
      relativePath,
      intendedRootDir: outputBasePath
    });
    validateFileSize(relativePath, size);
  }
  const results = await Promise.all(
    filesToFetch.map(async ({ remotePath, relativePath }) => {
      const localPath = (0, import_node_path109.join)(outputBasePath, relativePath);
      const exists = await fileExists(localPath);
      if (exists && conflictStrategy === "skip") {
        logger.debug(`Skipping existing file: ${relativePath}`);
        return { relativePath, status: "skipped" };
      }
      const content = await withSemaphore(
        semaphore,
        () => client.getFileContent(parsed.owner, parsed.repo, remotePath, ref)
      );
      await writeFileContent(localPath, content);
      const status = exists ? "overwritten" : "created";
      logger.debug(`Wrote: ${relativePath} (${status})`);
      return { relativePath, status };
    })
  );
  const summary = {
    source: `${parsed.owner}/${parsed.repo}`,
    ref,
    files: results,
    created: results.filter((r) => r.status === "created").length,
    overwritten: results.filter((r) => r.status === "overwritten").length,
    skipped: results.filter((r) => r.status === "skipped").length
  };
  return summary;
}
async function collectFeatureFiles(params) {
  const { client, owner, repo, basePath, ref, enabledFeatures, semaphore } = params;
  const dirCache = /* @__PURE__ */ new Map();
  async function getCachedDirectory(path4) {
    let promise = dirCache.get(path4);
    if (promise === void 0) {
      promise = withSemaphore(semaphore, () => client.listDirectory(owner, repo, path4, ref));
      dirCache.set(path4, promise);
    }
    return promise;
  }
  const tasks = enabledFeatures.flatMap(
    (feature) => FEATURE_PATHS[feature].map((featurePath) => ({ feature, featurePath }))
  );
  const results = await Promise.all(
    tasks.map(async ({ featurePath }) => {
      const fullPath = basePath === "." || basePath === "" ? featurePath : (0, import_node_path109.join)(basePath, featurePath);
      const collected = [];
      try {
        if (featurePath.includes(".")) {
          try {
            const entries = await getCachedDirectory(
              basePath === "." || basePath === "" ? "." : basePath
            );
            const fileEntry = entries.find((e) => e.name === featurePath && e.type === "file");
            if (fileEntry) {
              collected.push({
                remotePath: fileEntry.path,
                relativePath: featurePath,
                size: fileEntry.size
              });
            }
          } catch (error) {
            if (isNotFoundError(error)) {
              logger.debug(`File not found: ${fullPath}`);
            } else {
              throw error;
            }
          }
        } else {
          const dirFiles = await listDirectoryRecursive({
            client,
            owner,
            repo,
            path: fullPath,
            ref,
            semaphore
          });
          for (const file of dirFiles) {
            const relativePath = basePath === "." || basePath === "" ? file.path : file.path.substring(basePath.length + 1);
            collected.push({
              remotePath: file.path,
              relativePath,
              size: file.size
            });
          }
        }
      } catch (error) {
        if (isNotFoundError(error)) {
          logger.debug(`Feature not found: ${fullPath}`);
          return collected;
        }
        throw error;
      }
      return collected;
    })
  );
  return results.flat();
}
async function fetchAndConvertToolFiles(params) {
  const {
    client,
    parsed,
    ref,
    resolvedPath,
    enabledFeatures,
    target,
    outputDir,
    baseDir,
    conflictStrategy: _conflictStrategy
  } = params;
  const tempDir = await createTempDirectory();
  logger.debug(`Created temp directory: ${tempDir}`);
  const semaphore = new import_promise.Semaphore(FETCH_CONCURRENCY_LIMIT);
  try {
    const filesToFetch = await collectFeatureFiles({
      client,
      owner: parsed.owner,
      repo: parsed.repo,
      basePath: resolvedPath,
      ref,
      enabledFeatures,
      semaphore
    });
    if (filesToFetch.length === 0) {
      logger.warn(`No files found matching enabled features: ${enabledFeatures.join(", ")}`);
      return {
        source: `${parsed.owner}/${parsed.repo}`,
        ref,
        files: [],
        created: 0,
        overwritten: 0,
        skipped: 0
      };
    }
    for (const { relativePath, size } of filesToFetch) {
      validateFileSize(relativePath, size);
    }
    const toolPaths = getToolPathMapping(target);
    await Promise.all(
      filesToFetch.map(async ({ remotePath, relativePath }) => {
        const toolRelativePath = mapToToolPath(relativePath, toolPaths);
        checkPathTraversal({
          relativePath: toolRelativePath,
          intendedRootDir: tempDir
        });
        const localPath = (0, import_node_path109.join)(tempDir, toolRelativePath);
        const content = await withSemaphore(
          semaphore,
          () => client.getFileContent(parsed.owner, parsed.repo, remotePath, ref)
        );
        await writeFileContent(localPath, content);
        logger.debug(`Fetched to temp: ${toolRelativePath}`);
      })
    );
    const outputBasePath = (0, import_node_path109.join)(baseDir, outputDir);
    const { converted, convertedPaths } = await convertFetchedFilesToRulesync({
      tempDir,
      outputDir: outputBasePath,
      target,
      features: enabledFeatures
    });
    const results = convertedPaths.map((relativePath) => ({
      relativePath,
      status: "created"
    }));
    logger.debug(`Converted ${converted} files from ${target} format to rulesync format`);
    return {
      source: `${parsed.owner}/${parsed.repo}`,
      ref,
      files: results,
      created: results.filter((r) => r.status === "created").length,
      overwritten: results.filter((r) => r.status === "overwritten").length,
      skipped: results.filter((r) => r.status === "skipped").length
    };
  } finally {
    await removeTempDirectory(tempDir);
  }
}
function getToolPathMapping(target) {
  const mapping = {};
  const supportedRulesTargets = RulesProcessor.getToolTargets({ global: false });
  if (supportedRulesTargets.includes(target)) {
    const factory = RulesProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.rules = {
        root: paths.root?.relativeFilePath,
        nonRoot: paths.nonRoot?.relativeDirPath
      };
    }
  }
  const supportedCommandsTargets = CommandsProcessor.getToolTargets({
    global: false,
    includeSimulated: false
  });
  if (supportedCommandsTargets.includes(target)) {
    const factory = CommandsProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.commands = paths.relativeDirPath;
    }
  }
  const supportedSubagentsTargets = SubagentsProcessor.getToolTargets({
    global: false,
    includeSimulated: false
  });
  if (supportedSubagentsTargets.includes(target)) {
    const factory = SubagentsProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.subagents = paths.relativeDirPath;
    }
  }
  const supportedSkillsTargets = SkillsProcessor.getToolTargets({ global: false });
  if (supportedSkillsTargets.includes(target)) {
    const factory = SkillsProcessor.getFactory(target);
    if (factory) {
      const paths = factory.class.getSettablePaths({ global: false });
      mapping.skills = paths.relativeDirPath;
    }
  }
  return mapping;
}
function mapToToolPath(relativePath, toolPaths) {
  if (relativePath.startsWith("rules/")) {
    const restPath = relativePath.substring("rules/".length);
    if (toolPaths.rules?.nonRoot) {
      return (0, import_node_path109.join)(toolPaths.rules.nonRoot, restPath);
    }
  }
  if (toolPaths.rules?.root && relativePath === toolPaths.rules.root) {
    return relativePath;
  }
  if (relativePath.startsWith("commands/")) {
    const restPath = relativePath.substring("commands/".length);
    if (toolPaths.commands) {
      return (0, import_node_path109.join)(toolPaths.commands, restPath);
    }
  }
  if (relativePath.startsWith("subagents/")) {
    const restPath = relativePath.substring("subagents/".length);
    if (toolPaths.subagents) {
      return (0, import_node_path109.join)(toolPaths.subagents, restPath);
    }
  }
  if (relativePath.startsWith("skills/")) {
    const restPath = relativePath.substring("skills/".length);
    if (toolPaths.skills) {
      return (0, import_node_path109.join)(toolPaths.skills, restPath);
    }
  }
  return relativePath;
}
function formatFetchSummary(summary) {
  const lines = [];
  lines.push(`Fetched from ${summary.source}@${summary.ref}:`);
  for (const file of summary.files) {
    const icon = file.status === "skipped" ? "-" : "\u2713";
    const statusText = file.status === "created" ? "(created)" : file.status === "overwritten" ? "(overwritten)" : "(skipped - already exists)";
    lines.push(`  ${icon} ${file.relativePath} ${statusText}`);
  }
  const parts = [];
  if (summary.created > 0) parts.push(`${summary.created} created`);
  if (summary.overwritten > 0) parts.push(`${summary.overwritten} overwritten`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  lines.push("");
  const summaryText = parts.length > 0 ? parts.join(", ") : "no files";
  lines.push(`Summary: ${summaryText}`);
  return lines.join("\n");
}

// src/cli/commands/fetch.ts
async function fetchCommand(options) {
  const { source, ...fetchOptions } = options;
  logger.configure({
    verbose: fetchOptions.verbose ?? false,
    silent: fetchOptions.silent ?? false
  });
  logger.debug(`Fetching files from ${source}...`);
  try {
    const summary = await fetchFiles({
      source,
      options: fetchOptions
    });
    const output = formatFetchSummary(summary);
    logger.success(output);
    if (summary.created + summary.overwritten === 0 && summary.skipped === 0) {
      logger.warn("No files were fetched.");
    }
  } catch (error) {
    if (error instanceof GitHubClientError) {
      logGitHubAuthHints(error);
    } else {
      logger.error(formatError(error));
    }
    process.exit(1);
  }
}

// src/config/config-resolver.ts
var import_jsonc_parser = require("jsonc-parser");
var import_node_path110 = require("path");

// src/config/config.ts
var import_mini52 = require("zod/mini");
var SourceEntrySchema = import_mini52.z.object({
  source: import_mini52.z.string().check((0, import_mini52.minLength)(1, "source must be a non-empty string")),
  skills: (0, import_mini52.optional)(import_mini52.z.array(import_mini52.z.string()))
});
var ConfigParamsSchema = import_mini52.z.object({
  baseDirs: import_mini52.z.array(import_mini52.z.string()),
  targets: RulesyncTargetsSchema,
  features: RulesyncFeaturesSchema,
  verbose: import_mini52.z.boolean(),
  delete: import_mini52.z.boolean(),
  // New non-experimental options
  global: (0, import_mini52.optional)(import_mini52.z.boolean()),
  silent: (0, import_mini52.optional)(import_mini52.z.boolean()),
  simulateCommands: (0, import_mini52.optional)(import_mini52.z.boolean()),
  simulateSubagents: (0, import_mini52.optional)(import_mini52.z.boolean()),
  simulateSkills: (0, import_mini52.optional)(import_mini52.z.boolean()),
  dryRun: (0, import_mini52.optional)(import_mini52.z.boolean()),
  check: (0, import_mini52.optional)(import_mini52.z.boolean()),
  // Declarative skill sources
  sources: (0, import_mini52.optional)(import_mini52.z.array(SourceEntrySchema))
});
var PartialConfigParamsSchema = import_mini52.z.partial(ConfigParamsSchema);
var ConfigFileSchema = import_mini52.z.object({
  $schema: (0, import_mini52.optional)(import_mini52.z.string()),
  ...import_mini52.z.partial(ConfigParamsSchema).shape
});
var RequiredConfigParamsSchema = import_mini52.z.required(ConfigParamsSchema);
var CONFLICTING_TARGET_PAIRS = [
  ["augmentcode", "augmentcode-legacy"],
  ["claudecode", "claudecode-legacy"]
];
var LEGACY_TARGETS = ["augmentcode-legacy", "claudecode-legacy"];
var Config = class {
  baseDirs;
  targets;
  features;
  verbose;
  delete;
  global;
  silent;
  simulateCommands;
  simulateSubagents;
  simulateSkills;
  dryRun;
  check;
  sources;
  constructor({
    baseDirs,
    targets,
    features,
    verbose,
    delete: isDelete,
    global,
    silent,
    simulateCommands,
    simulateSubagents,
    simulateSkills,
    dryRun,
    check,
    sources
  }) {
    this.validateConflictingTargets(targets);
    if (dryRun && check) {
      throw new Error("--dry-run and --check cannot be used together");
    }
    this.baseDirs = baseDirs;
    this.targets = targets;
    this.features = features;
    this.verbose = verbose;
    this.delete = isDelete;
    this.global = global ?? false;
    this.silent = silent ?? false;
    this.simulateCommands = simulateCommands ?? false;
    this.simulateSubagents = simulateSubagents ?? false;
    this.simulateSkills = simulateSkills ?? false;
    this.dryRun = dryRun ?? false;
    this.check = check ?? false;
    this.sources = sources ?? [];
  }
  validateConflictingTargets(targets) {
    for (const [target1, target2] of CONFLICTING_TARGET_PAIRS) {
      const hasTarget1 = targets.includes(target1);
      const hasTarget2 = targets.includes(target2);
      if (hasTarget1 && hasTarget2) {
        throw new Error(
          `Conflicting targets: '${target1}' and '${target2}' cannot be used together. Please choose one.`
        );
      }
    }
  }
  getBaseDirs() {
    return this.baseDirs;
  }
  getTargets() {
    if (this.targets.includes("*")) {
      return ALL_TOOL_TARGETS.filter(
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        (target) => !LEGACY_TARGETS.includes(target)
      );
    }
    return this.targets.filter((target) => target !== "*");
  }
  getFeatures(target) {
    if (!Array.isArray(this.features)) {
      const perTargetFeatures = this.features;
      if (target) {
        const targetFeatures = perTargetFeatures[target];
        if (!targetFeatures || targetFeatures.length === 0) {
          return [];
        }
        if (targetFeatures.includes("*")) {
          return [...ALL_FEATURES];
        }
        return targetFeatures.filter((feature) => feature !== "*");
      }
      const allFeatures = [];
      for (const features of Object.values(perTargetFeatures)) {
        if (features && features.length > 0) {
          if (features.includes("*")) {
            return [...ALL_FEATURES];
          }
          for (const feature of features) {
            if (feature !== "*" && !allFeatures.includes(feature)) {
              allFeatures.push(feature);
            }
          }
        }
      }
      return allFeatures;
    }
    if (this.features.includes("*")) {
      return [...ALL_FEATURES];
    }
    return this.features.filter((feature) => feature !== "*");
  }
  /**
   * Check if per-target features configuration is being used.
   */
  hasPerTargetFeatures() {
    return !Array.isArray(this.features);
  }
  getVerbose() {
    return this.verbose;
  }
  getDelete() {
    return this.delete;
  }
  getGlobal() {
    return this.global;
  }
  getSilent() {
    return this.silent;
  }
  getSimulateCommands() {
    return this.simulateCommands;
  }
  getSimulateSubagents() {
    return this.simulateSubagents;
  }
  getSimulateSkills() {
    return this.simulateSkills;
  }
  getDryRun() {
    return this.dryRun;
  }
  getCheck() {
    return this.check;
  }
  getSources() {
    return this.sources;
  }
  /**
   * Returns true if either dry-run or check mode is enabled.
   * In both modes, no files should be written.
   */
  isPreviewMode() {
    return this.dryRun || this.check;
  }
};

// src/config/config-resolver.ts
var getDefaults = () => ({
  targets: ["agentsmd"],
  features: ["rules"],
  verbose: false,
  delete: false,
  baseDirs: [process.cwd()],
  configPath: RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  global: false,
  silent: false,
  simulateCommands: false,
  simulateSubagents: false,
  simulateSkills: false,
  dryRun: false,
  check: false,
  sources: []
});
var loadConfigFromFile = async (filePath) => {
  if (!await fileExists(filePath)) {
    return {};
  }
  try {
    const fileContent = await readFileContent(filePath);
    const jsonData = (0, import_jsonc_parser.parse)(fileContent);
    const parsed = ConfigFileSchema.parse(jsonData);
    const { $schema: _schema, ...configParams } = parsed;
    return configParams;
  } catch (error) {
    logger.error(`Failed to load config file "${filePath}": ${formatError(error)}`);
    throw error;
  }
};
var mergeConfigs = (baseConfig, localConfig) => {
  return {
    targets: localConfig.targets ?? baseConfig.targets,
    features: localConfig.features ?? baseConfig.features,
    verbose: localConfig.verbose ?? baseConfig.verbose,
    delete: localConfig.delete ?? baseConfig.delete,
    baseDirs: localConfig.baseDirs ?? baseConfig.baseDirs,
    global: localConfig.global ?? baseConfig.global,
    silent: localConfig.silent ?? baseConfig.silent,
    simulateCommands: localConfig.simulateCommands ?? baseConfig.simulateCommands,
    simulateSubagents: localConfig.simulateSubagents ?? baseConfig.simulateSubagents,
    simulateSkills: localConfig.simulateSkills ?? baseConfig.simulateSkills,
    dryRun: localConfig.dryRun ?? baseConfig.dryRun,
    check: localConfig.check ?? baseConfig.check,
    sources: localConfig.sources ?? baseConfig.sources
  };
};
var ConfigResolver = class {
  static async resolve({
    targets,
    features,
    verbose,
    delete: isDelete,
    baseDirs,
    configPath = getDefaults().configPath,
    global,
    silent,
    simulateCommands,
    simulateSubagents,
    simulateSkills,
    dryRun,
    check
  }) {
    const validatedConfigPath = resolvePath(configPath, process.cwd());
    const baseConfig = await loadConfigFromFile(validatedConfigPath);
    const configDir = (0, import_node_path110.dirname)(validatedConfigPath);
    const localConfigPath = (0, import_node_path110.join)(configDir, RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH);
    const localConfig = await loadConfigFromFile(localConfigPath);
    const configByFile = mergeConfigs(baseConfig, localConfig);
    const resolvedGlobal = global ?? configByFile.global ?? getDefaults().global;
    const resolvedSimulateCommands = simulateCommands ?? configByFile.simulateCommands ?? getDefaults().simulateCommands;
    const resolvedSimulateSubagents = simulateSubagents ?? configByFile.simulateSubagents ?? getDefaults().simulateSubagents;
    const resolvedSimulateSkills = simulateSkills ?? configByFile.simulateSkills ?? getDefaults().simulateSkills;
    const configParams = {
      targets: targets ?? configByFile.targets ?? getDefaults().targets,
      features: features ?? configByFile.features ?? getDefaults().features,
      verbose: verbose ?? configByFile.verbose ?? getDefaults().verbose,
      delete: isDelete ?? configByFile.delete ?? getDefaults().delete,
      baseDirs: getBaseDirsInLightOfGlobal({
        baseDirs: baseDirs ?? configByFile.baseDirs ?? getDefaults().baseDirs,
        global: resolvedGlobal
      }),
      global: resolvedGlobal,
      silent: silent ?? configByFile.silent ?? getDefaults().silent,
      simulateCommands: resolvedSimulateCommands,
      simulateSubagents: resolvedSimulateSubagents,
      simulateSkills: resolvedSimulateSkills,
      dryRun: dryRun ?? configByFile.dryRun ?? getDefaults().dryRun,
      check: check ?? configByFile.check ?? getDefaults().check,
      sources: configByFile.sources ?? getDefaults().sources
    };
    return new Config(configParams);
  }
};
function getBaseDirsInLightOfGlobal({
  baseDirs,
  global
}) {
  if (global) {
    return [getHomeDirectory()];
  }
  const resolvedBaseDirs = baseDirs.map((baseDir) => (0, import_node_path110.resolve)(baseDir));
  resolvedBaseDirs.forEach((baseDir) => {
    validateBaseDir(baseDir);
  });
  return resolvedBaseDirs;
}

// src/lib/generate.ts
var import_es_toolkit4 = require("es-toolkit");
var import_node_path111 = require("path");
async function processFeatureGeneration(params) {
  const { config, processor, toolFiles } = params;
  let totalCount = 0;
  const allPaths = [];
  let hasDiff = false;
  const writeResult = await processor.writeAiFiles(toolFiles);
  totalCount += writeResult.count;
  allPaths.push(...writeResult.paths);
  if (writeResult.count > 0) hasDiff = true;
  if (config.getDelete()) {
    const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });
    const orphanCount = await processor.removeOrphanAiFiles(existingToolFiles, toolFiles);
    if (orphanCount > 0) hasDiff = true;
  }
  return { count: totalCount, paths: allPaths, hasDiff };
}
async function processDirFeatureGeneration(params) {
  const { config, processor, toolDirs } = params;
  let totalCount = 0;
  const allPaths = [];
  let hasDiff = false;
  const writeResult = await processor.writeAiDirs(toolDirs);
  totalCount += writeResult.count;
  allPaths.push(...writeResult.paths);
  if (writeResult.count > 0) hasDiff = true;
  if (config.getDelete()) {
    const existingToolDirs = await processor.loadToolDirsToDelete();
    const orphanCount = await processor.removeOrphanAiDirs(existingToolDirs, toolDirs);
    if (orphanCount > 0) hasDiff = true;
  }
  return { count: totalCount, paths: allPaths, hasDiff };
}
async function processEmptyFeatureGeneration(params) {
  const { config, processor } = params;
  const totalCount = 0;
  let hasDiff = false;
  if (config.getDelete()) {
    const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });
    const orphanCount = await processor.removeOrphanAiFiles(existingToolFiles, []);
    if (orphanCount > 0) hasDiff = true;
  }
  return { count: totalCount, paths: [], hasDiff };
}
async function checkRulesyncDirExists(params) {
  return fileExists((0, import_node_path111.join)(params.baseDir, RULESYNC_RELATIVE_DIR_PATH));
}
async function generate(params) {
  const { config } = params;
  const ignoreResult = await generateIgnoreCore({ config });
  const mcpResult = await generateMcpCore({ config });
  const commandsResult = await generateCommandsCore({ config });
  const subagentsResult = await generateSubagentsCore({ config });
  const skillsResult = await generateSkillsCore({ config });
  const hooksResult = await generateHooksCore({ config });
  const rulesResult = await generateRulesCore({ config, skills: skillsResult.skills });
  const hasDiff = ignoreResult.hasDiff || mcpResult.hasDiff || commandsResult.hasDiff || subagentsResult.hasDiff || skillsResult.hasDiff || hooksResult.hasDiff || rulesResult.hasDiff;
  return {
    rulesCount: rulesResult.count,
    rulesPaths: rulesResult.paths,
    ignoreCount: ignoreResult.count,
    ignorePaths: ignoreResult.paths,
    mcpCount: mcpResult.count,
    mcpPaths: mcpResult.paths,
    commandsCount: commandsResult.count,
    commandsPaths: commandsResult.paths,
    subagentsCount: subagentsResult.count,
    subagentsPaths: subagentsResult.paths,
    skillsCount: skillsResult.count,
    skillsPaths: skillsResult.paths,
    hooksCount: hooksResult.count,
    hooksPaths: hooksResult.paths,
    skills: skillsResult.skills,
    hasDiff
  };
}
async function generateRulesCore(params) {
  const { config, skills } = params;
  let totalCount = 0;
  const allPaths = [];
  let hasDiff = false;
  const toolTargets = (0, import_es_toolkit4.intersection)(
    config.getTargets(),
    RulesProcessor.getToolTargets({ global: config.getGlobal() })
  );
  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      if (!config.getFeatures(toolTarget).includes("rules")) {
        continue;
      }
      const processor = new RulesProcessor({
        baseDir,
        toolTarget,
        global: config.getGlobal(),
        simulateCommands: config.getSimulateCommands(),
        simulateSubagents: config.getSimulateSubagents(),
        simulateSkills: config.getSimulateSkills(),
        skills,
        dryRun: config.isPreviewMode()
      });
      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const result = await processFeatureGeneration({
        config,
        processor,
        toolFiles
      });
      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }
  return { count: totalCount, paths: allPaths, hasDiff };
}
async function generateIgnoreCore(params) {
  const { config } = params;
  if (config.getGlobal()) {
    return { count: 0, paths: [], hasDiff: false };
  }
  let totalCount = 0;
  const allPaths = [];
  let hasDiff = false;
  for (const toolTarget of (0, import_es_toolkit4.intersection)(config.getTargets(), IgnoreProcessor.getToolTargets())) {
    if (!config.getFeatures(toolTarget).includes("ignore")) {
      continue;
    }
    for (const baseDir of config.getBaseDirs()) {
      try {
        const processor = new IgnoreProcessor({
          baseDir: baseDir === process.cwd() ? "." : baseDir,
          toolTarget,
          dryRun: config.isPreviewMode()
        });
        const rulesyncFiles = await processor.loadRulesyncFiles();
        let result;
        if (rulesyncFiles.length > 0) {
          const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
          result = await processFeatureGeneration({
            config,
            processor,
            toolFiles
          });
        } else {
          result = await processEmptyFeatureGeneration({
            config,
            processor
          });
        }
        totalCount += result.count;
        allPaths.push(...result.paths);
        if (result.hasDiff) hasDiff = true;
      } catch (error) {
        logger.warn(
          `Failed to generate ${toolTarget} ignore files for ${baseDir}: ${formatError(error)}`
        );
        continue;
      }
    }
  }
  return { count: totalCount, paths: allPaths, hasDiff };
}
async function generateMcpCore(params) {
  const { config } = params;
  let totalCount = 0;
  const allPaths = [];
  let hasDiff = false;
  const toolTargets = (0, import_es_toolkit4.intersection)(
    config.getTargets(),
    McpProcessor.getToolTargets({ global: config.getGlobal() })
  );
  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      if (!config.getFeatures(toolTarget).includes("mcp")) {
        continue;
      }
      const processor = new McpProcessor({
        baseDir,
        toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode()
      });
      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const result = await processFeatureGeneration({
        config,
        processor,
        toolFiles
      });
      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }
  return { count: totalCount, paths: allPaths, hasDiff };
}
async function generateCommandsCore(params) {
  const { config } = params;
  let totalCount = 0;
  const allPaths = [];
  let hasDiff = false;
  const toolTargets = (0, import_es_toolkit4.intersection)(
    config.getTargets(),
    CommandsProcessor.getToolTargets({
      global: config.getGlobal(),
      includeSimulated: config.getSimulateCommands()
    })
  );
  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      if (!config.getFeatures(toolTarget).includes("commands")) {
        continue;
      }
      const processor = new CommandsProcessor({
        baseDir,
        toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode()
      });
      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const result = await processFeatureGeneration({
        config,
        processor,
        toolFiles
      });
      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }
  return { count: totalCount, paths: allPaths, hasDiff };
}
async function generateSubagentsCore(params) {
  const { config } = params;
  let totalCount = 0;
  const allPaths = [];
  let hasDiff = false;
  const toolTargets = (0, import_es_toolkit4.intersection)(
    config.getTargets(),
    SubagentsProcessor.getToolTargets({
      global: config.getGlobal(),
      includeSimulated: config.getSimulateSubagents()
    })
  );
  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      if (!config.getFeatures(toolTarget).includes("subagents")) {
        continue;
      }
      const processor = new SubagentsProcessor({
        baseDir,
        toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode()
      });
      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const result = await processFeatureGeneration({
        config,
        processor,
        toolFiles
      });
      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }
  return { count: totalCount, paths: allPaths, hasDiff };
}
async function generateSkillsCore(params) {
  const { config } = params;
  let totalCount = 0;
  const allPaths = [];
  let hasDiff = false;
  const allSkills = [];
  const toolTargets = (0, import_es_toolkit4.intersection)(
    config.getTargets(),
    SkillsProcessor.getToolTargets({
      global: config.getGlobal(),
      includeSimulated: config.getSimulateSkills()
    })
  );
  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      if (!config.getFeatures(toolTarget).includes("skills")) {
        continue;
      }
      const processor = new SkillsProcessor({
        baseDir,
        toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode()
      });
      const rulesyncDirs = await processor.loadRulesyncDirs();
      for (const rulesyncDir of rulesyncDirs) {
        if (rulesyncDir instanceof RulesyncSkill) {
          allSkills.push(rulesyncDir);
        }
      }
      const toolDirs = await processor.convertRulesyncDirsToToolDirs(rulesyncDirs);
      const result = await processDirFeatureGeneration({
        config,
        processor,
        toolDirs
      });
      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }
  return { count: totalCount, paths: allPaths, skills: allSkills, hasDiff };
}
async function generateHooksCore(params) {
  const { config } = params;
  let totalCount = 0;
  const allPaths = [];
  let hasDiff = false;
  const toolTargets = (0, import_es_toolkit4.intersection)(
    config.getTargets(),
    HooksProcessor.getToolTargets({ global: config.getGlobal() })
  );
  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      if (!config.getFeatures(toolTarget).includes("hooks")) {
        continue;
      }
      const processor = new HooksProcessor({
        baseDir,
        toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode()
      });
      const rulesyncFiles = await processor.loadRulesyncFiles();
      let result;
      if (rulesyncFiles.length === 0) {
        result = await processEmptyFeatureGeneration({
          config,
          processor
        });
      } else {
        const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
        result = await processFeatureGeneration({
          config,
          processor,
          toolFiles
        });
      }
      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }
  return { count: totalCount, paths: allPaths, hasDiff };
}

// src/utils/result.ts
function calculateTotalCount(result) {
  return result.rulesCount + result.ignoreCount + result.mcpCount + result.commandsCount + result.subagentsCount + result.skillsCount + result.hooksCount;
}

// src/cli/commands/generate.ts
function logFeatureResult(params) {
  const { count, paths, featureName, isPreview, modePrefix } = params;
  if (count > 0) {
    if (isPreview) {
      logger.info(`${modePrefix} Would write ${count} ${featureName}`);
    } else {
      logger.success(`Written ${count} ${featureName}`);
    }
    for (const p of paths) {
      logger.info(`    ${p}`);
    }
  }
}
async function generateCommand(options) {
  const config = await ConfigResolver.resolve(options);
  logger.configure({
    verbose: config.getVerbose(),
    silent: config.getSilent()
  });
  const check = config.getCheck();
  const isPreview = config.isPreviewMode();
  const modePrefix = isPreview ? "[DRY RUN]" : "";
  logger.debug("Generating files...");
  if (!await checkRulesyncDirExists({ baseDir: process.cwd() })) {
    logger.error("\u274C .rulesync directory not found. Run 'rulesync init' first.");
    process.exit(1);
  }
  logger.debug(`Base directories: ${config.getBaseDirs().join(", ")}`);
  const features = config.getFeatures();
  if (features.includes("ignore")) {
    logger.debug("Generating ignore files...");
  }
  if (features.includes("mcp")) {
    logger.debug("Generating MCP files...");
  }
  if (features.includes("commands")) {
    logger.debug("Generating command files...");
  }
  if (features.includes("subagents")) {
    logger.debug("Generating subagent files...");
  }
  if (features.includes("skills")) {
    logger.debug("Generating skill files...");
  }
  if (features.includes("hooks")) {
    logger.debug("Generating hooks...");
  }
  if (features.includes("rules")) {
    logger.debug("Generating rule files...");
  }
  const result = await generate({ config });
  logFeatureResult({
    count: result.ignoreCount,
    paths: result.ignorePaths,
    featureName: "ignore file(s)",
    isPreview,
    modePrefix
  });
  logFeatureResult({
    count: result.mcpCount,
    paths: result.mcpPaths,
    featureName: "MCP configuration(s)",
    isPreview,
    modePrefix
  });
  logFeatureResult({
    count: result.commandsCount,
    paths: result.commandsPaths,
    featureName: "command(s)",
    isPreview,
    modePrefix
  });
  logFeatureResult({
    count: result.subagentsCount,
    paths: result.subagentsPaths,
    featureName: "subagent(s)",
    isPreview,
    modePrefix
  });
  logFeatureResult({
    count: result.skillsCount,
    paths: result.skillsPaths,
    featureName: "skill(s)",
    isPreview,
    modePrefix
  });
  logFeatureResult({
    count: result.hooksCount,
    paths: result.hooksPaths,
    featureName: "hooks file(s)",
    isPreview,
    modePrefix
  });
  logFeatureResult({
    count: result.rulesCount,
    paths: result.rulesPaths,
    featureName: "rule(s)",
    isPreview,
    modePrefix
  });
  const totalGenerated = calculateTotalCount(result);
  if (totalGenerated === 0) {
    const enabledFeatures = features.join(", ");
    logger.info(`\u2713 All files are up to date (${enabledFeatures})`);
    return;
  }
  const parts = [];
  if (result.rulesCount > 0) parts.push(`${result.rulesCount} rules`);
  if (result.ignoreCount > 0) parts.push(`${result.ignoreCount} ignore files`);
  if (result.mcpCount > 0) parts.push(`${result.mcpCount} MCP files`);
  if (result.commandsCount > 0) parts.push(`${result.commandsCount} commands`);
  if (result.subagentsCount > 0) parts.push(`${result.subagentsCount} subagents`);
  if (result.skillsCount > 0) parts.push(`${result.skillsCount} skills`);
  if (result.hooksCount > 0) parts.push(`${result.hooksCount} hooks`);
  if (isPreview) {
    logger.info(`${modePrefix} Would write ${totalGenerated} file(s) total (${parts.join(" + ")})`);
  } else {
    logger.success(`\u{1F389} All done! Written ${totalGenerated} file(s) total (${parts.join(" + ")})`);
  }
  if (check) {
    if (result.hasDiff) {
      logger.error("\u274C Files are not up to date. Run 'rulesync generate' to update.");
      process.exit(1);
    } else {
      logger.success("\u2713 All files are up to date.");
    }
  }
}

// src/cli/commands/gitignore.ts
var import_node_path112 = require("path");
var RULESYNC_HEADER = "# Generated by Rulesync";
var LEGACY_RULESYNC_HEADER = "# Generated by rulesync - AI tool configuration files";
var RULESYNC_IGNORE_ENTRIES = [
  // Rulesync curated (fetched) skills
  ".rulesync/skills/.curated/",
  // AGENTS.md
  "**/AGENTS.md",
  "**/.agents/",
  // Augment
  "**/.augmentignore",
  "**/.augment/rules/",
  "**/.augment-guidelines",
  // Claude Code
  "**/CLAUDE.md",
  "**/CLAUDE.local.md",
  "**/.claude/CLAUDE.md",
  "**/.claude/CLAUDE.local.md",
  "**/.claude/memories/",
  "**/.claude/rules/",
  "**/.claude/commands/",
  "**/.claude/agents/",
  "**/.claude/skills/",
  "**/.claude/settings.local.json",
  "**/.mcp.json",
  // Cline
  "**/.clinerules/",
  "**/.clinerules/workflows/",
  "**/.clineignore",
  "**/.cline/mcp.json",
  // Codex
  "**/.codexignore",
  "**/.codex/memories/",
  "**/.codex/skills/",
  "**/.codex/subagents/",
  // Cursor
  "**/.cursor/",
  "**/.cursorignore",
  // Factory Droid
  "**/.factory/rules/",
  "**/.factory/commands/",
  "**/.factory/droids/",
  "**/.factory/skills/",
  "**/.factory/mcp.json",
  "**/.factory/settings.json",
  // Gemini
  "**/GEMINI.md",
  "**/.gemini/memories/",
  "**/.gemini/commands/",
  "**/.gemini/subagents/",
  "**/.gemini/skills/",
  "**/.geminiignore",
  // GitHub Copilot
  "**/.github/copilot-instructions.md",
  "**/.github/instructions/",
  "**/.github/prompts/",
  "**/.github/agents/",
  "**/.github/skills/",
  "**/.vscode/mcp.json",
  // Junie
  "**/.junie/guidelines.md",
  "**/.junie/mcp.json",
  // Kilo Code
  "**/.kilocode/rules/",
  "**/.kilocode/skills/",
  "**/.kilocode/workflows/",
  "**/.kilocode/mcp.json",
  "**/.kilocodeignore",
  // Kiro
  "**/.kiro/steering/",
  "**/.kiro/prompts/",
  "**/.kiro/skills/",
  "**/.kiro/agents/",
  "**/.kiro/settings/mcp.json",
  "**/.aiignore",
  // OpenCode
  "**/.opencode/memories/",
  "**/.opencode/command/",
  "**/.opencode/agent/",
  "**/.opencode/skill/",
  "**/.opencode/plugins/",
  // Qwen
  "**/QWEN.md",
  "**/.qwen/memories/",
  // Replit
  "**/replit.md",
  // Roo
  "**/.roo/rules/",
  "**/.roo/skills/",
  "**/.rooignore",
  "**/.roo/mcp.json",
  "**/.roo/subagents/",
  // Warp
  "**/.warp/",
  "**/WARP.md",
  // Others
  ".rulesync/rules/*.local.md",
  "rulesync.local.jsonc",
  "!.rulesync/.aiignore"
];
var isRulesyncHeader = (line) => {
  const trimmed = line.trim();
  return trimmed === RULESYNC_HEADER || trimmed === LEGACY_RULESYNC_HEADER;
};
var isRulesyncEntry = (line) => {
  const trimmed = line.trim();
  if (trimmed === "" || isRulesyncHeader(line)) {
    return false;
  }
  return RULESYNC_IGNORE_ENTRIES.includes(trimmed);
};
var removeExistingRulesyncEntries = (content) => {
  const lines = content.split("\n");
  const filteredLines = [];
  let inRulesyncBlock = false;
  let consecutiveEmptyLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (isRulesyncHeader(line)) {
      inRulesyncBlock = true;
      continue;
    }
    if (inRulesyncBlock) {
      if (trimmed === "") {
        consecutiveEmptyLines++;
        if (consecutiveEmptyLines >= 2) {
          inRulesyncBlock = false;
          consecutiveEmptyLines = 0;
        }
        continue;
      }
      if (isRulesyncEntry(line)) {
        consecutiveEmptyLines = 0;
        continue;
      }
      inRulesyncBlock = false;
      consecutiveEmptyLines = 0;
    }
    if (isRulesyncEntry(line)) {
      continue;
    }
    filteredLines.push(line);
  }
  let result = filteredLines.join("\n");
  while (result.endsWith("\n\n")) {
    result = result.slice(0, -1);
  }
  return result;
};
var gitignoreCommand = async () => {
  const gitignorePath = (0, import_node_path112.join)(process.cwd(), ".gitignore");
  let gitignoreContent = "";
  if (await fileExists(gitignorePath)) {
    gitignoreContent = await readFileContent(gitignorePath);
  }
  const cleanedContent = removeExistingRulesyncEntries(gitignoreContent);
  const rulesyncBlock = [RULESYNC_HEADER, ...RULESYNC_IGNORE_ENTRIES].join("\n");
  const newContent = cleanedContent.trim() ? `${cleanedContent.trimEnd()}

${rulesyncBlock}
` : `${rulesyncBlock}
`;
  if (gitignoreContent === newContent) {
    logger.success(".gitignore is already up to date");
    return;
  }
  await writeFileContent(gitignorePath, newContent);
  logger.success("Updated .gitignore with rulesync entries:");
  for (const entry of RULESYNC_IGNORE_ENTRIES) {
    logger.info(`  ${entry}`);
  }
  logger.info("");
  logger.info(
    "\u{1F4A1} If you're using Google Antigravity, note that rules, workflows, and skills won't load if they're gitignored."
  );
  logger.info("   You can add the following to .git/info/exclude instead:");
  logger.info("   **/.agent/rules/");
  logger.info("   **/.agent/workflows/");
  logger.info("   **/.agent/skills/");
  logger.info("   For more details: https://github.com/dyoshikawa/rulesync/issues/981");
};

// src/lib/import.ts
async function importFromTool(params) {
  const { config, tool } = params;
  const rulesCount = await importRulesCore({ config, tool });
  const ignoreCount = await importIgnoreCore({ config, tool });
  const mcpCount = await importMcpCore({ config, tool });
  const commandsCount = await importCommandsCore({ config, tool });
  const subagentsCount = await importSubagentsCore({ config, tool });
  const skillsCount = await importSkillsCore({ config, tool });
  const hooksCount = await importHooksCore({ config, tool });
  return {
    rulesCount,
    ignoreCount,
    mcpCount,
    commandsCount,
    subagentsCount,
    skillsCount,
    hooksCount
  };
}
async function importRulesCore(params) {
  const { config, tool } = params;
  if (!config.getFeatures(tool).includes("rules")) {
    return 0;
  }
  const global = config.getGlobal();
  const supportedTargets = RulesProcessor.getToolTargets({ global });
  if (!supportedTargets.includes(tool)) {
    return 0;
  }
  const rulesProcessor = new RulesProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    global
  });
  const toolFiles = await rulesProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }
  const rulesyncFiles = await rulesProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await rulesProcessor.writeAiFiles(rulesyncFiles);
  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} rule files`);
  }
  return writtenCount;
}
async function importIgnoreCore(params) {
  const { config, tool } = params;
  if (!config.getFeatures(tool).includes("ignore")) {
    return 0;
  }
  if (config.getGlobal()) {
    logger.debug("Skipping ignore file import (not supported in global mode)");
    return 0;
  }
  if (!IgnoreProcessor.getToolTargets().includes(tool)) {
    return 0;
  }
  const ignoreProcessor = new IgnoreProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool
  });
  const toolFiles = await ignoreProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }
  const rulesyncFiles = await ignoreProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await ignoreProcessor.writeAiFiles(rulesyncFiles);
  if (config.getVerbose()) {
    logger.success(`Created ignore files from ${toolFiles.length} tool ignore configurations`);
  }
  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} ignore files`);
  }
  return writtenCount;
}
async function importMcpCore(params) {
  const { config, tool } = params;
  if (!config.getFeatures(tool).includes("mcp")) {
    return 0;
  }
  const global = config.getGlobal();
  const supportedTargets = McpProcessor.getToolTargets({ global });
  if (!supportedTargets.includes(tool)) {
    return 0;
  }
  const mcpProcessor = new McpProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    global
  });
  const toolFiles = await mcpProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }
  const rulesyncFiles = await mcpProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await mcpProcessor.writeAiFiles(rulesyncFiles);
  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} MCP files`);
  }
  return writtenCount;
}
async function importCommandsCore(params) {
  const { config, tool } = params;
  if (!config.getFeatures(tool).includes("commands")) {
    return 0;
  }
  const global = config.getGlobal();
  const supportedTargets = CommandsProcessor.getToolTargets({ global, includeSimulated: false });
  if (!supportedTargets.includes(tool)) {
    return 0;
  }
  const commandsProcessor = new CommandsProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    global
  });
  const toolFiles = await commandsProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }
  const rulesyncFiles = await commandsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await commandsProcessor.writeAiFiles(rulesyncFiles);
  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} command files`);
  }
  return writtenCount;
}
async function importSubagentsCore(params) {
  const { config, tool } = params;
  if (!config.getFeatures(tool).includes("subagents")) {
    return 0;
  }
  const global = config.getGlobal();
  const supportedTargets = SubagentsProcessor.getToolTargets({ global, includeSimulated: false });
  if (!supportedTargets.includes(tool)) {
    return 0;
  }
  const subagentsProcessor = new SubagentsProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    global: config.getGlobal()
  });
  const toolFiles = await subagentsProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }
  const rulesyncFiles = await subagentsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await subagentsProcessor.writeAiFiles(rulesyncFiles);
  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} subagent files`);
  }
  return writtenCount;
}
async function importSkillsCore(params) {
  const { config, tool } = params;
  if (!config.getFeatures(tool).includes("skills")) {
    return 0;
  }
  const global = config.getGlobal();
  const supportedTargets = SkillsProcessor.getToolTargets({ global });
  if (!supportedTargets.includes(tool)) {
    return 0;
  }
  const skillsProcessor = new SkillsProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    global
  });
  const toolDirs = await skillsProcessor.loadToolDirs();
  if (toolDirs.length === 0) {
    return 0;
  }
  const rulesyncDirs = await skillsProcessor.convertToolDirsToRulesyncDirs(toolDirs);
  const { count: writtenCount } = await skillsProcessor.writeAiDirs(rulesyncDirs);
  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} skill directories`);
  }
  return writtenCount;
}
async function importHooksCore(params) {
  const { config, tool } = params;
  if (!config.getFeatures(tool).includes("hooks")) {
    return 0;
  }
  const global = config.getGlobal();
  const allTargets = HooksProcessor.getToolTargets({ global });
  const importableTargets = HooksProcessor.getToolTargets({ global, importOnly: true });
  if (!allTargets.includes(tool)) {
    return 0;
  }
  if (!importableTargets.includes(tool)) {
    logger.warn(`Import is not supported for ${tool} hooks. Skipping.`);
    return 0;
  }
  const hooksProcessor = new HooksProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    global
  });
  const toolFiles = await hooksProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }
  const rulesyncFiles = await hooksProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await hooksProcessor.writeAiFiles(rulesyncFiles);
  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} hooks file(s)`);
  }
  return writtenCount;
}

// src/cli/commands/import.ts
async function importCommand(options) {
  if (!options.targets) {
    logger.error("No tools found in --targets");
    process.exit(1);
  }
  if (options.targets.length > 1) {
    logger.error("Only one tool can be imported at a time");
    process.exit(1);
  }
  const config = await ConfigResolver.resolve(options);
  logger.configure({
    verbose: config.getVerbose(),
    silent: config.getSilent()
  });
  const tool = config.getTargets()[0];
  logger.debug(`Importing files from ${tool}...`);
  const result = await importFromTool({ config, tool });
  const totalImported = calculateTotalCount(result);
  if (totalImported === 0) {
    const enabledFeatures = config.getFeatures().join(", ");
    logger.warn(`No files imported for enabled features: ${enabledFeatures}`);
    return;
  }
  const parts = [];
  if (result.rulesCount > 0) parts.push(`${result.rulesCount} rules`);
  if (result.ignoreCount > 0) parts.push(`${result.ignoreCount} ignore files`);
  if (result.mcpCount > 0) parts.push(`${result.mcpCount} MCP files`);
  if (result.commandsCount > 0) parts.push(`${result.commandsCount} commands`);
  if (result.subagentsCount > 0) parts.push(`${result.subagentsCount} subagents`);
  if (result.skillsCount > 0) parts.push(`${result.skillsCount} skills`);
  if (result.hooksCount > 0) parts.push(`${result.hooksCount} hooks`);
  logger.success(`Imported ${totalImported} file(s) total (${parts.join(" + ")})`);
}

// src/lib/init.ts
var import_node_path113 = require("path");
async function init() {
  const sampleFiles = await createSampleFiles();
  const configFile = await createConfigFile();
  return {
    configFile,
    sampleFiles
  };
}
async function createConfigFile() {
  const path4 = RULESYNC_CONFIG_RELATIVE_FILE_PATH;
  if (await fileExists(path4)) {
    return { created: false, path: path4 };
  }
  await writeFileContent(
    path4,
    JSON.stringify(
      {
        targets: ["copilot", "cursor", "claudecode", "codexcli"],
        features: ["rules", "ignore", "mcp", "commands", "subagents", "skills", "hooks"],
        baseDirs: ["."],
        delete: true,
        verbose: false,
        silent: false,
        global: false,
        simulateCommands: false,
        simulateSubagents: false,
        simulateSkills: false
      },
      null,
      2
    )
  );
  return { created: true, path: path4 };
}
async function createSampleFiles() {
  const results = [];
  const sampleRuleFile = {
    filename: RULESYNC_OVERVIEW_FILE_NAME,
    content: `---
root: true
targets: ["*"]
description: "Project overview and general development guidelines"
globs: ["**/*"]
---

# Project Overview

## General Guidelines

- Use TypeScript for all new code
- Follow consistent naming conventions
- Write self-documenting code with clear variable and function names
- Prefer composition over inheritance
- Use meaningful comments for complex business logic

## Code Style

- Use 2 spaces for indentation
- Use semicolons
- Use double quotes for strings
- Use trailing commas in multi-line objects and arrays

## Architecture Principles

- Organize code by feature, not by file type
- Keep related files close together
- Use dependency injection for better testability
- Implement proper error handling
- Follow single responsibility principle
`
  };
  const sampleMcpFile = {
    filename: "mcp.json",
    content: `{
  "mcpServers": {
    "serena": {
      "type": "stdio",
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "start-mcp-server",
        "--context",
        "ide-assistant",
        "--enable-web-dashboard",
        "false",
        "--project",
        "."
      ],
      "env": {}
    },
    "context7": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-mcp"
      ],
      "env": {}
    }
  }
}
`
  };
  const sampleCommandFile = {
    filename: "review-pr.md",
    content: `---
description: 'Review a pull request'
targets: ["*"]
---

target_pr = $ARGUMENTS

If target_pr is not provided, use the PR of the current branch.

Execute the following in parallel:

1. Check code quality and style consistency
2. Review test coverage
3. Verify documentation updates
4. Check for potential bugs or security issues

Then provide a summary of findings and suggestions for improvement.
`
  };
  const sampleSubagentFile = {
    filename: "planner.md",
    content: `---
name: planner
targets: ["*"]
description: >-
  This is the general-purpose planner. The user asks the agent to plan to
  suggest a specification, implement a new feature, refactor the codebase, or
  fix a bug. This agent can be called by the user explicitly only.
claudecode:
  model: inherit
---

You are the planner for any tasks.

Based on the user's instruction, create a plan while analyzing the related files. Then, report the plan in detail. You can output files to @tmp/ if needed.

Attention, again, you are just the planner, so though you can read any files and run any commands for analysis, please don't write any code.
`
  };
  const sampleSkillFile = {
    dirName: "project-context",
    content: `---
name: project-context
description: "Summarize the project context and key constraints"
targets: ["*"]
---

Summarize the project goals, core constraints, and relevant dependencies.
Call out any architecture decisions, shared conventions, and validation steps.
Keep the summary concise and ready to reuse in future tasks.`
  };
  const sampleIgnoreFile = {
    content: `credentials/
`
  };
  const sampleHooksFile = {
    content: `{
  "version": 1,
  "hooks": {
    "postToolUse": [
      {
        "matcher": "Write|Edit",
        "command": ".rulesync/hooks/format.sh"
      }
    ]
  }
}
`
  };
  const rulePaths = RulesyncRule.getSettablePaths();
  const mcpPaths = RulesyncMcp.getSettablePaths();
  const commandPaths = RulesyncCommand.getSettablePaths();
  const subagentPaths = RulesyncSubagent.getSettablePaths();
  const skillPaths = RulesyncSkill.getSettablePaths();
  const ignorePaths = RulesyncIgnore.getSettablePaths();
  const hooksPaths = RulesyncHooks.getSettablePaths();
  await ensureDir(rulePaths.recommended.relativeDirPath);
  await ensureDir(mcpPaths.recommended.relativeDirPath);
  await ensureDir(commandPaths.relativeDirPath);
  await ensureDir(subagentPaths.relativeDirPath);
  await ensureDir(skillPaths.relativeDirPath);
  await ensureDir(ignorePaths.recommended.relativeDirPath);
  const ruleFilepath = (0, import_node_path113.join)(rulePaths.recommended.relativeDirPath, sampleRuleFile.filename);
  results.push(await writeIfNotExists(ruleFilepath, sampleRuleFile.content));
  const mcpFilepath = (0, import_node_path113.join)(
    mcpPaths.recommended.relativeDirPath,
    mcpPaths.recommended.relativeFilePath
  );
  results.push(await writeIfNotExists(mcpFilepath, sampleMcpFile.content));
  const commandFilepath = (0, import_node_path113.join)(commandPaths.relativeDirPath, sampleCommandFile.filename);
  results.push(await writeIfNotExists(commandFilepath, sampleCommandFile.content));
  const subagentFilepath = (0, import_node_path113.join)(subagentPaths.relativeDirPath, sampleSubagentFile.filename);
  results.push(await writeIfNotExists(subagentFilepath, sampleSubagentFile.content));
  const skillDirPath = (0, import_node_path113.join)(skillPaths.relativeDirPath, sampleSkillFile.dirName);
  await ensureDir(skillDirPath);
  const skillFilepath = (0, import_node_path113.join)(skillDirPath, SKILL_FILE_NAME);
  results.push(await writeIfNotExists(skillFilepath, sampleSkillFile.content));
  const ignoreFilepath = (0, import_node_path113.join)(
    ignorePaths.recommended.relativeDirPath,
    ignorePaths.recommended.relativeFilePath
  );
  results.push(await writeIfNotExists(ignoreFilepath, sampleIgnoreFile.content));
  const hooksFilepath = (0, import_node_path113.join)(hooksPaths.relativeDirPath, hooksPaths.relativeFilePath);
  results.push(await writeIfNotExists(hooksFilepath, sampleHooksFile.content));
  return results;
}
async function writeIfNotExists(path4, content) {
  if (await fileExists(path4)) {
    return { created: false, path: path4 };
  }
  await writeFileContent(path4, content);
  return { created: true, path: path4 };
}

// src/cli/commands/init.ts
async function initCommand() {
  logger.debug("Initializing rulesync...");
  await ensureDir(RULESYNC_RELATIVE_DIR_PATH);
  const result = await init();
  for (const file of result.sampleFiles) {
    if (file.created) {
      logger.success(`Created ${file.path}`);
    } else {
      logger.info(`Skipped ${file.path} (already exists)`);
    }
  }
  if (result.configFile.created) {
    logger.success(`Created ${result.configFile.path}`);
  } else {
    logger.info(`Skipped ${result.configFile.path} (already exists)`);
  }
  logger.success("rulesync initialized successfully!");
  logger.info("Next steps:");
  logger.info(
    `1. Edit ${RULESYNC_RELATIVE_DIR_PATH}/**/*.md, ${RULESYNC_RELATIVE_DIR_PATH}/skills/*/${SKILL_FILE_NAME}, ${RULESYNC_MCP_RELATIVE_FILE_PATH}, ${RULESYNC_HOOKS_RELATIVE_FILE_PATH} and ${RULESYNC_AIIGNORE_RELATIVE_FILE_PATH}`
  );
  logger.info("2. Run 'rulesync generate' to create configuration files");
}

// src/lib/sources.ts
var import_promise2 = require("es-toolkit/promise");
var import_node_path115 = require("path");

// src/lib/sources-lock.ts
var import_node_crypto = require("crypto");
var import_node_path114 = require("path");
var import_mini53 = require("zod/mini");
var LOCKFILE_VERSION = 1;
var LockedSkillSchema = import_mini53.z.object({
  integrity: import_mini53.z.string()
});
var LockedSourceSchema = import_mini53.z.object({
  requestedRef: (0, import_mini53.optional)(import_mini53.z.string()),
  resolvedRef: import_mini53.z.string(),
  resolvedAt: (0, import_mini53.optional)(import_mini53.z.string()),
  skills: import_mini53.z.record(import_mini53.z.string(), LockedSkillSchema)
});
var SourcesLockSchema = import_mini53.z.object({
  lockfileVersion: import_mini53.z.number(),
  sources: import_mini53.z.record(import_mini53.z.string(), LockedSourceSchema)
});
var LegacyLockedSourceSchema = import_mini53.z.object({
  resolvedRef: import_mini53.z.string(),
  skills: import_mini53.z.array(import_mini53.z.string())
});
var LegacySourcesLockSchema = import_mini53.z.object({
  sources: import_mini53.z.record(import_mini53.z.string(), LegacyLockedSourceSchema)
});
function migrateLegacyLock(legacy) {
  const sources = {};
  for (const [key, entry] of Object.entries(legacy.sources)) {
    const skills = {};
    for (const name of entry.skills) {
      skills[name] = { integrity: "" };
    }
    sources[key] = {
      resolvedRef: entry.resolvedRef,
      skills
    };
  }
  logger.info(
    "Migrated legacy sources lockfile to version 1. Run 'rulesync install --update' to populate integrity hashes."
  );
  return { lockfileVersion: LOCKFILE_VERSION, sources };
}
function createEmptyLock() {
  return { lockfileVersion: LOCKFILE_VERSION, sources: {} };
}
async function readLockFile(params) {
  const lockPath = (0, import_node_path114.join)(params.baseDir, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH);
  if (!await fileExists(lockPath)) {
    logger.debug("No sources lockfile found, starting fresh.");
    return createEmptyLock();
  }
  try {
    const content = await readFileContent(lockPath);
    const data = JSON.parse(content);
    const result = SourcesLockSchema.safeParse(data);
    if (result.success) {
      return result.data;
    }
    const legacyResult = LegacySourcesLockSchema.safeParse(data);
    if (legacyResult.success) {
      return migrateLegacyLock(legacyResult.data);
    }
    logger.warn("Invalid sources lockfile format. Starting fresh.");
    return createEmptyLock();
  } catch {
    logger.warn("Failed to read sources lockfile. Starting fresh.");
    return createEmptyLock();
  }
}
async function writeLockFile(params) {
  const lockPath = (0, import_node_path114.join)(params.baseDir, RULESYNC_SOURCES_LOCK_RELATIVE_FILE_PATH);
  const content = JSON.stringify(params.lock, null, 2) + "\n";
  await writeFileContent(lockPath, content);
  logger.debug(`Wrote sources lockfile to ${lockPath}`);
}
function computeSkillIntegrity(files) {
  const hash = (0, import_node_crypto.createHash)("sha256");
  const sorted = files.toSorted((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return `sha256-${hash.digest("hex")}`;
}
function normalizeSourceKey(source) {
  let key = source;
  for (const prefix of [
    "https://www.github.com/",
    "https://github.com/",
    "http://www.github.com/",
    "http://github.com/"
  ]) {
    if (key.toLowerCase().startsWith(prefix)) {
      key = key.substring(prefix.length);
      break;
    }
  }
  if (key.startsWith("github:")) {
    key = key.substring("github:".length);
  }
  key = key.replace(/\/+$/, "");
  key = key.replace(/\.git$/, "");
  key = key.toLowerCase();
  return key;
}
function getLockedSource(lock, sourceKey) {
  const normalized = normalizeSourceKey(sourceKey);
  for (const [key, value] of Object.entries(lock.sources)) {
    if (normalizeSourceKey(key) === normalized) {
      return value;
    }
  }
  return void 0;
}
function setLockedSource(lock, sourceKey, entry) {
  const normalized = normalizeSourceKey(sourceKey);
  const filteredSources = {};
  for (const [key, value] of Object.entries(lock.sources)) {
    if (normalizeSourceKey(key) !== normalized) {
      filteredSources[key] = value;
    }
  }
  return {
    lockfileVersion: lock.lockfileVersion,
    sources: {
      ...filteredSources,
      [normalized]: entry
    }
  };
}
function getLockedSkillNames(entry) {
  return Object.keys(entry.skills);
}

// src/lib/sources.ts
async function resolveAndFetchSources(params) {
  const { sources, baseDir, options = {} } = params;
  if (sources.length === 0) {
    return { fetchedSkillCount: 0, sourcesProcessed: 0 };
  }
  if (options.skipSources) {
    logger.info("Skipping source fetching.");
    return { fetchedSkillCount: 0, sourcesProcessed: 0 };
  }
  let lock = options.updateSources ? createEmptyLock() : await readLockFile({ baseDir });
  if (options.frozen) {
    const missingKeys = [];
    const missingSkills = [];
    const curatedDir = (0, import_node_path115.join)(baseDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
    for (const source of sources) {
      const locked = getLockedSource(lock, source.source);
      if (!locked) {
        missingKeys.push(source.source);
        continue;
      }
      const skillNames = getLockedSkillNames(locked);
      for (const skillName of skillNames) {
        if (!await directoryExists((0, import_node_path115.join)(curatedDir, skillName))) {
          missingSkills.push(`${source.source}:${skillName}`);
        }
      }
    }
    if (missingKeys.length > 0) {
      throw new Error(
        `Frozen install failed: lockfile is missing entries for: ${missingKeys.join(", ")}. Run 'rulesync install' to update the lockfile.`
      );
    }
    if (missingSkills.length > 0) {
      throw new Error(
        `Frozen install failed: locked skills missing from disk: ${missingSkills.join(", ")}. Run 'rulesync install' to fetch missing skills.`
      );
    }
  }
  const originalLockJson = JSON.stringify(lock);
  const token = GitHubClient.resolveToken(options.token);
  const client = new GitHubClient({ token });
  const localSkillNames = await getLocalSkillDirNames(baseDir);
  let totalSkillCount = 0;
  const allFetchedSkillNames = /* @__PURE__ */ new Set();
  for (const sourceEntry of sources) {
    try {
      const { skillCount, fetchedSkillNames, updatedLock } = await fetchSource({
        sourceEntry,
        client,
        baseDir,
        lock,
        localSkillNames,
        alreadyFetchedSkillNames: allFetchedSkillNames,
        updateSources: options.updateSources ?? false
      });
      lock = updatedLock;
      totalSkillCount += skillCount;
      for (const name of fetchedSkillNames) {
        allFetchedSkillNames.add(name);
      }
    } catch (error) {
      if (error instanceof GitHubClientError) {
        logGitHubAuthHints(error);
      } else {
        logger.error(`Failed to fetch source "${sourceEntry.source}": ${formatError(error)}`);
      }
    }
  }
  const sourceKeys = new Set(sources.map((s) => normalizeSourceKey(s.source)));
  const prunedSources = {};
  for (const [key, value] of Object.entries(lock.sources)) {
    if (sourceKeys.has(normalizeSourceKey(key))) {
      prunedSources[key] = value;
    } else {
      logger.debug(`Pruned stale lockfile entry: ${key}`);
    }
  }
  lock = { lockfileVersion: lock.lockfileVersion, sources: prunedSources };
  if (!options.frozen && JSON.stringify(lock) !== originalLockJson) {
    await writeLockFile({ baseDir, lock });
  } else {
    logger.debug("Lockfile unchanged, skipping write.");
  }
  return { fetchedSkillCount: totalSkillCount, sourcesProcessed: sources.length };
}
async function checkLockedSkillsExist(curatedDir, skillNames) {
  if (skillNames.length === 0) return true;
  for (const name of skillNames) {
    if (!await directoryExists((0, import_node_path115.join)(curatedDir, name))) {
      return false;
    }
  }
  return true;
}
async function fetchSource(params) {
  const { sourceEntry, client, baseDir, localSkillNames, alreadyFetchedSkillNames, updateSources } = params;
  let { lock } = params;
  const parsed = parseSource(sourceEntry.source);
  if (parsed.provider === "gitlab") {
    throw new Error("GitLab sources are not yet supported.");
  }
  const sourceKey = sourceEntry.source;
  const locked = getLockedSource(lock, sourceKey);
  const lockedSkillNames = locked ? getLockedSkillNames(locked) : [];
  let ref;
  let resolvedSha;
  let requestedRef;
  if (locked && !updateSources) {
    ref = locked.resolvedRef;
    resolvedSha = locked.resolvedRef;
    requestedRef = locked.requestedRef;
    logger.debug(`Using locked ref for ${sourceKey}: ${resolvedSha}`);
  } else {
    requestedRef = parsed.ref ?? await client.getDefaultBranch(parsed.owner, parsed.repo);
    resolvedSha = await client.resolveRefToSha(parsed.owner, parsed.repo, requestedRef);
    ref = resolvedSha;
    logger.debug(`Resolved ${sourceKey} ref "${requestedRef}" to SHA: ${resolvedSha}`);
  }
  const curatedDir = (0, import_node_path115.join)(baseDir, RULESYNC_CURATED_SKILLS_RELATIVE_DIR_PATH);
  if (locked && resolvedSha === locked.resolvedRef && !updateSources) {
    const allExist = await checkLockedSkillsExist(curatedDir, lockedSkillNames);
    if (allExist) {
      logger.debug(`SHA unchanged for ${sourceKey}, skipping re-fetch.`);
      return {
        skillCount: 0,
        fetchedSkillNames: lockedSkillNames,
        updatedLock: lock
      };
    }
  }
  const skillFilter = sourceEntry.skills ?? ["*"];
  const isWildcard = skillFilter.length === 1 && skillFilter[0] === "*";
  const skillsBasePath = parsed.path ?? "skills";
  let remoteSkillDirs;
  try {
    const entries = await client.listDirectory(parsed.owner, parsed.repo, skillsBasePath, ref);
    remoteSkillDirs = entries.filter((e) => e.type === "dir").map((e) => ({ name: e.name, path: e.path }));
  } catch (error) {
    if (error instanceof GitHubClientError && error.statusCode === 404) {
      logger.warn(`No skills/ directory found in ${sourceKey}. Skipping.`);
      return { skillCount: 0, fetchedSkillNames: [], updatedLock: lock };
    }
    throw error;
  }
  const filteredDirs = isWildcard ? remoteSkillDirs : remoteSkillDirs.filter((d) => skillFilter.includes(d.name));
  const semaphore = new import_promise2.Semaphore(FETCH_CONCURRENCY_LIMIT);
  const fetchedSkills = {};
  if (locked) {
    const resolvedCuratedDir = (0, import_node_path115.resolve)(curatedDir);
    for (const prevSkill of lockedSkillNames) {
      const prevDir = (0, import_node_path115.join)(curatedDir, prevSkill);
      if (!(0, import_node_path115.resolve)(prevDir).startsWith(resolvedCuratedDir + import_node_path115.sep)) {
        logger.warn(
          `Skipping removal of "${prevSkill}": resolved path is outside the curated directory.`
        );
        continue;
      }
      if (await directoryExists(prevDir)) {
        await removeDirectory(prevDir);
      }
    }
  }
  for (const skillDir of filteredDirs) {
    if (skillDir.name.includes("..") || skillDir.name.includes("/") || skillDir.name.includes("\\")) {
      logger.warn(
        `Skipping skill with invalid name "${skillDir.name}" from ${sourceKey}: contains path traversal characters.`
      );
      continue;
    }
    if (localSkillNames.has(skillDir.name)) {
      logger.debug(
        `Skipping remote skill "${skillDir.name}" from ${sourceKey}: local skill takes precedence.`
      );
      continue;
    }
    if (alreadyFetchedSkillNames.has(skillDir.name)) {
      logger.warn(
        `Skipping duplicate skill "${skillDir.name}" from ${sourceKey}: already fetched from another source.`
      );
      continue;
    }
    const allFiles = await listDirectoryRecursive({
      client,
      owner: parsed.owner,
      repo: parsed.repo,
      path: skillDir.path,
      ref,
      semaphore
    });
    const files = allFiles.filter((file) => {
      if (file.size > MAX_FILE_SIZE) {
        logger.warn(
          `Skipping file "${file.path}" (${(file.size / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit).`
        );
        return false;
      }
      return true;
    });
    const skillFiles = [];
    for (const file of files) {
      const relativeToSkill = file.path.substring(skillDir.path.length + 1);
      const localFilePath = (0, import_node_path115.join)(curatedDir, skillDir.name, relativeToSkill);
      checkPathTraversal({
        relativePath: relativeToSkill,
        intendedRootDir: (0, import_node_path115.join)(curatedDir, skillDir.name)
      });
      const content = await withSemaphore(
        semaphore,
        () => client.getFileContent(parsed.owner, parsed.repo, file.path, ref)
      );
      await writeFileContent(localFilePath, content);
      skillFiles.push({ path: relativeToSkill, content });
    }
    const integrity = computeSkillIntegrity(skillFiles);
    const lockedSkillEntry = locked?.skills[skillDir.name];
    if (lockedSkillEntry && lockedSkillEntry.integrity && lockedSkillEntry.integrity !== integrity && resolvedSha === locked?.resolvedRef) {
      logger.warn(
        `Integrity mismatch for skill "${skillDir.name}" from ${sourceKey}: expected "${lockedSkillEntry.integrity}", got "${integrity}". Content may have been tampered with.`
      );
    }
    fetchedSkills[skillDir.name] = { integrity };
    logger.debug(`Fetched skill "${skillDir.name}" from ${sourceKey}`);
  }
  const fetchedNames = Object.keys(fetchedSkills);
  const mergedSkills = { ...fetchedSkills };
  if (locked) {
    for (const [skillName, skillEntry] of Object.entries(locked.skills)) {
      if (!(skillName in mergedSkills)) {
        mergedSkills[skillName] = skillEntry;
      }
    }
  }
  lock = setLockedSource(lock, sourceKey, {
    requestedRef,
    resolvedRef: resolvedSha,
    resolvedAt: (/* @__PURE__ */ new Date()).toISOString(),
    skills: mergedSkills
  });
  logger.info(
    `Fetched ${fetchedNames.length} skill(s) from ${sourceKey}: ${fetchedNames.join(", ") || "(none)"}`
  );
  return {
    skillCount: fetchedNames.length,
    fetchedSkillNames: fetchedNames,
    updatedLock: lock
  };
}

// src/cli/commands/install.ts
async function installCommand(options) {
  logger.configure({
    verbose: options.verbose ?? false,
    silent: options.silent ?? false
  });
  const config = await ConfigResolver.resolve({
    configPath: options.configPath,
    verbose: options.verbose,
    silent: options.silent
  });
  const sources = config.getSources();
  if (sources.length === 0) {
    logger.warn("No sources defined in configuration. Nothing to install.");
    return;
  }
  logger.debug(`Installing skills from ${sources.length} source(s)...`);
  const result = await resolveAndFetchSources({
    sources,
    baseDir: process.cwd(),
    options: {
      updateSources: options.update,
      frozen: options.frozen,
      token: options.token
    }
  });
  if (result.fetchedSkillCount > 0) {
    logger.success(
      `Installed ${result.fetchedSkillCount} skill(s) from ${result.sourcesProcessed} source(s).`
    );
  } else {
    logger.success(`All skills up to date (${result.sourcesProcessed} source(s) checked).`);
  }
}

// src/cli/commands/mcp.ts
var import_fastmcp = require("fastmcp");

// src/mcp/tools.ts
var import_mini62 = require("zod/mini");

// src/mcp/commands.ts
var import_node_path116 = require("path");
var import_mini54 = require("zod/mini");
var maxCommandSizeBytes = 1024 * 1024;
var maxCommandsCount = 1e3;
async function listCommands() {
  const commandsDir = (0, import_node_path116.join)(process.cwd(), RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
  try {
    const files = await listDirectoryFiles(commandsDir);
    const mdFiles = files.filter((file) => file.endsWith(".md"));
    const commands = await Promise.all(
      mdFiles.map(async (file) => {
        try {
          const command = await RulesyncCommand.fromFile({
            relativeFilePath: file
          });
          const frontmatter = command.getFrontmatter();
          return {
            relativePathFromCwd: (0, import_node_path116.join)(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, file),
            frontmatter
          };
        } catch (error) {
          logger.error(`Failed to read command file ${file}: ${formatError(error)}`);
          return null;
        }
      })
    );
    return commands.filter((command) => command !== null);
  } catch (error) {
    logger.error(`Failed to read commands directory: ${formatError(error)}`);
    return [];
  }
}
async function getCommand({ relativePathFromCwd }) {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd()
  });
  const filename = (0, import_node_path116.basename)(relativePathFromCwd);
  try {
    const command = await RulesyncCommand.fromFile({
      relativeFilePath: filename
    });
    return {
      relativePathFromCwd: (0, import_node_path116.join)(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, filename),
      frontmatter: command.getFrontmatter(),
      body: command.getBody()
    };
  } catch (error) {
    throw new Error(`Failed to read command file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error
    });
  }
}
async function putCommand({
  relativePathFromCwd,
  frontmatter,
  body
}) {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd()
  });
  const filename = (0, import_node_path116.basename)(relativePathFromCwd);
  const estimatedSize = JSON.stringify(frontmatter).length + body.length;
  if (estimatedSize > maxCommandSizeBytes) {
    throw new Error(
      `Command size ${estimatedSize} bytes exceeds maximum ${maxCommandSizeBytes} bytes (1MB)`
    );
  }
  try {
    const existingCommands = await listCommands();
    const isUpdate = existingCommands.some(
      (command2) => command2.relativePathFromCwd === (0, import_node_path116.join)(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, filename)
    );
    if (!isUpdate && existingCommands.length >= maxCommandsCount) {
      throw new Error(`Maximum number of commands (${maxCommandsCount}) reached`);
    }
    const fileContent = stringifyFrontmatter(body, frontmatter);
    const command = new RulesyncCommand({
      baseDir: process.cwd(),
      relativeDirPath: RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
      relativeFilePath: filename,
      frontmatter,
      body,
      fileContent,
      validate: true
    });
    const commandsDir = (0, import_node_path116.join)(process.cwd(), RULESYNC_COMMANDS_RELATIVE_DIR_PATH);
    await ensureDir(commandsDir);
    await writeFileContent(command.getFilePath(), command.getFileContent());
    return {
      relativePathFromCwd: (0, import_node_path116.join)(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, filename),
      frontmatter: command.getFrontmatter(),
      body: command.getBody()
    };
  } catch (error) {
    throw new Error(`Failed to write command file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error
    });
  }
}
async function deleteCommand({ relativePathFromCwd }) {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd()
  });
  const filename = (0, import_node_path116.basename)(relativePathFromCwd);
  const fullPath = (0, import_node_path116.join)(process.cwd(), RULESYNC_COMMANDS_RELATIVE_DIR_PATH, filename);
  try {
    await removeFile(fullPath);
    return {
      relativePathFromCwd: (0, import_node_path116.join)(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, filename)
    };
  } catch (error) {
    throw new Error(`Failed to delete command file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error
    });
  }
}
var commandToolSchemas = {
  listCommands: import_mini54.z.object({}),
  getCommand: import_mini54.z.object({
    relativePathFromCwd: import_mini54.z.string()
  }),
  putCommand: import_mini54.z.object({
    relativePathFromCwd: import_mini54.z.string(),
    frontmatter: RulesyncCommandFrontmatterSchema,
    body: import_mini54.z.string()
  }),
  deleteCommand: import_mini54.z.object({
    relativePathFromCwd: import_mini54.z.string()
  })
};
var commandTools = {
  listCommands: {
    name: "listCommands",
    description: `List all commands from ${(0, import_node_path116.join)(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "*.md")} with their frontmatter.`,
    parameters: commandToolSchemas.listCommands,
    execute: async () => {
      const commands = await listCommands();
      const output = { commands };
      return JSON.stringify(output, null, 2);
    }
  },
  getCommand: {
    name: "getCommand",
    description: "Get detailed information about a specific command. relativePathFromCwd parameter is required.",
    parameters: commandToolSchemas.getCommand,
    execute: async (args) => {
      const result = await getCommand({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    }
  },
  putCommand: {
    name: "putCommand",
    description: "Create or update a command (upsert operation). relativePathFromCwd, frontmatter, and body parameters are required.",
    parameters: commandToolSchemas.putCommand,
    execute: async (args) => {
      const result = await putCommand({
        relativePathFromCwd: args.relativePathFromCwd,
        frontmatter: args.frontmatter,
        body: args.body
      });
      return JSON.stringify(result, null, 2);
    }
  },
  deleteCommand: {
    name: "deleteCommand",
    description: "Delete a command file. relativePathFromCwd parameter is required.",
    parameters: commandToolSchemas.deleteCommand,
    execute: async (args) => {
      const result = await deleteCommand({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    }
  }
};

// src/mcp/generate.ts
var import_mini55 = require("zod/mini");
var generateOptionsSchema = import_mini55.z.object({
  targets: import_mini55.z.optional(import_mini55.z.array(import_mini55.z.string())),
  features: import_mini55.z.optional(import_mini55.z.array(import_mini55.z.string())),
  delete: import_mini55.z.optional(import_mini55.z.boolean()),
  global: import_mini55.z.optional(import_mini55.z.boolean()),
  simulateCommands: import_mini55.z.optional(import_mini55.z.boolean()),
  simulateSubagents: import_mini55.z.optional(import_mini55.z.boolean()),
  simulateSkills: import_mini55.z.optional(import_mini55.z.boolean())
});
async function executeGenerate(options = {}) {
  try {
    const exists = await checkRulesyncDirExists({ baseDir: process.cwd() });
    if (!exists) {
      return {
        success: false,
        error: ".rulesync directory does not exist. Please run 'rulesync init' first or create the directory manually."
      };
    }
    const config = await ConfigResolver.resolve({
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      targets: options.targets,
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      features: options.features,
      delete: options.delete,
      global: options.global,
      simulateCommands: options.simulateCommands,
      simulateSubagents: options.simulateSubagents,
      simulateSkills: options.simulateSkills,
      // Always use default baseDirs (process.cwd()) and configPath
      // verbose and silent are meaningless in MCP context
      verbose: false,
      silent: true
    });
    const generateResult = await generate({ config });
    return buildSuccessResponse({ generateResult, config });
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
function buildSuccessResponse(params) {
  const { generateResult, config } = params;
  const totalCount = calculateTotalCount(generateResult);
  return {
    success: true,
    result: {
      rulesCount: generateResult.rulesCount,
      ignoreCount: generateResult.ignoreCount,
      mcpCount: generateResult.mcpCount,
      commandsCount: generateResult.commandsCount,
      subagentsCount: generateResult.subagentsCount,
      skillsCount: generateResult.skillsCount,
      hooksCount: generateResult.hooksCount,
      totalCount
    },
    config: {
      targets: config.getTargets(),
      features: config.getFeatures(),
      global: config.getGlobal(),
      delete: config.getDelete(),
      simulateCommands: config.getSimulateCommands(),
      simulateSubagents: config.getSimulateSubagents(),
      simulateSkills: config.getSimulateSkills()
    }
  };
}
var generateToolSchemas = {
  executeGenerate: generateOptionsSchema
};
var generateTools = {
  executeGenerate: {
    name: "executeGenerate",
    description: "Execute the rulesync generate command to create output files for AI tools. Uses rulesync.jsonc settings by default, but options can override them.",
    parameters: generateToolSchemas.executeGenerate,
    execute: async (options = {}) => {
      const result = await executeGenerate(options);
      return JSON.stringify(result, null, 2);
    }
  }
};

// src/mcp/ignore.ts
var import_node_path117 = require("path");
var import_mini56 = require("zod/mini");
var maxIgnoreFileSizeBytes = 100 * 1024;
async function getIgnoreFile() {
  const ignoreFilePath = (0, import_node_path117.join)(process.cwd(), RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
  try {
    const content = await readFileContent(ignoreFilePath);
    return {
      relativePathFromCwd: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
      content
    };
  } catch (error) {
    throw new Error(`Failed to read .rulesync/.aiignore file: ${formatError(error)}`, {
      cause: error
    });
  }
}
async function putIgnoreFile({ content }) {
  const ignoreFilePath = (0, import_node_path117.join)(process.cwd(), RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
  const contentSizeBytes = Buffer.byteLength(content, "utf8");
  if (contentSizeBytes > maxIgnoreFileSizeBytes) {
    throw new Error(
      `Ignore file size ${contentSizeBytes} bytes exceeds maximum ${maxIgnoreFileSizeBytes} bytes (100KB)`
    );
  }
  try {
    await ensureDir(process.cwd());
    await writeFileContent(ignoreFilePath, content);
    return {
      relativePathFromCwd: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
      content
    };
  } catch (error) {
    throw new Error(`Failed to write .rulesync/.aiignore file: ${formatError(error)}`, {
      cause: error
    });
  }
}
async function deleteIgnoreFile() {
  const aiignorePath = (0, import_node_path117.join)(process.cwd(), RULESYNC_AIIGNORE_RELATIVE_FILE_PATH);
  const legacyIgnorePath = (0, import_node_path117.join)(process.cwd(), RULESYNC_IGNORE_RELATIVE_FILE_PATH);
  try {
    await Promise.all([removeFile(aiignorePath), removeFile(legacyIgnorePath)]);
    return {
      // Keep the historical return shape — point to the recommended file path
      // for backward compatibility.
      relativePathFromCwd: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH
    };
  } catch (error) {
    throw new Error(
      `Failed to delete .rulesyncignore and .rulesync/.aiignore files: ${formatError(error)}`,
      {
        cause: error
      }
    );
  }
}
var ignoreToolSchemas = {
  getIgnoreFile: import_mini56.z.object({}),
  putIgnoreFile: import_mini56.z.object({
    content: import_mini56.z.string()
  }),
  deleteIgnoreFile: import_mini56.z.object({})
};
var ignoreTools = {
  getIgnoreFile: {
    name: "getIgnoreFile",
    description: "Get the content of the .rulesyncignore file from the project root.",
    parameters: ignoreToolSchemas.getIgnoreFile,
    execute: async () => {
      const result = await getIgnoreFile();
      return JSON.stringify(result, null, 2);
    }
  },
  putIgnoreFile: {
    name: "putIgnoreFile",
    description: "Create or update the .rulesync/.aiignore file (upsert operation). content parameter is required.",
    parameters: ignoreToolSchemas.putIgnoreFile,
    execute: async (args) => {
      const result = await putIgnoreFile({ content: args.content });
      return JSON.stringify(result, null, 2);
    }
  },
  deleteIgnoreFile: {
    name: "deleteIgnoreFile",
    description: "Delete the .rulesyncignore and .rulesync/.aiignore files.",
    parameters: ignoreToolSchemas.deleteIgnoreFile,
    execute: async () => {
      const result = await deleteIgnoreFile();
      return JSON.stringify(result, null, 2);
    }
  }
};

// src/mcp/import.ts
var import_mini57 = require("zod/mini");
var importOptionsSchema = import_mini57.z.object({
  target: import_mini57.z.string(),
  features: import_mini57.z.optional(import_mini57.z.array(import_mini57.z.string())),
  global: import_mini57.z.optional(import_mini57.z.boolean())
});
async function executeImport(options) {
  try {
    if (!options.target) {
      return {
        success: false,
        error: "target is required. Please specify a tool to import from."
      };
    }
    const config = await ConfigResolver.resolve({
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      targets: [options.target],
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      features: options.features,
      global: options.global,
      // Always use default baseDirs (process.cwd()) and configPath
      // verbose and silent are meaningless in MCP context
      verbose: false,
      silent: true
    });
    const tool = config.getTargets()[0];
    const importResult = await importFromTool({ config, tool });
    return buildSuccessResponse2({ importResult, config, tool });
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
function buildSuccessResponse2(params) {
  const { importResult, config, tool } = params;
  const totalCount = calculateTotalCount(importResult);
  return {
    success: true,
    result: {
      rulesCount: importResult.rulesCount,
      ignoreCount: importResult.ignoreCount,
      mcpCount: importResult.mcpCount,
      commandsCount: importResult.commandsCount,
      subagentsCount: importResult.subagentsCount,
      skillsCount: importResult.skillsCount,
      hooksCount: importResult.hooksCount,
      totalCount
    },
    config: {
      target: tool,
      features: config.getFeatures(),
      global: config.getGlobal()
    }
  };
}
var importToolSchemas = {
  executeImport: importOptionsSchema
};
var importTools = {
  executeImport: {
    name: "executeImport",
    description: "Execute the rulesync import command to import configuration files from an AI tool into .rulesync directory. Requires exactly one target tool to import from.",
    parameters: importToolSchemas.executeImport,
    execute: async (options) => {
      const result = await executeImport(options);
      return JSON.stringify(result, null, 2);
    }
  }
};

// src/mcp/mcp.ts
var import_node_path118 = require("path");
var import_mini58 = require("zod/mini");
var maxMcpSizeBytes = 1024 * 1024;
async function getMcpFile() {
  try {
    const rulesyncMcp = await RulesyncMcp.fromFile({
      validate: true
    });
    const relativePathFromCwd = (0, import_node_path118.join)(
      rulesyncMcp.getRelativeDirPath(),
      rulesyncMcp.getRelativeFilePath()
    );
    return {
      relativePathFromCwd,
      content: rulesyncMcp.getFileContent()
    };
  } catch (error) {
    throw new Error(`Failed to read MCP file: ${formatError(error)}`, {
      cause: error
    });
  }
}
async function putMcpFile({ content }) {
  if (content.length > maxMcpSizeBytes) {
    throw new Error(
      `MCP file size ${content.length} bytes exceeds maximum ${maxMcpSizeBytes} bytes (1MB)`
    );
  }
  try {
    JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON format in MCP file: ${formatError(error)}`, {
      cause: error
    });
  }
  try {
    const baseDir = process.cwd();
    const paths = RulesyncMcp.getSettablePaths();
    const relativeDirPath = paths.recommended.relativeDirPath;
    const relativeFilePath = paths.recommended.relativeFilePath;
    const fullPath = (0, import_node_path118.join)(baseDir, relativeDirPath, relativeFilePath);
    const rulesyncMcp = new RulesyncMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: content,
      validate: true
    });
    await ensureDir((0, import_node_path118.join)(baseDir, relativeDirPath));
    await writeFileContent(fullPath, content);
    const relativePathFromCwd = (0, import_node_path118.join)(relativeDirPath, relativeFilePath);
    return {
      relativePathFromCwd,
      content: rulesyncMcp.getFileContent()
    };
  } catch (error) {
    throw new Error(`Failed to write MCP file: ${formatError(error)}`, {
      cause: error
    });
  }
}
async function deleteMcpFile() {
  try {
    const baseDir = process.cwd();
    const paths = RulesyncMcp.getSettablePaths();
    const recommendedPath = (0, import_node_path118.join)(
      baseDir,
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath
    );
    const legacyPath = (0, import_node_path118.join)(baseDir, paths.legacy.relativeDirPath, paths.legacy.relativeFilePath);
    await removeFile(recommendedPath);
    await removeFile(legacyPath);
    const relativePathFromCwd = (0, import_node_path118.join)(
      paths.recommended.relativeDirPath,
      paths.recommended.relativeFilePath
    );
    return {
      relativePathFromCwd
    };
  } catch (error) {
    throw new Error(`Failed to delete MCP file: ${formatError(error)}`, {
      cause: error
    });
  }
}
var mcpToolSchemas = {
  getMcpFile: import_mini58.z.object({}),
  putMcpFile: import_mini58.z.object({
    content: import_mini58.z.string()
  }),
  deleteMcpFile: import_mini58.z.object({})
};
var mcpTools = {
  getMcpFile: {
    name: "getMcpFile",
    description: `Get the MCP configuration file (${RULESYNC_MCP_RELATIVE_FILE_PATH}).`,
    parameters: mcpToolSchemas.getMcpFile,
    execute: async () => {
      const result = await getMcpFile();
      return JSON.stringify(result, null, 2);
    }
  },
  putMcpFile: {
    name: "putMcpFile",
    description: "Create or update the MCP configuration file (upsert operation). content parameter is required and must be valid JSON.",
    parameters: mcpToolSchemas.putMcpFile,
    execute: async (args) => {
      const result = await putMcpFile({ content: args.content });
      return JSON.stringify(result, null, 2);
    }
  },
  deleteMcpFile: {
    name: "deleteMcpFile",
    description: "Delete the MCP configuration file.",
    parameters: mcpToolSchemas.deleteMcpFile,
    execute: async () => {
      const result = await deleteMcpFile();
      return JSON.stringify(result, null, 2);
    }
  }
};

// src/mcp/rules.ts
var import_node_path119 = require("path");
var import_mini59 = require("zod/mini");
var maxRuleSizeBytes = 1024 * 1024;
var maxRulesCount = 1e3;
async function listRules() {
  const rulesDir = (0, import_node_path119.join)(process.cwd(), RULESYNC_RULES_RELATIVE_DIR_PATH);
  try {
    const files = await listDirectoryFiles(rulesDir);
    const mdFiles = files.filter((file) => file.endsWith(".md"));
    const rules = await Promise.all(
      mdFiles.map(async (file) => {
        try {
          const rule = await RulesyncRule.fromFile({
            relativeFilePath: file,
            validate: true
          });
          const frontmatter = rule.getFrontmatter();
          return {
            relativePathFromCwd: (0, import_node_path119.join)(RULESYNC_RULES_RELATIVE_DIR_PATH, file),
            frontmatter
          };
        } catch (error) {
          logger.error(`Failed to read rule file ${file}: ${formatError(error)}`);
          return null;
        }
      })
    );
    return rules.filter((rule) => rule !== null);
  } catch (error) {
    logger.error(`Failed to read rules directory: ${formatError(error)}`);
    return [];
  }
}
async function getRule({ relativePathFromCwd }) {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd()
  });
  const filename = (0, import_node_path119.basename)(relativePathFromCwd);
  try {
    const rule = await RulesyncRule.fromFile({
      relativeFilePath: filename,
      validate: true
    });
    return {
      relativePathFromCwd: (0, import_node_path119.join)(RULESYNC_RULES_RELATIVE_DIR_PATH, filename),
      frontmatter: rule.getFrontmatter(),
      body: rule.getBody()
    };
  } catch (error) {
    throw new Error(`Failed to read rule file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error
    });
  }
}
async function putRule({
  relativePathFromCwd,
  frontmatter,
  body
}) {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd()
  });
  const filename = (0, import_node_path119.basename)(relativePathFromCwd);
  const estimatedSize = JSON.stringify(frontmatter).length + body.length;
  if (estimatedSize > maxRuleSizeBytes) {
    throw new Error(
      `Rule size ${estimatedSize} bytes exceeds maximum ${maxRuleSizeBytes} bytes (1MB)`
    );
  }
  try {
    const existingRules = await listRules();
    const isUpdate = existingRules.some(
      (rule2) => rule2.relativePathFromCwd === (0, import_node_path119.join)(RULESYNC_RULES_RELATIVE_DIR_PATH, filename)
    );
    if (!isUpdate && existingRules.length >= maxRulesCount) {
      throw new Error(`Maximum number of rules (${maxRulesCount}) reached`);
    }
    const rule = new RulesyncRule({
      baseDir: process.cwd(),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: filename,
      frontmatter,
      body,
      validate: true
    });
    const rulesDir = (0, import_node_path119.join)(process.cwd(), RULESYNC_RULES_RELATIVE_DIR_PATH);
    await ensureDir(rulesDir);
    await writeFileContent(rule.getFilePath(), rule.getFileContent());
    return {
      relativePathFromCwd: (0, import_node_path119.join)(RULESYNC_RULES_RELATIVE_DIR_PATH, filename),
      frontmatter: rule.getFrontmatter(),
      body: rule.getBody()
    };
  } catch (error) {
    throw new Error(`Failed to write rule file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error
    });
  }
}
async function deleteRule({ relativePathFromCwd }) {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd()
  });
  const filename = (0, import_node_path119.basename)(relativePathFromCwd);
  const fullPath = (0, import_node_path119.join)(process.cwd(), RULESYNC_RULES_RELATIVE_DIR_PATH, filename);
  try {
    await removeFile(fullPath);
    return {
      relativePathFromCwd: (0, import_node_path119.join)(RULESYNC_RULES_RELATIVE_DIR_PATH, filename)
    };
  } catch (error) {
    throw new Error(`Failed to delete rule file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error
    });
  }
}
var ruleToolSchemas = {
  listRules: import_mini59.z.object({}),
  getRule: import_mini59.z.object({
    relativePathFromCwd: import_mini59.z.string()
  }),
  putRule: import_mini59.z.object({
    relativePathFromCwd: import_mini59.z.string(),
    frontmatter: RulesyncRuleFrontmatterSchema,
    body: import_mini59.z.string()
  }),
  deleteRule: import_mini59.z.object({
    relativePathFromCwd: import_mini59.z.string()
  })
};
var ruleTools = {
  listRules: {
    name: "listRules",
    description: `List all rules from ${(0, import_node_path119.join)(RULESYNC_RULES_RELATIVE_DIR_PATH, "*.md")} with their frontmatter.`,
    parameters: ruleToolSchemas.listRules,
    execute: async () => {
      const rules = await listRules();
      const output = { rules };
      return JSON.stringify(output, null, 2);
    }
  },
  getRule: {
    name: "getRule",
    description: "Get detailed information about a specific rule. relativePathFromCwd parameter is required.",
    parameters: ruleToolSchemas.getRule,
    execute: async (args) => {
      const result = await getRule({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    }
  },
  putRule: {
    name: "putRule",
    description: "Create or update a rule (upsert operation). relativePathFromCwd, frontmatter, and body parameters are required.",
    parameters: ruleToolSchemas.putRule,
    execute: async (args) => {
      const result = await putRule({
        relativePathFromCwd: args.relativePathFromCwd,
        frontmatter: args.frontmatter,
        body: args.body
      });
      return JSON.stringify(result, null, 2);
    }
  },
  deleteRule: {
    name: "deleteRule",
    description: "Delete a rule file. relativePathFromCwd parameter is required.",
    parameters: ruleToolSchemas.deleteRule,
    execute: async (args) => {
      const result = await deleteRule({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    }
  }
};

// src/mcp/skills.ts
var import_node_path120 = require("path");
var import_mini60 = require("zod/mini");
var maxSkillSizeBytes = 1024 * 1024;
var maxSkillsCount = 1e3;
function aiDirFileToMcpSkillFile(file) {
  return {
    name: file.relativeFilePathToDirPath,
    body: file.fileBuffer.toString("utf-8")
  };
}
function mcpSkillFileToAiDirFile(file) {
  return {
    relativeFilePathToDirPath: file.name,
    fileBuffer: Buffer.from(file.body, "utf-8")
  };
}
function extractDirName(relativeDirPathFromCwd) {
  const dirName = (0, import_node_path120.basename)(relativeDirPathFromCwd);
  if (!dirName) {
    throw new Error(`Invalid path: ${relativeDirPathFromCwd}`);
  }
  return dirName;
}
async function listSkills() {
  const skillsDir = (0, import_node_path120.join)(process.cwd(), RULESYNC_SKILLS_RELATIVE_DIR_PATH);
  try {
    const skillDirPaths = await findFilesByGlobs((0, import_node_path120.join)(skillsDir, "*"), { type: "dir" });
    const skills = await Promise.all(
      skillDirPaths.map(async (dirPath) => {
        const dirName = (0, import_node_path120.basename)(dirPath);
        if (!dirName) return null;
        try {
          const skill = await RulesyncSkill.fromDir({
            dirName
          });
          const frontmatter = skill.getFrontmatter();
          return {
            relativeDirPathFromCwd: (0, import_node_path120.join)(RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName),
            frontmatter
          };
        } catch (error) {
          logger.error(`Failed to read skill directory ${dirName}: ${formatError(error)}`);
          return null;
        }
      })
    );
    return skills.filter((skill) => skill !== null);
  } catch (error) {
    logger.error(`Failed to read skills directory: ${formatError(error)}`);
    return [];
  }
}
async function getSkill({ relativeDirPathFromCwd }) {
  checkPathTraversal({
    relativePath: relativeDirPathFromCwd,
    intendedRootDir: process.cwd()
  });
  const dirName = extractDirName(relativeDirPathFromCwd);
  try {
    const skill = await RulesyncSkill.fromDir({
      dirName
    });
    return {
      relativeDirPathFromCwd: (0, import_node_path120.join)(RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName),
      frontmatter: skill.getFrontmatter(),
      body: skill.getBody(),
      otherFiles: skill.getOtherFiles().map(aiDirFileToMcpSkillFile)
    };
  } catch (error) {
    throw new Error(
      `Failed to read skill directory ${relativeDirPathFromCwd}: ${formatError(error)}`,
      {
        cause: error
      }
    );
  }
}
async function putSkill({
  relativeDirPathFromCwd,
  frontmatter,
  body,
  otherFiles = []
}) {
  checkPathTraversal({
    relativePath: relativeDirPathFromCwd,
    intendedRootDir: process.cwd()
  });
  const dirName = extractDirName(relativeDirPathFromCwd);
  const estimatedSize = JSON.stringify(frontmatter).length + body.length + otherFiles.reduce((acc, file) => acc + file.name.length + file.body.length, 0);
  if (estimatedSize > maxSkillSizeBytes) {
    throw new Error(
      `Skill size ${estimatedSize} bytes exceeds maximum ${maxSkillSizeBytes} bytes (1MB)`
    );
  }
  try {
    const existingSkills = await listSkills();
    const isUpdate = existingSkills.some(
      (skill2) => skill2.relativeDirPathFromCwd === (0, import_node_path120.join)(RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName)
    );
    if (!isUpdate && existingSkills.length >= maxSkillsCount) {
      throw new Error(`Maximum number of skills (${maxSkillsCount}) reached`);
    }
    const aiDirFiles = otherFiles.map(mcpSkillFileToAiDirFile);
    const skill = new RulesyncSkill({
      baseDir: process.cwd(),
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName,
      frontmatter,
      body,
      otherFiles: aiDirFiles,
      validate: true
    });
    const skillDirPath = (0, import_node_path120.join)(process.cwd(), RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName);
    await ensureDir(skillDirPath);
    const skillFilePath = (0, import_node_path120.join)(skillDirPath, SKILL_FILE_NAME);
    const skillFileContent = stringifyFrontmatter(body, frontmatter);
    await writeFileContent(skillFilePath, skillFileContent);
    for (const file of otherFiles) {
      checkPathTraversal({
        relativePath: file.name,
        intendedRootDir: skillDirPath
      });
      const filePath = (0, import_node_path120.join)(skillDirPath, file.name);
      const fileDir = (0, import_node_path120.join)(skillDirPath, (0, import_node_path120.dirname)(file.name));
      if (fileDir !== skillDirPath) {
        await ensureDir(fileDir);
      }
      await writeFileContent(filePath, file.body);
    }
    return {
      relativeDirPathFromCwd: (0, import_node_path120.join)(RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName),
      frontmatter: skill.getFrontmatter(),
      body: skill.getBody(),
      otherFiles: skill.getOtherFiles().map(aiDirFileToMcpSkillFile)
    };
  } catch (error) {
    throw new Error(
      `Failed to write skill directory ${relativeDirPathFromCwd}: ${formatError(error)}`,
      {
        cause: error
      }
    );
  }
}
async function deleteSkill({
  relativeDirPathFromCwd
}) {
  checkPathTraversal({
    relativePath: relativeDirPathFromCwd,
    intendedRootDir: process.cwd()
  });
  const dirName = extractDirName(relativeDirPathFromCwd);
  const skillDirPath = (0, import_node_path120.join)(process.cwd(), RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName);
  try {
    if (await directoryExists(skillDirPath)) {
      await removeDirectory(skillDirPath);
    }
    return {
      relativeDirPathFromCwd: (0, import_node_path120.join)(RULESYNC_SKILLS_RELATIVE_DIR_PATH, dirName)
    };
  } catch (error) {
    throw new Error(
      `Failed to delete skill directory ${relativeDirPathFromCwd}: ${formatError(error)}`,
      {
        cause: error
      }
    );
  }
}
var McpSkillFileSchema = import_mini60.z.object({
  name: import_mini60.z.string(),
  body: import_mini60.z.string()
});
var skillToolSchemas = {
  listSkills: import_mini60.z.object({}),
  getSkill: import_mini60.z.object({
    relativeDirPathFromCwd: import_mini60.z.string()
  }),
  putSkill: import_mini60.z.object({
    relativeDirPathFromCwd: import_mini60.z.string(),
    frontmatter: RulesyncSkillFrontmatterSchema,
    body: import_mini60.z.string(),
    otherFiles: import_mini60.z.optional(import_mini60.z.array(McpSkillFileSchema))
  }),
  deleteSkill: import_mini60.z.object({
    relativeDirPathFromCwd: import_mini60.z.string()
  })
};
var skillTools = {
  listSkills: {
    name: "listSkills",
    description: `List all skills from ${(0, import_node_path120.join)(RULESYNC_SKILLS_RELATIVE_DIR_PATH, "*", SKILL_FILE_NAME)} with their frontmatter.`,
    parameters: skillToolSchemas.listSkills,
    execute: async () => {
      const skills = await listSkills();
      const output = { skills };
      return JSON.stringify(output, null, 2);
    }
  },
  getSkill: {
    name: "getSkill",
    description: "Get detailed information about a specific skill including SKILL.md content and other files. relativeDirPathFromCwd parameter is required.",
    parameters: skillToolSchemas.getSkill,
    execute: async (args) => {
      const result = await getSkill({ relativeDirPathFromCwd: args.relativeDirPathFromCwd });
      return JSON.stringify(result, null, 2);
    }
  },
  putSkill: {
    name: "putSkill",
    description: "Create or update a skill (upsert operation). relativeDirPathFromCwd, frontmatter, and body parameters are required. otherFiles is optional.",
    parameters: skillToolSchemas.putSkill,
    execute: async (args) => {
      const result = await putSkill({
        relativeDirPathFromCwd: args.relativeDirPathFromCwd,
        frontmatter: args.frontmatter,
        body: args.body,
        otherFiles: args.otherFiles
      });
      return JSON.stringify(result, null, 2);
    }
  },
  deleteSkill: {
    name: "deleteSkill",
    description: "Delete a skill directory and all its contents. relativeDirPathFromCwd parameter is required.",
    parameters: skillToolSchemas.deleteSkill,
    execute: async (args) => {
      const result = await deleteSkill({ relativeDirPathFromCwd: args.relativeDirPathFromCwd });
      return JSON.stringify(result, null, 2);
    }
  }
};

// src/mcp/subagents.ts
var import_node_path121 = require("path");
var import_mini61 = require("zod/mini");
var maxSubagentSizeBytes = 1024 * 1024;
var maxSubagentsCount = 1e3;
async function listSubagents() {
  const subagentsDir = (0, import_node_path121.join)(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
  try {
    const files = await listDirectoryFiles(subagentsDir);
    const mdFiles = files.filter((file) => file.endsWith(".md"));
    const subagents = await Promise.all(
      mdFiles.map(async (file) => {
        try {
          const subagent = await RulesyncSubagent.fromFile({
            relativeFilePath: file,
            validate: true
          });
          const frontmatter = subagent.getFrontmatter();
          return {
            relativePathFromCwd: (0, import_node_path121.join)(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, file),
            frontmatter
          };
        } catch (error) {
          logger.error(`Failed to read subagent file ${file}: ${formatError(error)}`);
          return null;
        }
      })
    );
    return subagents.filter(
      (subagent) => subagent !== null
    );
  } catch (error) {
    logger.error(`Failed to read subagents directory: ${formatError(error)}`);
    return [];
  }
}
async function getSubagent({ relativePathFromCwd }) {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd()
  });
  const filename = (0, import_node_path121.basename)(relativePathFromCwd);
  try {
    const subagent = await RulesyncSubagent.fromFile({
      relativeFilePath: filename,
      validate: true
    });
    return {
      relativePathFromCwd: (0, import_node_path121.join)(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, filename),
      frontmatter: subagent.getFrontmatter(),
      body: subagent.getBody()
    };
  } catch (error) {
    throw new Error(`Failed to read subagent file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error
    });
  }
}
async function putSubagent({
  relativePathFromCwd,
  frontmatter,
  body
}) {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd()
  });
  const filename = (0, import_node_path121.basename)(relativePathFromCwd);
  const estimatedSize = JSON.stringify(frontmatter).length + body.length;
  if (estimatedSize > maxSubagentSizeBytes) {
    throw new Error(
      `Subagent size ${estimatedSize} bytes exceeds maximum ${maxSubagentSizeBytes} bytes (1MB)`
    );
  }
  try {
    const existingSubagents = await listSubagents();
    const isUpdate = existingSubagents.some(
      (subagent2) => subagent2.relativePathFromCwd === (0, import_node_path121.join)(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, filename)
    );
    if (!isUpdate && existingSubagents.length >= maxSubagentsCount) {
      throw new Error(`Maximum number of subagents (${maxSubagentsCount}) reached`);
    }
    const subagent = new RulesyncSubagent({
      baseDir: process.cwd(),
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: filename,
      frontmatter,
      body,
      validate: true
    });
    const subagentsDir = (0, import_node_path121.join)(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH);
    await ensureDir(subagentsDir);
    await writeFileContent(subagent.getFilePath(), subagent.getFileContent());
    return {
      relativePathFromCwd: (0, import_node_path121.join)(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, filename),
      frontmatter: subagent.getFrontmatter(),
      body: subagent.getBody()
    };
  } catch (error) {
    throw new Error(`Failed to write subagent file ${relativePathFromCwd}: ${formatError(error)}`, {
      cause: error
    });
  }
}
async function deleteSubagent({ relativePathFromCwd }) {
  checkPathTraversal({
    relativePath: relativePathFromCwd,
    intendedRootDir: process.cwd()
  });
  const filename = (0, import_node_path121.basename)(relativePathFromCwd);
  const fullPath = (0, import_node_path121.join)(process.cwd(), RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, filename);
  try {
    await removeFile(fullPath);
    return {
      relativePathFromCwd: (0, import_node_path121.join)(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, filename)
    };
  } catch (error) {
    throw new Error(
      `Failed to delete subagent file ${relativePathFromCwd}: ${formatError(error)}`,
      {
        cause: error
      }
    );
  }
}
var subagentToolSchemas = {
  listSubagents: import_mini61.z.object({}),
  getSubagent: import_mini61.z.object({
    relativePathFromCwd: import_mini61.z.string()
  }),
  putSubagent: import_mini61.z.object({
    relativePathFromCwd: import_mini61.z.string(),
    frontmatter: RulesyncSubagentFrontmatterSchema,
    body: import_mini61.z.string()
  }),
  deleteSubagent: import_mini61.z.object({
    relativePathFromCwd: import_mini61.z.string()
  })
};
var subagentTools = {
  listSubagents: {
    name: "listSubagents",
    description: `List all subagents from ${(0, import_node_path121.join)(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "*.md")} with their frontmatter.`,
    parameters: subagentToolSchemas.listSubagents,
    execute: async () => {
      const subagents = await listSubagents();
      const output = { subagents };
      return JSON.stringify(output, null, 2);
    }
  },
  getSubagent: {
    name: "getSubagent",
    description: "Get detailed information about a specific subagent. relativePathFromCwd parameter is required.",
    parameters: subagentToolSchemas.getSubagent,
    execute: async (args) => {
      const result = await getSubagent({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    }
  },
  putSubagent: {
    name: "putSubagent",
    description: "Create or update a subagent (upsert operation). relativePathFromCwd, frontmatter, and body parameters are required.",
    parameters: subagentToolSchemas.putSubagent,
    execute: async (args) => {
      const result = await putSubagent({
        relativePathFromCwd: args.relativePathFromCwd,
        frontmatter: args.frontmatter,
        body: args.body
      });
      return JSON.stringify(result, null, 2);
    }
  },
  deleteSubagent: {
    name: "deleteSubagent",
    description: "Delete a subagent file. relativePathFromCwd parameter is required.",
    parameters: subagentToolSchemas.deleteSubagent,
    execute: async (args) => {
      const result = await deleteSubagent({ relativePathFromCwd: args.relativePathFromCwd });
      return JSON.stringify(result, null, 2);
    }
  }
};

// src/mcp/tools.ts
var rulesyncFeatureSchema = import_mini62.z.enum([
  "rule",
  "command",
  "subagent",
  "skill",
  "ignore",
  "mcp",
  "generate",
  "import"
]);
var rulesyncOperationSchema = import_mini62.z.enum(["list", "get", "put", "delete", "run"]);
var skillFileSchema = import_mini62.z.object({
  name: import_mini62.z.string(),
  body: import_mini62.z.string()
});
var rulesyncToolSchema = import_mini62.z.object({
  feature: rulesyncFeatureSchema,
  operation: rulesyncOperationSchema,
  targetPathFromCwd: import_mini62.z.optional(import_mini62.z.string()),
  frontmatter: import_mini62.z.optional(import_mini62.z.unknown()),
  body: import_mini62.z.optional(import_mini62.z.string()),
  otherFiles: import_mini62.z.optional(import_mini62.z.array(skillFileSchema)),
  content: import_mini62.z.optional(import_mini62.z.string()),
  generateOptions: import_mini62.z.optional(generateOptionsSchema),
  importOptions: import_mini62.z.optional(importOptionsSchema)
});
var supportedOperationsByFeature = {
  rule: ["list", "get", "put", "delete"],
  command: ["list", "get", "put", "delete"],
  subagent: ["list", "get", "put", "delete"],
  skill: ["list", "get", "put", "delete"],
  ignore: ["get", "put", "delete"],
  mcp: ["get", "put", "delete"],
  generate: ["run"],
  import: ["run"]
};
function assertSupported({
  feature,
  operation
}) {
  const supportedOperations = supportedOperationsByFeature[feature];
  if (!supportedOperations.includes(operation)) {
    throw new Error(
      `Operation ${operation} is not supported for feature ${feature}. Supported operations: ${supportedOperations.join(
        ", "
      )}`
    );
  }
}
function requireTargetPath({ targetPathFromCwd, feature, operation }) {
  if (!targetPathFromCwd) {
    throw new Error(`targetPathFromCwd is required for ${feature} ${operation} operation`);
  }
  return targetPathFromCwd;
}
function parseFrontmatter2({
  feature,
  frontmatter
}) {
  switch (feature) {
    case "rule": {
      return RulesyncRuleFrontmatterSchema.parse(frontmatter);
    }
    case "command": {
      return RulesyncCommandFrontmatterSchema.parse(frontmatter);
    }
    case "subagent": {
      return RulesyncSubagentFrontmatterSchema.parse(frontmatter);
    }
    case "skill": {
      return RulesyncSkillFrontmatterSchema.parse(frontmatter);
    }
  }
}
function ensureBody({ body, feature, operation }) {
  if (!body) {
    throw new Error(`body is required for ${feature} ${operation} operation`);
  }
  return body;
}
var rulesyncTool = {
  name: "rulesyncTool",
  description: "Manage Rulesync files through a single MCP tool. Features: rule/command/subagent/skill support list/get/put/delete; ignore/mcp support get/put/delete only; generate supports run only; import supports run only. Parameters: list requires no targetPathFromCwd (lists all items); get/delete require targetPathFromCwd; put requires targetPathFromCwd, frontmatter, and body (or content for ignore/mcp); generate/run uses generateOptions to configure generation; import/run uses importOptions to configure import.",
  parameters: rulesyncToolSchema,
  execute: async (args) => {
    const parsed = rulesyncToolSchema.parse(args);
    assertSupported({ feature: parsed.feature, operation: parsed.operation });
    switch (parsed.feature) {
      case "rule": {
        if (parsed.operation === "list") {
          return ruleTools.listRules.execute();
        }
        if (parsed.operation === "get") {
          return ruleTools.getRule.execute({ relativePathFromCwd: requireTargetPath(parsed) });
        }
        if (parsed.operation === "put") {
          return ruleTools.putRule.execute({
            relativePathFromCwd: requireTargetPath(parsed),
            frontmatter: parseFrontmatter2({
              feature: "rule",
              frontmatter: parsed.frontmatter ?? {}
            }),
            body: ensureBody(parsed)
          });
        }
        return ruleTools.deleteRule.execute({ relativePathFromCwd: requireTargetPath(parsed) });
      }
      case "command": {
        if (parsed.operation === "list") {
          return commandTools.listCommands.execute();
        }
        if (parsed.operation === "get") {
          return commandTools.getCommand.execute({
            relativePathFromCwd: requireTargetPath(parsed)
          });
        }
        if (parsed.operation === "put") {
          return commandTools.putCommand.execute({
            relativePathFromCwd: requireTargetPath(parsed),
            frontmatter: parseFrontmatter2({
              feature: "command",
              frontmatter: parsed.frontmatter ?? {}
            }),
            body: ensureBody(parsed)
          });
        }
        return commandTools.deleteCommand.execute({
          relativePathFromCwd: requireTargetPath(parsed)
        });
      }
      case "subagent": {
        if (parsed.operation === "list") {
          return subagentTools.listSubagents.execute();
        }
        if (parsed.operation === "get") {
          return subagentTools.getSubagent.execute({
            relativePathFromCwd: requireTargetPath(parsed)
          });
        }
        if (parsed.operation === "put") {
          return subagentTools.putSubagent.execute({
            relativePathFromCwd: requireTargetPath(parsed),
            frontmatter: parseFrontmatter2({
              feature: "subagent",
              frontmatter: parsed.frontmatter ?? {}
            }),
            body: ensureBody(parsed)
          });
        }
        return subagentTools.deleteSubagent.execute({
          relativePathFromCwd: requireTargetPath(parsed)
        });
      }
      case "skill": {
        if (parsed.operation === "list") {
          return skillTools.listSkills.execute();
        }
        if (parsed.operation === "get") {
          return skillTools.getSkill.execute({ relativeDirPathFromCwd: requireTargetPath(parsed) });
        }
        if (parsed.operation === "put") {
          return skillTools.putSkill.execute({
            relativeDirPathFromCwd: requireTargetPath(parsed),
            frontmatter: parseFrontmatter2({
              feature: "skill",
              frontmatter: parsed.frontmatter ?? {}
            }),
            body: ensureBody(parsed),
            otherFiles: parsed.otherFiles ?? []
          });
        }
        return skillTools.deleteSkill.execute({
          relativeDirPathFromCwd: requireTargetPath(parsed)
        });
      }
      case "ignore": {
        if (parsed.operation === "get") {
          return ignoreTools.getIgnoreFile.execute();
        }
        if (parsed.operation === "put") {
          if (!parsed.content) {
            throw new Error("content is required for ignore put operation");
          }
          return ignoreTools.putIgnoreFile.execute({ content: parsed.content });
        }
        return ignoreTools.deleteIgnoreFile.execute();
      }
      case "mcp": {
        if (parsed.operation === "get") {
          return mcpTools.getMcpFile.execute();
        }
        if (parsed.operation === "put") {
          if (!parsed.content) {
            throw new Error("content is required for mcp put operation");
          }
          return mcpTools.putMcpFile.execute({ content: parsed.content });
        }
        return mcpTools.deleteMcpFile.execute();
      }
      case "generate": {
        return generateTools.executeGenerate.execute(parsed.generateOptions ?? {});
      }
      case "import": {
        if (!parsed.importOptions) {
          throw new Error("importOptions is required for import feature");
        }
        return importTools.executeImport.execute(parsed.importOptions);
      }
      default: {
        throw new Error(`Unknown feature: ${parsed.feature}`);
      }
    }
  }
};

// src/cli/commands/mcp.ts
async function mcpCommand({ version }) {
  const server = new import_fastmcp.FastMCP({
    name: "Rulesync MCP Server",
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    version,
    instructions: "This server handles Rulesync files including rules, commands, MCP, ignore files, subagents and skills for any AI agents. It should be used when you need those files."
  });
  server.addTool(rulesyncTool);
  logger.info("Rulesync MCP server started via stdio");
  void server.start({
    transportType: "stdio"
  });
}

// src/lib/update.ts
var crypto = __toESM(require("crypto"), 1);
var fs = __toESM(require("fs"), 1);
var os2 = __toESM(require("os"), 1);
var path3 = __toESM(require("path"), 1);
var import_node_stream = require("stream");
var import_promises2 = require("stream/promises");
var RULESYNC_REPO_OWNER = "dyoshikawa";
var RULESYNC_REPO_NAME = "rulesync";
var RELEASES_URL = `https://github.com/${RULESYNC_REPO_OWNER}/${RULESYNC_REPO_NAME}/releases`;
var MAX_DOWNLOAD_SIZE = 500 * 1024 * 1024;
var ALLOWED_DOWNLOAD_DOMAINS = [
  "github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "release-assets.githubusercontent.com"
];
var UpdatePermissionError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UpdatePermissionError";
  }
};
function detectExecutionEnvironment() {
  const execPath = process.execPath;
  const scriptPath = process.argv[1] ?? "";
  const isRulesyncBinary = /rulesync(-[a-z0-9]+(-[a-z0-9]+)?)?(\.exe)?$/i.test(execPath);
  if (isRulesyncBinary) {
    if (execPath.includes("/homebrew/") || execPath.includes("/Cellar/")) {
      return "homebrew";
    }
    return "single-binary";
  }
  if ((scriptPath.includes("/homebrew/") || scriptPath.includes("/Cellar/")) && scriptPath.includes("rulesync")) {
    return "homebrew";
  }
  return "npm";
}
function getPlatformAssetName() {
  const platform2 = os2.platform();
  const arch2 = os2.arch();
  const platformMap = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows"
  };
  const archMap = {
    x64: "x64",
    arm64: "arm64"
  };
  const platformName = platformMap[platform2];
  const archName = archMap[arch2];
  if (!platformName || !archName) {
    return null;
  }
  const extension = platform2 === "win32" ? ".exe" : "";
  return `rulesync-${platformName}-${archName}${extension}`;
}
function normalizeVersion(v) {
  return v.replace(/^v/, "").replace(/-.*$/, "");
}
function compareVersions(a, b) {
  const aParts = normalizeVersion(a).split(".").map(Number);
  const bParts = normalizeVersion(b).split(".").map(Number);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aNum = aParts[i] ?? 0;
    const bNum = bParts[i] ?? 0;
    if (!Number.isFinite(aNum) || !Number.isFinite(bNum)) {
      throw new Error(`Invalid version format: cannot compare "${a}" and "${b}"`);
    }
    if (aNum > bNum) return 1;
    if (aNum < bNum) return -1;
  }
  return 0;
}
function validateDownloadUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid download URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Download URL must use HTTPS: ${url}`);
  }
  const isAllowed = ALLOWED_DOWNLOAD_DOMAINS.some((domain) => parsed.hostname === domain);
  if (!isAllowed) {
    throw new Error(
      `Download URL domain "${parsed.hostname}" is not in the allowed list: ${ALLOWED_DOWNLOAD_DOMAINS.join(", ")}`
    );
  }
  if (parsed.hostname === "github.com") {
    const expectedPrefix = `/${RULESYNC_REPO_OWNER}/${RULESYNC_REPO_NAME}/`;
    if (!parsed.pathname.startsWith(expectedPrefix)) {
      throw new Error(
        `Download URL path must belong to ${RULESYNC_REPO_OWNER}/${RULESYNC_REPO_NAME}: ${url}`
      );
    }
  }
}
async function checkForUpdate(currentVersion, token) {
  const client = new GitHubClient({
    token: GitHubClient.resolveToken(token)
  });
  const release = await client.getLatestRelease(RULESYNC_REPO_OWNER, RULESYNC_REPO_NAME);
  const latestVersion = normalizeVersion(release.tag_name);
  const normalizedCurrentVersion = normalizeVersion(currentVersion);
  return {
    currentVersion: normalizedCurrentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, normalizedCurrentVersion) > 0,
    release
  };
}
function findAsset(release, assetName) {
  return release.assets.find((asset) => asset.name === assetName) ?? null;
}
async function downloadFile(url, destPath) {
  validateDownloadUrl(url);
  const response = await fetch(url, {
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`Failed to download: HTTP ${response.status}`);
  }
  if (response.url) {
    validateDownloadUrl(response.url);
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_DOWNLOAD_SIZE) {
    throw new Error(
      `Download too large: ${contentLength} bytes exceeds limit of ${MAX_DOWNLOAD_SIZE} bytes`
    );
  }
  if (!response.body) {
    throw new Error("Response body is empty");
  }
  const fileStream = fs.createWriteStream(destPath);
  let downloadedBytes = 0;
  const bodyReader = import_node_stream.Readable.fromWeb(
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    response.body
  );
  const sizeChecker = new import_node_stream.Transform({
    transform(chunk, _encoding, callback) {
      downloadedBytes += chunk.length;
      if (downloadedBytes > MAX_DOWNLOAD_SIZE) {
        callback(
          new Error(
            `Download too large: exceeded limit of ${MAX_DOWNLOAD_SIZE} bytes during streaming`
          )
        );
        return;
      }
      callback(null, chunk);
    }
  });
  await (0, import_promises2.pipeline)(bodyReader, sizeChecker, fileStream);
}
async function calculateSha256(filePath) {
  const content = await fs.promises.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}
function parseSha256Sums(content) {
  const result = /* @__PURE__ */ new Map();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([a-f0-9]{64})\s+(.+)$/.exec(trimmed);
    if (match && match[1] && match[2]) {
      result.set(match[2].trim(), match[1]);
    }
  }
  return result;
}
async function performBinaryUpdate(currentVersion, options = {}) {
  const { force = false, token } = options;
  const updateCheck = await checkForUpdate(currentVersion, token);
  if (!updateCheck.hasUpdate && !force) {
    return `Already at the latest version (${currentVersion})`;
  }
  const assetName = getPlatformAssetName();
  if (!assetName) {
    throw new Error(
      `Unsupported platform: ${os2.platform()} ${os2.arch()}. Please download manually from ${RELEASES_URL}`
    );
  }
  const binaryAsset = findAsset(updateCheck.release, assetName);
  if (!binaryAsset) {
    throw new Error(
      `Binary for ${assetName} not found in release. Please download manually from ${RELEASES_URL}`
    );
  }
  const checksumAsset = findAsset(updateCheck.release, "SHA256SUMS");
  if (!checksumAsset) {
    throw new Error(
      `SHA256SUMS not found in release. Cannot verify download integrity. Please download manually from ${RELEASES_URL}`
    );
  }
  const tempDir = await fs.promises.mkdtemp(path3.join(os2.tmpdir(), "rulesync-update-"));
  let restoreFailed = false;
  try {
    if (os2.platform() !== "win32") {
      await fs.promises.chmod(tempDir, 448);
    }
    const tempBinaryPath = path3.join(tempDir, assetName);
    await downloadFile(binaryAsset.browser_download_url, tempBinaryPath);
    const checksumsPath = path3.join(tempDir, "SHA256SUMS");
    await downloadFile(checksumAsset.browser_download_url, checksumsPath);
    const checksumsContent = await fs.promises.readFile(checksumsPath, "utf-8");
    const checksums = parseSha256Sums(checksumsContent);
    const expectedChecksum = checksums.get(assetName);
    if (!expectedChecksum) {
      throw new Error(
        `Checksum entry for "${assetName}" not found in SHA256SUMS. Cannot verify download integrity.`
      );
    }
    const actualChecksum = await calculateSha256(tempBinaryPath);
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Checksum verification failed. Expected: ${expectedChecksum}, Got: ${actualChecksum}. The download may be corrupted.`
      );
    }
    const currentExePath = await fs.promises.realpath(process.execPath);
    const currentDir = path3.dirname(currentExePath);
    const backupPath = path3.join(tempDir, "rulesync.backup");
    try {
      await fs.promises.copyFile(currentExePath, backupPath);
    } catch (error) {
      if (isPermissionError(error)) {
        throw new UpdatePermissionError(
          `Permission denied: Cannot read ${currentExePath}. Try running with sudo.`
        );
      }
      throw error;
    }
    try {
      const tempInPlace = path3.join(currentDir, `.rulesync-update-${crypto.randomUUID()}`);
      try {
        await fs.promises.copyFile(tempBinaryPath, tempInPlace);
        if (os2.platform() !== "win32") {
          await fs.promises.chmod(tempInPlace, 493);
        }
        await fs.promises.rename(tempInPlace, currentExePath);
      } catch {
        try {
          await fs.promises.unlink(tempInPlace);
        } catch {
        }
        await fs.promises.copyFile(tempBinaryPath, currentExePath);
        if (os2.platform() !== "win32") {
          await fs.promises.chmod(currentExePath, 493);
        }
      }
      return `Successfully updated from ${currentVersion} to ${updateCheck.latestVersion}`;
    } catch (error) {
      try {
        await fs.promises.copyFile(backupPath, currentExePath);
      } catch {
        restoreFailed = true;
        throw new Error(
          `Failed to replace binary and restore failed. Backup is preserved at: ${backupPath} (in ${tempDir}). Please manually copy it to ${currentExePath}. Original error: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error }
        );
      }
      if (isPermissionError(error)) {
        throw new UpdatePermissionError(
          `Permission denied: Cannot write to ${path3.dirname(currentExePath)}. Try running with sudo.`
        );
      }
      throw error;
    }
  } finally {
    if (!restoreFailed) {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
      }
    }
  }
}
function isPermissionError(error) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const record = error;
    return record["code"] === "EACCES" || record["code"] === "EPERM";
  }
  return false;
}
function getNpmUpgradeInstructions() {
  return `This rulesync installation was installed via npm/npx.

To upgrade, run one of the following commands:

  Global installation:
    npm install -g rulesync@latest

  Project dependency:
    npm install rulesync@latest

  Or use npx to always run the latest version:
    npx rulesync@latest --version`;
}
function getHomebrewUpgradeInstructions() {
  return `This rulesync installation was installed via Homebrew.

To upgrade, run:
  brew upgrade rulesync`;
}

// src/cli/commands/update.ts
async function updateCommand(currentVersion, options) {
  const { check = false, force = false, verbose = false, silent = false, token } = options;
  logger.configure({ verbose, silent });
  try {
    const environment = detectExecutionEnvironment();
    logger.debug(`Detected environment: ${environment}`);
    if (environment === "npm") {
      logger.info(getNpmUpgradeInstructions());
      return;
    }
    if (environment === "homebrew") {
      logger.info(getHomebrewUpgradeInstructions());
      return;
    }
    if (check) {
      logger.info("Checking for updates...");
      const updateCheck = await checkForUpdate(currentVersion, token);
      if (updateCheck.hasUpdate) {
        logger.success(
          `Update available: ${updateCheck.currentVersion} -> ${updateCheck.latestVersion}`
        );
      } else {
        logger.info(`Already at the latest version (${updateCheck.currentVersion})`);
      }
      return;
    }
    logger.info("Checking for updates...");
    const message = await performBinaryUpdate(currentVersion, { force, token });
    logger.success(message);
  } catch (error) {
    if (error instanceof GitHubClientError) {
      logGitHubAuthHints(error);
    } else if (error instanceof UpdatePermissionError) {
      logger.error(error.message);
      logger.info("Tip: Run with elevated privileges (e.g., sudo rulesync update)");
    } else {
      logger.error(formatError(error));
    }
    process.exit(1);
  }
}

// src/cli/index.ts
var getVersion = () => "7.0.0";
var main = async () => {
  const program = new import_commander.Command();
  const version = getVersion();
  program.hook("postAction", () => {
    if (ANNOUNCEMENT.length > 0) {
      logger.info(ANNOUNCEMENT);
    }
  });
  program.name("rulesync").description("Unified AI rules management CLI tool").version(version, "-v, --version", "Show version");
  program.command("init").description("Initialize rulesync in current directory").action(initCommand);
  program.command("gitignore").description("Add generated files to .gitignore").action(gitignoreCommand);
  program.command("fetch <source>").description("Fetch files from a Git repository (GitHub/GitLab)").option(
    "-t, --target <target>",
    "Target format to interpret files as (e.g., 'rulesync', 'claudecode'). Default: rulesync"
  ).option(
    "-f, --features <features>",
    `Comma-separated list of features to fetch (${ALL_FEATURES.join(",")}) or '*' for all`,
    (value) => {
      return value.split(",").map((f) => f.trim());
    }
  ).option("-r, --ref <ref>", "Branch, tag, or commit SHA to fetch from").option("-p, --path <path>", "Subdirectory path within the repository").option("-o, --output <dir>", "Output directory (default: .rulesync)").option(
    "-c, --conflict <strategy>",
    "Conflict resolution strategy: skip, overwrite (default: overwrite)"
  ).option("--token <token>", "Git provider token for private repositories").option("-V, --verbose", "Verbose output").option("-s, --silent", "Suppress all output").action(async (source, options) => {
    await fetchCommand({
      source,
      target: options.target,
      features: options.features,
      ref: options.ref,
      path: options.path,
      output: options.output,
      conflict: options.conflict,
      token: options.token,
      verbose: options.verbose,
      silent: options.silent
    });
  });
  program.command("import").description("Import configurations from AI tools to rulesync format").option(
    "-t, --targets <tool>",
    "Tool to import from (e.g., 'copilot', 'cursor', 'cline')",
    (value) => {
      return value.split(",").map((t) => t.trim());
    }
  ).option(
    "-f, --features <features>",
    `Comma-separated list of features to import (${ALL_FEATURES.join(",")}) or '*' for all`,
    (value) => {
      return value.split(",").map((f) => f.trim());
    }
  ).option("-V, --verbose", "Verbose output").option("-s, --silent", "Suppress all output").option("-g, --global", "Import for global(user scope) configuration files").action(async (options) => {
    try {
      await importCommand({
        targets: options.targets,
        features: options.features,
        verbose: options.verbose,
        silent: options.silent,
        configPath: options.config,
        global: options.global
      });
    } catch (error) {
      logger.error(formatError(error));
      process.exit(1);
    }
  });
  program.command("mcp").description("Start MCP server for rulesync").action(async () => {
    try {
      await mcpCommand({ version });
    } catch (error) {
      logger.error(formatError(error));
      process.exit(1);
    }
  });
  program.command("install").description("Install skills from declarative sources in rulesync.jsonc").option("--update", "Force re-resolve all source refs, ignoring lockfile").option("--frozen", "Fail if lockfile is missing or out of sync (for CI)").option("--token <token>", "GitHub token for private repos").option("-c, --config <path>", "Path to configuration file").option("-V, --verbose", "Verbose output").option("-s, --silent", "Suppress all output").action(async (options) => {
    try {
      await installCommand({
        update: options.update,
        frozen: options.frozen,
        token: options.token,
        configPath: options.config,
        verbose: options.verbose,
        silent: options.silent
      });
    } catch (error) {
      logger.error(formatError(error));
      process.exit(1);
    }
  });
  program.command("generate").description("Generate configuration files for AI tools").option(
    "-t, --targets <tools>",
    "Comma-separated list of tools to generate for (e.g., 'copilot,cursor,cline' or '*' for all)",
    (value) => {
      return value.split(",").map((t) => t.trim());
    }
  ).option(
    "-f, --features <features>",
    `Comma-separated list of features to generate (${ALL_FEATURES.join(",")}) or '*' for all`,
    (value) => {
      return value.split(",").map((f) => f.trim());
    }
  ).option("--delete", "Delete all existing files in output directories before generating").option(
    "-b, --base-dir <paths>",
    "Base directories to generate files (comma-separated for multiple paths)"
  ).option("-V, --verbose", "Verbose output").option("-s, --silent", "Suppress all output").option("-c, --config <path>", "Path to configuration file").option("-g, --global", "Generate for global(user scope) configuration files").option(
    "--simulate-commands",
    "Generate simulated commands. This feature is only available for copilot, cursor and codexcli."
  ).option(
    "--simulate-subagents",
    "Generate simulated subagents. This feature is only available for copilot and codexcli."
  ).option(
    "--simulate-skills",
    "Generate simulated skills. This feature is only available for copilot, cursor and codexcli."
  ).option("--dry-run", "Dry run: show changes without writing files").option("--check", "Check if files are up to date (exits with code 1 if changes needed)").action(async (options) => {
    try {
      await generateCommand({
        targets: options.targets,
        features: options.features,
        verbose: options.verbose,
        silent: options.silent,
        delete: options.delete,
        baseDirs: options.baseDirs,
        configPath: options.config,
        global: options.global,
        simulateCommands: options.simulateCommands,
        simulateSubagents: options.simulateSubagents,
        simulateSkills: options.simulateSkills,
        dryRun: options.dryRun,
        check: options.check
      });
    } catch (error) {
      logger.error(formatError(error));
      process.exit(1);
    }
  });
  program.command("update").description("Update rulesync to the latest version").option("--check", "Check for updates without installing").option("--force", "Force update even if already at latest version").option("--token <token>", "GitHub token for API access").option("-V, --verbose", "Verbose output").option("-s, --silent", "Suppress all output").action(async (options) => {
    await updateCommand(version, {
      check: options.check,
      force: options.force,
      token: options.token,
      verbose: options.verbose,
      silent: options.silent
    });
  });
  program.parse();
};
main().catch((error) => {
  logger.error(formatError(error));
  process.exit(1);
});
