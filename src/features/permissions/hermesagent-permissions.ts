import { join } from "node:path";

import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_GLOBAL_DIR,
} from "../../constants/hermesagent-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction } from "../../types/permissions.js";
import { readFileContent } from "../../utils/file.js";
import {
  applySharedConfigPatch,
  HERMES_CONFIG_SHARED_FILE_KEY,
  mergeSharedConfigDeep,
  parseSharedConfig,
  stringifySharedConfig,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
} from "./tool-permissions.js";

type HermesagentPermissionsParams = Omit<AiFileParams, "relativeDirPath" | "relativeFilePath">;

/** Collect the glob patterns in a canonical category that carry a given action. */
function patternsByAction(
  category: Record<string, PermissionAction> | undefined,
  action: PermissionAction,
): string[] {
  return Object.entries(category ?? {})
    .filter(([, value]) => value === action)
    .map(([pattern]) => pattern);
}

export class HermesagentPermissions extends ToolPermissions {
  static getSettablePaths() {
    return {
      relativeDirPath: HERMESAGENT_GLOBAL_DIR,
      relativeFilePath: HERMESAGENT_CONFIG_FILE_NAME,
    };
  }

  constructor(params: HermesagentPermissionsParams) {
    super({
      ...params,
      ...HermesagentPermissions.getSettablePaths(),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  override isDeletable(): boolean {
    return false;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<HermesagentPermissions> {
    const paths = this.getSettablePaths();
    return new HermesagentPermissions({
      outputRoot,
      fileContent: await readFileContent(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      ),
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
  }: ToolPermissionsForDeletionParams): HermesagentPermissions {
    return new HermesagentPermissions({ outputRoot, fileContent: "", validate: false });
  }

  shouldMergeExistingFileContent(): boolean {
    return true;
  }

  setFileContent(fileContent: string): void {
    this.fileContent = applySharedConfigPatch({
      fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
      feature: "permissions",
      existingContent: fileContent,
      patch: parseSharedConfig({ format: "yaml", fileContent: this.fileContent }),
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const config = parseSharedConfig({ format: "yaml", fileContent: this.getFileContent() });
    const permissions =
      config.permissions && typeof config.permissions === "object"
        ? (config.permissions as Record<string, unknown>).rulesync
        : {};
    return new RulesyncPermissions({
      relativeDirPath: "",
      relativeFilePath: ".rulesync/permissions.json",
      fileContent: JSON.stringify(permissions ?? {}, null, 2),
    });
  }

  static fromRulesyncPermissions({
    outputRoot,
    rulesyncPermissions,
  }: ToolPermissionsFromRulesyncPermissionsParams): HermesagentPermissions {
    const permissions = rulesyncPermissions.getJson();
    const permissionBlock = permissions.permission ?? {};

    // `allow` patterns (all categories) feed Hermes's command allowlist, as before.
    const commandAllowlist = Object.entries(permissionBlock).flatMap(([, patterns]) =>
      patternsByAction(patterns, "allow"),
    );

    // Map the two canonical deny surfaces onto the structures Hermes's runtime
    // actually enforces (previously dropped): `bash` deny -> `approvals.deny`
    // (a hard denylist evaluated before autonomy mode) and `webfetch` deny ->
    // `security.website_blocklist.domains`. Other categories' deny and every
    // `ask` rule have no native per-pattern Hermes primitive, so they survive
    // only in the round-trip blob below.
    const bashDeny = patternsByAction(permissionBlock.bash, "deny");
    const webfetchDeny = patternsByAction(permissionBlock.webfetch, "deny");

    let config: Record<string, unknown> = {};
    if (commandAllowlist.length > 0) config.command_allowlist = commandAllowlist;
    if (bashDeny.length > 0) config.approvals = { deny: bashDeny };
    if (webfetchDeny.length > 0) {
      // `website_blocklist.enabled` defaults to false in Hermes, so the blocklist
      // is inert unless it is explicitly enabled — emit `enabled: true` alongside
      // the domains, otherwise the deny would be written but never enforced.
      config.security = { website_blocklist: { enabled: true, domains: webfetchDeny } };
    }

    // Overlay the Hermes-scoped override (approvals.mode, security.*,
    // skills.write_approval, ...). Deep-merged so it coexists with the natively
    // emitted `approvals`/`security` structures instead of clobbering them.
    if (permissions.hermes && typeof permissions.hermes === "object") {
      config = mergeSharedConfigDeep({
        base: config,
        patch: permissions.hermes as Record<string, unknown>,
      });
    }

    // Keep the full canonical config under the rulesync-private key for a
    // lossless round-trip back to `.rulesync/permissions.json`.
    config.permissions = { rulesync: permissions };

    return new HermesagentPermissions({
      outputRoot,
      fileContent: stringifySharedConfig({ format: "yaml", document: config }),
    });
  }
}
