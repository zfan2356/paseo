import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const installer = path.join(scriptDirectory, "install-local-app.sh");

describe("local macOS app installer", () => {
  it("renders a one-shot LaunchAgent with escaped arguments", () => {
    const output = execFileSync(
      "bash",
      [
        installer,
        "--render-launch-agent",
        "/repo/Paseo & tools/install-local-app.sh",
        "/tmp/Custom & Signed/Paseo.app",
        "/Applications/Paseo.app",
        "/Applications/.Paseo.installing.app",
        "/tmp/Paseo.previous.app",
        "/Users/test/Library/LaunchAgents/sh.paseo.local-install.plist",
        "sh.paseo.local-install.test",
        "/tmp/paseo-local-install.log",
        "10",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(output).toContain("<key>KeepAlive</key>\n  <false/>");
    expect(output).toContain("<string>/bin/bash</string>");
    expect(output).toContain("<string>--perform</string>");
    expect(output).toContain("/repo/Paseo &amp; tools/install-local-app.sh");
    expect(output).toContain("/tmp/Custom &amp; Signed/Paseo.app");
  });
});
