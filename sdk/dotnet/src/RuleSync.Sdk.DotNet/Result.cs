#nullable enable

using System;

namespace RuleSync.Sdk;

/// <summary>
/// Represents the result of a rulesync operation that can succeed or fail.
/// </summary>
/// <typeparam name="T">The type of the result value.</typeparam>
public readonly struct Result<T>
{
    private readonly T? _value;
    private readonly RulesyncError? _error;

    /// <summary>
    /// Gets whether the operation was successful.
    /// </summary>
    public bool IsSuccess { get; }

    /// <summary>
    /// Gets whether the operation failed.
    /// </summary>
    public bool IsFailure => !IsSuccess;

    /// <summary>
    /// Gets the result value. Throws if the operation failed.
    /// </summary>
    public T Value => IsSuccess ? _value! : throw new InvalidOperationException("Cannot access Value on a failed result.");

    /// <summary>
    /// Gets the error. Throws if the operation succeeded.
    /// </summary>
    public RulesyncError Error => IsFailure ? _error! : throw new InvalidOperationException("Cannot access Error on a successful result.");

    private Result(T value)
    {
        _value = value;
        _error = null;
        IsSuccess = true;
    }

    private Result(RulesyncError error)
    {
        _value = default;
        _error = error;
        IsSuccess = false;
    }

    /// <summary>
    /// Creates a successful result with the specified value.
    /// </summary>
    public static Result<T> Success(T value) => new(value);

    /// <summary>
    /// Creates a failed result with the specified error.
    /// </summary>
    public static Result<T> Failure(RulesyncError error) => new(error);

    /// <summary>
    /// Creates a failed result with the specified error code and message.
    /// </summary>
    public static Result<T> Failure(string code, string message) =>
        new(new RulesyncError(code, message));

    /// <summary>
    /// Maps the result value to a new type if successful.
    /// </summary>
    public Result<TResult> Map<TResult>(Func<T, TResult> mapper) where TResult : class
    {
        return IsSuccess
            ? Result<TResult>.Success(mapper(_value!))
            : Result<TResult>.Failure(_error!);
    }

    /// <summary>
    /// Executes an action if the result is successful.
    /// </summary>
    public Result<T> OnSuccess(Action<T> action)
    {
        if (IsSuccess)
        {
            action(_value!);
        }
        return this;
    }

    /// <summary>
    /// Executes an action if the result failed.
    /// </summary>
    public Result<T> OnFailure(Action<RulesyncError> action)
    {
        if (IsFailure)
        {
            action(_error!);
        }
        return this;
    }
}

/// <summary>
/// Represents an error that occurred during a rulesync operation.
/// </summary>
public sealed class RulesyncError
{
    /// <summary>
    /// Gets the error code.
    /// </summary>
    public string Code { get; }

    /// <summary>
    /// Gets the error message.
    /// </summary>
    public string Message { get; }

    /// <summary>
    /// Gets optional additional details about the error.
    /// </summary>
    public object? Details { get; }

    /// <summary>
    /// Creates a new RulesyncError instance.
    /// </summary>
    public RulesyncError(string code, string message, object? details = null)
    {
        Code = code ?? throw new ArgumentNullException(nameof(code));
        Message = message ?? throw new ArgumentNullException(nameof(message));
        Details = details;
    }

    /// <inheritdoc />
    public override string ToString() => $"[{Code}] {Message}";
}
