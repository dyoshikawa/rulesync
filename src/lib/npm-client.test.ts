import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockLogger } from "../test-utils/mock-logger.js";
import {
  buildPackumentUrl,
  fetchPackument,
  fetchTarball,
  getPackumentVersionDist,
  logNpmAuthHints,
  NpmClientError,
  resolveNpmToken,
  resolvePackumentVersion,
  shasumToSri,
  validateNpmPackageName,
  validateNpmRegistryUrl,
  verifyTarballIntegrity,
} from "./npm-client.js";

// Obviously-fake placeholder token for tests (never a real credential).
const FAKE_TOKEN = "npm-test-token-placeholder";

const logger = createMockLogger();

function mockFetchResponse(params: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  body?: Buffer;
  contentLength?: string;
}): Response {
  const { ok = true, status = 200, json, body, contentLength } = params;
  return {
    ok,
    status,
    headers: new Headers(contentLength !== undefined ? { "content-length": contentLength } : {}),
    json: async () => json,
    arrayBuffer: async () =>
      body
        ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
        : new ArrayBuffer(0),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("validateNpmPackageName", () => {
  it("accepts unscoped and scoped names", () => {
    expect(() => validateNpmPackageName("my-skill-package")).not.toThrow();
    expect(() => validateNpmPackageName("@acme/skills")).not.toThrow();
    expect(() => validateNpmPackageName("pkg.name_with~chars")).not.toThrow();
  });

  it("rejects names that could inject URL paths", () => {
    expect(() => validateNpmPackageName("../evil")).toThrow(NpmClientError);
    expect(() => validateNpmPackageName("a/b/c")).toThrow(NpmClientError);
    expect(() => validateNpmPackageName("name?query")).toThrow(NpmClientError);
    expect(() => validateNpmPackageName("name#hash")).toThrow(NpmClientError);
    expect(() => validateNpmPackageName(".hidden")).toThrow(NpmClientError);
    expect(() => validateNpmPackageName("")).toThrow(NpmClientError);
    expect(() => validateNpmPackageName("a".repeat(215))).toThrow(NpmClientError);
  });
});

describe("validateNpmRegistryUrl", () => {
  it("accepts https URLs", () => {
    expect(() => validateNpmRegistryUrl("https://registry.npmjs.org")).not.toThrow();
    expect(() =>
      validateNpmRegistryUrl("https://acme.jfrog.io/artifactory/api/npm/npm-local/"),
    ).not.toThrow();
  });

  it("warns on http URLs", () => {
    validateNpmRegistryUrl("http://internal-registry.example.com", { logger });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("unencrypted"));
  });

  it("rejects non-http(s) URLs and control characters", () => {
    expect(() => validateNpmRegistryUrl("ftp://registry.example.com")).toThrow(NpmClientError);
    expect(() => validateNpmRegistryUrl("https://evil.example.com/\n")).toThrow(NpmClientError);
  });
});

describe("resolveNpmToken", () => {
  it("reads the variable named by tokenEnv", () => {
    vi.stubEnv("MY_REGISTRY_TOKEN", FAKE_TOKEN);
    expect(resolveNpmToken({ tokenEnv: "MY_REGISTRY_TOKEN" })).toBe(FAKE_TOKEN);
  });

  it("throws when tokenEnv names an unset variable", () => {
    vi.stubEnv("MY_REGISTRY_TOKEN", "");
    expect(() => resolveNpmToken({ tokenEnv: "MY_REGISTRY_TOKEN" })).toThrow(/MY_REGISTRY_TOKEN/);
  });

  it("falls back to NPM_TOKEN when tokenEnv is not set", () => {
    vi.stubEnv("NPM_TOKEN", FAKE_TOKEN);
    expect(resolveNpmToken({})).toBe(FAKE_TOKEN);
  });

  it("returns undefined when no token variable is set", () => {
    vi.stubEnv("NPM_TOKEN", "");
    expect(resolveNpmToken({})).toBeUndefined();
  });
});

describe("buildPackumentUrl", () => {
  it("encodes the scoped package slash and preserves registry paths", () => {
    expect(
      buildPackumentUrl({
        registryUrl: "https://acme.jfrog.io/artifactory/api/npm/npm-local/",
        packageName: "@acme/skills",
      }),
    ).toBe("https://acme.jfrog.io/artifactory/api/npm/npm-local/@acme%2Fskills");
    expect(
      buildPackumentUrl({ registryUrl: "https://registry.npmjs.org", packageName: "my-pkg" }),
    ).toBe("https://registry.npmjs.org/my-pkg");
  });
});

describe("fetchPackument", () => {
  it("requests the abbreviated packument with a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({ json: { versions: {} } }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchPackument({
      registryUrl: "https://registry.example.com",
      packageName: "@acme/skills",
      token: FAKE_TOKEN,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://registry.example.com/@acme%2Fskills",
      expect.objectContaining({
        headers: {
          Accept: "application/vnd.npm.install-v1+json",
          Authorization: `Bearer ${FAKE_TOKEN}`,
        },
      }),
    );
  });

  it("omits the Authorization header without a token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({ json: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchPackument({ registryUrl: "https://registry.example.com", packageName: "pkg" });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers;
    expect(headers).not.toHaveProperty("Authorization");
  });

  it("throws NpmClientError with the status code on HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockFetchResponse({ ok: false, status: 401 })),
    );

    await expect(
      fetchPackument({ registryUrl: "https://registry.example.com", packageName: "pkg" }),
    ).rejects.toMatchObject({ name: "NpmClientError", statusCode: 401 });
  });
});

