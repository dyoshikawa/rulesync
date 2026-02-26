import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../src/test-utils/test-directories.js";
import type { OpenRouterClient, SecurityScanResult } from "./security-scan-lib.js";
import {
  SecurityScanResultSchema,
  formatEmailBody,
  getToonFiles,
  runSecurityScan,
  sendEmail,
  validateEnv,
} from "./security-scan-lib.js";

const mockSend = vi.fn().mockResolvedValue({ data: { id: "email-id" }, error: null });

vi.mock("resend", () => {
  return {
    Resend: class {
      emails = { send: mockSend };
    },
  };
});

describe("validateEnv", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.SECURITY_SCAN_MODEL = "test-model";
    process.env.SECURITY_SCAN_PROMPT = "Analyze this code for vulnerabilities.";
    process.env.RESEND_API_KEY = "test-resend-key";
    process.env.RESEND_FROM_EMAIL = "security@example.com";
    process.env.SECURITY_SCAN_RECIPIENT = "recipient@example.com";
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("should return validated env when all variables are set", () => {
    const env = validateEnv();
    expect(env).toEqual({
      openrouterApiKey: "test-openrouter-key",
      model: "test-model",
      securityScanPrompt: "Analyze this code for vulnerabilities.",
      resendApiKey: "test-resend-key",
      resendFromEmail: "security@example.com",
      securityScanRecipient: "recipient@example.com",
    });
  });

  it("should throw when OPENROUTER_API_KEY is missing", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => validateEnv()).toThrow("OPENROUTER_API_KEY is not set");
  });

  it("should throw when SECURITY_SCAN_MODEL is missing", () => {
    delete process.env.SECURITY_SCAN_MODEL;
    expect(() => validateEnv()).toThrow("SECURITY_SCAN_MODEL is not set");
  });

  it("should throw when SECURITY_SCAN_PROMPT is missing", () => {
    delete process.env.SECURITY_SCAN_PROMPT;
    expect(() => validateEnv()).toThrow("SECURITY_SCAN_PROMPT is not set");
  });

  it("should throw when RESEND_API_KEY is missing", () => {
    delete process.env.RESEND_API_KEY;
    expect(() => validateEnv()).toThrow("RESEND_API_KEY is not set");
  });

  it("should throw when RESEND_FROM_EMAIL is missing", () => {
    delete process.env.RESEND_FROM_EMAIL;
    expect(() => validateEnv()).toThrow("RESEND_FROM_EMAIL is not set");
  });

  it("should throw when SECURITY_SCAN_RECIPIENT is missing", () => {
    delete process.env.SECURITY_SCAN_RECIPIENT;
    expect(() => validateEnv()).toThrow("SECURITY_SCAN_RECIPIENT is not set");
  });
});

describe("getToonFiles", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return only .toon files", () => {
    writeFileSync(join(testDir, "a.toon"), "toon-a");
    writeFileSync(join(testDir, "b.toon"), "toon-b");
    writeFileSync(join(testDir, "c.txt"), "not-toon");
    writeFileSync(join(testDir, "d.ts"), "not-toon");

    const files = getToonFiles({ dir: testDir });
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".toon"))).toBe(true);
  });

  it("should return empty array when no .toon files exist", () => {
    writeFileSync(join(testDir, "a.txt"), "not-toon");

    const files = getToonFiles({ dir: testDir });
    expect(files).toHaveLength(0);
  });
});

