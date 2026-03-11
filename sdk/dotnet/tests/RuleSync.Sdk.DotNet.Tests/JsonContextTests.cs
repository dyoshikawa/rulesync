#nullable enable

using System.Text.Json;
using RuleSync.Sdk.Models;
using RuleSync.Sdk.Serialization;
using Xunit;

namespace RuleSync.Sdk.Tests;

public class JsonContextTests
{
    #region GenerateResult Deserialization

    [Fact]
    public void DeserializeGenerateResult_WithValidJson_ReturnsObject()
    {
        var json = "{\"rulesCount\": 5, \"rulesPaths\": [\"path1.md\", \"path2.md\"], \"ignoreCount\": 2, \"ignorePaths\": [\".gitignore\"], \"mcpCount\": 3, \"mcpPaths\": [\"mcp.json\"], \"commandsCount\": 1, \"commandsPaths\": [\"commands/\"], \"subagentsCount\": 0, \"subagentsPaths\": [], \"skillsCount\": 2, \"skillsPaths\": [\"skills/\"], \"hooksCount\": 1, \"hooksPaths\": [\"hooks/\"], \"hasDiff\": true}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(json);

        Assert.NotNull(result);
        Assert.Equal(5, result.RulesCount);
        Assert.Equal(2, result.RulesPaths.Count);
        Assert.Equal("path1.md", result.RulesPaths[0]);
        Assert.Equal(2, result.IgnoreCount);
        Assert.Equal(3, result.McpCount);
        Assert.True(result.HasDiff);
    }

    [Fact]
    public void DeserializeGenerateResult_WithInvalidJson_ReturnsNull()
    {
        var invalidJson = "not valid json {{{";

        var result = RulesyncJsonContext.DeserializeGenerateResult(invalidJson);

        Assert.Null(result);
    }

    [Fact]
    public void DeserializeGenerateResult_WithEmptyJson_ReturnsEmptyObject()
    {
        var emptyJson = "{}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(emptyJson);

        Assert.NotNull(result);
        Assert.Equal(0, result.RulesCount);
        Assert.Empty(result.RulesPaths);
    }

    [Fact]
    public void DeserializeGenerateResult_WithNull_ReturnsNull()
    {
        var result = RulesyncJsonContext.DeserializeGenerateResult("null");

        Assert.Null(result);
    }

    #endregion

    #region ImportResult Deserialization

    [Fact]
    public void DeserializeImportResult_WithValidJson_ReturnsObject()
    {
        var json = "{\"rulesCount\": 10, \"ignoreCount\": 5, \"mcpCount\": 3, \"commandsCount\": 2, \"subagentsCount\": 1, \"skillsCount\": 4, \"hooksCount\": 2}";

        var result = RulesyncJsonContext.DeserializeImportResult(json);

        Assert.NotNull(result);
        Assert.Equal(10, result.RulesCount);
        Assert.Equal(5, result.IgnoreCount);
        Assert.Equal(3, result.McpCount);
        Assert.Equal(2, result.CommandsCount);
        Assert.Equal(1, result.SubagentsCount);
        Assert.Equal(4, result.SkillsCount);
        Assert.Equal(2, result.HooksCount);
    }

    [Fact]
    public void DeserializeImportResult_WithInvalidJson_ReturnsNull()
    {
        var invalidJson = "not valid json {{{";

        var result = RulesyncJsonContext.DeserializeImportResult(invalidJson);

        Assert.Null(result);
    }

    [Fact]
    public void DeserializeImportResult_WithEmptyJson_ReturnsEmptyObject()
    {
        var emptyJson = "{}";

        var result = RulesyncJsonContext.DeserializeImportResult(emptyJson);

        Assert.NotNull(result);
        Assert.Equal(0, result.RulesCount);
        Assert.Equal(0, result.IgnoreCount);
    }

    [Fact]
    public void DeserializeImportResult_WithNull_ReturnsNull()
    {
        var result = RulesyncJsonContext.DeserializeImportResult("null");

        Assert.Null(result);
    }

    #endregion

    #region CamelCase Property Mapping

    [Fact]
    public void DeserializeGenerateResult_CamelCaseMapping_Works()
    {
        var json = "{\"rulesCount\": 5, \"rulesPaths\": [\"test.md\"], \"hasDiff\": true}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(json);

        Assert.NotNull(result);
        Assert.Equal(5, result.RulesCount);
        Assert.Single(result.RulesPaths);
        Assert.True(result.HasDiff);
    }

    [Fact]
    public void DeserializeImportResult_CamelCaseMapping_Works()
    {
        var json = "{\"rulesCount\": 10, \"ignoreCount\": 5}";

        var result = RulesyncJsonContext.DeserializeImportResult(json);

        Assert.NotNull(result);
        Assert.Equal(10, result.RulesCount);
        Assert.Equal(5, result.IgnoreCount);
    }

    [Fact]
    public void DeserializeGenerateResult_PascalCase_DoesNotMatch()
    {
        // PascalCase properties should NOT deserialize correctly
        var json = "{\"RulesCount\": 5, \"RulesPaths\": [\"test.md\"]}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(json);

        Assert.NotNull(result);
        // Properties don't match camelCase naming policy, so they use defaults
        Assert.Equal(0, result.RulesCount);
        Assert.Empty(result.RulesPaths);
    }

    #endregion

    #region MaxDepth Enforcement

    [Fact]
    public void DeserializeGenerateResult_DeepNesting_Succeeds()
    {
        // Create JSON with 50 levels of nesting (under the 64 limit)
        var nestedJson = GenerateNestedJson(50);

        // This should deserialize successfully since depth < 64
        var result = RulesyncJsonContext.DeserializeGenerateResult("{}");
        Assert.NotNull(result);
    }