describe("resolvePackumentVersion", () => {
  const packument = {
    "dist-tags": { latest: "2.0.0", beta: "3.0.0-beta.1" },
    versions: {
      "1.0.0": { dist: { tarball: "https://registry.example.com/pkg/-/pkg-1.0.0.tgz" } },
      "2.0.0": { dist: { tarball: "https://registry.example.com/pkg/-/pkg-2.0.0.tgz" } },
      "3.0.0-beta.1": { dist: { tarball: "https://registry.example.com/pkg/-/pkg-3.tgz" } },
    },
  };

  it("resolves exact versions and dist-tags", () => {
    expect(resolvePackumentVersion({ packument, packageName: "pkg", requested: "1.0.0" })).toBe(
      "1.0.0",
    );
    expect(resolvePackumentVersion({ packument, packageName: "pkg", requested: "latest" })).toBe(
      "2.0.0",
    );
    expect(resolvePackumentVersion({ packument, packageName: "pkg", requested: "beta" })).toBe(
      "3.0.0-beta.1",
    );
  });

  it("rejects semver ranges and unknown versions", () => {
    expect(() =>
      resolvePackumentVersion({ packument, packageName: "pkg", requested: "^1.0.0" }),
    ).toThrow(/semver ranges are not supported/);
    expect(() =>
      resolvePackumentVersion({ packument, packageName: "pkg", requested: "9.9.9" }),
    ).toThrow(NpmClientError);
  });
});

describe("getPackumentVersionDist", () => {
  it("throws when the dist.tarball URL is missing", () => {
    expect(() =>
      getPackumentVersionDist({
        packument: { versions: { "1.0.0": {} } },
        packageName: "pkg",
        version: "1.0.0",
      }),
    ).toThrow(/dist\.tarball/);
  });
});

describe("fetchTarball", () => {
  it("sends the token only to the registry host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ body: Buffer.from("tgz-bytes") }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchTarball({
      tarballUrl: "https://registry.example.com/pkg/-/pkg-1.0.0.tgz",
      registryUrl: "https://registry.example.com",
      token: FAKE_TOKEN,
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toHaveProperty("Authorization");

    await fetchTarball({
      tarballUrl: "https://cdn.other-host.example.com/pkg-1.0.0.tgz",
      registryUrl: "https://registry.example.com",
      token: FAKE_TOKEN,
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).not.toHaveProperty("Authorization");
  });

  it("does not downgrade the token to a plaintext http tarball URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockFetchResponse({ body: Buffer.from("tgz-bytes") }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchTarball({
      tarballUrl: "http://registry.example.com/pkg/-/pkg-1.0.0.tgz",
      registryUrl: "https://registry.example.com",
      token: FAKE_TOKEN,
    });

    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");
  });

  it("aborts a streamed body that exceeds the size cap even without content-length", async () => {
    const chunk = new Uint8Array(1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    await expect(
      fetchTarball({
        tarballUrl: "https://registry.example.com/pkg.tgz",
        registryUrl: "https://registry.example.com",
        maxSize: 4096,
      }),
    ).rejects.toThrow(/max size/);
  });

  it("rejects non-http(s) tarball URLs", async () => {
    await expect(
      fetchTarball({
        tarballUrl: "file:///etc/passwd",
        registryUrl: "https://registry.example.com",
      }),
    ).rejects.toThrow(NpmClientError);
  });

  it("rejects oversized tarballs via content-length", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          mockFetchResponse({ body: Buffer.alloc(0), contentLength: String(200 * 1024 * 1024) }),
        ),
    );

    await expect(
      fetchTarball({
        tarballUrl: "https://registry.example.com/pkg.tgz",
        registryUrl: "https://registry.example.com",
      }),
    ).rejects.toThrow(/max size/);
  });
});

