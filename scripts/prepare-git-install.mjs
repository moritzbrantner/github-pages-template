// Plain JavaScript: Node does not strip TypeScript types for files below node_modules.
// The `prepare` script, which builds the package when it is installed as a commit-pinned git
// dependency.
// - bun runs it inside the consumer's node_modules (for packages in `trustedDependencies`)
//   without the package's devDependencies, so TypeScript is missing there. The build runs in a
//   copy outside node_modules with its own `npm ci`, and only the build output is copied back.
// - npm runs it in a temporary clone after installing devDependencies, then packs that clone
//   without running `prepack`, so the build has to happen here.
// In a normal checkout it also builds once devDependencies are installed (`npm ci`).

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
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
} else if (existsSync(path.join(packageRoot, "node_modules", "typescript"))) {
  npm(["run", "build"], packageRoot);
}
