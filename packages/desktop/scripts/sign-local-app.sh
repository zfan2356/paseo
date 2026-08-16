#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
IDENTITY_SCRIPT="${SCRIPT_DIR}/local-signing-identity.sh"

usage() {
  cat <<'EOF'
Usage: sign-local-app.sh --app <Paseo.app> [--home <dir>]

Deep-sign a local Paseo.app with the stable Paseo Local identity.
EOF
}

APP=""
SIGNING_HOME_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP="$2"
      shift 2
      ;;
    --home)
      SIGNING_HOME_ARGS=(--home "$2")
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$APP" ]]; then
  echo "--app is required" >&2
  usage >&2
  exit 1
fi

IDENTITY="$("$IDENTITY_SCRIPT" --ensure "${SIGNING_HOME_ARGS[@]}")"
SIGNING_HOME="${PASEO_LOCAL_SIGNING_HOME:-${HOME}/Library/Application Support/Paseo/signing}"
if [[ ${#SIGNING_HOME_ARGS[@]} -eq 2 ]]; then
  SIGNING_HOME="${SIGNING_HOME_ARGS[1]}"
fi
KEYCHAIN="${SIGNING_HOME}/paseo-local.keychain-db"
PASSWORD="$(/bin/cat "${SIGNING_HOME}/keychain.password")"

/usr/bin/security unlock-keychain -p "$PASSWORD" "$KEYCHAIN" >/dev/null

original_keychains=()
while IFS= read -r line; do
  original_keychains+=("${line//\"/}")
done < <(/usr/bin/security list-keychains -d user)

restore_keychains() {
  /usr/bin/security list-keychains -d user -s "${original_keychains[@]}" >/dev/null
}
trap restore_keychains EXIT

/usr/bin/security list-keychains -d user -s "$KEYCHAIN" "${original_keychains[@]}" >/dev/null
/usr/bin/codesign --deep --force --sign "$IDENTITY" --keychain "$KEYCHAIN" --timestamp=none "$APP"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP"
