import { beforeEach } from "vitest";

import { resetRunWarningState } from "../utils/warned-once.js";

// `warnOnceWithFallback` remembers what it has already printed for the lifetime
// of the process, which is one CLI run in production but the whole suite here.
// Clearing it between tests keeps each test's warning expectations independent
// of whatever ran before it.
beforeEach(() => {
  resetRunWarningState();
});
