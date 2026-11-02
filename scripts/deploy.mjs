import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { nextPatchVersion, withLockVersion, withPackageVersion } from "./lib/release-version.js";

// Production deploy that advances the patch version shown in Settings.
// The bump is committed locally only after Cloudflare accepts the upload;
// a failed or dry run restores the previous version. Pushing stays manual.
const dryRun = process.argv.includes("--dry-run");
const root = process.cwd();
const files = { package: resolve(root, "package.json"), lock: resolve(root, "package-lock.json") };

const run = (command, args, options = {}) => spawnSync(command, args, { stdio: "inherit", ...options });
function git(...args) {
  const result = spawnSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
  return result.stdout;
}

// A release commit must contain only the version bump.
if (!dryRun && git("status", "--porcelain", "--", "package.json", "package-lock.json").trim())
  throw new Error("package.json or package-lock.json has uncommitted changes; commit or discard them before deploying");

// Code that reads a new D1 column must not go live before its migration has been applied.
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const migrations = spawnSync(process.execPath, [wrangler, "d1", "migrations", "list", "stockapps-t86", "--remote"], { encoding: "utf8" });
if (migrations.status !== 0 || !`${migrations.stdout}${migrations.stderr}`.includes("No migrations to apply")) {
  const message = "Remote D1 has unapplied migrations (or the check failed). Apply them first: npx wrangler d1 migrations apply stockapps-t86 --remote";
  if (!dryRun) throw new Error(message);
  console.warn(message);
}

const original = { package: readFileSync(files.package, "utf8"), lock: readFileSync(files.lock, "utf8") };
const previous = JSON.parse(original.package).version;
const version = nextPatchVersion(previous);
const restore = () => {
  writeFileSync(files.package, original.package);
  writeFileSync(files.lock, original.lock);
};

writeFileSync(files.package, withPackageVersion(original.package, version));
writeFileSync(files.lock, withLockVersion(original.lock, version));
console.log(`Release v${version} (was v${previous})${dryRun ? " — dry run" : ""}`);

let status = 1;
try {
  const build = run(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "build", "--mode", "cloudflare", "--configLoader", "runner"]);
  if (build.status !== 0) throw new Error("Build failed");
  const deploy = run(process.execPath, [wrangler, "deploy",
    "--message", `v${version}`, ...(dryRun ? ["--dry-run"] : [])]);
  if (deploy.status !== 0) throw new Error("wrangler deploy failed");
  status = 0;
} catch (error) {
  console.error(`${error.message}; version stays v${previous}`);
}

if (status !== 0 || dryRun) restore();
else {
  git("commit", "-m", `Release v${version}`, "--", "package.json", "package-lock.json");
  console.log(`Deployed and committed v${version}. Push when ready: git push origin main`);
}
process.exitCode = status;
