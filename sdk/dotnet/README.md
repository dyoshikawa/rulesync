# RuleSync.Sdk.DotNet

A C# SDK for [rulesync](https://github.com/dyoshikawa/rulesync) - generate AI tool configurations programmatically from .NET applications.

## Features

- **Multi-target support**: .NET Standard 2.1, .NET 6.0, .NET 8.0
- **Source-generated types**: Types are auto-generated from rulesync's TypeScript source at compile time
- **Result pattern**: Functional error handling with `Result<T>`
- **Async/await**: `ValueTask<T>` for efficient async operations

## Installation

### From GitHub Packages

```bash
# Add GitHub Packages source (replace USERNAME with your GitHub username)
dotnet nuget add source "https://nuget.pkg.github.com/dyoshikawa/index.json" \
  --name "github" \
  --username USERNAME \
  --password YOUR_GITHUB_TOKEN

# Install the package
dotnet add package RuleSync.Sdk.DotNet --source github
```

Or add to your `nuget.config`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="github" value="https://nuget.pkg.github.com/dyoshikawa/index.json" />
  </packageSources>
  <packageSourceCredentials>
    <github>
      <add key="Username" value="USERNAME" />
      <add key="ClearTextPassword" value="YOUR_GITHUB_TOKEN" />
    </github>
  </packageSourceCredentials>
</configuration>
```

**Note**: You need a GitHub personal access token with `read:packages` scope.

### From Source

```bash
git clone https://github.com/dyoshikawa/rulesync.git
cd rulesync/sdk/dotnet
dotnet pack src/RuleSync.Sdk.DotNet/RuleSync.Sdk.DotNet.csproj -c Release
dotnet add package RuleSync.Sdk.DotNet --source ./src/RuleSync.Sdk.DotNet/bin/Release
```

## Prerequisites

- Node.js 20+ installed and available in PATH
- rulesync npm package (used via npx)

## Quick Start

```csharp
using RuleSync.Sdk;
using RuleSync.Sdk.Models;

// Create client
using var client = new RulesyncClient();

// Generate configurations for specific targets
var result = await client.GenerateAsync(new GenerateOptions
{
    Targets = new[] { ToolTarget.ClaudeCode, ToolTarget.Cursor },
    Features = new[] { Feature.Rules, Feature.Mcp }
});

if (result.IsSuccess)
{
    Console.WriteLine($"Generated configs");
}
else
{
    Console.WriteLine($"Error: {result.Error}");
}
```

## API Reference

### RulesyncClient

```csharp
public sealed class RulesyncClient : IDisposable
{
    // Uses "node" from PATH, 60 second timeout
    public RulesyncClient();

    // Custom configuration
    public RulesyncClient(
        string? nodeExecutablePath = null,  // Path to node executable
        string? rulesyncPath = null,         // Path to rulesync package (null = use npx)
        TimeSpan? timeout = null);           // Operation timeout

    // Generate AI tool configurations
    public ValueTask<Result<GenerateResult>> GenerateAsync(
        GenerateOptions? options = null,
        CancellationToken cancellationToken = default);

