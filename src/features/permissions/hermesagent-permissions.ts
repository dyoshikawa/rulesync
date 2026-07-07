import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_GLOBAL_DIR,
} from "../../constants/hermesagent-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction } from "../../types/permissions.js";
import {
  deepMergeHermesConfig,
  mergeHermesConfig,
  parseHermesConfig,
  stringifyHermesConfig,
} from "../hermes-config.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
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

  shouldMergeExistingFileContent(): boolean {
    return true;
  }

  setFileContent(fileContent: string): void {
    this.fileContent = mergeHermesConfig(fileContent, parseHermesConfig(this.fileContent));
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const config = parseHermesConfig(this.getFileContent());
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
      config.security = { website_blocklist: { domains: webfetchDeny } };
    }

    // Overlay the Hermes-scoped override (approvals.mode, security.*,
    // skills.write_approval, ...). Deep-merged so it coexists with the natively
    // emitted `approvals`/`security` structures instead of clobbering them.
    if (permissions.hermes && typeof permissions.hermes === "object") {
      config = deepMergeHermesConfig(config, permissions.hermes as Record<string, unknown>);
    }

    // Keep the full canonical config under the rulesync-private key for a
    // lossless round-trip back to `.rulesync/permissions.json`.
    config.permissions = { rulesync: permissions };

    return new HermesagentPermissions({
      outputRoot,
      fileContent: stringifyHermesConfig(config),
    });
  }
}
