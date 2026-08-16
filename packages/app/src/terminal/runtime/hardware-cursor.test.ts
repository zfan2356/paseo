import { describe, expect, it } from "vitest";
import {
  csiParamCount,
  csiParamsInclude,
  restoreHardwareCursorVisibility,
  SHOW_HARDWARE_CURSOR,
} from "./hardware-cursor";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decode(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

describe("restoreHardwareCursorVisibility", () => {
  it("re-shows the hardware cursor after a TUI hide sequence", () => {
    expect(decode(restoreHardwareCursorVisibility(encode("\x1b[?25lprompt")))).toBe(
      `\x1b[?25lprompt${SHOW_HARDWARE_CURSOR}`,
    );
  });

  it("re-shows the hardware cursor when hide is mixed with other DEC private modes", () => {
    expect(decode(restoreHardwareCursorVisibility(encode("\x1b[?1;25l")))).toBe(
      `\x1b[?1;25l${SHOW_HARDWARE_CURSOR}`,
    );
  });

  it("leaves writes without a hide sequence unchanged", () => {
    const data = encode("prompt> \x1b[?25h");
    expect(restoreHardwareCursorVisibility(data)).toBe(data);
  });

  it("does not treat a show sequence as a hide", () => {
    const data = encode("\x1b[?25hhello");
    expect(restoreHardwareCursorVisibility(data)).toBe(data);
  });
});

describe("csiParamsInclude", () => {
  it("matches a hide-cursor mode among CSI params", () => {
    expect(csiParamsInclude([1, 25], 25)).toBe(true);
    expect(csiParamsInclude([1, [25]], 25)).toBe(true);
    expect(csiParamsInclude([1, 7], 25)).toBe(false);
  });

  it("counts flattened CSI params", () => {
    expect(csiParamCount([25])).toBe(1);
    expect(csiParamCount([1, [25, 12]])).toBe(3);
  });
});
