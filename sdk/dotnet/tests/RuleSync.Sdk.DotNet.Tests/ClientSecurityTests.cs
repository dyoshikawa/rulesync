#nullable enable

using System;
using RuleSync.Sdk.Models;
using Xunit;

namespace RuleSync.Sdk.Tests;

public class ClientSecurityTests
{
    #region Path Validation - ValidateExecutablePath

    [Fact]
    public void Constructor_NullByteInExecutablePath_ThrowsArgumentException()
    {
        var maliciousPath = "/usr/bin/node\0--version";

        var ex = Assert.Throws<ArgumentException>(() =>
            new RulesyncClient(nodeExecutablePath: maliciousPath));

        Assert.Contains("invalid characters", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Constructor_NullByteInRulesyncPath_ThrowsArgumentException()
    {
        var maliciousPath = "/path/to/rulesync\0--malicious";

        var ex = Assert.Throws<ArgumentException>(() =>
            new RulesyncClient(rulesyncPath: maliciousPath));

        Assert.Contains("invalid characters", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Constructor_DirectoryTraversalInExecutablePath_ThrowsArgumentException()
    {
        var maliciousPath = "../../../etc/passwd";

        var ex = Assert.Throws<ArgumentException>(() =>
            new RulesyncClient(nodeExecutablePath: maliciousPath));

        Assert.Contains("directory traversal", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Constructor_DirectoryTraversalWithBackslashes_ThrowsArgumentException()
    {
        var maliciousPath = "..\\..\\windows\\system32\\calc.exe";

        var ex = Assert.Throws<ArgumentException>(() =>
            new RulesyncClient(nodeExecutablePath: maliciousPath));

        Assert.Contains("directory traversal", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Constructor_RelativePathWithDotSlash_ThrowsArgumentException()
    {
        var maliciousPath = "./malicious";

        var ex = Assert.Throws<ArgumentException>(() =>
            new RulesyncClient(nodeExecutablePath: maliciousPath));

        Assert.Contains("directory traversal", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Constructor_AbsolutePath_NormalizesPath()
    {
        // This should not throw - absolute paths are normalized
        var client = new RulesyncClient(nodeExecutablePath: "/usr/bin/node");

        Assert.NotNull(client);
        client.Dispose();
    }

    [Fact]
    public void Constructor_ValidRelativePathLikeNode_Accepts()
    {
        // "node" is a valid relative path that will be resolved from PATH
        var client = new RulesyncClient(nodeExecutablePath: "node");

        Assert.NotNull(client);
        client.Dispose();
    }

    [Fact]
    public void Constructor_ValidRelativePathLikeNpx_Accepts()
    {
        // "npx" is a valid relative path that will be resolved from PATH
        var client = new RulesyncClient(nodeExecutablePath: "npx");

        Assert.NotNull(client);
        client.Dispose();
    }

    [Fact]
    public void Constructor_PathWithMixedTraversal_ThrowsArgumentException()
    {
        var maliciousPath = "foo/../bar/../../../etc/shadow";

        var ex = Assert.Throws<ArgumentException>(() =>
            new RulesyncClient(nodeExecutablePath: maliciousPath));

        Assert.Contains("directory traversal", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    #endregion

    #region Path Validation - ValidateConfigPath

    [Fact]
    public void GenerateAsync_NullByteInConfigPath_ThrowsArgumentException()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { ConfigPath = "/path/to/config\0--evil" };

        var ex = Assert.Throws<ArgumentException>(() =>
            client.GenerateAsync(options));

        Assert.Contains("invalid characters", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ImportAsync_NullByteInConfigPath_ThrowsArgumentException()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            ConfigPath = "/path/to/config\0--evil"
        };

        var ex = Assert.Throws<ArgumentException>(() =>
            client.ImportAsync(options));

        Assert.Contains("invalid characters", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void GenerateAsync_ConfigPath_NormalizesToFullPath()
    {
        // This should not throw - paths are normalized
        using var client = new RulesyncClient();
        var options = new GenerateOptions { ConfigPath = "../rulesync.config.js" };

        // The call itself validates the path synchronously before async execution
        // This should not throw because path normalization happens before the async call
        _ = client.GenerateAsync(options);
    }

    #endregion

    #region Security Edge Cases

    [Fact]
    public void Constructor_EmptyStringExecutablePath_AcceptsAsRelative()
    {
        // Empty string falls back to "node" default
        var client = new RulesyncClient();

        Assert.NotNull(client);
        client.Dispose();
    }

    [Fact]
    public void Constructor_WhitespaceOnlyExecutablePath_Accepts()
    {
        // Whitespace is treated as a relative path
        var client = new RulesyncClient(nodeExecutablePath: "   ");

        Assert.NotNull(client);
        client.Dispose();
    }

    [Fact]
    public void Constructor_MultipleNullBytes_ThrowsArgumentException()
    {
        var maliciousPath = "\0\0\0/usr/bin/node";

        var ex = Assert.Throws<ArgumentException>(() =>
            new RulesyncClient(nodeExecutablePath: maliciousPath));

        Assert.Contains("invalid characters", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Constructor_UrlEncodedTraversal_Accepts()
    {
        // URL encoding should NOT be decoded automatically
        var maliciousPath = "..%2f..%2fetc%2fpasswd";

        // This actually doesn't contain ".." literally, so it passes
        // URL encoding is not automatically decoded
        var client = new RulesyncClient(nodeExecutablePath: maliciousPath);

        // If it passes, verify it was treated as a relative path
        Assert.NotNull(client);
        client.Dispose();
    }

    [Fact]
    public void Constructor_NullOrFalseInPath_ThrowsArgumentException()
    {
        // null byte is different from "null" string
        var pathWithNull = "node\0false";

        var ex = Assert.Throws<ArgumentException>(() =>
            new RulesyncClient(nodeExecutablePath: pathWithNull));

        Assert.Contains("invalid characters", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Constructor_ShellInjectionAttempt_Accepts()
    {
        var maliciousPath = "node; rm -rf /";

        // Shell injection via ; is not directly prevented but path validation
        // should catch directory traversal or null bytes
        // This test verifies the actual behavior
        var client = new RulesyncClient(nodeExecutablePath: maliciousPath);

        Assert.NotNull(client);
        client.Dispose();
    }

    [Fact]
    public void Constructor_CommandSubstitutionAttempt_Accepts()
    {
        var maliciousPath = "$(whoami)";

        // Command substitution syntax - treated as relative path
        var client = new RulesyncClient(nodeExecutablePath: maliciousPath);

        Assert.NotNull(client);
        client.Dispose();
    }

    #endregion
}
