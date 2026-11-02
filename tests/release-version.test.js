import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextPatchVersion, withLockVersion, withPackageVersion } from "../scripts/lib/release-version.js";

test("each deploy advances only the patch number", () => {
  assert.equal(nextPatchVersion("0.2.0"), "0.2.1");
  assert.equal(nextPatchVersion("0.2.9"), "0.2.10");
  assert.equal(nextPatchVersion("1.0.41"), "1.0.42");
  for (const invalid of ["0.2", "v0.2.0", "0.2.0-beta.1", "", undefined])
    assert.throws(() => nextPatchVersion(invalid), /MAJOR\.MINOR\.PATCH/);
});

test("version rewrites keep the rest of package.json and the lockfile unchanged", () => {
  const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const lock = readFileSync(new URL("../package-lock.json", import.meta.url), "utf8");
  const bumpedPkg = withPackageVersion(pkg, "9.9.9"), bumpedLock = withLockVersion(lock, "9.9.9");
  assert.equal(JSON.parse(bumpedPkg).version, "9.9.9");
  assert.deepEqual({ ...JSON.parse(bumpedPkg), version: null }, { ...JSON.parse(pkg), version: null });
  assert.equal(JSON.parse(bumpedLock).version, "9.9.9");
  assert.equal(JSON.parse(bumpedLock).packages[""].version, "9.9.9");
  // Restoring the original version reproduces the committed files byte for byte.
  assert.equal(withPackageVersion(bumpedPkg, JSON.parse(pkg).version), pkg);
  assert.equal(withLockVersion(bumpedLock, JSON.parse(lock).version), lock);
});
