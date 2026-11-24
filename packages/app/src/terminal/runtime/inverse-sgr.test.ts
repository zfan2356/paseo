import { describe, expect, it } from "vitest";
import { materializeDefaultInverseSgr } from "./inverse-sgr";

const THEME = {
  foreground: "#e6e6e6",
  background: "#0b0b0b",
} as const;

const INK_INVERSE_CARET = "\x1b[7m \x1b[27m";
const PAINTED_INK_CARET = "\x1b[38;2;11;11;11;48;2;230;230;230m \x1b[39;49m";

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decode(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

function materialize(text: string, theme = THEME): string {
  return decode(
    materializeDefaultInverseSgr({
      data: encode(text),
      foreground: theme.foreground,
      background: theme.background,
    }),
  );
}

describe("materializeDefaultInverseSgr", () => {
  it("paints Ink's inverse-space caret with explicit theme colors", () => {
    expect(materialize(`hello${INK_INVERSE_CARET}`)).toBe(`hello${PAINTED_INK_CARET}`);
  });

  it("returns the same bytes when the write has no SGR", () => {
    const data = encode("prompt> ");
    expect(materializeDefaultInverseSgr({ data, ...THEME })).toBe(data);
  });

  it("leaves inverse alone when the cell already has a non-default foreground", () => {
    const coloredInverse = "\x1b[31m\x1b[7mX\x1b[27m";
    expect(materialize(coloredInverse)).toBe(coloredInverse);
  });

  it("does not treat RGB channel 7 as the inverse attribute", () => {
    const rgb = "\x1b[38;2;7;7;7m ";
    expect(materialize(rgb)).toBe(rgb);
  });

  it("materializes inverse after a reset in the same SGR sequence", () => {
    expect(materialize(`\x1b[31m\x1b[0;7m \x1b[27m`)).toBe(
      `\x1b[31m\x1b[0;38;2;11;11;11;48;2;230;230;230m \x1b[39;49m`,
    );
  });

  it("leaves the write unchanged when the theme colors cannot be parsed", () => {
    const data = encode(INK_INVERSE_CARET);
    expect(
      materializeDefaultInverseSgr({
        data,
        foreground: "currentColor",
        background: THEME.background,
      }),
    ).toBe(data);
  });
});
