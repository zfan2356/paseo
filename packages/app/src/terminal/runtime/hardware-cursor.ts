export const SHOW_HARDWARE_CURSOR = "\x1b[?25h";

const CSI = "\x1b[";
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

interface DecPrivateModeSequence {
  params: number[];
  command: string;
  end: number;
}

export function restoreHardwareCursorVisibility(data: Uint8Array): Uint8Array {
  if (!data.includes(0x1b)) {
    return data;
  }
  if (!containsDecHideCursor(textDecoder.decode(data))) {
    return data;
  }

  const suffix = textEncoder.encode(SHOW_HARDWARE_CURSOR);
  const next = new Uint8Array(data.length + suffix.length);
  next.set(data);
  next.set(suffix, data.length);
  return next;
}

export function csiParamsInclude(params: readonly (number | number[])[], mode: number): boolean {
  for (const param of params) {
    if (typeof param === "number") {
      if (param === mode) {
        return true;
      }
      continue;
    }
    if (param.includes(mode)) {
      return true;
    }
  }
  return false;
}

export function csiParamCount(params: readonly (number | number[])[]): number {
  let count = 0;
  for (const param of params) {
    count += typeof param === "number" ? 1 : param.length;
  }
  return count;
}

function containsDecHideCursor(text: string): boolean {
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(`${CSI}?`, cursor);
    if (start === -1) {
      return false;
    }

    const sequence = readDecPrivateModeSequence(text, start);
    if (!sequence) {
      cursor = start + CSI.length;
      continue;
    }
    if (sequence.command === "l" && sequence.params.includes(25)) {
      return true;
    }
    cursor = sequence.end;
  }
  return false;
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
