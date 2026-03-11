#nullable enable

using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using RuleSync.Sdk.Models;
using Xunit;

namespace RuleSync.Sdk.Tests;

public class ModelTests
{
    [Theory]
    [InlineData(Feature.Rules, "rules")]
    [InlineData(Feature.Ignore, "ignore")]
    [InlineData(Feature.Mcp, "mcp")]
    [InlineData(Feature.Subagents, "subagents")]
    [InlineData(Feature.Commands, "commands")]
    [InlineData(Feature.Skills, "skills")]
    [InlineData(Feature.Hooks, "hooks")]
    public void Feature_Enum_HasExpectedValues(Feature feature, string expectedName)
    {
        Assert.Equal(expectedName, feature.ToString().ToLowerInvariant());
    }

    [Theory]
    [InlineData(ToolTarget.ClaudeCode, "claudecode")]
    [InlineData(ToolTarget.Cursor, "cursor")]
    [InlineData(ToolTarget.Copilot, "copilot")]
    [InlineData(ToolTarget.Windsurf, "windsurf")]
    public void ToolTarget_Enum_HasExpectedValues(ToolTarget target, string expectedName)
    {
        Assert.Equal(expectedName, target.ToString().ToLowerInvariant());
    }

    [Fact]
    public void GenerateOptions_DefaultValues_AreCorrect()
    {
        var options = new GenerateOptions();

        Assert.Null(options.Targets);
        Assert.Null(options.Features);
        Assert.Null(options.BaseDirs);
        Assert.Null(options.ConfigPath);
        Assert.Equal(false, options.Verbose);
        Assert.Equal(true, options.Silent);
        Assert.Equal(false, options.Delete);
        Assert.Equal(false, options.Global);
        Assert.Equal(false, options.SimulateCommands);
        Assert.Equal(false, options.SimulateSubagents);
        Assert.Equal(false, options.SimulateSkills);
        Assert.Equal(false, options.DryRun);
        Assert.Equal(false, options.Check);
    }

    [Fact]
    public void GenerateOptions_CanSetProperties()
    {
        var options = new GenerateOptions
        {
            Targets = new[] { ToolTarget.ClaudeCode, ToolTarget.Cursor },
            Features = new[] { Feature.Rules, Feature.Mcp },
            Verbose = true,
            Silent = false
        };

        Assert.Equal(2, options.Targets.Count);
        Assert.Equal(2, options.Features.Count);
        Assert.Equal(ToolTarget.ClaudeCode, options.Targets[0]);
        Assert.Equal(Feature.Rules, options.Features[0]);
        Assert.True(options.Verbose);
        Assert.False(options.Silent);
    }

    [Fact]
    public void ImportOptions_RequiresTarget()
    {
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = new[] { Feature.Rules }
        };

