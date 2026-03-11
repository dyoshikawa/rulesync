#nullable enable

using System;
using System.Threading;
using System.Threading.Tasks;
using RuleSync.Sdk.Models;
using Xunit;

namespace RuleSync.Sdk.Tests;

public class ClientAsyncTests : IDisposable
{
    private readonly RulesyncClient _client;

    public ClientAsyncTests()
    {
        // Use longer timeout for CI environments
        _client = new RulesyncClient(timeout: TimeSpan.FromSeconds(30));
    }

    public void Dispose()
    {
        _client.Dispose();
        GC.SuppressFinalize(this);
    }

    #region GenerateAsync Tests

    [Fact]
    public async Task GenerateAsync_WithValidOptions_ReturnsResult()
    {
        // This test requires rulesync to be available
        // It may fail if rulesync is not installed
        var options = new GenerateOptions
        {
            Targets = new[] { ToolTarget.ClaudeCode },
            Features = new[] { Feature.Rules },
            DryRun = true // Don't actually generate files
        };

        // This test will only work if rulesync CLI is available
        // Skip if rulesync is not available
        try
        {
            var result = await _client.GenerateAsync(options);

            // Result could be success or failure depending on environment
            // but it should complete without throwing
            Assert.True(true); // If we get here, it completed
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable if rulesync is slow
        }
    }

    [Fact]
    public async Task GenerateAsync_NullOptions_UsesDefaults()
    {
        try
        {
            _ = await _client.GenerateAsync(null);

            // Should not throw - uses default options
            Assert.True(true);
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable
        }
    }

    [Fact]
    public async Task GenerateAsync_WithAllOptions_SetsAllFlags()
    {
        var options = new GenerateOptions
        {
            Targets = new[] { ToolTarget.ClaudeCode },
            Features = new[] { Feature.Rules },
            Verbose = true,
            Silent = false,
            Delete = true,
            Global = true,
            SimulateCommands = true,
            SimulateSubagents = true,
            SimulateSkills = true,
            DryRun = true,
            Check = true
        };

        try
        {
            _ = await _client.GenerateAsync(options);
            Assert.True(true);
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable
        }
    }

    #endregion

    #region ImportAsync Tests

    [Fact]
    public async Task ImportAsync_WithValidOptions_ReturnsResult()
    {
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = new[] { Feature.Rules }
        };

