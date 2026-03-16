import { vi } from "vitest";

import { Logger } from "../../../utils/logger.js";

export function createMockLogger(): Logger {
  return {
    configure: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    jsonMode: false,
    captureData: vi.fn(),
  } as unknown as Logger;
}
