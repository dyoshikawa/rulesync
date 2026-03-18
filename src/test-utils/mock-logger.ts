import { type Mock, vi } from "vitest";

import type { Logger } from "../utils/logger.js";

export type MockLogger = {
  [K in keyof Logger]: Logger[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : Logger[K];
};

export function createMockLogger(): MockLogger {
  return {
    configure: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: false,
    silent: false,
    jsonMode: false,
    captureData: vi.fn(),
    getJsonData: vi.fn().mockReturnValue({}),
    outputJson: vi.fn(),
  } satisfies Logger;
}
