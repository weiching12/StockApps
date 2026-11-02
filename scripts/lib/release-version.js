// Pure helpers for the deploy script: every production deploy advances the patch version.
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function nextPatchVersion(version) {
  const match = SEMVER.exec(String(version ?? ""));
  if (!match) throw new Error(`package.json version must be MAJOR.MINOR.PATCH, got ${JSON.stringify(version)}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

// Rewrite only the version fields, keeping npm's two-space layout and trailing newline.
export function withPackageVersion(text, version) {
  const json = JSON.parse(text);
  json.version = version;
  return `${JSON.stringify(json, null, 2)}\n`;
}

export function withLockVersion(text, version) {
  const json = JSON.parse(text);
  json.version = version;
  if (json.packages?.[""]) json.packages[""].version = version;
  return `${JSON.stringify(json, null, 2)}\n`;
}
