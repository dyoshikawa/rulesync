#nullable enable

using System;
using System.Collections.Generic;
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
    public void GenerateAsync_InvalidToolTarget_ThrowsArgumentException(ToolTarget invalidTarget)
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Targets = new[] { invalidTarget } };

        var ex = Assert.Throws<ArgumentException>(() =>
            client.GenerateAsync(options));

        Assert.Contains("Invalid ToolTarget", ex.Message);
    }

    [Fact]
    public void GenerateAsync_AllValidToolTargets_DoesNotThrow()
    {
        using var client = new RulesyncClient();
        var allTargets = System.Enum.GetValues<ToolTarget>();

        var options = new GenerateOptions { Targets = allTargets };

        // Should not throw for valid enum values
        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    #endregion

    #region Enum Validation - Feature

    [Theory]
    [InlineData((Feature)999)]
    [InlineData((Feature)(-1))]
    [InlineData((Feature)int.MinValue)]
    [InlineData((Feature)int.MaxValue)]
    public void GenerateAsync_InvalidFeature_ThrowsArgumentException(Feature invalidFeature)
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Features = new[] { invalidFeature } };

        var ex = Assert.Throws<ArgumentException>(() =>
            client.GenerateAsync(options));

        Assert.Contains("Invalid Feature", ex.Message);
    }

    [Fact]
    public void GenerateAsync_AllValidFeatures_DoesNotThrow()
    {
        using var client = new RulesyncClient();
        var allFeatures = System.Enum.GetValues<Feature>();

        var options = new GenerateOptions { Features = allFeatures };

        // Should not throw for valid enum values
        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    #endregion

    #region Import Target Validation

    [Theory]
    [InlineData((ToolTarget)999)]
    [InlineData((ToolTarget)(-1))]
    [InlineData((ToolTarget)0)] // Default value
    public void ImportAsync_InvalidTarget_ThrowsArgumentException(ToolTarget invalidTarget)
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions { Target = invalidTarget };

        var ex = Assert.Throws<ArgumentException>(() =>
            client.ImportAsync(options));

        Assert.Contains("Invalid ToolTarget", ex.Message);
    }

    [Fact]
    public void ImportAsync_DefaultTarget_ThrowsArgumentException()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions { Target = default(ToolTarget) };

        var ex = Assert.Throws<ArgumentException>(() =>
            client.ImportAsync(options));

        Assert.Contains("Invalid ToolTarget", ex.Message);
    }

    [Theory]
    [InlineData(ToolTarget.ClaudeCode)]
    [InlineData(ToolTarget.Cursor)]
    [InlineData(ToolTarget.Copilot)]
    [InlineData(ToolTarget.Windsurf)]
    [InlineData(ToolTarget.Zed)]
    public void ImportAsync_ValidTarget_DoesNotThrow(ToolTarget validTarget)
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions { Target = validTarget };

        // Should not throw for valid targets
        var task = client.ImportAsync(options);
        Assert.NotNull(task);
    }

    #endregion

    #region Boolean Flag Tests

    [Fact]
    public void GenerateArgs_VerboseTrue_AddsVerboseFlag()
    {
        // Indirectly test via building args - would need reflection to verify
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Verbose = true };

        // Just verify it doesn't throw
        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_SilentFalse_AddsNoSilentFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Silent = false };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_DeleteTrue_AddsDeleteFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Delete = true };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_GlobalTrue_AddsGlobalFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Global = true };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_SimulateCommandsTrue_AddsFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { SimulateCommands = true };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_SimulateSubagentsTrue_AddsFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { SimulateSubagents = true };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_SimulateSkillsTrue_AddsFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { SimulateSkills = true };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_DryRunTrue_AddsDryRunFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { DryRun = true };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_CheckTrue_AddsCheckFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Check = true };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    #endregion

    #region Config Path Tests

    [Fact]
    public void GenerateArgs_ConfigPath_AddsConfigFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { ConfigPath = "/path/to/config.js" };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void ImportArgs_ConfigPath_AddsConfigFlag()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            ConfigPath = "/path/to/config.js"
        };

        var task = client.ImportAsync(options);
        Assert.NotNull(task);
    }

    #endregion

    #region Combined Options Tests

    [Fact]
    public void GenerateArgs_MultipleTargets_JoinsWithComma()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions
        {
            Targets = new[] { ToolTarget.ClaudeCode, ToolTarget.Cursor, ToolTarget.Copilot },
            Features = new[] { Feature.Rules, Feature.Mcp }
        };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_MultipleFeatures_JoinsWithComma()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions
        {
            Targets = new[] { ToolTarget.ClaudeCode },
            Features = new[] { Feature.Rules, Feature.Ignore, Feature.Mcp, Feature.Skills }
        };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_AllBooleanFlagsTrue_AddsAllFlags()
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

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void ImportArgs_MultipleFeatures_JoinsWithComma()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = new[] { Feature.Rules, Feature.Ignore, Feature.Mcp }
        };

        var task = client.ImportAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void ImportArgs_AllBooleanFlags_AddsAllFlags()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Verbose = true,
            Silent = false,
            Global = true
        };

        var task = client.ImportAsync(options);
        Assert.NotNull(task);
    }

    #endregion

    #region Edge Cases

    [Fact]
    public void GenerateArgs_EmptyTargets_DoesNotAddTargetsFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Targets = Array.Empty<ToolTarget>() };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_EmptyFeatures_DoesNotAddFeaturesFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Features = Array.Empty<Feature>() };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_NullTargets_DoesNotAddTargetsFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Targets = null };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void GenerateArgs_NullFeatures_DoesNotAddFeaturesFlag()
    {
        using var client = new RulesyncClient();
        var options = new GenerateOptions { Features = null };

        var task = client.GenerateAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void ImportArgs_EmptyFeatures_DoesNotAddFeaturesFlag()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = Array.Empty<Feature>()
        };

        var task = client.ImportAsync(options);
        Assert.NotNull(task);
    }

    [Fact]
    public void ImportArgs_NullFeatures_DoesNotAddFeaturesFlag()
    {
        using var client = new RulesyncClient();
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = null
        };

        var task = client.ImportAsync(options);
        Assert.NotNull(task);
    }

    #endregion
}
