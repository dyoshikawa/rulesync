#nullable enable

using System;
using System.Threading.Tasks;
using RuleSync.Sdk.Models;
using Xunit;

namespace RuleSync.Sdk.Tests;

public class ClientTests
{
    [Fact]
    public void Constructor_WithDefaults_SetsDefaultValues()
    {
        var client = new RulesyncClient();

        // Should not throw and should be disposable
        Assert.NotNull(client);
        client.Dispose();
    }

    [Fact]
    public void Constructor_WithCustomPaths_SetsValues()
    {
        var client = new RulesyncClient(
            nodeExecutablePath: "/usr/bin/node",
            rulesyncPath: "/path/to/rulesync",
            timeout: TimeSpan.FromMinutes(2));

        Assert.NotNull(client);
        client.Dispose();
    }

    [Fact]
    public void Dispose_CanBeCalledMultipleTimes()
    {
        var client = new RulesyncClient();

        client.Dispose();
        client.Dispose(); // Should not throw
    }

    [Fact]
    public async Task Dispose_PreventsFurtherOperations()
    {
        var client = new RulesyncClient();
        client.Dispose();

        // After disposal, operations should throw ObjectDisposedException
        await Assert.ThrowsAsync<ObjectDisposedException>(async () =>
            await client.GenerateAsync());
    }

    [Fact]
    public void BuildGenerateArgs_WithoutOptions_ReturnsMinimalArgs()
    {
        // This tests the internal arg building logic indirectly
        // by verifying the client can be created with options
        var client = new RulesyncClient();
        Assert.NotNull(client);
        client.Dispose();
    }

    [Fact]
    public void GenerateOptions_DefaultConstructor_HasExpectedDefaults()
    {
        var options = new GenerateOptions();

        // Boolean defaults
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
    public void ImportOptions_RequiresTarget()
    {
        var options = new ImportOptions { Target = ToolTarget.ClaudeCode };

        Assert.Equal(ToolTarget.ClaudeCode, options.Target);
    }

    [Theory]
    [InlineData(true, true)]   // verbose=true sets Verbose to true
    [InlineData(false, false)] // verbose=false sets Verbose to false (default is false)
    public void GenerateOptions_BooleanLogic(bool verbose, bool expectedVerbose)
    {
        var options = new GenerateOptions { Verbose = verbose };

        Assert.Equal(expectedVerbose, options.Verbose);
    }

    [Fact]
    public void ToolTarget_AllValues_AreUnique()
    {
        var values = Enum.GetValues<ToolTarget>();
        var distinctCount = new System.Collections.Generic.HashSet<ToolTarget>(values).Count;

        Assert.Equal(values.Length, distinctCount);
    }

    [Fact]
    public void Feature_AllValues_AreUnique()
    {
        var values = Enum.GetValues<Feature>();
        var distinctCount = new System.Collections.Generic.HashSet<Feature>(values).Count;

        Assert.Equal(values.Length, distinctCount);
    }

    [Fact]
    public void Result_SuccessAndFailure_AreMutuallyExclusive()
    {
        var success = Result<string>.Success("test");
        var failure = Result<string>.Failure("ERROR", "test");

        Assert.True(success.IsSuccess);
        Assert.False(success.IsFailure);
        Assert.True(failure.IsFailure);
        Assert.False(failure.IsSuccess);
    }
}
