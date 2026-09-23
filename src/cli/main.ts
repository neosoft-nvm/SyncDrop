#!/usr/bin/env node
import { createProcessIO, run } from "./cli.js";

process.exitCode = await run(process.argv.slice(2), createProcessIO());