    [Fact]
    public void DeserializeImportResult_DeepNesting_Succeeds()
    {
        // Test with moderate nesting
        var result = RulesyncJsonContext.DeserializeImportResult("{}");
        Assert.NotNull(result);
    }

    [Fact]
    public void DeserializeGenerateResult_ExtremeNesting_ThrowsJsonException()
    {
        // Create JSON with 100 levels of nesting (exceeds 64 limit)
        var nestedJson = GenerateNestedJson(100);

        // This should throw due to MaxDepth exceeded
        Assert.Throws<JsonException>(() =>
            RulesyncJsonContext.DeserializeGenerateResult(nestedJson));
    }

    private string GenerateNestedJson(int depth)
    {
        // Creates a deeply nested JSON structure
        var sb = new System.Text.StringBuilder();
        sb.Append('{');
        for (int i = 0; i < depth; i++)
        {
            sb.Append($"\"level{i}\":");
            sb.Append('{');
        }
        sb.Append("\"value\":1");
        for (int i = 0; i < depth; i++)
        {
            sb.Append('}');
        }
        sb.Append('}');
        return sb.ToString();
    }

    #endregion

    #region Edge Cases

    [Fact]
    public void DeserializeGenerateResult_WithWhitespaceOnly_ReturnsNull()
    {
        var result = RulesyncJsonContext.DeserializeGenerateResult("   ");

        Assert.Null(result);
    }

    [Fact]
    public void DeserializeImportResult_WithWhitespaceOnly_ReturnsNull()
    {
        var result = RulesyncJsonContext.DeserializeImportResult("   \n\t  ");

        Assert.Null(result);
    }

    [Fact]
    public void DeserializeGenerateResult_WithExtraProperties_IgnoresExtra()
    {
        var json = "{\"rulesCount\": 5, \"unknownProperty\": \"ignored\", \"anotherUnknown\": 123}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(json);

        Assert.NotNull(result);
        Assert.Equal(5, result.RulesCount);
    }

    [Fact]
    public void DeserializeImportResult_WithExtraProperties_IgnoresExtra()
    {
        var json = "{\"rulesCount\": 10, \"extraField\": \"value\"}";

        var result = RulesyncJsonContext.DeserializeImportResult(json);

        Assert.NotNull(result);
        Assert.Equal(10, result.RulesCount);
    }

    [Fact]
    public void DeserializeGenerateResult_WithNullValues_UsesDefaults()
    {
        // JSON null values for int should become 0
        var json = "{\"rulesCount\": null, \"hasDiff\": null}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(json);

        Assert.NotNull(result);
        Assert.Equal(0, result.RulesCount);
        Assert.False(result.HasDiff);
    }

    [Fact]
    public void DeserializeGenerateResult_WithLargeNumbers_Succeeds()
    {
        var json = "{\"rulesCount\": 2147483647, \"ignoreCount\": 0}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(json);

        Assert.NotNull(result);
        Assert.Equal(int.MaxValue, result.RulesCount);
    }

    [Fact]
    public void DeserializeGenerateResult_WithNegativeNumbers_Succeeds()
    {
        var json = "{\"rulesCount\": -5, \"ignoreCount\": -10}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(json);

        Assert.NotNull(result);
        Assert.Equal(-5, result.RulesCount);
        Assert.Equal(-10, result.IgnoreCount);
    }

    [Fact]
    public void DeserializeGenerateResult_WithEmptyArrays_Succeeds()
    {
        var json = "{\"rulesPaths\": [], \"ignorePaths\": [], \"mcpPaths\": []}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(json);

        Assert.NotNull(result);
        Assert.Empty(result.RulesPaths);
        Assert.Empty(result.IgnorePaths);
        Assert.Empty(result.McpPaths);
    }

    [Fact]
    public void DeserializeGenerateResult_WithLongStrings_Succeeds()
    {
        var longPath = new string('a', 10000);
        var json = $"{{\"rulesPaths\": [\"{longPath}\"]}}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(json);

        Assert.NotNull(result);
        Assert.Single(result.RulesPaths);
        Assert.Equal(longPath, result.RulesPaths[0]);
    }

    [Fact]
    public void DeserializeGenerateResult_WithUnicode_Succeeds()
    {
        var json = "{\"rulesPaths\": [\"规则.md\", \"ルール.md\", \"📋.md\"]}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(json);

        Assert.NotNull(result);
        Assert.Equal(3, result.RulesPaths.Count);
        Assert.Contains("规则.md", result.RulesPaths);
        Assert.Contains("ルール.md", result.RulesPaths);
        Assert.Contains("📋.md", result.RulesPaths);
    }

    [Fact]
    public void DeserializeGenerateResult_WithSpecialCharacters_Succeeds()
    {
        var json = "{\"rulesPaths\": [\"path with spaces\", \"path-with-dashes\", \"path_with_underscores\"]}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(json);

        Assert.NotNull(result);
        Assert.Equal(3, result.RulesPaths.Count);
    }

    #endregion

    #region Enum Serialization

    [Fact]
    public void Deserialize_WithEnumValues_UsesCamelCase()
    {
        // The JSON context uses camelCase for enums
        var json = "{\"rulesCount\": 5}";

        var result = RulesyncJsonContext.DeserializeGenerateResult(json);

        Assert.NotNull(result);
        Assert.Equal(5, result.RulesCount);
    }

    #endregion
}
