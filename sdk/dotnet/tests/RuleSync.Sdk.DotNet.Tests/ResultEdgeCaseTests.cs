#nullable enable

using System;
using System.Collections.Generic;
using Xunit;

namespace RuleSync.Sdk.Tests;

public class ResultEdgeCaseTests
{
    #region Map with Null Mapper

    [Fact]
    public void Map_NullMapper_ThrowsArgumentNullException()
    {
        var result = Result<string>.Success("test");

#pragma warning disable CS8625 // Cannot convert null literal to non-nullable reference type
        var ex = Assert.Throws<ArgumentNullException>(() =>
            result.Map<string>(null));
#pragma warning restore CS8625

        Assert.NotNull(ex);
    }

    [Fact]
    public void Map_NullMapper_OnFailure_DoesNotThrow()
    {
        // Even with null mapper, if result is failure, mapper shouldn't be called
        var result = Result<string>.Failure("ERROR", "test");

        // This should not throw because the mapper is not invoked for failures
#pragma warning disable CS8625 // Cannot convert null literal to non-nullable reference type
        var mapped = result.Map<string>(null);
#pragma warning restore CS8625

        Assert.True(mapped.IsFailure);
        Assert.Equal("ERROR", mapped.Error.Code);
    }

    #endregion

    #region Map with Throwing Mapper

    [Fact]
    public void Map_ThrowingMapper_PropagatesException()
    {
        var result = Result<string>.Success("test");

        var ex = Assert.Throws<InvalidOperationException>(() =>
            result.Map<string>(_ => throw new InvalidOperationException("Mapper failed")));

        Assert.Equal("Mapper failed", ex.Message);
    }

    [Fact]
    public void Map_ThrowingMapper_OnFailure_DoesNotCallMapper()
    {
        var result = Result<string>.Failure("ERROR", "original");
        var called = false;

        // This should not throw because mapper is not invoked for failures
        System.Func<string, string> throwingMapper = _ =>
        {
            called = true;
            throw new InvalidOperationException("Should not be called");
        };
        var mapped = result.Map(throwingMapper);

        Assert.False(called);
        Assert.True(mapped.IsFailure);
        Assert.Equal("ERROR", mapped.Error.Code);
    }

    #endregion

    #region Chained Map Operations

    [Fact]
    public void Map_ChainedOperations_TransformsValue()
    {
        var result = Result<string>.Success("5");
        var mapped = result
            .Map(x => x + "0")           // "50"
            .Map(x => x + "extra")       // "50extra"
            .Map(x => x.Substring(0, 2)); // "50"

        Assert.True(mapped.IsSuccess);
        Assert.Equal("50", mapped.Value);
    }

    [Fact]
    public void Map_ChainedOperations_StopsOnFailure()
    {
        var callCount = 0;
        var result = Result<string>.Success("5");
        var mapped = result
            .Map(x => { callCount++; return x + "0"; })
            .Map<string>(_ => throw new InvalidOperationException("Stop here"));

        // Second map throws, so chain is broken
        Assert.Equal(1, callCount);
    }

    [Fact]
    public void Map_ChainedWithFailure_PreservesError()
    {
        var result = Result<string>.Failure("CODE1", "first error");
        var mapped = result
            .Map(x => x + "extra")
            .Map(x => x + "more");

        Assert.True(mapped.IsFailure);
        Assert.Equal("CODE1", mapped.Error.Code);
        Assert.Equal("first error", mapped.Error.Message);
    }

    #endregion

    #region Result with Reference Types

    [Fact]
    public void Result_WithString_Success()
    {
        var result = Result<string>.Success("hello");

        Assert.True(result.IsSuccess);
        Assert.Equal("hello", result.Value);
    }

    [Fact]
    public void Result_WithString_MapTransforms()
    {
        var result = Result<string>.Success("hello");
        var mapped = result.Map(x => x.ToUpper());

        Assert.True(mapped.IsSuccess);
        Assert.Equal("HELLO", mapped.Value);
    }

