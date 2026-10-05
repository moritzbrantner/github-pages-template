#!/usr/bin/env node

// Committed launcher for the compiled CLI. Package managers link `bin` entries before a git
// dependency's `prepare` build runs, and bun skips links whose target does not exist yet, so the
// bin target must be a file that is present in the repository.
import "../build/bin/github-pages-template.js";
