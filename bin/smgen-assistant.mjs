#!/usr/bin/env node

import { main } from "../dist/cli/index.mjs";

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`smgen-assistant: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
