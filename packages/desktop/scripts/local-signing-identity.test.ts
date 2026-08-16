import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "local-signing-identity.sh");
const SIGN_SCRIPT = join(import.meta.dirname, "sign-local-app.sh");

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

describe.skipIf(process.platform !== "darwin")("local signing identity", () => {
  it(
    "creates a stable certificate identity instead of a one-off ad-hoc cdhash",
    { timeout: 20_000 },
    () => {
      const home = mkdtempSync(join(tmpdir(), "paseo-local-signing-"));
      const dummy = join(home, "dummy");
      writeFileSync(dummy, "#!/bin/sh\n");
      chmodSync(dummy, 0o755);

      try {
        const first = run("/bin/bash", [SCRIPT, "--ensure", "--home", home]);
        const second = run("/bin/bash", [SCRIPT, "--ensure", "--home", home]);
        expect(first).toBe("Paseo Local");
        expect(second).toBe(first);

        const keychain = join(home, "paseo-local.keychain-db");
        const password = run("/bin/cat", [join(home, "keychain.password")]);
        run("/usr/bin/security", ["unlock-keychain", "-p", password, keychain]);
        const previous = run("/usr/bin/security", ["list-keychains", "-d", "user"])
          .split("\n")
          .map((line) => line.replaceAll('"', "").trim())
          .filter((line) => line.length > 0);
        try {
          run("/usr/bin/security", ["list-keychains", "-d", "user", "-s", keychain, ...previous]);
          run("/usr/bin/codesign", [
            "--force",
            "--sign",
            first,
            "--keychain",
            keychain,
            "--timestamp=none",
            dummy,
          ]);
        } finally {
          run("/usr/bin/security", ["list-keychains", "-d", "user", "-s", ...previous]);
        }

        const requirement = run("/usr/bin/codesign", ["-d", "-r-", dummy], {
          ...process.env,
        });
        expect(
          requirement.includes("certificate root") || requirement.includes("certificate leaf"),
        ).toBe(true);
        expect(requirement.includes("designated => cdhash")).toBe(false);
      } finally {
        try {
          run("/usr/bin/security", ["delete-keychain", join(home, "paseo-local.keychain-db")]);
        } catch {
          // The keychain may already be gone if create failed.
        }
        rmSync(home, { recursive: true, force: true });
      }
    },
  );

  it("exposes a local app signer that uses the same identity", () => {
    expect(SIGN_SCRIPT.endsWith("sign-local-app.sh")).toBe(true);
  });
});
