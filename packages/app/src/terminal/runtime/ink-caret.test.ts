import { describe, expect, it } from "vitest";
import {
  findInkSoftwareCaret,
  lastHardwareCursorHidden,
  parkHardwareCursorSequence,
  SHOW_HARDWARE_CURSOR,
  type InkCaretBuffer,
  type InkCaretCell,
} from "./ink-caret";

interface FakeCell {
  chars: string;
  inverse?: boolean;
  bgRgb?: number;
  fgRgb?: number;
  width?: number;
}

const THEME = {
  foreground: "#e6e6e6",
  background: "#0b0b0b",
} as const;

function createCell(input: FakeCell): InkCaretCell {
  return {
    getChars: () => input.chars,
    getWidth: () => input.width ?? 1,
    isInverse: () => (input.inverse ? 1 : 0),
    isBgRGB: () => input.bgRgb !== undefined,
    isFgRGB: () => input.fgRgb !== undefined,
    getBgColor: () => input.bgRgb ?? 0,
    getFgColor: () => input.fgRgb ?? 0,
  };
}

function createTerminal(rows: FakeCell[][], theme = THEME): InkCaretBuffer {
  const cols = Math.max(1, ...rows.map((row) => row.length));
  return {
    cols,
    rows: rows.length,
    options: { theme },
    buffer: {
      active: {
        baseY: 0,
        getLine(y: number) {
          const row = rows[y];
          if (!row) {
            return undefined;
          }
          return {
            getCell(column: number) {
              const cell = row[column];
              if (!cell) {
                return createCell({ chars: " " });
              }
              return createCell(cell);
            },
          };
        },
      },
    },
  };
}

describe("findInkSoftwareCaret", () => {
  it("finds an isolated inverse-space caret above leftover status rows", () => {
    expect(
      findInkSoftwareCaret(
        createTerminal([
          [
            { chars: "p" },
            { chars: "r" },
            { chars: "o" },
            { chars: "m" },
            { chars: "p" },
            { chars: "t" },
            { chars: " " },
            { chars: " ", inverse: true },
          ],
          [{ chars: "s" }, { chars: "t" }, { chars: "a" }, { chars: "t" }],
          [{ chars: "~" }, { chars: "/" }],
        ]),
      ),
    ).toEqual({ row: 0, col: 7 });
  });

  it("finds a materialized theme-swapped space caret", () => {
    expect(
      findInkSoftwareCaret(
        createTerminal([
          [{ chars: "h" }, { chars: "i" }, { chars: " ", bgRgb: 0xe6e6e6, fgRgb: 0x0b0b0b }],
          [{ chars: "z" }],
        ]),
      ),
    ).toEqual({ row: 0, col: 2 });
  });

  it("ignores inverse highlight runs and keeps the isolated caret", () => {
    expect(
      findInkSoftwareCaret(
        createTerminal([
          [
            { chars: "E", inverse: true },
            { chars: "r", inverse: true },
            { chars: "r", inverse: true },
            { chars: " " },
            { chars: " ", inverse: true },
          ],
        ]),
      ),
    ).toEqual({ row: 0, col: 4 });
  });

  it("treats a wide inverse glyph as one caret", () => {
    expect(
      findInkSoftwareCaret(
        createTerminal([
          [{ chars: "这", inverse: true, width: 2 }, { chars: "", width: 0 }, { chars: "是" }],
        ]),
      ),
    ).toEqual({ row: 0, col: 0 });
  });

  it("returns null when the buffer has no software caret", () => {
    expect(
      findInkSoftwareCaret(
        createTerminal([
          [{ chars: "p" }, { chars: "r" }, { chars: "o" }, { chars: "m" }, { chars: "p" }],
          [{ chars: "~" }, { chars: "/" }],
        ]),
      ),
    ).toBeNull();
  });
});

describe("parkHardwareCursorSequence", () => {
  it("moves the hardware bar onto the software caret cell", () => {
    expect(parkHardwareCursorSequence({ row: 2, col: 7 })).toBe(`\x1b[3;8H${SHOW_HARDWARE_CURSOR}`);
  });
});

describe("lastHardwareCursorHidden", () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it("returns true when the last DEC cursor mode hides the caret", () => {
    expect(lastHardwareCursorHidden(encode("\x1b[?25lprompt"))).toBe(true);
    expect(lastHardwareCursorHidden(encode("\x1b[?25h\x1b[?25l"))).toBe(true);
  });

  it("returns false when a later show or reset wins", () => {
    expect(lastHardwareCursorHidden(encode("\x1b[?25l\x1b[?25h"))).toBe(false);
    expect(lastHardwareCursorHidden(encode("\x1bc\x1b[?25l\x1bc"))).toBe(false);
  });

  it("returns null when the write does not change cursor visibility", () => {
    expect(lastHardwareCursorHidden(encode("prompt> "))).toBeNull();
  });
});