describe("SecurityScanResultSchema", () => {
  it("should validate a correct result", () => {
    const input = {
      vulnerabilities: [
        {
          severity: "HIGH",
          title: "SQL Injection",
          description: "User input is not sanitized",
          location: "src/db.ts:42",
          recommendation: "Use parameterized queries",
        },
      ],
      summary: "Found 1 vulnerability",
    };
    const result = SecurityScanResultSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("should validate a result with no vulnerabilities", () => {
    const input = {
      vulnerabilities: [],
      summary: "No vulnerabilities found",
    };
    const result = SecurityScanResultSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("should validate a result with optional fields omitted", () => {
    const input = {
      vulnerabilities: [
        {
          severity: "LOW",
          title: "Info disclosure",
          description: "Debug info exposed",
        },
      ],
      summary: "Found 1 vulnerability",
    };
    const result = SecurityScanResultSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("should reject invalid severity", () => {
    const input = {
      vulnerabilities: [
        {
          severity: "UNKNOWN",
          title: "Test",
          description: "Test",
        },
      ],
      summary: "Test",
    };
    expect(() => SecurityScanResultSchema.parse(input)).toThrow();
  });
});

describe("formatEmailBody", () => {
  it("should format results as markdown", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("app.toon", {
      vulnerabilities: [
        {
          severity: "CRITICAL",
          title: "RCE",
          description: "Remote code execution",
          location: "src/exec.ts:10",
          recommendation: "Sanitize input",
        },
      ],
      summary: "Critical issue found",
    });

    const body = formatEmailBody({ results });
    expect(body).toContain("# Security Scan Report");
    expect(body).toContain("## app.toon");
    expect(body).toContain("Critical issue found");
    expect(body).toContain("[CRITICAL] RCE");
    expect(body).toContain("Location: src/exec.ts:10");
    expect(body).toContain("Remote code execution");
    expect(body).toContain("Sanitize input");
  });

  it("should format multiple files", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("a.toon", {
      vulnerabilities: [],
      summary: "Clean",
    });
    results.set("b.toon", {
      vulnerabilities: [
        {
          severity: "LOW",
          title: "Minor issue",
          description: "Not critical",
        },
      ],
      summary: "Minor issues",
    });

    const body = formatEmailBody({ results });
    expect(body).toContain("## a.toon");
    expect(body).toContain("## b.toon");
    expect(body).toContain("Found 0 vulnerabilities");
    expect(body).toContain("Found 1 vulnerability");
  });

  it("should handle empty results map", () => {
    const results = new Map<string, SecurityScanResult>();
    const body = formatEmailBody({ results });
    expect(body).toContain("# Security Scan Report");
    expect(body).not.toContain("## ");
  });
});

describe("runSecurityScan", () => {
  it("should parse response from OpenRouter SDK", async () => {
    const scanResult: SecurityScanResult = {
      vulnerabilities: [
        {
          severity: "HIGH",
          title: "XSS",
          description: "Cross-site scripting",
        },
      ],
      summary: "Found XSS",
    };

    const mockClient: OpenRouterClient = {
      chat: {
        send: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify(scanResult),
              },
            },
          ],
        }),
      },
    };

    const result = await runSecurityScan({
      client: mockClient,
      toonContent: "some code",
      model: "test-model",
      prompt: "analyze this",
    });

    expect(result).toEqual(scanResult);
    expect(mockClient.chat.send).toHaveBeenCalledOnce();
  });

  it("should throw when no content returned", async () => {
    const mockClient: OpenRouterClient = {
      chat: {
        send: vi.fn().mockResolvedValue({
          choices: [{ message: { content: null } }],
        }),
      },
    };

    await expect(
      runSecurityScan({
        client: mockClient,
        toonContent: "some code",
        model: "test-model",
        prompt: "analyze this",
      }),
    ).rejects.toThrow("No content returned from OpenRouter");
  });

  it("should throw on invalid JSON response", async () => {
    const mockClient: OpenRouterClient = {
      chat: {
        send: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "not json" } }],
        }),
      },
    };

    await expect(
      runSecurityScan({
        client: mockClient,
        toonContent: "some code",
        model: "test-model",
        prompt: "analyze this",
      }),
    ).rejects.toThrow();
  });

  it("should throw when response fails Zod validation", async () => {
    const mockClient: OpenRouterClient = {
      chat: {
        send: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify({ invalid: "data" }) } }],
        }),
      },
    };

    await expect(
      runSecurityScan({
        client: mockClient,
        toonContent: "some code",
        model: "test-model",
        prompt: "analyze this",
      }),
    ).rejects.toThrow();
  });

  it("should throw when choices array is empty", async () => {
    const mockClient: OpenRouterClient = {
      chat: {
        send: vi.fn().mockResolvedValue({
          choices: [],
        }),
      },
    };

    await expect(
      runSecurityScan({
        client: mockClient,
        toonContent: "some code",
        model: "test-model",
        prompt: "analyze this",
      }),
    ).rejects.toThrow("No content returned from OpenRouter");
  });
});

describe("sendEmail", () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  it("should send email via Resend", async () => {
    await sendEmail({
      apiKey: "test-key",
      from: "security@example.com",
      to: "recipient@example.com",
      subject: "Security Scan Report - 2025-01-01",
      body: "# Report\n\nNo issues found.",
    });

    expect(mockSend).toHaveBeenCalledWith({
      from: "security@example.com",
      to: "recipient@example.com",
      subject: "Security Scan Report - 2025-01-01",
      text: "# Report\n\nNo issues found.",
    });
  });

  it("should throw when Resend returns an error", async () => {
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { message: "Invalid API key", name: "validation_error" },
    });

    await expect(
      sendEmail({
        apiKey: "invalid-key",
        from: "security@example.com",
        to: "recipient@example.com",
        subject: "Security Scan Report",
        body: "# Report",
      }),
    ).rejects.toThrow("Failed to send email: Invalid API key");
  });
});
