// Plain JavaScript: Node does not strip TypeScript types for files below node_modules.
// The `prepare` script. It only acts when the package sits below node_modules, which is where
// bun places a consumer's commit-pinned git dependency (listed in `trustedDependencies`).
// bun does not install a git dependency's devDependencies, so TypeScript is missing there. The
// build therefore runs in a copy outside node_modules with its own `npm ci`, and only the build
// output is copied back. npm git installs build through `prepack` in their own clone instead.
// In a normal checkout it does nothing, so `npm ci` and `npm pack` stay side-effect free.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const buildOutputs = ["build"];
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function npm(args, cwd) {
  execFileSync("npm", args, { cwd, stdio: "inherit" });
}

if (packageRoot.split(path.sep).includes("node_modules")) {
  const buildRoot = mkdtempSync(path.join(tmpdir(), "git-install-build-"));
  const skipped = new Set(["node_modules", ".git", ...buildOutputs].map((entry) => path.join(packageRoot, entry)));

  try {
    cpSync(packageRoot, buildRoot, {
      recursive: true,
      filter: (source) => !skipped.has(source),
    });
    npm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], buildRoot);
    npm(["run", "build"], buildRoot);

    for (const output of buildOutputs) {
      rmSync(path.join(packageRoot, output), { recursive: true, force: true });
      cpSync(path.join(buildRoot, output), path.join(packageRoot, output), { recursive: true });
    }
  } finally {
    rmSync(buildRoot, { recursive: true, force: true });
  }
}
