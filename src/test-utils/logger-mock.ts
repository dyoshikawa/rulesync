import { vi } from "vitest";

export const createLoggerMock = () => {
  return {
    setVerbose: vi.fn(),
    get verbose() {
      return false;
    },
    log: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
};

export const mockLogger = createLoggerMock();