describe("verifyTarballIntegrity", () => {
  const tarball = Buffer.from("tarball-content");
  const sha512 = createHash("sha512").update(tarball).digest("base64");
  const sha1Hex = createHash("sha1").update(tarball).digest("hex");

  it("verifies a matching sha512 SRI integrity", () => {
    expect(() =>
      verifyTarballIntegrity({ tarball, integrity: `sha512-${sha512}`, context: "pkg@1.0.0" }),
    ).not.toThrow();
  });

  it("prefers the strongest algorithm in a multi-entry SRI string", () => {
    expect(() =>
      verifyTarballIntegrity({
        tarball,
        integrity: `sha1-bogus sha512-${sha512}`,
        context: "pkg@1.0.0",
      }),
    ).not.toThrow();
  });

  it("throws on integrity mismatch", () => {
    expect(() =>
      verifyTarballIntegrity({
        tarball,
        integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        context: "pkg@1.0.0",
      }),
    ).toThrow(/tampered/);
  });

  it("falls back to the legacy sha1 shasum", () => {
    expect(() =>
      verifyTarballIntegrity({ tarball, shasum: sha1Hex, context: "pkg@1.0.0" }),
    ).not.toThrow();
    expect(() =>
      verifyTarballIntegrity({ tarball, shasum: "0".repeat(40), context: "pkg@1.0.0" }),
    ).toThrow(/tampered/);
  });

  it("accepts SRI entries carrying options", () => {
    expect(() =>
      verifyTarballIntegrity({
        tarball,
        integrity: `sha512-${sha512}?opt`,
        context: "pkg@1.0.0",
      }),
    ).not.toThrow();
  });

  it("fails closed when integrity is present but unparseable", () => {
    expect(() =>
      verifyTarballIntegrity({ tarball, integrity: "md5-bogus", context: "pkg@1.0.0" }),
    ).toThrow(/malformed integrity/);
    expect(() =>
      verifyTarballIntegrity({
        tarball,
        integrity: "corrupted",
        shasum: sha1Hex,
        context: "pkg@1.0.0",
      }),
    ).toThrow(/malformed integrity/);
  });

  it("warns when no integrity metadata is available", () => {
    verifyTarballIntegrity({ tarball, context: "pkg@1.0.0", logger });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("No integrity metadata"));
  });
});

describe("shasumToSri", () => {
  it("converts a hex sha1 shasum to SRI form", () => {
    const tarball = Buffer.from("abc");
    const hex = createHash("sha1").update(tarball).digest("hex");
    const sri = shasumToSri(hex);
    expect(() => verifyTarballIntegrity({ tarball, integrity: sri, context: "pkg" })).not.toThrow();
  });

  it("rejects malformed shasum values", () => {
    expect(() => shasumToSri("not-hex")).toThrow(NpmClientError);
    expect(() => shasumToSri("abcd")).toThrow(NpmClientError);
  });
});

describe("logNpmAuthHints", () => {
  it("logs an auth hint for 401/403 without ever including a token", () => {
    const hintLogger = createMockLogger();
    logNpmAuthHints({
      error: new NpmClientError("HTTP 401", { statusCode: 401 }),
      logger: hintLogger,
    });
    expect(hintLogger.info).toHaveBeenCalledWith(expect.stringContaining("NPM_TOKEN"));
  });

  it("logs a not-found hint for 404", () => {
    const hintLogger = createMockLogger();
    logNpmAuthHints({
      error: new NpmClientError("HTTP 404", { statusCode: 404 }),
      logger: hintLogger,
    });
    expect(hintLogger.info).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });
});
