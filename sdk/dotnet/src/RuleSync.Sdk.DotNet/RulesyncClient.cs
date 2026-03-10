#nullable enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using RuleSync.Sdk.Models;
using RuleSync.Sdk.Serialization;
#if NETSTANDARD2_1
using RuleSync.Sdk.Polyfills;
#endif

namespace RuleSync.Sdk;

/// <summary>
/// Client for interacting with rulesync from .NET applications.
/// Spawns Node.js process to execute rulesync commands.
/// </summary>
public sealed class RulesyncClient : IDisposable
{
    private readonly string _nodeExecutablePath;
    private readonly string? _rulesyncPath;
    private readonly TimeSpan _timeout;
    private bool _disposed;

    /// <summary>
    /// Creates a new RulesyncClient instance.
    /// </summary>
    /// <param name="nodeExecutablePath">
    /// Optional path to Node.js executable. If null, uses "node" from PATH.
    /// Security note: Ensure this path is trusted. Providing an untrusted path could result in arbitrary code execution.
    /// </param>
    /// <param name="rulesyncPath">Optional path to rulesync package. If null, uses npx rulesync.</param>
    /// <param name="timeout">Optional timeout for operations. Default is 60 seconds.</param>
    public RulesyncClient(
        string? nodeExecutablePath = null,
        string? rulesyncPath = null,
        TimeSpan? timeout = null)
    {
        _nodeExecutablePath = ValidateExecutablePath(nodeExecutablePath ?? "node", nameof(nodeExecutablePath));
        _rulesyncPath = rulesyncPath != null ? ValidateExecutablePath(rulesyncPath, nameof(rulesyncPath)) : null;
        _timeout = timeout ?? TimeSpan.FromSeconds(60);
    }

    /// <summary>
    /// Generates AI tool configurations based on the provided options.
    /// </summary>
    /// <param name="options">Generation options</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>Result of the generation operation</returns>
#if NET6_0_OR_GREATER
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("JSON serialization uses reflection which may require unreferenced code")]
#endif
#if NET7_0_OR_GREATER
    [System.Diagnostics.CodeAnalysis.RequiresDynamicCode("JSON serialization uses reflection which requires dynamic code")]
#endif
    public async ValueTask<Result<GenerateResult>> GenerateAsync(
        GenerateOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();

        try
        {
            var opts = options ?? new GenerateOptions();
            var args = BuildGenerateArgs(opts);
            var result = await ExecuteRulesyncAsync(args, cancellationToken).ConfigureAwait(false);

            if (result.ExitCode != 0)
            {
                return Result<GenerateResult>.Failure(
                    "GENERATE_FAILED",
                    $"Rulesync generate failed with exit code {result.ExitCode}: {result.Stderr}");
            }

            var generateResult = RulesyncJsonContext.DeserializeGenerateResult(result.Stdout);
            if (generateResult == null)
            {
                return Result<GenerateResult>.Failure(
                    "DESERIALIZATION_FAILED",
                    "Failed to deserialize generate result.");
            }

            return Result<GenerateResult>.Success(generateResult);
        }
        catch (Exception ex)
        {
            return Result<GenerateResult>.Failure(
                "EXCEPTION",
                $"An error occurred during generate: {ex.Message}");
        }
    }

    /// <summary>
    /// Imports configuration from an existing AI tool.
    /// </summary>
    /// <param name="options">Import options (target is required)</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>Result of the import operation</returns>
#if NET6_0_OR_GREATER
    [System.Diagnostics.CodeAnalysis.RequiresUnreferencedCode("JSON serialization uses reflection which may require unreferenced code")]
#endif
#if NET7_0_OR_GREATER
    [System.Diagnostics.CodeAnalysis.RequiresDynamicCode("JSON serialization uses reflection which requires dynamic code")]
