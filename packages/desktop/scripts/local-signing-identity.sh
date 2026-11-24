#!/usr/bin/env bash
set -euo pipefail

IDENTITY_NAME="Paseo Local"
DEFAULT_HOME="${HOME}/Library/Application Support/Paseo/signing"

usage() {
  cat <<'EOF'
Usage: local-signing-identity.sh [--ensure|--print] [--home <dir>]

Create or reuse a stable local code-signing identity so rebuilt Paseo.app
keeps the same designated requirement and macOS TCC grants persist.
EOF
}

SIGNING_HOME="${PASEO_LOCAL_SIGNING_HOME:-$DEFAULT_HOME}"
ACTION="ensure"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ensure)
      ACTION="ensure"
      shift
      ;;
    --print)
      ACTION="print"
      shift
      ;;
    --home)
      SIGNING_HOME="$2"
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

KEYCHAIN="${SIGNING_HOME}/paseo-local.keychain-db"
PASSWORD_FILE="${SIGNING_HOME}/keychain.password"

keychain_password() {
  if [[ ! -f "$PASSWORD_FILE" ]]; then
    return 1
  fi
  /bin/cat "$PASSWORD_FILE"
}

unlock_signing_keychain() {
  local password
  password="$(keychain_password)"
  /usr/bin/security unlock-keychain -p "$password" "$KEYCHAIN" >/dev/null
}

identity_exists() {
  [[ -f "$KEYCHAIN" ]] || return 1
  unlock_signing_keychain
  /usr/bin/security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null | /usr/bin/grep -q "\"${IDENTITY_NAME}\""
}

print_identity() {
  if ! identity_exists; then
    echo "missing local signing identity: ${IDENTITY_NAME}" >&2
    return 1
  fi
  printf '%s\n' "$IDENTITY_NAME"
}

create_identity() {
  /bin/mkdir -p "$SIGNING_HOME"
  /bin/chmod 700 "$SIGNING_HOME"

  if [[ ! -f "$PASSWORD_FILE" ]]; then
    /usr/bin/openssl rand -base64 32 >"$PASSWORD_FILE"
    /bin/chmod 600 "$PASSWORD_FILE"
  fi

  local password
  password="$(keychain_password)"

  if [[ ! -f "$KEYCHAIN" ]]; then
    /usr/bin/security create-keychain -p "$password" "$KEYCHAIN"
  fi
  /usr/bin/security set-keychain-settings -lut 21600 "$KEYCHAIN"
  unlock_signing_keychain

  if identity_exists; then
    return 0
  fi

  local work
  work="$(/usr/bin/mktemp -d /tmp/paseo-local-signing.XXXXXX)"
  local p12_password
  p12_password="$(/usr/bin/openssl rand -hex 16)"

  cat >"${work}/codesign.cnf" <<'EOF'
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_codesign
prompt = no

[req_distinguished_name]
CN = Paseo Local
O = Paseo Local Signing

[v3_codesign]
basicConstraints = CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = codeSigning
EOF

  /usr/bin/openssl req -new -x509 -days 3650 -nodes -newkey rsa:2048 \
    -config "${work}/codesign.cnf" \
    -keyout "${work}/key.pem" \
    -out "${work}/cert.pem"
  /usr/bin/openssl pkcs12 -export \
    -inkey "${work}/key.pem" \
    -in "${work}/cert.pem" \
    -out "${work}/cert.p12" \
    -passout "pass:${p12_password}" \
    -name "$IDENTITY_NAME"

  /usr/bin/security import "${work}/cert.p12" \
    -k "$KEYCHAIN" \
    -P "$p12_password" \
    -T /usr/bin/codesign \
    -T /usr/bin/security \
    >/dev/null
  /usr/bin/security add-trusted-cert \
    -r trustRoot \
    -p codeSign \
    -k "$KEYCHAIN" \
    "${work}/cert.pem" \
    >/dev/null
  /usr/bin/security set-key-partition-list \
    -S apple-tool:,apple:,codesign: \
    -s \
    -k "$password" \
    "$KEYCHAIN" >/dev/null
  /bin/cp "${work}/cert.pem" "${SIGNING_HOME}/paseo-local.cer"
  /bin/chmod 600 "${SIGNING_HOME}/paseo-local.cer"

  /bin/rm -rf "$work"

  if ! identity_exists; then
    echo "failed to create local signing identity: ${IDENTITY_NAME}" >&2
    return 1
  fi
}

case "$ACTION" in
  print)
    print_identity
    ;;
  ensure)
    if ! identity_exists; then
      create_identity
    fi
    print_identity
    ;;
esac
