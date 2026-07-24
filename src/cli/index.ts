#!/usr/bin/env node

import { formatError } from "../utils/error.js";
import { createProgram } from "./program.js";

async function main(): Promise<void> {
  createProgram().parse();
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
