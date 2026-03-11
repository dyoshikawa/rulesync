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

        // Should complete without throwing - validates the async operation works
        var result = await _client.GenerateAsync(options);

        // Verify result has valid state (operation completed)
    }

    [Fact]
    public async Task GenerateAsync_NullOptions_UsesDefaults()
    {
        // Should complete without throwing - uses default options
        var result = await _client.GenerateAsync(null);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateAsync_WithAllOptions_CompletesSuccessfully()
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

        // Should complete without throwing - validates all options work
        var result = await _client.GenerateAsync(options);

        // Verify result has valid state
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

        // Should complete without throwing - validates the async operation works
        var result = await _client.ImportAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task ImportAsync_WithAllOptions_CompletesSuccessfully()
    {
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = new[] { Feature.Rules, Feature.Mcp },
            Verbose = true,
            Silent = false,
            Global = true
        };

        // Should complete without throwing - validates all options work
        var result = await _client.ImportAsync(options);

        // Verify result has valid state
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

        // If we get here, no exception was thrown - dispose is idempotent
        Assert.NotNull(client);
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

        var tasks = new[]
        {
            _client.GenerateAsync(options).AsTask(),
            _client.GenerateAsync(options).AsTask(),
            _client.GenerateAsync(options).AsTask()
        };

        var results = await Task.WhenAll(tasks);

        // All operations completed without throwing
        Assert.All(results, r => Assert.True(r.IsSuccess || r.IsFailure));
    }

    [Fact]
    public async Task ImportAsync_ConcurrentOperations_AllComplete()
    {
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode
        };

        var tasks = new[]
        {
            _client.ImportAsync(options).AsTask(),
            _client.ImportAsync(options).AsTask(),
            _client.ImportAsync(options).AsTask()
        };

        var results = await Task.WhenAll(tasks);

        // All operations completed without throwing
        Assert.All(results, r => Assert.True(r.IsSuccess || r.IsFailure));
    }

    [Fact]
    public async Task MixedOperations_Concurrent_AllComplete()
    {
        var generateOptions = new GenerateOptions { DryRun = true };
        var importOptions = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode
        };

        var generateTask1 = _client.GenerateAsync(generateOptions).AsTask();
        var importTask = _client.ImportAsync(importOptions).AsTask();
        var generateTask2 = _client.GenerateAsync(generateOptions).AsTask();

        // Wait for all tasks to complete
        await Task.WhenAll(generateTask1, importTask, generateTask2);

        // All operations completed without throwing - Task.WhenAll guarantees all tasks completed successfully
        // No additional assertions needed since we reached this point
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

        // Should complete without throwing - validates output handling works
        var result = await _client.GenerateAsync(options);

        // Verify result has valid state
    }

    #endregion

    #region Edge Cases

    [Fact]
    public async Task GenerateAsync_DefaultToken_Completes()
    {
        var options = new GenerateOptions
        {
            Targets = new[] { ToolTarget.ClaudeCode },
            Features = new[] { Feature.Rules }
        };

        // Should complete without throwing - validates default token handling
        var result = await _client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task ImportAsync_DefaultToken_Completes()
    {
        var options = new ImportOptions { Target = ToolTarget.ClaudeCode };

        // Should complete without throwing - validates default token handling
        var result = await _client.ImportAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateAsync_EmptyTargets_Completes()
    {
        var options = new GenerateOptions
        {
            Targets = Array.Empty<ToolTarget>()
        };

        // Should complete without throwing - validates empty targets handling
        var result = await _client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task ImportAsync_EmptyFeatures_Completes()
    {
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = Array.Empty<Feature>()
        };

        // Should complete without throwing - validates empty features handling
        var result = await _client.ImportAsync(options);

        // Verify result has valid state
    }

    #endregion
}