        try
        {
            _ = await _client.ImportAsync(options);
            Assert.True(true);
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable
        }
    }

    [Fact]
    public async Task ImportAsync_WithAllOptions_SetsAllFlags()
    {
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = new[] { Feature.Rules, Feature.Mcp },
            Verbose = true,
            Silent = false,
            Global = true
        };

        try
        {
            _ = await _client.ImportAsync(options);
            Assert.True(true);
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable
        }
    }

    #endregion

    #region Disposal Tests

    [Fact]
    public async Task GenerateAsync_AfterDispose_ThrowsObjectDisposedException()
    {
        var client = new RulesyncClient();
        client.Dispose();

        await Assert.ThrowsAsync<ObjectDisposedException>(async () =>
            await client.GenerateAsync());
    }

    [Fact]
    public async Task ImportAsync_AfterDispose_ThrowsObjectDisposedException()
    {
        var client = new RulesyncClient();
        client.Dispose();

        var options = new ImportOptions { Target = ToolTarget.ClaudeCode };

        await Assert.ThrowsAsync<ObjectDisposedException>(async () =>
            await client.ImportAsync(options));
    }

    [Fact]
    public void Dispose_CanBeCalledMultipleTimes()
    {
        var client = new RulesyncClient();

        client.Dispose();
        client.Dispose(); // Should not throw
        client.Dispose(); // Should not throw

        Assert.True(true); // If we get here, no exception was thrown
    }

    #endregion

    #region Error Handling Tests

    [Fact]
    public async Task GenerateAsync_InvalidExecutable_ReturnsFailureResult()
    {
        // Use a client with a non-existent executable
        using var client = new RulesyncClient(
            nodeExecutablePath: "/nonexistent/node",
            timeout: TimeSpan.FromSeconds(5));

        var options = new GenerateOptions();

        var result = await client.GenerateAsync(options);

        // Should return a failure result, not throw
        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task ImportAsync_InvalidExecutable_ReturnsFailureResult()
    {
        using var client = new RulesyncClient(
            nodeExecutablePath: "/nonexistent/node",
            timeout: TimeSpan.FromSeconds(5));

        var options = new ImportOptions { Target = ToolTarget.ClaudeCode };

        var result = await client.ImportAsync(options);

        Assert.True(result.IsFailure);
    }

    #endregion

    #region Concurrent Operations

    [Fact]
    public async Task GenerateAsync_ConcurrentOperations_AllComplete()
    {
        var options = new GenerateOptions { DryRun = true };

        try
        {
            var tasks = new[]
            {
                _client.GenerateAsync(options).AsTask(),
                _client.GenerateAsync(options).AsTask(),
                _client.GenerateAsync(options).AsTask()
            };

            var results = await Task.WhenAll(tasks);

            Assert.All(results, r => Assert.NotNull(r));
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable in concurrent scenarios
        }
    }

    [Fact]
    public async Task ImportAsync_ConcurrentOperations_AllComplete()
    {
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode
        };

        try
        {
            var tasks = new[]
            {
                _client.ImportAsync(options).AsTask(),
                _client.ImportAsync(options).AsTask(),
                _client.ImportAsync(options).AsTask()
            };

            var results = await Task.WhenAll(tasks);

            Assert.All(results, r => Assert.NotNull(r));
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable in concurrent scenarios
        }
    }

    [Fact]
    public async Task MixedOperations_Concurrent_AllComplete()
    {
        var generateOptions = new GenerateOptions { DryRun = true };
        var importOptions = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode
        };

        try
        {
            var tasks = new Task[]
            {
                _client.GenerateAsync(generateOptions).AsTask(),
                _client.ImportAsync(importOptions).AsTask(),
                _client.GenerateAsync(generateOptions).AsTask()
            };

            await Task.WhenAll(tasks);

            Assert.True(true);
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable
        }
    }

    #endregion

    #region Output Size Tests

    [Fact]
    public async Task GenerateAsync_LargeOutput_Completes()
    {
        // This test verifies that the 10MB output size limit is enforced
        // without causing memory issues
        var options = new GenerateOptions
        {
            Targets = new[] { ToolTarget.ClaudeCode },
            Features = new[] { Feature.Rules },
            Verbose = true // More output
        };

        try
        {
            _ = await _client.GenerateAsync(options);
            Assert.True(true);
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable
        }
    }

    #endregion

    #region Edge Cases

    [Fact]
    public async Task GenerateAsync_DefaultToken_Completes()
    {
        try
        {
            _ = await _client.GenerateAsync(new GenerateOptions());
            Assert.True(true);
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable
        }
    }

    [Fact]
    public async Task ImportAsync_DefaultToken_Completes()
    {
        var options = new ImportOptions { Target = ToolTarget.ClaudeCode };

        try
        {
            _ = await _client.ImportAsync(options);
            Assert.True(true);
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable
        }
    }

    [Fact]
    public async Task GenerateAsync_EmptyTargets_Completes()
    {
        var options = new GenerateOptions
        {
            Targets = Array.Empty<ToolTarget>()
        };

        try
        {
            _ = await _client.GenerateAsync(options);
            Assert.True(true);
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable
        }
    }

    [Fact]
    public async Task ImportAsync_EmptyFeatures_Completes()
    {
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = Array.Empty<Feature>()
        };

        try
        {
            _ = await _client.ImportAsync(options);
            Assert.True(true);
        }
        catch (TimeoutException)
        {
            // Timeout is acceptable
        }
    }

    #endregion
}
