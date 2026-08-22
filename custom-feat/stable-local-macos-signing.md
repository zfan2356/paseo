# Stable local macOS signing

- Status: active
- Commits: `66a33558f`, `13d9a8666`, `45a17982b`, `9bdcb959b`
- Ledger entry: "Stable local macOS signing"

## Original requirement

Every locally rebuilt Paseo.app was ad-hoc signed, so each rebuild produced a
new cdhash. macOS TCC treated every install as a brand-new app and re-asked
for every permission (screen recording, microphone, automation, …) after
every rebuild. There is no Developer ID on this machine. The requirement:
rebuilds should keep their TCC grants.

## Design

- A reusable self-created certificate, **`Paseo Local`**, generated once and
  stored under `~/Library/Application Support/Paseo/signing/` (outside the
  git checkout; trusted for code signing only — explicitly *not* a Developer
  ID or notarization identity).
- `npm run sign:desktop:local` deep-signs an install candidate with that
  identity. Because the designated requirement stays certificate-based, TCC
  grants persist across rebuilds; only the first switch from ad-hoc needs one
  new authorization.
- `electron-builder` on this machine can still emit ad-hoc bundles or fail on
  helper signing ("resource fork … detritus not allowed"), so the real
  candidate is a `ditto --norsrc --noextattr` clean copy re-signed by
  `sign-local-app.sh`. Never fall back to `codesign --sign -`: a fresh
  ad-hoc cdhash forces a new TCC grant, defeating the feature.
- Signing temporarily adds the identity's keychain to the user search list
  and must restore the **exact** original list afterwards — a malformed
  nested path there silently breaks Cursor's credential lookup.

Install flow of the signed candidate is owned by
[safe-local-macos-app-replacement.md](safe-local-macos-app-replacement.md).
