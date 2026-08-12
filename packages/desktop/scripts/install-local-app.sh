#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEFAULT_APP="$SCRIPT_DIR/../release/mac-arm64/Paseo.app"
DEFAULT_TARGET="/Applications/Paseo.app"
DEFAULT_DELAY_SECONDS=10
DEFAULT_LOG="/tmp/paseo-local-install.log"

usage() {
  cat <<'EOF'
Usage: install-local-app.sh [options]

Safely replace the installed macOS Paseo app after a short delay.

Options:
  --app <path>       Signed candidate app (default: desktop release/mac-arm64/Paseo.app)
  --target <path>    Installed app to replace (default: /Applications/Paseo.app)
  --delay <seconds>  Delay before quitting Paseo (default: 10, minimum: 5)
  --dry-run          Validate inputs and print the one-shot LaunchAgent without loading it
  -h, --help         Show this help
EOF
}

xml_escape() {
  printf '%s' "$1" | /usr/bin/sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

canonicalize_existing_path() {
  local input="$1"
  local directory
  local basename
  directory="$(cd "$(dirname "$input")" && pwd -P)"
  basename="$(basename "$input")"
  printf '%s/%s' "$directory" "$basename"
}

render_launch_agent() {
  local script_path="$1"
  local candidate_app="$2"
  local target_app="$3"
  local staging_app="$4"
  local backup_app="$5"
  local plist_path="$6"
  local label="$7"
  local log_file="$8"
  local delay_seconds="$9"

  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$label")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$script_path")</string>
    <string>--perform</string>
    <string>$(xml_escape "$candidate_app")</string>
    <string>$(xml_escape "$target_app")</string>
    <string>$(xml_escape "$staging_app")</string>
    <string>$(xml_escape "$backup_app")</string>
    <string>$(xml_escape "$plist_path")</string>
    <string>$(xml_escape "$label")</string>
    <string>$(xml_escape "$log_file")</string>
    <string>$(xml_escape "$delay_seconds")</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$log_file")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$log_file")</string>
</dict>
</plist>
EOF
}

restore_previous_app() {
  local status="$?"
  trap - EXIT
  set +e

  if [[ -d "$BACKUP_APP" ]]; then
    /usr/bin/pkill -TERM -f -x "$TARGET_APP/Contents/MacOS/Paseo" >/dev/null 2>&1
    sleep 1
    if [[ -d "$TARGET_APP" ]]; then
      /bin/mv "$TARGET_APP" "$CANDIDATE_APP"
    elif [[ -d "$STAGING_APP" ]]; then
      /bin/mv "$STAGING_APP" "$CANDIDATE_APP"
    fi
    /bin/mv "$BACKUP_APP" "$TARGET_APP"
    /usr/bin/open -n "$TARGET_APP"
  elif [[ -d "$STAGING_APP" && ! -e "$CANDIDATE_APP" ]]; then
    /bin/mv "$STAGING_APP" "$CANDIDATE_APP"
  fi

  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') Installation failed; previous app restored"
  /bin/launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
  exit "$status"
}

perform_install() {
  CANDIDATE_APP="$1"
  TARGET_APP="$2"
  STAGING_APP="$3"
  BACKUP_APP="$4"
  PLIST_PATH="$5"
  LABEL="$6"
  LOG_FILE="$7"
  DELAY_SECONDS="$8"

  exec >"$LOG_FILE" 2>&1
  /bin/rm -f "$PLIST_PATH"
  trap restore_previous_app EXIT

  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') Waiting for the current Paseo session to finish"
  sleep "$DELAY_SECONDS"

  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') Stopping the current Paseo app and daemon"
  /usr/bin/osascript -e 'tell application id "sh.paseo.desktop" to quit' || true

  local attempt
  for ((attempt = 0; attempt < 20; attempt += 1)); do
    if ! /usr/bin/pgrep -f -x "$TARGET_APP/Contents/MacOS/Paseo" >/dev/null && \
      ! /usr/bin/pgrep -f '^Paseo Supervisor' >/dev/null; then
      break
    fi
    sleep 1
  done

  /usr/bin/pkill -TERM -f -x "$TARGET_APP/Contents/MacOS/Paseo" >/dev/null 2>&1 || true
  /usr/bin/pkill -TERM -f '^Paseo Supervisor' >/dev/null 2>&1 || true
  /usr/bin/pkill -TERM -f '^Paseo Daemon' >/dev/null 2>&1 || true
  sleep 2

  [[ -d "$CANDIDATE_APP" ]] || {
    echo "Validated build is missing: $CANDIDATE_APP" >&2
    return 1
  }
  [[ -d "$TARGET_APP" ]] || {
    echo "Installed app is missing: $TARGET_APP" >&2
    return 1
  }
  [[ ! -e "$STAGING_APP" ]] || {
    echo "Refusing to overwrite staging app: $STAGING_APP" >&2
    return 1
  }
  [[ ! -e "$BACKUP_APP" ]] || {
    echo "Refusing to overwrite rollback app: $BACKUP_APP" >&2
    return 1
  }

  /usr/bin/codesign --verify --deep --strict --verbose=2 "$CANDIDATE_APP"

  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') Installing the validated build"
  /bin/mv "$CANDIDATE_APP" "$STAGING_APP"
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$STAGING_APP"
  /bin/mv "$TARGET_APP" "$BACKUP_APP"
  /bin/mv "$STAGING_APP" "$TARGET_APP"
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$TARGET_APP"

  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') Launching the new Paseo app"
  /usr/bin/open -n "$TARGET_APP"

  local launched=false
  for ((attempt = 0; attempt < 30; attempt += 1)); do
    if /usr/bin/pgrep -f -x "$TARGET_APP/Contents/MacOS/Paseo" >/dev/null; then
      launched=true
      break
    fi
    sleep 1
  done

  [[ "$launched" == true ]] || {
    echo "New app did not launch: $TARGET_APP" >&2
    return 1
  }

  trap - EXIT
  /bin/rm -rf "$BACKUP_APP"
  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') Installed and launched $TARGET_APP"
  /usr/bin/find /Applications -maxdepth 2 -iname '*paseo*.app' -print
  /bin/launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
}

