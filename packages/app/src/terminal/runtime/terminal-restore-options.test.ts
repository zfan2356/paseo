import { describe, expect, it } from "vitest";

import {
  resolveTerminalRestoreOptions,
  restoreSubscriptionSendsFrame,
} from "./terminal-restore-options";

describe("terminal restore options", () => {
  it("omits restore options for daemons without terminal restore modes", () => {
    expect(
      resolveTerminalRestoreOptions({
        supportsTerminalRestoreModes: false,
        canClaimSize: true,
        size: { rows: 24, cols: 80 },
      }),
    ).toBeUndefined();
  });

  it("requests a viewport-only visible snapshot so reopen does not replay scrollback", () => {
    expect(
      resolveTerminalRestoreOptions({
        supportsTerminalRestoreModes: true,
        canClaimSize: true,
        size: { rows: 24, cols: 80 },
      }),
    ).toEqual({
      mode: "visible-snapshot",
      scrollbackLines: 0,
      size: { rows: 24, cols: 80 },
    });
  });

  it("omits size until the terminal has been measured", () => {
    expect(
      resolveTerminalRestoreOptions({
        supportsTerminalRestoreModes: true,
        canClaimSize: true,
        size: null,
      }),
    ).toEqual({
      mode: "visible-snapshot",
      scrollbackLines: 0,
    });
  });

  it("does not let a background attach resize the PTY", () => {
    expect(
      resolveTerminalRestoreOptions({
        supportsTerminalRestoreModes: true,
        canClaimSize: false,
        size: { rows: 24, cols: 80 },
      }),
    ).toEqual({
      mode: "visible-snapshot",
      scrollbackLines: 0,
    });
  });

  it("expects a restore frame for snapshot modes and not for live", () => {
    expect(restoreSubscriptionSendsFrame(undefined)).toBe(false);
    expect(restoreSubscriptionSendsFrame({ mode: "live" })).toBe(false);
    expect(restoreSubscriptionSendsFrame({ mode: "visible-snapshot" })).toBe(true);
    expect(restoreSubscriptionSendsFrame({ mode: "full-snapshot" })).toBe(true);
  });
});