    [Fact]
    public void Result_WithList_Success()
    {
        var list = new List<string> { "a", "b", "c" };
        var result = Result<List<string>>.Success(list);

        Assert.True(result.IsSuccess);
        Assert.Equal(3, result.Value.Count);
    }

    [Fact]
    public void Result_WithArray_Success()
    {
        var arr = new[] { 1, 2, 3 };
        var result = Result<int[]>.Success(arr);

        Assert.True(result.IsSuccess);
        Assert.Equal(3, result.Value.Length);
    }

    [Fact]
    public void Result_WithNullReferenceType_Success()
    {
        string? value = null;
        var result = Result<string?>.Success(value);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value);
    }

    [Fact]
    public void Result_WithCustomObject_Success()
    {
        var person = new Person { Name = "Alice", Age = 30 };
        var result = Result<Person>.Success(person);

        Assert.True(result.IsSuccess);
        Assert.Equal("Alice", result.Value.Name);
        Assert.Equal(30, result.Value.Age);
    }

    [Fact]
    public void Result_WithCustomObject_MapTransforms()
    {
        var person = new Person { Name = "Alice", Age = 30 };
        var result = Result<Person>.Success(person);
        var mapped = result.Map(p => p.Name);

        Assert.True(mapped.IsSuccess);
        Assert.Equal("Alice", mapped.Value);
    }

    private class Person
    {
        public required string Name { get; set; }
        public int Age { get; set; }
    }

    #endregion

    #region RulesyncError Tests

    [Fact]
    public void RulesyncError_WithDetails_ToStringIncludesCodeAndMessage()
    {
        var error = new RulesyncError("CODE", "message", new { Detail = "info" });

        var str = error.ToString();

        Assert.Equal("[CODE] message", str);
    }

    [Fact]
    public void RulesyncError_WithNullDetails_Accepts()
    {
        var error = new RulesyncError("CODE", "message", null);

        Assert.Null(error.Details);
        Assert.Equal("[CODE] message", error.ToString());
    }

    [Fact]
    public void RulesyncError_WithComplexDetails_Serializes()
    {
        var details = new Dictionary<string, object>
        {
            ["key1"] = "value1",
            ["key2"] = 42
        };
        var error = new RulesyncError("CODE", "message", details);

        Assert.NotNull(error.Details);
        Assert.Equal("[CODE] message", error.ToString());
    }

    [Fact]
    public void RulesyncError_CodeProperty_ReturnsCode()
    {
        var error = new RulesyncError("MYCODE", "message");

        Assert.Equal("MYCODE", error.Code);
    }

    [Fact]
    public void RulesyncError_MessageProperty_ReturnsMessage()
    {
        var error = new RulesyncError("CODE", "my message");

        Assert.Equal("my message", error.Message);
    }

    #endregion

    #region Result Factory Methods

    [Fact]
    public void Success_FromErrorInstance_CreatesSuccess()
    {
        var result = Result<string>.Success("value");

        Assert.True(result.IsSuccess);
        Assert.Equal("value", result.Value);
    }

    [Fact]
    public void Failure_FromErrorInstance_CreatesFailure()
    {
        var error = new RulesyncError("CODE", "message");
        var result = Result<string>.Failure(error);

        Assert.True(result.IsFailure);
        Assert.Equal("CODE", result.Error.Code);
        Assert.Equal("message", result.Error.Message);
    }

    [Fact]
    public void Failure_FromCodeAndMessage_CreatesFailure()
    {
        var result = Result<string>.Failure("ERROR", "something went wrong");

        Assert.True(result.IsFailure);
        Assert.Equal("ERROR", result.Error.Code);
        Assert.Equal("something went wrong", result.Error.Message);
    }

    #endregion

    #region OnSuccess and OnFailure Callbacks

    [Fact]
    public void OnSuccess_WithSuccess_CallsAction()
    {
        var result = Result<string>.Success("test");
        var captured = "";

        result.OnSuccess(v => captured = v);

        Assert.Equal("test", captured);
    }

    [Fact]
    public void OnSuccess_WithFailure_DoesNotCallAction()
    {
        var result = Result<string>.Failure("CODE", "error");
        var called = false;

        result.OnSuccess(_ => called = true);

        Assert.False(called);
    }

    [Fact]
    public void OnFailure_WithFailure_CallsAction()
    {
        var result = Result<string>.Failure("CODE", "error message");
        var capturedCode = "";
        var capturedMessage = "";

        result.OnFailure(e =>
        {
            capturedCode = e.Code;
            capturedMessage = e.Message;
        });

        Assert.Equal("CODE", capturedCode);
        Assert.Equal("error message", capturedMessage);
    }

    [Fact]
    public void OnFailure_WithSuccess_DoesNotCallAction()
    {
        var result = Result<string>.Success("test");
        var called = false;

        result.OnFailure(_ => called = true);

        Assert.False(called);
    }

    [Fact]
    public void OnSuccess_ReturnsOriginalResult()
    {
        var result = Result<string>.Success("test");

        var returned = result.OnSuccess(_ => { });

        Assert.Equal(result, returned);
    }

    [Fact]
    public void OnFailure_ReturnsOriginalResult()
    {
        var result = Result<string>.Failure("CODE", "error");

        var returned = result.OnFailure(_ => { });

        Assert.Equal(result, returned);
    }

    #endregion

    #region Error Equality and Comparison

    [Fact]
    public void RulesyncError_SameCodeAndMessage_AreEqualByValue()
    {
        var error1 = new RulesyncError("CODE", "message");
        var error2 = new RulesyncError("CODE", "message");

        // They're not reference equal but have same values
        Assert.NotSame(error1, error2);
        Assert.Equal(error1.Code, error2.Code);
        Assert.Equal(error1.Message, error2.Message);
    }

    [Fact]
    public void RulesyncError_DifferentCodes_NotEqual()
    {
        var error1 = new RulesyncError("CODE1", "message");
        var error2 = new RulesyncError("CODE2", "message");

        Assert.NotEqual(error1.Code, error2.Code);
    }

    [Fact]
    public void RulesyncError_DifferentMessages_NotEqual()
    {
        var error1 = new RulesyncError("CODE", "message1");
        var error2 = new RulesyncError("CODE", "message2");

        Assert.NotEqual(error1.Message, error2.Message);
    }

    #endregion

    #region Edge Cases

    [Fact]
    public void Result_ValueOnFailure_ThrowsWithCorrectMessage()
    {
        var result = Result<string>.Failure("CODE", "error occurred");

        var ex = Assert.Throws<InvalidOperationException>(() => result.Value);
        Assert.Contains("Cannot access Value", ex.Message);
    }

    [Fact]
    public void Result_ErrorOnSuccess_ThrowsWithCorrectMessage()
    {
        var result = Result<string>.Success("value");

        var ex = Assert.Throws<InvalidOperationException>(() => result.Error);
        Assert.Contains("Cannot access Error", ex.Message);
    }

    [Fact]
    public void Map_MultipleReferenceTypes_ChainsCorrectly()
    {
        var result = Result<string>.Success("hello");
        var mapped = result
            .Map(x => x.ToUpper())
            .Map(x => x + " WORLD")
            .Map(x => x.Substring(0, 8));

        Assert.True(mapped.IsSuccess);
        Assert.Equal("HELLO WO", mapped.Value);
    }

    [Fact]
    public void Result_EmptyString_IsValidSuccess()
    {
        var result = Result<string>.Success("");

        Assert.True(result.IsSuccess);
        Assert.Equal("", result.Value);
    }

    [Fact]
    public void Result_WhitespaceString_IsValidSuccess()
    {
        var result = Result<string>.Success("   ");

        Assert.True(result.IsSuccess);
        Assert.Equal("   ", result.Value);
    }

    [Fact]
    public void Result_NullString_IsValidSuccess()
    {
        var result = Result<string?>.Success(null);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value);
    }

    #endregion
}