schedule_install() {
  local candidate_app="$1"
  local target_app="$2"
  local delay_seconds="$3"
  local dry_run="$4"

  [[ "$(uname -s)" == Darwin ]] || {
    echo "Local Paseo app installation is supported only on macOS." >&2
    return 1
  }
  [[ "$delay_seconds" =~ ^[0-9]+$ && "$delay_seconds" -ge 5 ]] || {
    echo "Delay must be an integer of at least 5 seconds." >&2
    return 1
  }
  [[ -d "$candidate_app" ]] || {
    echo "Candidate app does not exist: $candidate_app" >&2
    return 1
  }
  [[ -d "$target_app" ]] || {
    echo "Installed app does not exist: $target_app" >&2
    return 1
  }

  candidate_app="$(canonicalize_existing_path "$candidate_app")"
  target_app="$(canonicalize_existing_path "$target_app")"
  [[ "$candidate_app" != "$target_app" ]] || {
    echo "Candidate and installed app must be different paths." >&2
    return 1
  }

  /usr/bin/codesign --verify --deep --strict --verbose=2 "$candidate_app"

  local timestamp
  local label
  local plist_path
  local staging_app
  local backup_app
  timestamp="$(date +%s)"
  label="sh.paseo.local-install.$timestamp.$$"
  plist_path="$HOME/Library/LaunchAgents/$label.plist"
  staging_app="$(dirname "$target_app")/.Paseo.installing.app"
  backup_app="/tmp/Paseo.previous.$timestamp.$$.app"

  if [[ "$dry_run" == true ]]; then
    render_launch_agent \
      "$SCRIPT_DIR/install-local-app.sh" \
      "$candidate_app" \
      "$target_app" \
      "$staging_app" \
      "$backup_app" \
      "$plist_path" \
      "$label" \
      "$DEFAULT_LOG" \
      "$delay_seconds"
    return
  fi

  /bin/mkdir -p "$HOME/Library/LaunchAgents"
  render_launch_agent \
    "$SCRIPT_DIR/install-local-app.sh" \
    "$candidate_app" \
    "$target_app" \
    "$staging_app" \
    "$backup_app" \
    "$plist_path" \
    "$label" \
    "$DEFAULT_LOG" \
    "$delay_seconds" >"$plist_path"
  /usr/bin/plutil -lint "$plist_path"
  /bin/launchctl bootstrap "gui/$(id -u)" "$plist_path"

  printf 'Scheduled one-shot Paseo replacement in %s seconds.\n' "$delay_seconds"
  printf 'Install log: %s\n' "$DEFAULT_LOG"
}

if [[ "${1:-}" == --perform ]]; then
  shift
  [[ "$#" -eq 8 ]] || {
    echo "Invalid internal installer arguments." >&2
    exit 2
  }
  perform_install "$@"
  exit
fi

if [[ "${1:-}" == --render-launch-agent ]]; then
  shift
  [[ "$#" -eq 9 ]] || {
    echo "Invalid launch agent rendering arguments." >&2
    exit 2
  }
  render_launch_agent "$@"
  exit
fi

candidate_app="$DEFAULT_APP"
target_app="$DEFAULT_TARGET"
delay_seconds="$DEFAULT_DELAY_SECONDS"
dry_run=false

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --app)
      [[ "$#" -ge 2 ]] || { echo "--app requires a path." >&2; exit 2; }
      candidate_app="$2"
      shift 2
      ;;
    --target)
      [[ "$#" -ge 2 ]] || { echo "--target requires a path." >&2; exit 2; }
      target_app="$2"
      shift 2
      ;;
    --delay)
      [[ "$#" -ge 2 ]] || { echo "--delay requires seconds." >&2; exit 2; }
      delay_seconds="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    -h | --help)
      usage
      exit
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

schedule_install "$candidate_app" "$target_app" "$delay_seconds" "$dry_run"
