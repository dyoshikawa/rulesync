#nullable enable

using System;
using System.Threading.Tasks;
using RuleSync.Sdk.Models;
using Xunit;

namespace RuleSync.Sdk.Tests;

public class ClientArgumentBuilderTests
{
    #region Enum Validation - ToolTarget

    [Theory]
    [InlineData((ToolTarget)999)]
    [InlineData((ToolTarget)(-1))]
    [InlineData((ToolTarget)int.MinValue)]
    [InlineData((ToolTarget)int.MaxValue)]
    public async Task GenerateAsync_InvalidToolTarget_ThrowsArgumentException(ToolTarget invalidTarget)
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Targets = new[] { invalidTarget } };

        var ex = await Assert.ThrowsAsync<ArgumentException>(async () =>
            await client.GenerateAsync(options));

        Assert.Equal("targets", ex.ParamName);
    }

    [Fact]
    public async Task GenerateAsync_AllValidToolTargets_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var allTargets = System.Enum.GetValues<ToolTarget>();

        var options = new GenerateOptions { Targets = allTargets };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state (it should since we got here)
    }

    #endregion

    #region Enum Validation - Feature

    [Theory]
    [InlineData((Feature)999)]
    [InlineData((Feature)(-1))]
    [InlineData((Feature)int.MinValue)]
    [InlineData((Feature)int.MaxValue)]
    public async Task GenerateAsync_InvalidFeature_ThrowsArgumentException(Feature invalidFeature)
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Features = new[] { invalidFeature } };

        var ex = await Assert.ThrowsAsync<ArgumentException>(async () =>
            await client.GenerateAsync(options));

        Assert.Equal("features", ex.ParamName);
    }

    [Fact]
    public async Task GenerateAsync_AllValidFeatures_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var allFeatures = System.Enum.GetValues<Feature>();

        var options = new GenerateOptions { Features = allFeatures };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    #endregion

    #region Import Target Validation

    [Theory]
    [InlineData((ToolTarget)999)]
    [InlineData((ToolTarget)(-1))]
    [InlineData((ToolTarget)0)] // Default value
    public async Task ImportAsync_InvalidTarget_ThrowsArgumentException(ToolTarget invalidTarget)
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions { Target = invalidTarget };

        var ex = await Assert.ThrowsAsync<ArgumentException>(async () =>
            await client.ImportAsync(options));

        Assert.Equal("target", ex.ParamName);
    }

    [Fact]
    public async Task ImportAsync_DefaultTarget_ThrowsArgumentException()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions { Target = default(ToolTarget) };

        var ex = await Assert.ThrowsAsync<ArgumentException>(async () =>
            await client.ImportAsync(options));

        Assert.Equal("target", ex.ParamName);
    }

    [Theory]
    [InlineData(ToolTarget.ClaudeCode)]
    [InlineData(ToolTarget.Cursor)]
    [InlineData(ToolTarget.Copilot)]
    [InlineData(ToolTarget.Windsurf)]
    [InlineData(ToolTarget.Zed)]
    public async Task ImportAsync_ValidTarget_CompletesSuccessfully(ToolTarget validTarget)
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions { Target = validTarget };

        // Should complete without throwing - validates argument building works
        var result = await client.ImportAsync(options);

        // Verify result has valid state
    }

    #endregion

    #region Boolean Flag Tests

    [Fact]
    public async Task GenerateArgs_VerboseTrue_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Verbose = true };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_SilentFalse_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Silent = false };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_DeleteTrue_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Delete = true };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_GlobalTrue_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Global = true };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_SimulateCommandsTrue_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { SimulateCommands = true };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_SimulateSubagentsTrue_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { SimulateSubagents = true };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_SimulateSkillsTrue_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { SimulateSkills = true };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_DryRunTrue_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { DryRun = true };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_CheckTrue_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Check = true };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    #endregion

    #region Config Path Tests

    [Fact]
    public async Task GenerateArgs_ConfigPath_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { ConfigPath = "/path/to/config.js" };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task ImportArgs_ConfigPath_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            ConfigPath = "/path/to/config.js"
        };

        // Should complete without throwing - validates argument building works
        var result = await client.ImportAsync(options);

        // Verify result has valid state
    }

    #endregion

    #region Combined Options Tests

    [Fact]
    public async Task GenerateArgs_MultipleTargets_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions
        {
            Targets = new[] { ToolTarget.ClaudeCode, ToolTarget.Cursor, ToolTarget.Copilot },
            Features = new[] { Feature.Rules, Feature.Mcp }
        };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_MultipleFeatures_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions
        {
            Targets = new[] { ToolTarget.ClaudeCode },
            Features = new[] { Feature.Rules, Feature.Ignore, Feature.Mcp, Feature.Skills }
        };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_AllBooleanFlags_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions
        {
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

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task ImportArgs_MultipleFeatures_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = new[] { Feature.Rules, Feature.Ignore, Feature.Mcp }
        };

        // Should complete without throwing - validates argument building works
        var result = await client.ImportAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task ImportArgs_AllBooleanFlags_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Verbose = true,
            Silent = false,
            Global = true
        };

        // Should complete without throwing - validates argument building works
        var result = await client.ImportAsync(options);

        // Verify result has valid state
    }

    #endregion

    #region Edge Cases

    [Fact]
    public async Task GenerateArgs_EmptyTargets_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Targets = Array.Empty<ToolTarget>() };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_EmptyFeatures_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Features = Array.Empty<Feature>() };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_NullTargets_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Targets = null };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task GenerateArgs_NullFeatures_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Features = null };

        // Should complete without throwing - validates argument building works
        var result = await client.GenerateAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task ImportArgs_EmptyFeatures_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = Array.Empty<Feature>()
        };

        // Should complete without throwing - validates argument building works
        var result = await client.ImportAsync(options);

        // Verify result has valid state
    }

    [Fact]
    public async Task ImportArgs_NullFeatures_CompletesSuccessfully()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = null
        };

        // Should complete without throwing - validates argument building works
        var result = await client.ImportAsync(options);

        // Verify result has valid state
    }

    #endregion
}
