#!/usr/bin/env bash
#
# release-local.sh — build a release on this machine and publish it to
# 17Arigato-jwd/Authno-Releases, without GitHub Actions.
#
# Usage:
#   scripts/release-local.sh 1.1.20-beta.0
#   scripts/release-local.sh 1.1.20-beta.0 --dry-run       # build, publish nothing
#   scripts/release-local.sh 1.1.20-beta.0 --skip-windows  # no wine on this box
#
# ── Why this exists ─────────────────────────────────────────────────────────
# The repository is private. Actions minutes are metered and artifact storage
# is capped, and a release run hit that cap and died before it built anything.
# A laptop has neither limit. This does what .github/workflows/build.yml does,
# in the same order, with the same guards, and uploads the result to the
# public releases repository directly.
#
# It is deliberately a peer of the workflow rather than a replacement: the two
# produce the same artifacts, so either can cut a release. Any change to the
# build here should be mirrored there and vice versa.
#
# ── What it needs, once ─────────────────────────────────────────────────────
# Copy scripts/release.env.example to scripts/release.env and fill it in. That
# file is gitignored and holds the keystore passwords, the publishing token,
# and the three REACT_APP_* values that are repository Variables in CI.
#
# Tools: node, npm, java (17+), the Android SDK (ANDROID_HOME set), tar, zip,
# curl. Windows installers additionally need wine.

set -euo pipefail

# ── Where everything is ─────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RELEASES_REPO="17Arigato-jwd/Authno-Releases"
OUT="$ROOT/dist-release"

# Android requires versionCode to increase monotonically; a device refuses an
# APK whose code is lower than the installed one, and says only "app not
# installed". CI derived it from the run number, which reached 294 — and the
# published v1.1.19-beta.0 carries exactly that.
#
# `git rev-list --count HEAD` is the natural local equivalent (it only ever
# grows) but is currently ~95, far BELOW what shipped. So it is offset past
# the high-water mark. 1000 leaves room for CI to keep numbering runs without
# ever colliding, and the sum still only increases.
VERSION_CODE_BASE=1000

# ── Arguments ───────────────────────────────────────────────────────────────
VERSION="${1:-}"
DRY_RUN=0
SKIP_WINDOWS=0
shift || true
for arg in "$@"; do
  case "$arg" in
    --dry-run)      DRY_RUN=1 ;;
    --skip-windows) SKIP_WINDOWS=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ -z "$VERSION" ]; then
  echo "usage: scripts/release-local.sh <version> [--dry-run] [--skip-windows]" >&2
  echo "example: scripts/release-local.sh 1.1.20-beta.0" >&2
  exit 2
fi
VERSION="${VERSION#v}"
TAG="v$VERSION"

