import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../src/test-utils/test-directories.js";
import type { OpenRouterClient, SecurityScanResult } from "./security-scan-lib.js";
import {
  SecurityScanResultSchema,
  countHighSeverityVulnerabilities,
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
          severity: "high",
          reason: "User input is not sanitized",
          filePath: "src/db.ts",
          line: "L42",
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

  it("should validate a result with line range", () => {
    const input = {
      vulnerabilities: [
        {
          severity: "low",
          reason: "Debug info exposed",
          filePath: "src/debug.ts",
          line: "L10-L11",
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
          reason: "Test",
          filePath: "test.ts",
          line: "L1",
        },
      ],
      summary: "Test",
    };
    expect(() => SecurityScanResultSchema.parse(input)).toThrow();
  });
});

describe("formatEmailBody", () => {
  it("should include only high and critical vulnerabilities", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("app.toon", {
      vulnerabilities: [
        {
          severity: "critical",
          reason: "Remote code execution via unsanitized input",
          filePath: "src/exec.ts",
          line: "L10",
        },
        {
          severity: "low",
          reason: "Minor style issue",
          filePath: "src/style.ts",
          line: "L5",
        },
      ],
      summary: "Critical issue found",
    });

    const body = formatEmailBody({ results });
    expect(body).toContain("# Security Scan Report");
    expect(body).toContain("## app.toon");
    expect(body).toContain("Critical issue found");
    expect(body).toContain("[critical] src/exec.ts L10");
    expect(body).toContain("Reason: Remote code execution via unsanitized input");
    expect(body).not.toContain("[low]");
    expect(body).not.toContain("Minor style issue");
    expect(body).toContain("Found 1 vulnerability (high+)");
  });

  it("should exclude low and medium vulnerabilities", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("b.toon", {
      vulnerabilities: [
        {
          severity: "low",
          reason: "Not critical",
          filePath: "src/minor.ts",
          line: "L5",
        },
        {
          severity: "medium",
          reason: "Moderate issue",
          filePath: "src/moderate.ts",
          line: "L20",
        },
      ],
      summary: "Minor issues",
    });

    const body = formatEmailBody({ results });
    expect(body).toContain("## b.toon");
    expect(body).toContain("Found 0 vulnerabilities (high+)");
    expect(body).not.toContain("[low]");
    expect(body).not.toContain("[medium]");
  });

  it("should format multiple files with mixed severities", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("a.toon", {
      vulnerabilities: [],
      summary: "Clean",
    });
    results.set("b.toon", {
      vulnerabilities: [
        {
          severity: "high",
          reason: "SQL injection",
          filePath: "src/db.ts",
          line: "L42",
        },
        {
          severity: "low",
          reason: "Not critical",
          filePath: "src/minor.ts",
          line: "L5",
        },
      ],
      summary: "Issues found",
    });

    const body = formatEmailBody({ results });
    expect(body).toContain("## a.toon");
    expect(body).toContain("## b.toon");
    expect(body).toContain("[high] src/db.ts L42");
    expect(body).not.toContain("[low]");
  });

  it("should handle empty results map", () => {
    const results = new Map<string, SecurityScanResult>();
    const body = formatEmailBody({ results });
    expect(body).toContain("# Security Scan Report");
    expect(body).not.toContain("## ");
  });
});

describe("countHighSeverityVulnerabilities", () => {
  it("should count only high and critical vulnerabilities", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("app.toon", {
      vulnerabilities: [
        { severity: "critical", reason: "RCE", filePath: "a.ts", line: "L1" },
        { severity: "high", reason: "SQLi", filePath: "b.ts", line: "L2" },
        { severity: "medium", reason: "XSS", filePath: "c.ts", line: "L3" },
        { severity: "low", reason: "Info", filePath: "d.ts", line: "L4" },
      ],
      summary: "Mixed",
    });

    expect(countHighSeverityVulnerabilities({ results })).toBe(2);
  });

  it("should return 0 when no high severity vulnerabilities exist", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("app.toon", {
      vulnerabilities: [
        { severity: "low", reason: "Info", filePath: "a.ts", line: "L1" },
        { severity: "medium", reason: "XSS", filePath: "b.ts", line: "L2" },
      ],
      summary: "Minor",
    });

    expect(countHighSeverityVulnerabilities({ results })).toBe(0);
  });

  it("should count across multiple files", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("a.toon", {
      vulnerabilities: [{ severity: "high", reason: "SQLi", filePath: "a.ts", line: "L1" }],
      summary: "A",
    });
    results.set("b.toon", {
      vulnerabilities: [
        { severity: "critical", reason: "RCE", filePath: "b.ts", line: "L1" },
        { severity: "low", reason: "Info", filePath: "c.ts", line: "L2" },
      ],
      summary: "B",
    });

    expect(countHighSeverityVulnerabilities({ results })).toBe(2);
  });
});

describe("runSecurityScan", () => {
  it("should parse response from OpenRouter SDK", async () => {
    const scanResult: SecurityScanResult = {
      vulnerabilities: [
        {
          severity: "high",
          reason: "Cross-site scripting",
          filePath: "src/render.ts",
          line: "L15-L20",
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
