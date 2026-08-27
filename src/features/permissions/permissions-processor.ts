import { basename, dirname } from "node:path";

import { z } from "zod/mini";

import { RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { pickLastRootWithFile } from "../../types/feature-processor.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import type { RulesyncFile } from "../../types/rulesync-file.js";
import type { ToolFile } from "../../types/tool-file.js";
import { permissionsProcessorToolTargetTuple } from "../../types/tool-target-tuples.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { isFileNotFoundError } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { getRulesyncSourceCandidates } from "../../utils/rulesync-source-path.js";
import { AmpPermissions } from "./amp-permissions.js";
import { AntigravityCliPermissions } from "./antigravity-cli-permissions.js";
import { AntigravityIdePermissions } from "./antigravity-ide-permissions.js";
import { AugmentcodePermissions } from "./augmentcode-permissions.js";
import { ClaudecodePermissions } from "./claudecode-permissions.js";
import { ClinePermissions } from "./cline-permissions.js";
import { CodexcliPermissions, createCodexcliBashRulesFile } from "./codexcli-permissions.js";
import { CopilotPermissions } from "./copilot-permissions.js";
import { CopilotcliPermissions } from "./copilotcli-permissions.js";
import { CursorPermissions } from "./cursor-permissions.js";
import { DevinPermissions } from "./devin-permissions.js";
import { FactorydroidPermissions } from "./factorydroid-permissions.js";
import { GoosePermissions } from "./goose-permissions.js";
import { GrokcliPermissions } from "./grokcli-permissions.js";
import { HermesagentPermissions } from "./hermesagent-permissions.js";
import { JuniePermissions } from "./junie-permissions.js";
import { KiloPermissions } from "./kilo-permissions.js";
import { KimiCodePermissions } from "./kimi-code-permissions.js";
import { KiroPermissions } from "./kiro-permissions.js";
import { OpencodePermissions } from "./opencode-permissions.js";
import { PiPermissions } from "./pi-permissions.js";
import { QwencodePermissions } from "./qwencode-permissions.js";
import { ReasonixPermissions } from "./reasonix-permissions.js";
import { RooPermissions } from "./roo-permissions.js";
import { RovodevPermissions } from "./rovodev-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { TaktPermissions } from "./takt-permissions.js";
import type {
  ToolPermissionsForDeletionParams,
  ToolPermissionsFromFileParams,
  ToolPermissionsFromRulesyncPermissionsParams,
  ToolPermissionsSettablePaths,
} from "./tool-permissions.js";
import { ToolPermissions } from "./tool-permissions.js";
import { VibePermissions } from "./vibe-permissions.js";
import { WarpPermissions } from "./warp-permissions.js";
import { ZedPermissions } from "./zed-permissions.js";
import { ZoocodePermissions } from "./zoocode-permissions.js";

export type PermissionsProcessorToolTarget = (typeof permissionsProcessorToolTargetTuple)[number];

export const PermissionsProcessorToolTargetSchema = z.enum(permissionsProcessorToolTargetTuple);

type ToolPermissionsFactory = {
  class: {
    fromRulesyncPermissions(
      params: ToolPermissionsFromRulesyncPermissionsParams,
    ): ToolPermissions | Promise<ToolPermissions>;
    fromFile(params: ToolPermissionsFromFileParams): Promise<ToolPermissions>;
    forDeletion(params: ToolPermissionsForDeletionParams): ToolPermissions;
    getSettablePaths(options?: { global?: boolean }): ToolPermissionsSettablePaths;
  };
  meta: {
    supportsProject: boolean;
    supportsGlobal: boolean;
    supportsImport: boolean;
  };
};

export const toolPermissionsFactories = new Map<
  PermissionsProcessorToolTarget,
  ToolPermissionsFactory
>([
  [
    "amp",
    {
      class: AmpPermissions,
      meta: {
        // Amp maps `deny` rules onto `amp.tools.disable` in the shared settings
        // file: `.amp/settings.json` (project) and
        // `~/.config/amp/settings.json` (global).
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "antigravity-cli",
    {
      class: AntigravityCliPermissions,
      meta: {
        // The Antigravity CLI only reads permissions from the global
        // `~/.gemini/antigravity-cli/settings.json`; there is no documented
        // workspace-scoped permissions file.
        supportsProject: false,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "antigravity-ide",
    {
      class: AntigravityIdePermissions,
      meta: {
        // The Antigravity IDE reads agent permissions from the committable
        // workspace `.antigravity/settings.json`. The User-scope settings file
        // is a platform-dependent path outside rulesync's home-relative global
        // model, so only project scope is generated.
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
    },
  ],
  [
    "augmentcode",
    {
      class: AugmentcodePermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodePermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "cline",
    {
      class: ClinePermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
    },
  ],
  [
    "codexcli",
    {
      class: CodexcliPermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "copilot",
    {
      class: CopilotPermissions,
      meta: {
        // GitHub Copilot Chat in VS Code has no standalone policy file; the
        // adapter manages only the `chat.tools.terminal.autoApprove` map in the
        // workspace `.vscode/settings.json`. VS Code's user-scope settings.json
        // is at a platform-dependent path outside rulesync's home-relative
        // global model, so only project scope is supported.
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
    },
  ],
  [
    "copilotcli",
    {
      class: CopilotcliPermissions,
      meta: {
        // The Copilot CLI keeps the canonical `webfetch` category in its
        // `deniedUrls` / `allowedUrls` lists: `.github/copilot/settings.json`
        // (repository, deny only — upstream accepts no `allowedUrls` there) and
        // `~/.copilot/settings.json` (user, both lists).
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "cursor",
    {
      class: CursorPermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "devin",
    {
      class: DevinPermissions,
      meta: {
        // Devin Local maps permissions onto the `permissions` block (allow/deny/
        // ask scope matchers) in the shared config file: `.devin/config.json`
        // (project) and `~/.config/devin/config.json` (global).
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "factorydroid",
    {
      class: FactorydroidPermissions,
      meta: {
        // Factory Droid maps `bash` allow/deny rules onto
        // `commandAllowlist`/`commandDenylist` in the shared settings file:
        // `.factory/settings.json` (project) and `~/.factory/settings.json`
        // (global).
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "goose",
    {
      class: GoosePermissions,
      meta: {
        // Goose persists per-tool permission overrides only in the global user
        // `~/.config/goose/permission.yaml`; there is no project-scoped Goose
        // permission file (mirrors the Rovodev adapter).
        supportsProject: false,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "grokcli",
    {
      class: GrokcliPermissions,
      meta: {
        // Grok's fine-grained `[permission]` rules live in `.grok/config.toml`
        // at both project (`./.grok/config.toml`) and user
        // (`~/.grok/config.toml`) scope. Grok documents that project configs
        // support permission rules ("Project configs are limited to MCP
        // servers, plugins, and permission rules, not full user configs" —
        // https://docs.x.ai/build/settings), so both scopes are generated.
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "hermesagent",
    {
      class: HermesagentPermissions,
      meta: {
        supportsProject: false,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "kimi-code",
    {
      class: KimiCodePermissions,
      meta: {
        supportsProject: false,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "junie",
    {
      class: JuniePermissions,
      meta: {
        // Junie CLI resolves exactly one allowlist path, the user
        // `~/.junie/allowlist.json` — it never reads a project-scope
        // `.junie/allowlist.json` (verified against release `2383.10`), so the
        // feature is global-only, mirroring the Junie hooks surface.
        supportsProject: false,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "kilo",
    {
      class: KiloPermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "kiro",
    {
      class: KiroPermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
    },
  ],
  [
    // Kiro IDE and CLI share the same permissions file.
    "kiro-cli",
    {
      class: KiroPermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
    },
  ],
  [
    "kiro-ide",
    {
      class: KiroPermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
    },
  ],
  [
    "opencode",
    {
      class: OpencodePermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "pi",
    {
      class: PiPermissions,
      meta: {
        // `.pi/settings.json` (project) and `~/.pi/agent/settings.json`
        // (global); a project `defaultTools` array replaces the global one.
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "qwencode",
    {
      class: QwencodePermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "reasonix",
    {
      class: ReasonixPermissions,
      meta: {
        // Reasonix reads the `[permissions]` table from the same shared TOML
        // config the MCP adapter already writes: `./reasonix.toml` (project) /
        // `~/.reasonix/config.toml` (global).
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "roo",
    {
      class: RooPermissions,
      meta: {
        // Roo Code is a VS Code extension: its committable command allow/deny
        // lists are the `roo-cline.allowedCommands` / `roo-cline.deniedCommands`
        // workspace settings in `.vscode/settings.json`, not a file in the
        // `.roo/` tree. The `roo-cline.*` spelling is the archived Roo lineage's
        // own, which is why this is a separate adapter from `zoocode` rather
        // than a shared one. VS Code's user-scope settings.json is at a
        // platform-dependent path outside rulesync's home-relative global
        // model, so only project scope is supported.
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
    },
  ],
  [
    "rovodev",
    {
      class: RovodevPermissions,
      meta: {
        // Rovo Dev reads the `toolPermissions` block of `config.yml` at both
        // scopes: the global `~/.rovodev/config.yml`, and the repo-committed
        // project `.rovodev/config.yml` documented by the Bitbucket Cloud
        // Agentic Pipelines guide (referenced via `config.path`, or
        // the `--config-file` CLI flag).
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "takt",
    {
      class: TaktPermissions,
      meta: {
        // Takt gates tools with the coarse `default_permission_mode`
        // (readonly < edit < full) under `provider_profiles.<provider>` in the
        // shared config: `.takt/config.yaml` (project) and
        // `~/.takt/config.yaml` (global).
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "vibe",
    {
      class: VibePermissions,
      meta: {
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "warp",
    {
      class: WarpPermissions,
      meta: {
        // Warp reads command permissions only from the global user
        // `settings.toml` (`[agents.profiles]` allowlist/denylist); there is no
        // project-scoped Warp permissions file. The settings.toml path differs
        // per platform, resolved in WarpPermissions.getSettablePaths.
        supportsProject: false,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "zed",
    {
      class: ZedPermissions,
      meta: {
        // Zed maps permissions onto `agent.tool_permissions` in the shared
        // settings file: `.zed/settings.json` (project) and
        // `~/.config/zed/settings.json` (global).
        supportsProject: true,
        supportsGlobal: true,
        supportsImport: true,
      },
    },
  ],
  [
    "zoocode",
    {
      class: ZoocodePermissions,
      meta: {
        // Zoo Code is a VS Code extension: its committable command allow/deny
        // lists are the `zoo-code.allowedCommands` / `zoo-code.deniedCommands`
        // workspace settings in `.vscode/settings.json`, not a file in the
        // `.roo/` tree. VS Code's user-scope settings.json is at a
        // platform-dependent path outside rulesync's home-relative global
        // model, so only project scope is supported.
        supportsProject: true,
        supportsGlobal: false,
        supportsImport: true,
      },
    },
  ],
]);

export class PermissionsProcessor extends FeatureProcessor {
  private readonly toolTarget: PermissionsProcessorToolTarget;
  private readonly global: boolean;

  constructor({
    outputRoot = process.cwd(),
    inputRoots,
    toolTarget,
    global = false,
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoots?: readonly [string, ...string[]] | readonly string[];
    toolTarget: ToolTarget;
    global?: boolean;
    dryRun?: boolean;
    logger: Logger;
  }) {
    super({ outputRoot, inputRoots, dryRun, logger });
    const result = PermissionsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for PermissionsProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
  }

  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    // `inputRoots[i]` is a source tree itself (e.g. `/repo/.rulesync.local`);
    // permissions files live directly inside it (no implicit `.rulesync/`
    // prefix).
    //
    // Multi-root policy: the last root that provides a permissions file
    // wins the whole file (see the inputRoots plan).
    const paths = RulesyncPermissions.getSettablePaths();
    const relativePaths = getRulesyncSourceCandidates({ paths }).map(
      (candidate) => candidate.relativeFilePath,
    );
    const winningRoot = await pickLastRootWithFile({
      inputRoots: this.inputRoots,
      relativePaths,
      logger: this.logger,
      artifactName: "The permissions file",
    });
    const sourceTree = winningRoot ?? this.inputRoots[0];

    try {
      return [
        await RulesyncPermissions.fromFile({
          outputRoot: dirname(sourceTree),
          relativeDirPath: basename(sourceTree),
          validate: true,
        }),
      ];
    } catch (error) {
      this.logger.error(
        `Failed to load Rulesync permissions file (${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH}): ${formatError(error)}`,
      );
      // A source that is simply absent is not a failure: the feature just has
      // no file here, and `winningRoot` is undefined precisely in that case.
      // Anything else means the file exists but could not be read or parsed,
      // which must not be reported as a clean run.
      if (winningRoot !== undefined && !isFileNotFoundError(error)) {
        this.recordRulesyncSourceLoadFailure();
      }
      return [];
    }
  }

  async loadToolFiles({
    forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    try {
      const factory = toolPermissionsFactories.get(this.toolTarget);
      if (!factory) throw new Error(`Unsupported tool target: ${this.toolTarget}`);
      const paths = factory.class.getSettablePaths({ global: this.global });

      if (forDeletion) {
        const toolPermissions = factory.class.forDeletion({
          outputRoot: this.outputRoot,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: paths.relativeFilePath,
          global: this.global,
        });
        const list = toolPermissions.isDeletable?.() !== false ? [toolPermissions] : [];
        return list;
      }

      const toolPermissions = await factory.class.fromFile({
        outputRoot: this.outputRoot,
        validate: true,
        global: this.global,
      });
      return [toolPermissions];
    } catch (error) {
      const msg = `Failed to load permissions files for tool target: ${this.toolTarget}: ${formatError(error)}`;
      if (error instanceof Error && error.message.includes("no such file or directory")) {
        this.logger.debug(msg);
      } else {
        this.logger.error(msg);
      }
      return [];
    }
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncPermissions = rulesyncFiles.find(
      (f): f is RulesyncPermissions => f instanceof RulesyncPermissions,
    );
    if (!rulesyncPermissions) {
      throw new Error(`No ${RULESYNC_PERMISSIONS_RELATIVE_FILE_PATH} found.`);
    }

    const factory = toolPermissionsFactories.get(this.toolTarget);
    if (!factory) throw new Error(`Unsupported tool target: ${this.toolTarget}`);

    // Apply the tool-scoped `{toolname}.permission` block (if any) so the
    // translator only ever sees the effective shared `permission` record.
    const effectivePermissions = rulesyncPermissions.forTarget({
      toolTarget: this.toolTarget,
      logger: this.logger,
    });

    const toolPermissions = await factory.class.fromRulesyncPermissions({
      outputRoot: this.outputRoot,
      rulesyncPermissions: effectivePermissions,
      logger: this.logger,
      global: this.global,
    });
    if (this.toolTarget !== "codexcli") {
      return [toolPermissions];
    }

    const bashRulesFile = createCodexcliBashRulesFile({
      outputRoot: this.outputRoot,
      config: effectivePermissions.getJson(),
    });
    return [toolPermissions, bashRulesFile];
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const permissions = toolFiles.filter((f): f is ToolPermissions => f instanceof ToolPermissions);
    return permissions.map((p) => p.toRulesyncPermissions());
  }

  static getToolTargets({
    global = false,
    importOnly = false,
  }: { global?: boolean; importOnly?: boolean } = {}): ToolTarget[] {
    return [...toolPermissionsFactories.entries()]
      .filter(([, f]) => (global ? f.meta.supportsGlobal : f.meta.supportsProject))
      .filter(([, f]) => (importOnly ? f.meta.supportsImport : true))
      .map(([target]) => target);
  }
}