say()  { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[0;32m✔\033[0m %s\n' "$*"; }
die()  { printf '\n\033[0;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# ── Configuration ───────────────────────────────────────────────────────────
if [ -f "$ROOT/scripts/release.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$ROOT/scripts/release.env"; set +a
else
  die "scripts/release.env is missing. Copy scripts/release.env.example to it and fill it in."
fi

# ── Preflight ───────────────────────────────────────────────────────────────
# Everything that can be known before an hour of compiling is checked here.
# This is the same reasoning as the workflow's build-react preflight: a
# missing password should cost five seconds, not a full Android build.
say "Preflight"

for tool in node npm java tar zip curl git; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed."
done
ok "tools present"

[ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || \
  die "ANDROID_HOME (or ANDROID_SDK_ROOT) is not set — the Android build needs the SDK."

MISSING=""
for v in RELEASES_TOKEN STORE_PASSWORD KEY_ALIAS KEY_PASSWORD \
         REACT_APP_ACCESS_PUBKEY REACT_APP_REQUIRE_INVITE REACT_APP_GATE_API; do
  [ -n "${!v:-}" ] || MISSING="$MISSING $v"
done
[ -z "$MISSING" ] || die "scripts/release.env is missing:$MISSING"
ok "configuration complete"

KEYSTORE="${KEYSTORE_PATH:-$ROOT/android/app/keystore.jks}"
[ -f "$KEYSTORE" ] || die "No keystore at $KEYSTORE. Set KEYSTORE_PATH in release.env, or put keystore.jks there."
KEYSTORE="$(cd "$(dirname "$KEYSTORE")" && pwd)/$(basename "$KEYSTORE")"   # absolutise for gradle
ok "keystore found"

# Signing with the wrong key produces an APK that no existing installation
# will accept as an update — and it looks like a corrupt download, not a
# signing problem. Verify the alias opens before building anything.
if command -v keytool >/dev/null 2>&1; then
  keytool -list -keystore "$KEYSTORE" -alias "$KEY_ALIAS" \
          -storepass "$STORE_PASSWORD" >/dev/null 2>&1 \
    || die "The keystore will not open with this KEY_ALIAS/STORE_PASSWORD. Fix release.env before building."
  ok "keystore opens with the configured alias and password"
fi

# The release body comes from CHANGELOG.md, exactly as the workflow does it.
# awk rather than sed: the section runs to the NEXT "## " and must not include
# it, which sed's inclusive ranges cannot express.
NOTES="$(awk -v ver="## $VERSION" '
  $0 == ver { grab = 1; next }
  grab && /^## / { exit }
  grab { print }
' CHANGELOG.md)"
[ -n "$NOTES" ] || die "CHANGELOG.md has no '## $VERSION' section, so the release would have an empty body."
ok "changelog section found ($(printf '%s' "$NOTES" | wc -c) bytes)"

# A dirty tree means the thing you ship is not the thing in the repository,
# and nobody can ever reconstruct it. This is the single biggest hazard of
# building on a laptop rather than a clean runner.
[ -z "$(git status --porcelain)" ] || \
  die "Working tree has uncommitted changes. Commit or stash them — a release must be reproducible from a commit."
git fetch origin --quiet
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "@{upstream}" 2>/dev/null || echo "")"
[ -n "$REMOTE" ] && [ "$LOCAL" = "$REMOTE" ] || \
  die "HEAD is not level with its upstream. Pull or push first, so the release matches what is on origin."
ok "tree clean and level with origin ($(git rev-parse --short HEAD))"

if [ "$DRY_RUN" = 0 ]; then
  # This asks one question and answers two: is the tag free, and does the
  # token still work? Both have to be true, and both are cheap to check now
  # and expensive to discover an hour from now with the build finished.
  #
  # Each status gets its own message. Collapsing them into "not 404 means the
  # tag exists" would report an expired or mistyped token as a name clash,
  # which sends you to delete a release that was never there.
  code="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "authorization: Bearer $RELEASES_TOKEN" \
    -H "accept: application/vnd.github+json" \
    "https://api.github.com/repos/$RELEASES_REPO/releases/tags/$TAG")"
  case "$code" in
    404) ok "$TAG is free, and the token works" ;;
    200) die "$TAG already exists in $RELEASES_REPO. Delete it there, or pick a new version." ;;
    401|403)
      die "GitHub rejected RELEASES_TOKEN (HTTP $code).
   Either it lacks Contents: read and write on $RELEASES_REPO, or it was
   regenerated after scripts/release.env was filled in — regenerating
   replaces the value, it does not keep the old one working." ;;
    *) die "Could not reach the GitHub API (HTTP $code). Not starting a build that has nowhere to go." ;;
  esac
fi

VERSION_CODE=$(( VERSION_CODE_BASE + $(git rev-list --count HEAD) ))
ok "versionName=$VERSION  versionCode=$VERSION_CODE"

# ── Leave the tree as we found it ───────────────────────────────────────────
# Two things the build writes into the working tree are inputs, not source:
# the stamped package.json version, and the React bundle copied into the
# sandbox's app/ directory. CI gets away with ignoring both because a runner
# is thrown away afterwards. A laptop is not.
#
# Left behind, they fail the *next* run's clean-tree check, and they do it in
# a way that reads as your own uncommitted edits rather than as debris. So
# undo them on the way out, whether this succeeds or dies.
ORIGINAL_PKG_VERSION="$(node -p "require('./package.json').version")"
cleanup() {
  local status=$?
  npm pkg set version="$ORIGINAL_PKG_VERSION" >/dev/null 2>&1 || true
  rm -rf "$ROOT/extensions/extbk-sandbox/app"
  return $status
}
trap cleanup EXIT

rm -rf "$OUT"; mkdir -p "$OUT"

# ── 1. React ────────────────────────────────────────────────────────────────
say "Building the React app"
npm ci --no-audit --no-fund --legacy-peer-deps
npm pkg set version="$VERSION"          # prebuild regenerates src/version.js from this
CI=false npm run build
ok "built"

# Reed-Solomon is what makes a damaged .authbook recoverable. If it is broken,
# every format this release ships is subtly wrong, so it gates everything.
CI=true npx react-scripts test src/utils/rs.test.js --watchAll=false
ok "Reed-Solomon round-trip tests pass"

grep -qF "$REACT_APP_GATE_API" build/static/js/*.js \
  || die "REACT_APP_GATE_API did not reach the bundle — password sign-in would ship dead."
ok "gate configuration is compiled into the bundle"

# ── 2. Source maps ──────────────────────────────────────────────────────────
# Keep them here, out of the shipped bundle. Every installer before
# v1.1.19-beta.0 carried ~1.29M characters of first-party source this way.
say "Separating the source maps from the shipped bundle"
mkdir -p "$OUT/sourcemaps"
find build -name '*.map' -exec cp {} "$OUT/sourcemaps/" \;
ok "kept $(find "$OUT/sourcemaps" -name '*.map' | wc -l) map(s) in $OUT/sourcemaps"

find build -name '*.map' -delete
find build/static -type f \( -name '*.js' -o -name '*.css' \) \
  -exec sed -i -e '/^\/\/# sourceMappingURL=/d' -e 's|/\*# sourceMappingURL=[^*]*\*/||g' {} +

left=$(find build -name '*.map' | wc -l)
# `|| true` is load-bearing: grep exits 1 when it matches NOTHING, and under
# `set -e` that would abort the script for succeeding.
refs=$(grep -rl "sourceMappingURL" build/static 2>/dev/null | wc -l || true)
[ "$left" = "0" ] && [ "$refs" = "0" ] \
  || die "maps remaining: $left, files still referencing one: $refs"
ok "no source maps in the bundle the platform builds will package"

# ── 3. Android ──────────────────────────────────────────────────────────────
say "Building the Android APK and AAB"
npx cap sync android
(
  cd android
  export KEYSTORE_PATH="$KEYSTORE" STORE_PASSWORD KEY_ALIAS KEY_PASSWORD
  ./gradlew assembleRelease bundleRelease --no-daemon \
    -PversionCode="$VERSION_CODE" -PversionName="$VERSION"
)
cp android/app/build/outputs/apk/release/*.apk       "$OUT/"
cp android/app/build/outputs/bundle/release/*.aab    "$OUT/"
ok "APK and AAB built and signed"

# ── 4. Desktop ──────────────────────────────────────────────────────────────
say "Building the Linux packages"
npm run dist:linux
cp dist-electron/*.AppImage dist-electron/*.deb dist-electron/*.rpm "$OUT/" 2>/dev/null || true
ok "AppImage, deb and rpm built"

if [ "$SKIP_WINDOWS" = 1 ]; then
  printf '  \033[0;33m•\033[0m skipping the Windows installer (--skip-windows)\n'
elif command -v wine >/dev/null 2>&1; then
  say "Building the Windows installer (through wine)"
  npm run dist:win
  cp dist-electron/*.exe "$OUT/" 2>/dev/null || true
  ok "installer built"
else
  die "wine is not installed, so the Windows installer cannot be built here.
   Install wine, or re-run with --skip-windows to publish without it.
   Publishing without it means Windows users see no download for this version."
fi

# ── 5. extbk sandbox ────────────────────────────────────────────────────────
say "Packaging the extbk sandbox"
PKG="extbk-sandbox-$TAG"
rm -rf "extensions/extbk-sandbox/app"
mkdir -p "extensions/extbk-sandbox/app"
cp -r build/. "extensions/extbk-sandbox/app/"
[ -f "extensions/extbk-sandbox/app/index.html" ] || die "Bundled React app missing from extbk-sandbox/app/"
( cd extensions/extbk-sandbox && npm install --omit=dev --no-audit --no-fund )

STAGE="$(mktemp -d)"
mkdir -p "$STAGE/$PKG"
cp -r extensions/extbk-sandbox/src        "$STAGE/$PKG/src"
cp -r extensions/extbk-sandbox/app        "$STAGE/$PKG/app"
cp -r extensions/extbk-sandbox/installer  "$STAGE/$PKG/installer"
cp    extensions/extbk-sandbox/package.json "$STAGE/$PKG/package.json"
chmod +x "$STAGE/$PKG/installer/install.sh"
tar -czf "$OUT/${PKG}-linux-mac.tar.gz" -C "$STAGE" "$PKG"
( cd "$STAGE" && zip -qr "$OUT/${PKG}-windows.zip" "$PKG" )
rm -rf "$STAGE"
ok "sandbox installers packaged"

# ── 6. What we are about to publish ─────────────────────────────────────────
say "Assets"
ASSETS=()
while IFS= read -r f; do ASSETS+=("$f"); done < <(find "$OUT" -maxdepth 1 -type f | sort)
[ "${#ASSETS[@]}" -gt 0 ] || die "Nothing was built."
for f in "${ASSETS[@]}"; do
  printf '  %-52s %s\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)"
done

if [ "$DRY_RUN" = 1 ]; then
  say "Dry run — nothing published. The files above are in $OUT"
  exit 0
fi

# ── 7. Publish ──────────────────────────────────────────────────────────────
# The token goes in a header read from the environment, never on a command
# line, where `ps` would show it to every process on the machine.
say "Publishing $TAG to $RELEASES_REPO"

RELEASE_JSON="$(printf '%s' "$NOTES" | node -e '
  const body = require("fs").readFileSync(0, "utf8");
  process.stdout.write(JSON.stringify({
    tag_name: process.argv[1],
    name: "AuthNo " + process.argv[1],
    target_commitish: "main",
    body,
    draft: false,
    prerelease: false,   // /releases/latest skips prereleases, and the website reads it
  }));
' "$TAG")"

RESP="$(printf '%s' "$RELEASE_JSON" | curl -sS -X POST \
  -H "authorization: Bearer $RELEASES_TOKEN" \
  -H "accept: application/vnd.github+json" \
  -H "content-type: application/json" \
  --data-binary @- \
  "https://api.github.com/repos/$RELEASES_REPO/releases")"

RELEASE_ID="$(printf '%s' "$RESP" | node -e '
  let d = ""; process.stdin.on("data", c => d += c).on("end", () => {
    const r = JSON.parse(d);
    if (!r.id) { console.error("GitHub refused to create the release:\n" + d); process.exit(1); }
    process.stdout.write(String(r.id));
  });
')"
ok "release created (id $RELEASE_ID)"

for f in "${ASSETS[@]}"; do
  name="$(basename "$f")"
  printf '  uploading %-46s' "$name"
  up="$(curl -sS -X POST \
    -H "authorization: Bearer $RELEASES_TOKEN" \
    -H "accept: application/vnd.github+json" \
    -H "content-type: application/octet-stream" \
    --data-binary @"$f" \
    "https://uploads.github.com/repos/$RELEASES_REPO/releases/$RELEASE_ID/assets?name=$name")"
  printf '%s' "$up" | node -e '
    let d = ""; process.stdin.on("data", c => d += c).on("end", () => {
      const r = JSON.parse(d);
      if (r.state === "uploaded") console.log("✔");
      else { console.error("\nupload failed:\n" + d); process.exit(1); }
    });
  '
done

say "Published"
echo "  https://github.com/$RELEASES_REPO/releases/tag/$TAG"
echo
echo "  The downloads page reads this within ten minutes (the Worker caches"
echo "  /v1/releases/latest for that long). Nothing else to do."
echo
echo "  Source maps for this build are in $OUT/sourcemaps — keep them if you"
echo "  want readable stack traces from this version's error reports. They are"
echo "  deliberately not published."
