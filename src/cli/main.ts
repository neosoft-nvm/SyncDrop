#!/usr/bin/env node
import { createProcessIO, run } from "./cli.js";

void run(process.argv.slice(2), createProcessIO()).then((code) => {
  process.exitCode = code;
});
