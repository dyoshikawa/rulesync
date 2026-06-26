import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestDirectory } from "../src/test-utils/test-directories.js";
import type { OpenRouterClient, SecurityScanResult } from "./security-scan-lib.js";
import {
  SecurityScanResultSchema,
  buildSummaryInput,
  countHighSeverityVulnerabilities,
  formatEmailBody,
  generateOverallSummary,
  getXmlFiles,
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

describe("getXmlFiles", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("should return only .xml files", () => {
    writeFileSync(join(testDir, "a.xml"), "xml-a");
    writeFileSync(join(testDir, "b.xml"), "xml-b");
    writeFileSync(join(testDir, "c.txt"), "not-xml");
    writeFileSync(join(testDir, "d.ts"), "not-xml");

    const files = getXmlFiles({ dir: testDir });
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.endsWith(".xml"))).toBe(true);
  });

  it("should return empty array when no .xml files exist", () => {
    writeFileSync(join(testDir, "a.txt"), "not-xml");

    const files = getXmlFiles({ dir: testDir });
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
    results.set("app.xml", {
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
    expect(body).toContain("## app.xml");
    expect(body).toContain("Critical issue found");
    expect(body).toContain("[critical] src/exec.ts L10");
    expect(body).toContain("Reason: Remote code execution via unsanitized input");
    expect(body).not.toContain("[low]");
    expect(body).not.toContain("Minor style issue");
    expect(body).toContain("Found 1 vulnerability (high+)");
  });

  it("should exclude xml sections with only low and medium vulnerabilities", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("b.xml", {
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
    expect(body).not.toContain("## b.xml");
    expect(body).not.toContain("Minor issues");
    expect(body).not.toContain("[low]");
    expect(body).not.toContain("[medium]");
  });

  it("should format multiple files with mixed severities", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("a.xml", {
      vulnerabilities: [],
      summary: "Clean",
    });
    results.set("b.xml", {
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
    expect(body).not.toContain("## a.xml");
    expect(body).toContain("## b.xml");
    expect(body).toContain("[high] src/db.ts L42");
    expect(body).not.toContain("[low]");
  });

  it("should handle empty results map", () => {
    const results = new Map<string, SecurityScanResult>();
    const body = formatEmailBody({ results });
    expect(body).toContain("# Security Scan Report");
    expect(body).not.toContain("## ");
  });

  it("should prepend the AI summary when provided", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("app.xml", {
      vulnerabilities: [
        { severity: "high", reason: "SQL injection", filePath: "src/db.ts", line: "L42" },
      ],
      summary: "Issues found",
    });

    const body = formatEmailBody({ results, overallSummary: "Overall the codebase is risky." });
    expect(body).toContain("## AI Summary");
    expect(body).toContain("Overall the codebase is risky.");
    // Summary must appear before the per-file sections.
    expect(body.indexOf("## AI Summary")).toBeLessThan(body.indexOf("## app.xml"));
  });

  it("should not render an AI Summary section for empty or whitespace summary", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("app.xml", {
      vulnerabilities: [
        { severity: "high", reason: "SQL injection", filePath: "src/db.ts", line: "L42" },
      ],
      summary: "Issues found",
    });

    expect(formatEmailBody({ results, overallSummary: "" })).not.toContain("## AI Summary");
    expect(formatEmailBody({ results, overallSummary: "   " })).not.toContain("## AI Summary");
  });
});

describe("buildSummaryInput", () => {
  it("should serialize files with their vulnerabilities", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("app.xml", {
      vulnerabilities: [
        { severity: "high", reason: "SQL injection", filePath: "src/db.ts", line: "L42" },
      ],
      summary: "Issues found",
    });

    const input = buildSummaryInput({ results });
    expect(input).toContain("File: app.xml");
    expect(input).toContain("Summary: Issues found");
    expect(input).toContain("- [high] src/db.ts L42: SQL injection");
  });

  it("should mark files with no vulnerabilities", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("clean.xml", {
      vulnerabilities: [],
      summary: "Clean",
    });

    const input = buildSummaryInput({ results });
    expect(input).toContain("File: clean.xml");
    expect(input).toContain("- No vulnerabilities found");
  });
});

describe("generateOverallSummary", () => {
  it("should return the trimmed summary text from OpenRouter", async () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("app.xml", {
      vulnerabilities: [
        { severity: "critical", reason: "RCE", filePath: "src/exec.ts", line: "L10" },
      ],
      summary: "Critical issue",
    });

    const mockClient: OpenRouterClient = {
      chat: {
        send: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "  重大な脆弱性が見つかりました。  " } }],
        }),
      },
    };

    const summary = await generateOverallSummary({
      client: mockClient,
      model: "test-model",
      results,
    });

    expect(summary).toBe("重大な脆弱性が見つかりました。");
    expect(mockClient.chat.send).toHaveBeenCalledOnce();
  });

  it("should throw when no content returned", async () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("app.xml", { vulnerabilities: [], summary: "Clean" });

    const mockClient: OpenRouterClient = {
      chat: {
        send: vi.fn().mockResolvedValue({ choices: [{ message: { content: null } }] }),
      },
    };

    await expect(
      generateOverallSummary({ client: mockClient, model: "test-model", results }),
    ).rejects.toThrow("No content returned from OpenRouter");
  });
});

describe("countHighSeverityVulnerabilities", () => {
  it("should count only high and critical vulnerabilities", () => {
    const results = new Map<string, SecurityScanResult>();
    results.set("app.xml", {
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
    results.set("app.xml", {
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
    results.set("a.xml", {
      vulnerabilities: [{ severity: "high", reason: "SQLi", filePath: "a.ts", line: "L1" }],
      summary: "A",
    });
    results.set("b.xml", {
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
      content: "some code",
      model: "test-model",
      prompt: "analyze this",
    });

    expect(result).toEqual(scanResult);
    expect(mockClient.chat.send).toHaveBeenCalledOnce();
    // Lock in the OpenRouter SDK request shape (chatRequest/appTitle), which
    // the SDK validates at call time and silently breaks the scan if wrong.
    const sendArg = vi.mocked(mockClient.chat.send).mock.calls[0]?.[0];
    expect(sendArg).toMatchObject({
      chatRequest: {
        model: "test-model",
        messages: [{ role: "user", content: "analyze this\n\nsome code" }],
        stream: false,
      },
      appTitle: "rulesync security-scan",
    });
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
        content: "some code",
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
        content: "some code",
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
        content: "some code",
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
        content: "some code",
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
