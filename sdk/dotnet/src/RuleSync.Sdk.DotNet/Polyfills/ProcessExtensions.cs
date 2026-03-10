#nullable enable

#if NETSTANDARD2_1
using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

namespace RuleSync.Sdk.Polyfills;

/// <summary>Polyfill for WaitForExitAsync on .NET Standard 2.1.</summary>
internal static class ProcessExtensions
{
    public static Task WaitForExitAsync(this Process process, CancellationToken cancellationToken = default)
    {
        var tcs = new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);

        void OnExited(object? sender, EventArgs e)
        {
            process.Exited -= OnExited;
            tcs.TrySetResult(null);
        }

        // Enable raising events first, then subscribe, then check HasExited
        // This order prevents the race condition where process exits between
        // the initial check and event subscription
        process.EnableRaisingEvents = true;
        process.Exited += OnExited;

        // Double-check after subscribing to the event
        if (process.HasExited)
        {
            process.Exited -= OnExited;
            tcs.TrySetResult(null);
        }

        if (cancellationToken.CanBeCanceled)
        {
            var registration = cancellationToken.Register(() =>
            {
                process.Exited -= OnExited;
                tcs.TrySetCanceled(cancellationToken);
            });

            return tcs.Task.ContinueWith(
                _ => registration.Dispose(),
                TaskContinuationOptions.ExecuteSynchronously);
        }

        return tcs.Task;
    }
}
#endif
