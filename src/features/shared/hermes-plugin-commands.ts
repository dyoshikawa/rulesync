/**
 * Normalize a name into a Hermes Agent plugin slash command name.
 *
 * `ctx.register_command()` lowercases the name, and Hermes' messaging gateway
 * looks plugin commands up with every `_` turned into `-`
 * (`gateway/run_inbound_hooks.py`), so only a lowercase, hyphenated name is
 * reachable from every surface.
 */
export function hermesSlashName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ _]/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Python helpers shared by the generated Hermes command plugins.
 *
 * A plugin slash command runs outside any agent turn, so it cannot call
 * `delegate_task` (which requires a parent agent). Instead the handler queues
 * its prompt as a user message with `ctx.inject_message()`, passing the calling
 * session's key: a `session_key` handler keyword on newer Hermes, or
 * `HERMES_SESSION_KEY` from the session context the gateway binds around the
 * handler on older releases.
 */
export function getHermesQueueUserMessagePython({ pluginName }: { pluginName: string }): string {
  return `def _session_key(kwargs):
    session_key = kwargs.get("session_key")
    if session_key:
        return session_key
    try:
        from gateway.session_context import get_session_env
    except Exception:
        return None
    return get_session_env("HERMES_SESSION_KEY") or None


def _queue_user_message(ctx, message, kwargs, label):
    """Queue *message* as the session's next user turn; return an error reply, or None."""
    session_key = _session_key(kwargs)
    try:
        if session_key:
            queued = ctx.inject_message(message, role="user", session_key=session_key)
        else:
            queued = ctx.inject_message(message, role="user")
    except Exception as error:
        return f"Could not queue {label}: {error}"
    if not queued:
        return (
            f"Hermes refused to queue {label}. Allow it with "
            "plugins.entries.${pluginName}.allow_gateway_injection: true in config.yaml."
        )
    return None
`;
}
