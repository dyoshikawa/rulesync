import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_GLOBAL_DIR,
} from "../../constants/hermesagent-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { mergeHermesConfig, parseHermesConfig, stringifyHermesConfig } from "../hermes-config.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsFromRulesyncPermissionsParams,
} from "./tool-permissions.js";

type HermesagentPermissionsParams = Omit<AiFileParams, "relativeDirPath" | "relativeFilePath">;

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
    const commandAllowlist = Object.entries(permissions.permission ?? {}).flatMap(([, patterns]) =>
      Object.entries(patterns)
        .filter(([, action]) => action === "allow")
        .map(([command]) => command),
    );

    return new HermesagentPermissions({
      outputRoot,
      fileContent: stringifyHermesConfig({
        command_allowlist: commandAllowlist,
        permissions: {
          rulesync: permissions,
        },
      }),
    });
  }
}
