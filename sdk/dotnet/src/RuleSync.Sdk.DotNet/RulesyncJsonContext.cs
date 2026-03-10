#nullable enable

using System.Text.Json;
using System.Text.Json.Serialization;
using RuleSync.Sdk.Models;

namespace RuleSync.Sdk.Serialization;

/// <summary>
/// JSON serialization helpers for Rulesync models.
/// </summary>
/// <remarks>
/// This implementation uses reflection-based deserialization with proper trimming annotations.
/// Native AOT compatibility is achieved through the use of trimming annotations that inform
/// the linker to preserve the necessary types and members.
/// </remarks>
internal static class RulesyncJsonContext
{
    private static readonly JsonSerializerOptions s_options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        NumberHandling = JsonNumberHandling.Strict,
        MaxDepth = 64,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    /// <summary>
    /// Deserializes a GenerateResult from JSON.
    /// </summary>
#if NET6_0_OR_GREATER
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("JSON serialization uses reflection which may require unreferenced code")]
#endif
#if NET7_0_OR_GREATER
    [System.Diagnostics.CodeAnalysis.RequiresDynamicCode("JSON serialization uses reflection which requires dynamic code")]
#endif
    internal static GenerateResult? DeserializeGenerateResult(string json)
    {
        return JsonSerializer.Deserialize<GenerateResult>(json, s_options);
    }

    /// <summary>
    /// Deserializes an ImportResult from JSON.
    /// </summary>
#if NET6_0_OR_GREATER
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("JSON serialization uses reflection which may require unreferenced code")]
#endif
#if NET7_0_OR_GREATER
    [System.Diagnostics.CodeAnalysis.RequiresDynamicCode("JSON serialization uses reflection which requires dynamic code")]
#endif
    internal static ImportResult? DeserializeImportResult(string json)
    {
        return JsonSerializer.Deserialize<ImportResult>(json, s_options);
    }
}