#endif
    public async ValueTask<Result<ImportResult>> ImportAsync(
        ImportOptions options,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();

        try
        {
            var args = BuildImportArgs(options);
            var result = await ExecuteRulesyncAsync(args, cancellationToken).ConfigureAwait(false);

            if (result.ExitCode != 0)
            {
                return Result<ImportResult>.Failure(
                    "IMPORT_FAILED",
                    $"Rulesync import failed with exit code {result.ExitCode}: {result.Stderr}");
            }

            var importResult = RulesyncJsonContext.DeserializeImportResult(result.Stdout);
            if (importResult == null)
            {
                return Result<ImportResult>.Failure(
                    "DESERIALIZATION_FAILED",
                    "Failed to deserialize import result.");
            }

            return Result<ImportResult>.Success(importResult);
        }
        catch (Exception ex)
        {
            return Result<ImportResult>.Failure(
                "EXCEPTION",
                $"An error occurred during import: {ex.Message}");
        }
    }

    /// <summary>
    /// Disposes the client.
    /// </summary>
    public void Dispose()
    {
        _disposed = true;
        GC.SuppressFinalize(this);
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new ObjectDisposedException(nameof(RulesyncClient));
        }
    }

    private string[] BuildGenerateArgs(GenerateOptions options)
    {
        // Validate Targets enum values
        if (options.Targets?.Count > 0)
        {
            foreach (var target in options.Targets)
            {
                if (!Enum.IsDefined(typeof(ToolTarget), target))
                {
                    throw new ArgumentException(
                        $"Invalid ToolTarget value: {target}.",
                        nameof(options.Targets));
                }
            }
        }

        // Validate Features enum values
        if (options.Features?.Count > 0)
        {
            foreach (var feature in options.Features)
            {
                if (!Enum.IsDefined(typeof(Feature), feature))
                {
                    throw new ArgumentException(
                        $"Invalid Feature value: {feature}.",
                        nameof(options.Features));
                }
            }
        }

        var args = new System.Collections.Generic.List<string>();
        args.Add("generate");

        if (options.Targets?.Count > 0)
        {
            args.Add("--targets");
            args.Add(string.Join(",", options.Targets.Select(ToCliValue)));
        }

        if (options.Features?.Count > 0)
        {
            args.Add("--features");
            args.Add(string.Join(",", options.Features.Select(ToCliValue)));
        }

        if (options.Verbose == true) args.Add("--verbose");
        if (options.Silent == false) args.Add("--no-silent");
        if (options.Delete == true) args.Add("--delete");
        if (options.Global == true) args.Add("--global");
        if (options.SimulateCommands == true) args.Add("--simulate-commands");
        if (options.SimulateSubagents == true) args.Add("--simulate-subagents");
        if (options.SimulateSkills == true) args.Add("--simulate-skills");
        if (options.DryRun == true) args.Add("--dry-run");
        if (options.Check == true) args.Add("--check");

        if (!string.IsNullOrEmpty(options.ConfigPath))
        {
            var configPath = ValidateConfigPath(options.ConfigPath);
            args.Add("--config");
            args.Add(configPath);
        }

        // Add JSON output flag
        args.Add("--json");

        return args.ToArray();
    }

    private string[] BuildImportArgs(ImportOptions options)
    {
        // Validate Target is defined (not default/unset)
        // Check for default value (0) which is invalid for ToolTarget
        if (!Enum.IsDefined(typeof(ToolTarget), options.Target) || EqualityComparer<ToolTarget>.Default.Equals(options.Target, default))
        {
            throw new ArgumentException(
                $"Invalid ToolTarget value: {options.Target}. Target must be specified and cannot be the default value.",
                nameof(options));
        }

        var args = new System.Collections.Generic.List<string>();
        args.Add("import");
        args.Add("--target");
        args.Add(ToCliValue(options.Target));

        if (options.Features?.Count > 0)
        {
            args.Add("--features");
            args.Add(string.Join(",", options.Features.Select(ToCliValue)));
        }

        if (options.Verbose == true) args.Add("--verbose");
        if (options.Silent == false) args.Add("--no-silent");
        if (options.Global == true) args.Add("--global");

        if (!string.IsNullOrEmpty(options.ConfigPath))
        {
            var configPath = ValidateConfigPath(options.ConfigPath);
            args.Add("--config");
            args.Add(configPath);
        }

        // Add JSON output flag
        args.Add("--json");

        return args.ToArray();
    }

    private static string ValidateConfigPath(string configPath)
    {
        // Check for null bytes (path injection)
        if (configPath.Contains('\0'))
        {
            throw new ArgumentException("Config path contains invalid characters.", nameof(configPath));
        }

        // Normalize the path to prevent traversal attacks
        var fullPath = Path.GetFullPath(configPath);

        return fullPath;
    }

    /// <summary>
    /// Validates an executable path for null bytes and requires absolute paths.
    /// </summary>
    private static string ValidateExecutablePath(string path, string paramName)
    {
        // Check for null bytes (path injection)
        if (path.Contains('\0'))
        {
            throw new ArgumentException("Executable path contains invalid characters.", paramName);
        }

        // Require absolute paths for security
        if (!Path.IsPathRooted(path))
        {
            // Allow relative paths like "node" or "npx" that are resolved from PATH
            // but validate they don't contain directory traversal
            if (path.Contains("..") || path.Contains("./") || path.Contains(".\\"))
            {
                throw new ArgumentException("Executable path cannot contain directory traversal characters.", paramName);
            }
            return path;
        }

        // For absolute paths, normalize to prevent traversal
        return Path.GetFullPath(path);
    }

    /// <summary>
    /// Converts an enum value to its CLI-compatible kebab-case string representation.
    /// </summary>
    private static string ToCliValue<T>(T value) where T : struct, Enum
    {
        // Get the enum name and convert to kebab-case
        var name = value.ToString();
        if (string.IsNullOrEmpty(name))
            return string.Empty;

        // Convert PascalCase to kebab-case
        // Handle special cases like "AugmentCodeLegacy" -> "augmentcode-legacy"
        var result = new System.Text.StringBuilder();
        for (int i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsUpper(c))
            {
                if (i > 0 && (char.IsLower(name[i - 1]) || (i + 1 < name.Length && char.IsLower(name[i + 1]))))
                {
                    result.Append('-');
                }
                result.Append(char.ToLowerInvariant(c));
            }
            else
            {
                result.Append(c);
            }
        }

        return result.ToString();
    }

    private const int MaxOutputSize = 10 * 1024 * 1024; // 10 MB limit

    private async Task<ProcessResult> ExecuteRulesyncAsync(
        string[] args,
        CancellationToken cancellationToken)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = _nodeExecutablePath,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        if (_rulesyncPath != null)
        {
            // Direct path to rulesync module
            startInfo.ArgumentList.Add(Path.Combine(_rulesyncPath, "dist", "cli.js"));
        }
        else
        {
            // Use npx
            startInfo.FileName = "npx";
            startInfo.ArgumentList.Add("rulesync");
        }

        foreach (var arg in args)
        {
            startInfo.ArgumentList.Add(arg);
        }

        using var process = new Process { StartInfo = startInfo };
        var stdoutBuilder = new StringBuilder();
        var stderrBuilder = new StringBuilder();
        int stdoutLength = 0;
        int stderrLength = 0;

        process.OutputDataReceived += (sender, e) =>
        {
            if (e.Data == null) return;
            var dataLength = e.Data.Length + Environment.NewLine.Length;
            // Atomic check-and-reserve: try to reserve space, only append if successful
            var newLength = Interlocked.Add(ref stdoutLength, dataLength);
            if (newLength <= MaxOutputSize + dataLength)
            {
                lock (stdoutBuilder)
                {
                    stdoutBuilder.AppendLine(e.Data);
                }
            }
            else
            {
                // Revert the reservation if over limit
                Interlocked.Add(ref stdoutLength, -dataLength);
            }
        };

        process.ErrorDataReceived += (sender, e) =>
        {
            if (e.Data == null) return;
            var dataLength = e.Data.Length + Environment.NewLine.Length;
            // Atomic check-and-reserve: try to reserve space, only append if successful
            var newLength = Interlocked.Add(ref stderrLength, dataLength);
            if (newLength <= MaxOutputSize + dataLength)
            {
                lock (stderrBuilder)
                {
                    stderrBuilder.AppendLine(e.Data);
                }
            }
            else
            {
                // Revert the reservation if over limit
                Interlocked.Add(ref stderrLength, -dataLength);
            }
        };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(_timeout);

        try
        {
            await process.WaitForExitAsync(cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            process.Kill();
            throw new TimeoutException($"Rulesync operation timed out after {_timeout.TotalSeconds} seconds.");
        }
        catch
        {
            process.Kill();
            throw;
        }

        return new ProcessResult(
            process.ExitCode,
            stdoutBuilder.ToString(),
            stderrBuilder.ToString());
    }

    private readonly record struct ProcessResult(int ExitCode, string Stdout, string Stderr);
}
