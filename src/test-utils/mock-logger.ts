import { vi } from "vitest";

import { Logger } from "../utils/logger.js";

export function createMockLogger(): Logger {
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
  };
}
