export const SHOW_HARDWARE_CURSOR = "\x1b[?25h";

const CSI = "\x1b[";
const textDecoder = new TextDecoder();

interface DecPrivateModeSequence {
  params: number[];
  command: string;
  end: number;
}

export interface InkCaretCell {
  getChars(): string;
  getWidth(): number;
  isInverse(): number | boolean;
  isBgRGB(): number | boolean;
  isFgRGB(): number | boolean;
  getBgColor(): number;
  getFgColor(): number;
}

export interface InkCaretLine {
  getCell(column: number): InkCaretCell | undefined;
}

export interface InkCaretBuffer {
  cols: number;
  rows: number;
  options?: {
    theme?: {
      foreground?: string;
      background?: string;
    };
  };
  buffer: {
    active: {
      baseY: number;
      getLine(y: number): InkCaretLine | undefined;
    };
  };
}

export interface InkCaretPosition {
  row: number;
  col: number;
}

interface ThemeRgb {
  foreground: number;
  background: number;
}

export function findInkSoftwareCaret(terminal: InkCaretBuffer): InkCaretPosition | null {
  if (terminal.rows <= 0 || terminal.cols <= 0) {
    return null;
  }

  const theme = parseThemeRgb(terminal.options?.theme);
  const buffer = terminal.buffer.active;
  let caret: InkCaretPosition | null = null;

  for (let row = 0; row < terminal.rows; row += 1) {
    const line = buffer.getLine(buffer.baseY + row);
    if (!line) {
      continue;
    }

    let column = 0;
    while (column < terminal.cols) {
      const cell = line.getCell(column);
      const width = cellWidth(cell);
      if (!isInkCaretCell(cell, theme) || width === 0) {
        column += 1;
        continue;
      }

      const start = column;
      column += width;
      while (column < terminal.cols) {
        const next = line.getCell(column);
        const nextWidth = cellWidth(next);
        if (!isInkCaretCell(next, theme) || nextWidth === 0) {
          break;
        }
        column += nextWidth;
      }

      if (isIsolatedCaretRun(column - start, width)) {
        caret = { row, col: start };
      }
    }
  }

  return caret;
}

export function parkHardwareCursorSequence(position: InkCaretPosition): string {
  return `\x1b[${position.row + 1};${position.col + 1}H${SHOW_HARDWARE_CURSOR}`;
}

export function lastHardwareCursorHidden(data: Uint8Array): boolean | null {
  if (!data.includes(0x1b)) {
    return null;
  }
  return lastHardwareCursorHiddenInText(textDecoder.decode(data));
}

function lastHardwareCursorHiddenInText(text: string): boolean | null {
  let hidden: boolean | null = null;
  let cursor = 0;
  while (cursor < text.length) {
    if (text.startsWith("\x1bc", cursor)) {
      hidden = false;
      cursor += 2;
      continue;
    }

    const start = text.indexOf(`${CSI}?`, cursor);
    if (start === -1) {
      return hidden;
    }

    const sequence = readDecPrivateModeSequence(text, start);
    if (!sequence) {
      cursor = start + CSI.length;
      continue;
    }
    if ((sequence.command === "l" || sequence.command === "h") && sequence.params.includes(25)) {
      hidden = sequence.command === "l";
    }
    cursor = sequence.end;
  }
  return hidden;
}

function readDecPrivateModeSequence(text: string, start: number): DecPrivateModeSequence | null {
  let index = start + CSI.length + 1;
  const paramStart = index;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    const isDigit = code >= 0x30 && code <= 0x39;
    if (isDigit || code === 0x3b) {
      index += 1;
      continue;
    }
    if (code < 0x40 || code > 0x7e) {
      return null;
    }
    return {
      params: parseDecParams(text.slice(paramStart, index)),
      command: text[index] ?? "",
      end: index + 1,
    };
  }
  return null;
}

function parseDecParams(params: string): number[] {
  if (params.length === 0) {
    return [];
  }

  const codes: number[] = [];
  for (const part of params.split(";")) {
    if (part.length === 0) {
      continue;
    }
    const code = Number(part);
    if (!Number.isFinite(code)) {
      continue;
    }
    codes.push(code);
  }
  return codes;
}

function isIsolatedCaretRun(runWidth: number, firstCellWidth: number): boolean {
  if (runWidth === 1) {
    return true;
  }
  return runWidth === 2 && firstCellWidth === 2;
}

function isInkCaretCell(cell: InkCaretCell | undefined, theme: ThemeRgb | null): boolean {
  if (!cell) {
    return false;
  }
  if (isEnabled(cell.isInverse())) {
    return true;
  }
  if (!theme || !isEnabled(cell.isBgRGB()) || cell.getBgColor() !== theme.foreground) {
    return false;
  }
  if (isEnabled(cell.isFgRGB()) && cell.getFgColor() === theme.background) {
    return true;
  }
  const chars = cell.getChars();
  return chars === "" || chars === " ";
}

function cellWidth(cell: InkCaretCell | undefined): number {
  if (!cell) {
    return 1;
  }
  const width = cell.getWidth();
  return width > 0 ? width : 0;
}

function isEnabled(value: number | boolean): boolean {
  return value !== 0 && value !== false;
}

function parseThemeRgb(
  theme: { foreground?: string; background?: string } | undefined,
): ThemeRgb | null {
  const foreground = packCssRgb(theme?.foreground);
  const background = packCssRgb(theme?.background);
  if (foreground === null || background === null) {
    return null;
  }
  return { foreground, background };
}

function packCssRgb(value: string | undefined): number | null {
  if (!value || value[0] !== "#") {
    return null;
  }

  const hex = value.slice(1);
  if (hex.length === 3) {
    const r = Number.parseInt(`${hex[0]}${hex[0]}`, 16);
    const g = Number.parseInt(`${hex[1]}${hex[1]}`, 16);
    const b = Number.parseInt(`${hex[2]}${hex[2]}`, 16);
    if ([r, g, b].some((channel) => Number.isNaN(channel))) {
      return null;
    }
    return (r << 16) | (g << 8) | b;
  }

  if (hex.length !== 6) {
    return null;
  }

  const packed = Number.parseInt(hex, 16);
  if (Number.isNaN(packed)) {
    return null;
  }
  return packed;
}
