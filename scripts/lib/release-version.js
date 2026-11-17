// Pure helpers for the deploy script. Every production deploy advances the version; the level
// follows docs/operations.md: patch by default, minor for a feature or model change, major for a
// change that breaks API or stored-data compatibility. A higher level resets the lower numbers.
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
export const RELEASE_LEVELS = Object.freeze(["patch", "minor", "major"]);

export function nextVersion(version, level = "patch") {
  const match = SEMVER.exec(String(version ?? ""));
  if (!match) throw new Error(`package.json version must be MAJOR.MINOR.PATCH, got ${JSON.stringify(version)}`);
  if (!RELEASE_LEVELS.includes(level)) throw new Error(`Release level must be one of ${RELEASE_LEVELS.join(", ")}, got ${JSON.stringify(level)}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export const nextPatchVersion = (version) => nextVersion(version, "patch");

/** The release level from deploy arguments: --minor or --major, never both; patch otherwise. */
export function releaseLevel(args) {
  const levels = RELEASE_LEVELS.filter((level) => args.includes(`--${level}`));
  if (levels.length > 1) throw new Error(`Choose one release level, got ${levels.map((level) => `--${level}`).join(" and ")}`);
  return levels[0] ?? "patch";
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