        Assert.Equal(ToolTarget.ClaudeCode, options.Target);
        Assert.Single(options.Features);
    }

    [Fact]
    public void ImportOptions_DefaultValues_AreCorrect()
    {
        var options = new ImportOptions { Target = ToolTarget.ClaudeCode };

        Assert.Null(options.Features);
        Assert.Null(options.ConfigPath);
        Assert.Equal(false, options.Verbose);
        Assert.Equal(true, options.Silent);
        Assert.Equal(false, options.Global);
    }

    [Fact]
    public void GenerateResult_InitializesCollections()
    {
        var result = new GenerateResult();

        Assert.NotNull(result.RulesPaths);
        Assert.NotNull(result.IgnorePaths);
        Assert.NotNull(result.McpPaths);
        Assert.NotNull(result.CommandsPaths);
        Assert.NotNull(result.SubagentsPaths);
        Assert.NotNull(result.SkillsPaths);
        Assert.NotNull(result.HooksPaths);
        Assert.Empty(result.RulesPaths);
    }

    [Fact]
    public void GenerateResult_Serialization_RoundTrips()
    {
        var original = new GenerateResult
        {
            RulesCount = 5,
            RulesPaths = new[] { "path1.md", "path2.md" },
            IgnoreCount = 2,
            IgnorePaths = new[] { ".gitignore" }
        };

        var json = JsonSerializer.Serialize(original);
        var deserialized = JsonSerializer.Deserialize<GenerateResult>(json);

        Assert.NotNull(deserialized);
        Assert.Equal(5, deserialized.RulesCount);
        Assert.Equal(2, deserialized.RulesPaths.Count);
        Assert.Equal("path1.md", deserialized.RulesPaths[0]);
        Assert.Single(deserialized.IgnorePaths);
    }

    [Fact]
    public void ImportResult_Serialization_RoundTrips()
    {
        var original = new ImportResult
        {
            RulesCount = 5,
            IgnoreCount = 2,
            McpCount = 3
        };

        var json = JsonSerializer.Serialize(original);
        var deserialized = JsonSerializer.Deserialize<ImportResult>(json);

        Assert.NotNull(deserialized);
        Assert.Equal(5, deserialized.RulesCount);
        Assert.Equal(2, deserialized.IgnoreCount);
        Assert.Equal(3, deserialized.McpCount);
    }

    [Fact]
    public void Feature_Serialization_UsesCamelCase()
    {
        var feature = Feature.Rules;
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
        };
        var json = JsonSerializer.Serialize(feature, options);

        // With JsonStringEnumConverter, enums serialize as camelCase strings
        Assert.Equal("\"rules\"", json);
    }

    #region Complete Enum Coverage

    // All 26 ToolTarget values
    [Theory]
    [InlineData(ToolTarget.AgentsMd, "agentsmd")]
    [InlineData(ToolTarget.AgentsSkills, "agentsskills")]
    [InlineData(ToolTarget.Antigravity, "antigravity")]
    [InlineData(ToolTarget.AugmentCode, "augmentcode")]
    [InlineData(ToolTarget.AugmentCodeLegacy, "augmentcodelegacy")]
    [InlineData(ToolTarget.ClaudeCode, "claudecode")]
    [InlineData(ToolTarget.ClaudeCodeLegacy, "claudecodelegacy")]
    [InlineData(ToolTarget.Cline, "cline")]
    [InlineData(ToolTarget.CodexCli, "codexcli")]
    [InlineData(ToolTarget.Copilot, "copilot")]
    [InlineData(ToolTarget.Cursor, "cursor")]
    [InlineData(ToolTarget.FactoryDroid, "factorydroid")]
    [InlineData(ToolTarget.GeminiCli, "geminicli")]
    [InlineData(ToolTarget.Goose, "goose")]
    [InlineData(ToolTarget.Junie, "junie")]
    [InlineData(ToolTarget.Kilo, "kilo")]
    [InlineData(ToolTarget.Kiro, "kiro")]
    [InlineData(ToolTarget.OpenCode, "opencode")]
    [InlineData(ToolTarget.QwenCode, "qwencode")]
    [InlineData(ToolTarget.Replit, "replit")]
    [InlineData(ToolTarget.Roo, "roo")]
    [InlineData(ToolTarget.Warp, "warp")]
    [InlineData(ToolTarget.Windsurf, "windsurf")]
    [InlineData(ToolTarget.Zed, "zed")]
    public void ToolTarget_AllValues_HaveExpectedNames(ToolTarget target, string expectedName)
    {
        Assert.Equal(expectedName, target.ToString().ToLowerInvariant());
    }

    [Fact]
    public void ToolTarget_Count_Is24()
    {
        var values = System.Enum.GetValues<ToolTarget>();
        Assert.Equal(24, values.Length);
    }

    // All 7 Feature values
    [Theory]
    [InlineData(Feature.Rules, "rules")]
    [InlineData(Feature.Ignore, "ignore")]
    [InlineData(Feature.Mcp, "mcp")]
    [InlineData(Feature.Subagents, "subagents")]
    [InlineData(Feature.Commands, "commands")]
    [InlineData(Feature.Skills, "skills")]
    [InlineData(Feature.Hooks, "hooks")]
    public void Feature_AllValues_HaveExpectedNames(Feature feature, string expectedName)
    {
        Assert.Equal(expectedName, feature.ToString().ToLowerInvariant());
    }

    [Fact]
    public void Feature_Count_Is7()
    {
        var values = System.Enum.GetValues<Feature>();
        Assert.Equal(7, values.Length);
    }

    // Wildcard enums
    [Fact]
    public void FeaturesWithWildcard_HasWildcardValue()
    {
        Assert.Equal(0, (int)FeaturesWithWildcard.Wildcard);
        Assert.Equal("Wildcard", FeaturesWithWildcard.Wildcard.ToString());
    }

    [Fact]
    public void ToolTargetsWithWildcard_HasWildcardValue()
    {
        Assert.Equal(0, (int)ToolTargetsWithWildcard.Wildcard);
        Assert.Equal("Wildcard", ToolTargetsWithWildcard.Wildcard.ToString());
    }

    #endregion

    #region Model Property Tests

    [Fact]
    public void GenerateOptions_BaseDirs_CanBeSet()
    {
        var options = new GenerateOptions
        {
            BaseDirs = new[] { "/path1", "/path2" }
        };

        Assert.NotNull(options.BaseDirs);
        Assert.Equal(2, options.BaseDirs.Count);
        Assert.Equal("/path1", options.BaseDirs[0]);
        Assert.Equal("/path2", options.BaseDirs[1]);
    }

    [Fact]
    public void GenerateOptions_ConfigPath_CanBeSet()
    {
        var options = new GenerateOptions
        {
            ConfigPath = "/path/to/config.js"
        };

        Assert.Equal("/path/to/config.js", options.ConfigPath);
    }

    [Fact]
    public void ImportOptions_Features_CanBeSet()
    {
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            Features = new[] { Feature.Rules, Feature.Mcp }
        };

        Assert.NotNull(options.Features);
        Assert.Equal(2, options.Features.Count);
        Assert.Equal(Feature.Rules, options.Features[0]);
    }

    [Fact]
    public void ImportOptions_ConfigPath_CanBeSet()
    {
        var options = new ImportOptions
        {
            Target = ToolTarget.ClaudeCode,
            ConfigPath = "/path/to/import-config.js"
        };

        Assert.Equal("/path/to/import-config.js", options.ConfigPath);
    }

    [Fact]
    public void GenerateResult_HasDiff_CanBeSet()
    {
        var result = new GenerateResult
        {
            HasDiff = true
        };

        Assert.True(result.HasDiff);
    }

    [Fact]
    public void GenerateResult_AllProperties_CanBeSet()
    {
        var result = new GenerateResult
        {
            RulesCount = 10,
            RulesPaths = new[] { "rule1.md", "rule2.md" },
            IgnoreCount = 5,
            IgnorePaths = new[] { ".gitignore" },
            McpCount = 3,
            McpPaths = new[] { "mcp.json" },
            CommandsCount = 2,
            CommandsPaths = new[] { "commands/" },
            SubagentsCount = 1,
            SubagentsPaths = new[] { "subagents/" },
            SkillsCount = 4,
            SkillsPaths = new[] { "skills/" },
            HooksCount = 2,
            HooksPaths = new[] { "hooks/" },
            HasDiff = true
        };

        Assert.Equal(10, result.RulesCount);
        Assert.Equal(2, result.RulesPaths.Count);
        Assert.Equal(5, result.IgnoreCount);
        Assert.Equal(3, result.McpCount);
        Assert.Equal(2, result.CommandsCount);
        Assert.Equal(1, result.SubagentsCount);
        Assert.Equal(4, result.SkillsCount);
        Assert.Equal(2, result.HooksCount);
        Assert.True(result.HasDiff);
    }

    [Fact]
    public void ImportResult_AllProperties_CanBeSet()
    {
        var result = new ImportResult
        {
            RulesCount = 10,
            IgnoreCount = 5,
            McpCount = 3,
            CommandsCount = 2,
            SubagentsCount = 1,
            SkillsCount = 4,
            HooksCount = 2
        };

        Assert.Equal(10, result.RulesCount);
        Assert.Equal(5, result.IgnoreCount);
        Assert.Equal(3, result.McpCount);
        Assert.Equal(2, result.CommandsCount);
        Assert.Equal(1, result.SubagentsCount);
        Assert.Equal(4, result.SkillsCount);
        Assert.Equal(2, result.HooksCount);
    }

    #endregion

    #region Serialization Tests

    [Fact]
    public void ToolTarget_Serialization_UsesCamelCase()
    {
        var target = ToolTarget.ClaudeCode;
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
        };
        var json = JsonSerializer.Serialize(target, options);

        // JsonStringEnumConverter with CamelCase converts "ClaudeCode" to "claudeCode"
        Assert.Equal("\"claudeCode\"", json);
    }

    [Fact]
    public void ToolTarget_WithHyphen_SerializesCorrectly()
    {
        var target = ToolTarget.AugmentCodeLegacy;
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
        };
        var json = JsonSerializer.Serialize(target, options);

        // JsonStringEnumConverter converts "AugmentCodeLegacy" to "augmentCodeLegacy"
        Assert.Equal("\"augmentCodeLegacy\"", json);
    }

    [Fact]
    public void GenerateOptions_Serialization_RoundTrips()
    {
        var original = new GenerateOptions
        {
            Targets = new[] { ToolTarget.ClaudeCode, ToolTarget.Cursor },
            Features = new[] { Feature.Rules, Feature.Mcp },
            BaseDirs = new[] { "/path1", "/path2" },
            ConfigPath = "/config.js",
            Verbose = true,
            Silent = false,
            Delete = true,
            Global = false
        };

        var json = JsonSerializer.Serialize(original);
        var deserialized = JsonSerializer.Deserialize<GenerateOptions>(json);

        Assert.NotNull(deserialized);
        Assert.Equal(2, deserialized.Targets?.Count);
        Assert.Equal(2, deserialized.Features?.Count);
        Assert.Equal(2, deserialized.BaseDirs?.Count);
        Assert.Equal("/config.js", deserialized.ConfigPath);
        Assert.True(deserialized.Verbose);
        Assert.False(deserialized.Silent);
        Assert.True(deserialized.Delete);
        Assert.False(deserialized.Global);
    }

    [Fact]
    public void ImportOptions_Serialization_RoundTrips()
    {
        var original = new ImportOptions
        {
            Target = ToolTarget.Windsurf,
            Features = new[] { Feature.Skills, Feature.Commands },
            ConfigPath = "/import-config.js",
            Verbose = true,
            Silent = false,
            Global = true
        };

        var json = JsonSerializer.Serialize(original);
        var deserialized = JsonSerializer.Deserialize<ImportOptions>(json);

        Assert.NotNull(deserialized);
        Assert.Equal(ToolTarget.Windsurf, deserialized.Target);
        Assert.Equal(2, deserialized.Features?.Count);
        Assert.Equal("/import-config.js", deserialized.ConfigPath);
        Assert.True(deserialized.Verbose);
        Assert.False(deserialized.Silent);
        Assert.True(deserialized.Global);
    }

    [Fact]
    public void GenerateResult_WithEmptyCollections_SerializesCorrectly()
    {
        var result = new GenerateResult();

        var json = JsonSerializer.Serialize(result);
        var deserialized = JsonSerializer.Deserialize<GenerateResult>(json);

        Assert.NotNull(deserialized);
        Assert.NotNull(deserialized.RulesPaths);
        Assert.Empty(deserialized.RulesPaths);
    }

    #endregion
}
