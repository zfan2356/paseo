export interface MaterializeDefaultInverseSgrInput {
  data: Uint8Array;
  foreground: string | undefined;
  background: string | undefined;
}

interface CssRgb {
  r: number;
  g: number;
  b: number;
}

interface DrawState {
  fgDefault: boolean;
  bgDefault: boolean;
  inverse: boolean;
  materializedInverse: boolean;
}

const CSI = "\x1b[";
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function materializeDefaultInverseSgr(input: MaterializeDefaultInverseSgrInput): Uint8Array {
  if (!input.data.includes(0x1b)) {
    return input.data;
  }

  const foreground = parseCssRgb(input.foreground);
  const background = parseCssRgb(input.background);
  if (!foreground || !background) {
    return input.data;
  }

  const next = rewriteSgrText({
    text: textDecoder.decode(input.data),
    foreground,
    background,
  });
  if (next === null) {
    return input.data;
  }
  return textEncoder.encode(next);
}

function rewriteSgrText(input: {
  text: string;
  foreground: CssRgb;
  background: CssRgb;
}): string | null {
  const state: DrawState = {
    fgDefault: true,
    bgDefault: true,
    inverse: false,
    materializedInverse: false,
  };
  let cursor = 0;
  let changed = false;
  let result = "";

  while (cursor < input.text.length) {
    const start = input.text.indexOf(CSI, cursor);
    if (start === -1) {
      result += input.text.slice(cursor);
      break;
    }

    result += input.text.slice(cursor, start);
    const sequence = readSgrSequence(input.text, start);
    if (!sequence) {
      result += input.text[start];
      cursor = start + 1;
      continue;
    }

    const rewritten = rewriteSgrSequence({
      match: sequence.match,
      params: sequence.params,
      state,
      foreground: input.foreground,
      background: input.background,
    });
    if (rewritten !== sequence.match) {
      changed = true;
    }
    result += rewritten;
    cursor = sequence.end;
  }

  if (!changed) {
    return null;
  }
  return result;
}

interface SgrSequence {
  match: string;
  params: string;
  end: number;
}

function readSgrSequence(text: string, start: number): SgrSequence | null {
  let index = start + CSI.length;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x6d) {
      return {
        match: text.slice(start, index + 1),
        params: text.slice(start + CSI.length, index),
        end: index + 1,
      };
    }
    const isDigit = code >= 0x30 && code <= 0x39;
    if (!isDigit && code !== 0x3b) {
      return null;
    }
    index += 1;
  }
  return null;
}

interface RewriteSgrSequenceInput {
  match: string;
  params: string;
  state: DrawState;
  foreground: CssRgb;
  background: CssRgb;
}

function rewriteSgrSequence(input: RewriteSgrSequenceInput): string {
  const codes = parseSgrParams(input.params);
  if (!codes) {
    return input.match;
  }

  const output: number[] = [];
  let rewritten = false;
  let index = 0;
  while (index < codes.length) {
    const code = codes[index] ?? 0;

    if (code === 38 || code === 48) {
      const consumed = consumeColorSequence(codes, index);
      output.push(...codes.slice(index, index + consumed));
      if (code === 38) {
        input.state.fgDefault = false;
      } else {
        input.state.bgDefault = false;
      }
      index += consumed;
      continue;
    }

    if (code === 0) {
      output.push(0);
      input.state.fgDefault = true;
      input.state.bgDefault = true;
      input.state.inverse = false;
      input.state.materializedInverse = false;
      index += 1;
      continue;
    }

    if (code === 7) {
      const canMaterialize = !input.state.inverse && input.state.fgDefault && input.state.bgDefault;
      if (canMaterialize) {
        output.push(
          38,
          2,
          input.background.r,
          input.background.g,
          input.background.b,
          48,
          2,
          input.foreground.r,
          input.foreground.g,
          input.foreground.b,
        );
        input.state.inverse = true;
        input.state.materializedInverse = true;
        rewritten = true;
      } else {
        output.push(7);
        input.state.inverse = true;
      }
      index += 1;
      continue;
    }

    if (code === 27) {
      if (input.state.materializedInverse) {
        output.push(39, 49);
        input.state.materializedInverse = false;
        rewritten = true;
      } else {
        output.push(27);
      }
      input.state.inverse = false;
      index += 1;
      continue;
    }

    if (code === 39) {
      output.push(39);
      input.state.fgDefault = true;
      index += 1;
      continue;
    }

    if (code === 49) {
      output.push(49);
      input.state.bgDefault = true;
      index += 1;
      continue;
    }

    if (isForegroundPalette(code)) {
      input.state.fgDefault = false;
    } else if (isBackgroundPalette(code)) {
      input.state.bgDefault = false;
    }
    output.push(code);
    index += 1;
  }

  if (!rewritten) {
    return input.match;
  }
  return `${CSI}${output.join(";")}m`;
}

function parseSgrParams(params: string): number[] | null {
  if (params.length === 0) {
    return [0];
  }

  const codes: number[] = [];
  for (const part of params.split(";")) {
    const code = part.length === 0 ? 0 : Number(part);
    if (!Number.isFinite(code)) {
      return null;
    }
    codes.push(code);
  }
  return codes;
}

function consumeColorSequence(codes: readonly number[], index: number): number {
  const selector = codes[index + 1];
  if (selector === 5) {
    return 3;
  }
  if (selector === 2) {
    return 5;
  }
  return 1;
}

function isForegroundPalette(code: number): boolean {
  return (code >= 30 && code <= 37) || (code >= 90 && code <= 97);
}

function isBackgroundPalette(code: number): boolean {
  return (code >= 40 && code <= 47) || (code >= 100 && code <= 107);
}

function parseCssRgb(value: string | undefined): CssRgb | null {
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
    return { r, g, b };
  }

  if (hex.length !== 6) {
    return null;
  }

  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) {
    return null;
  }
  return { r, g, b };
}