    // Import configuration from existing AI tool
    public ValueTask<Result<ImportResult>> ImportAsync(
        ImportOptions options,
        CancellationToken cancellationToken = default);
}
```

### Result<T>

```csharp
public readonly struct Result<T>
{
    public bool IsSuccess { get; }
    public bool IsFailure { get; }
    public T Value { get; }              // Throws if failed
    public RulesyncError Error { get; }  // Throws if success

    public Result<TResult> Map<TResult>(Func<T, TResult> mapper);
    public Result<T> OnSuccess(Action<T> action);
    public Result<T> OnFailure(Action<RulesyncError> action);
}
```

### Source-Generated Types

Types are automatically generated from rulesync's TypeScript source at compile time:

**Feature enum** (from `src/types/features.ts`):

- `Rules`, `Ignore`, `Mcp`, `Subagents`, `Commands`, `Skills`, `Hooks`

**ToolTarget enum** (from `src/types/tool-targets.ts`):

- `Agentsmd`, `Agentsskills`, `Antigravity`, `Augmentcode`, `Claudecode`, `Codexcli`, `Copilot`, `Cursor`, `Factorydroid`, `Geminicli`, `Goose`, `Junie`, `Kilo`, `Kiro`, `Opencode`, `Qwencode`, `Replit`, `Roo`, `Warp`, `Windsurf`, `Zed`

**GenerateOptions** (from `src/lib/generate.ts`):

```csharp
public sealed class GenerateOptions
{
    public IReadOnlyList<ToolTarget>? Targets { get; init; }
    public IReadOnlyList<Feature>? Features { get; init; }
    public bool? Verbose { get; init; }
    public bool? Silent { get; init; }
    public bool? Delete { get; init; }
    public bool? Global { get; init; }
    public bool? SimulateCommands { get; init; }
    public bool? SimulateSubagents { get; init; }
    public bool? SimulateSkills { get; init; }
    public bool? DryRun { get; init; }
    public bool? Check { get; init; }
}
```

**ImportOptions** (from `src/lib/import.ts`):

```csharp
public sealed class ImportOptions
{
    public ToolTarget Target { get; init; }  // Required
    public IReadOnlyList<Feature>? Features { get; init; }
    public bool? Verbose { get; init; }
    public bool? Silent { get; init; }
    public bool? Global { get; init; }
}
```

## Examples

### Generate all features for all tools

```csharp
var result = await client.GenerateAsync();
```

### Generate specific features for Cursor

```csharp
var result = await client.GenerateAsync(new GenerateOptions
{
    Targets = new[] { ToolTarget.Cursor },
    Features = new[] { Feature.Rules, Feature.Mcp, Feature.Skills }
});
```

### Import from Claude Code

```csharp
var result = await client.ImportAsync(new ImportOptions
{
    Target = ToolTarget.Claudecode,
    Features = new[] { Feature.Rules, Feature.Mcp }
});

if (result.IsSuccess)
{
    Console.WriteLine("Import successful");
}
```

### Error handling

```csharp
var result = await client.GenerateAsync(options);

result
    .OnSuccess(r => Console.WriteLine("Generated successfully"))
    .OnFailure(e => Console.WriteLine($"Error {e.Code}: {e.Message}"));

// Or use pattern matching
if (result.IsSuccess)
{
    var value = result.Value;
}
else
{
    var error = result.Error;
}
```

### Custom timeout and paths

```csharp
using var client = new RulesyncClient(
    nodeExecutablePath: "/usr/local/bin/node",
    rulesyncPath: "/path/to/rulesync",  // Local rulesync installation
    timeout: TimeSpan.FromMinutes(2)
);
```

## How It Works

The SDK uses an **incremental source generator** that parses rulesync's TypeScript type definitions at compile time and generates corresponding C# types:

1. **TypeScript parsing**: The generator reads TypeScript files from the rulesync source:
   - `src/types/features.ts` → `Feature` enum
   - `src/types/tool-targets.ts` → `ToolTarget` enum
   - `src/lib/generate.ts` → `GenerateOptions`, `GenerateResult`
   - `src/lib/import.ts` → `ImportOptions`, `ImportResult`

2. **Compile-time generation**: Types are generated during build, not runtime

3. **IDE support**: Full IntelliSense and autocomplete for all generated types

## Building from Source

```bash
# Clone the repository
git clone https://github.com/dyoshikawa/rulesync.git
cd rulesync/sdk/dotnet

# Build
dotnet build

# Pack as NuGet package
dotnet pack -c Release
```

## Architecture

```
RulesyncClient
    |
    +-- Spawns Node.js process
    |       +-- npx rulesync generate ...
    |       +-- npx rulesync import ...
    |
    +-- JSON output parsing
    |       +-- System.Text.Json
    |
    +-- Returns Result<T>

Source Generator
    |
    +-- Parses TypeScript files at compile time
    |       +-- src/types/features.ts
    |       +-- src/types/tool-targets.ts
    |       +-- src/lib/generate.ts
    |       +-- src/lib/import.ts
    |
    +-- Generates C# types
            +-- Feature enum
            +-- ToolTarget enum
            +-- GenerateOptions class
            +-- ImportOptions class
```

## License

MIT License - see LICENSE file for details.
