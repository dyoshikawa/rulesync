import {
  RULESYNC_HOOKS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { AiFileFromFileParams, AiFileParams } from "../../types/ai-file.js";
import { ToolFile } from "../../types/tool-file.js";
import type { Logger } from "../../utils/logger.js";
import { buildHooksOwnershipLockFile, type OwnedHookRef } from "./hooks-ownership-lock.js";
import { RulesyncHooks } from "./rulesync-hooks.js";

export type ToolHooksParams = AiFileParams & {
  /**
   * What this instance's hooks list claims as rulesync-generated, recorded so
   * the next run can retract a hook that is no longer defined. Set only by
   * adapters that support preservation, and only when it is enabled.
   */
  ownedHookRefs?: readonly OwnedHookRef[];
};

export type ToolHooksFromRulesyncHooksParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncHooks: RulesyncHooks;
  /**
   * Keep handlers in the destination file that rulesync did not generate,
   * instead of replacing the list. Off by default; adapters that do not
   * support it ignore it.
   */
  preserveUnowned?: boolean;
  /**
   * Adapters warn through this about what a conversion cannot represent. The
   * processor passes its own logger, so a warning an adapter emits reaches the
   * user rather than only the tests that construct one.
   */
  logger?: Logger;
};

export type ToolHooksFromFileParams = Pick<
  AiFileFromFileParams,
  "outputRoot" | "validate" | "global"
> & {
  /**
   * Lets an adapter report what it read, e.g. that a value came out of a
   * machine-local overrides file the import is about to make committable.
   */
  logger?: Logger;
};

export type ToolHooksForDeletionParams = {
  outputRoot?: string;
  relativeDirPath: string;
  relativeFilePath: string;
  global?: boolean;
};

export type ToolHooksSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export abstract class ToolHooks extends ToolFile {
  private readonly ownedHookRefs: readonly OwnedHookRef[] | undefined;

  constructor(params: ToolHooksParams) {
    super({
      ...params,
      validate: true,
    });

    this.ownedHookRefs = params.ownedHookRefs;

    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  /**
   * The ownership record for this destination, or nothing when preservation is
   * off — in which case rulesync owns the whole list and needs no record.
   */
  getOwnershipLockFiles(): ToolFile[] {
    if (this.ownedHookRefs === undefined) {
      return [];
    }
    return [
      buildHooksOwnershipLockFile({
        outputRoot: this.getOutputRoot(),
        relativeDirPath: this.getRelativeDirPath(),
        owned: this.ownedHookRefs,
      }),
    ];
  }

  /**
   * Whether the adapter can keep handlers it did not generate. Destinations
   * rulesync owns outright (plugin bundles) must answer `false`: there is no
   * third party writing into them, and preserving there would only make
   * removals impossible.
   */
  static supportsPreserveUnowned(): boolean {
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolHooksSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  abstract toRulesyncHooks(options?: { logger?: Logger }): RulesyncHooks;

  protected toRulesyncHooksDefault({
    fileContent = undefined,
    outputRoot = this.outputRoot,
  }: {
    fileContent?: string;
    outputRoot?: string;
  } = {}): RulesyncHooks {
    return new RulesyncHooks({
      outputRoot,
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_HOOKS_FILE_NAME,
      fileContent: fileContent ?? this.fileContent,
    });
  }

  static async fromFile(_params: ToolHooksFromFileParams): Promise<ToolHooks> {
    throw new Error("Please implement this method in the subclass.");
  }

  static forDeletion(_params: ToolHooksForDeletionParams): ToolHooks {
    throw new Error("Please implement this method in the subclass.");
  }

  static async getAuxiliaryFiles(_params: {
    outputRoot?: string;
    global?: boolean;
    /** The instance just built, for adapters whose extra files derive from it. */
    toolHooks?: ToolHooks;
    logger?: Logger;
  }): Promise<ToolFile[]> {
    return [];
  }

  /**
   * Extra files the deletion sweep may remove, for adapters that write more
   * than their settable path. Kept separate from {@link getAuxiliaryFiles},
   * which may legitimately return a shared user-owned config file.
   */
  static async getDeletableAuxiliaryFiles(_params: {
    outputRoot?: string;
    global?: boolean;
  }): Promise<ToolFile[]> {
    return [];
  }
}
