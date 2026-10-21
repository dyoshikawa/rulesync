import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { writeFileContent } from "../utils/file.js";

const execFileAsync = promisify(execFile);

export type HermesPluginRun = {
  commands: string[];
  replies: Record<string, string | null>;
  injected: Array<{ content: string; role: string; kwargs: Record<string, unknown> }>;
  warnings: string[];
};

/**
 * Load a generated Hermes plugin `__init__.py` in python3 against a stub
 * plugin context and call every registered slash command once.
 *
 * `specs` are written to `<root>/rulesync/<specKind>/` next to
 * `<root>/plugins/<pluginName>/__init__.py`, the layout the plugin expects.
 * A stub `gateway.session_context` module answers `HERMES_SESSION_KEY` with
 * `contextSessionKey`, standing in for the session context older Hermes binds.
 */
export async function runHermesPlugin({
  root,
  pluginName,
  pluginInit,
  specKind,
  specs,
  args,
  handlerKwargs = {},
  injectResult = true,
  contextSessionKey = "",
}: {
  root: string;
  pluginName: string;
  pluginInit: string;
  specKind: string;
  specs: Record<string, unknown>;
  args: string;
  handlerKwargs?: Record<string, unknown>;
  injectResult?: boolean;
  contextSessionKey?: string;
}): Promise<HermesPluginRun> {
  const pluginDir = join(root, "plugins", pluginName);
  const stubDir = join(root, "stubs");
  await writeFileContent(join(pluginDir, "__init__.py"), pluginInit);
  for (const [fileName, spec] of Object.entries(specs)) {
    await writeFileContent(join(root, "rulesync", specKind, fileName), JSON.stringify(spec));
  }
  await writeFileContent(join(stubDir, "gateway", "__init__.py"), "");
  await writeFileContent(
    join(stubDir, "gateway", "session_context.py"),
    [
      "import os",
      "",
      "def get_session_env(name, default=''):",
      "    if name == 'HERMES_SESSION_KEY':",
      "        return os.environ.get('STUB_CONTEXT_SESSION_KEY', default)",
      "    return default",
      "",
    ].join("\n"),
  );
  const runnerPath = join(root, "runner.py");
  await writeFileContent(
    runnerPath,
    [
      "import importlib.util",
      "import json",
      "import logging",
      "import sys",
      "",
      "warnings = []",
      "class _Collect(logging.Handler):",
      "    def emit(self, record):",
      "        warnings.append(record.getMessage())",
      "logging.getLogger().addHandler(_Collect())",
      "",
      "class Ctx:",
      "    def __init__(self, inject_result):",
      "        self.commands = {}",
      "        self.injected = []",
      "        self.inject_result = inject_result",
      "    def register_command(self, name, handler, description=''):",
      "        self.commands[name] = handler",
      "    def inject_message(self, content, role='user', **kwargs):",
      "        self.injected.append({'content': content, 'role': role, 'kwargs': kwargs})",
      "        return self.inject_result",
      "",
      "options = json.loads(sys.argv[1])",
      "spec = importlib.util.spec_from_file_location('plugin', options['init'])",
      "plugin = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(plugin)",
      "ctx = Ctx(options['inject_result'])",
      "plugin.register(ctx)",
      "replies = {",
      "    name: handler(options['args'], **options['kwargs'])",
      "    for name, handler in ctx.commands.items()",
      "}",
      "print(json.dumps({",
      "    'commands': sorted(ctx.commands),",
      "    'replies': replies,",
      "    'injected': ctx.injected,",
      "    'warnings': warnings,",
      "}))",
      "",
    ].join("\n"),
  );

  const { stdout } = await execFileAsync(
    "python3",
    [
      runnerPath,
      JSON.stringify({
        init: join(pluginDir, "__init__.py"),
        args,
        kwargs: handlerKwargs,
        inject_result: injectResult,
      }),
    ],
    {
      env: {
        ...process.env,
        PYTHONPATH: stubDir,
        STUB_CONTEXT_SESSION_KEY: contextSessionKey,
      },
    },
  );
  return JSON.parse(stdout) as HermesPluginRun;
}
