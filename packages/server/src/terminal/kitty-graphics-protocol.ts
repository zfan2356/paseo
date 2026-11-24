const APC_START = "\x1b_G";
const ST = "\x1b\\";
const BEL = "\x07";
const MAX_PENDING_CHARS = 1_000_000;

export class KittyGraphicsReplyTracker {
  private pending = "";

  feed(data: string): string[] {
    this.pending += data;
    if (this.pending.length > MAX_PENDING_CHARS) {
      this.pending = keepIncompletePrefix(this.pending.slice(-APC_START.length));
    }

    const replies: string[] = [];
    while (this.pending.length > 0) {
      const start = this.pending.indexOf(APC_START);
      if (start === -1) {
        this.pending = keepIncompletePrefix(this.pending);
        break;
      }

      const bodyStart = start + APC_START.length;
      const terminator = findApcTerminator(this.pending, bodyStart);
      if (terminator === null) {
        this.pending = this.pending.slice(start);
        break;
      }

      const body = this.pending.slice(bodyStart, terminator.index);
      const reply = kittyGraphicsReplyFor(body);
      if (reply) {
        replies.push(reply);
      }
      this.pending = this.pending.slice(terminator.end);
    }

    return replies;
  }

  reset(): void {
    this.pending = "";
  }
}

function findApcTerminator(text: string, from: number): { index: number; end: number } | null {
  const st = text.indexOf(ST, from);
  const bel = text.indexOf(BEL, from);
  if (st === -1 && bel === -1) {
    return null;
  }
  if (st === -1) {
    return { index: bel, end: bel + BEL.length };
  }
  if (bel === -1 || st < bel) {
    return { index: st, end: st + ST.length };
  }
  return { index: bel, end: bel + BEL.length };
}

function keepIncompletePrefix(text: string): string {
  if (text.endsWith(APC_START.slice(0, 2)) || text.endsWith("\x1b")) {
    return text.slice(text.lastIndexOf("\x1b"));
  }
  return "";
}

function kittyGraphicsReplyFor(body: string): string | null {
  const separator = body.indexOf(";");
  const controls = separator === -1 ? body : body.slice(0, separator);
  const payload = separator === -1 ? "" : body.slice(separator + 1);
  if (isKittyGraphicsResponsePayload(payload)) {
    return null;
  }

  const fields = parseKittyGraphicsControls(controls);
  const quiet = Number.parseInt(fields.q ?? "0", 10);
  if (quiet >= 1) {
    return null;
  }

  const id = fields.i ?? "0";
  if (!/^\d+$/.test(id)) {
    return null;
  }
  return `${APC_START}i=${id};OK${ST}`;
}

function isKittyGraphicsResponsePayload(payload: string): boolean {
  return (
    payload === "OK" ||
    payload.startsWith("ENOENT") ||
    payload.startsWith("EINVAL") ||
    payload.startsWith("EBAD") ||
    payload.startsWith("EIO")
  );
}

function parseKittyGraphicsControls(controls: string): Record<string, string> {
  const fields: Record<string, string> = {};
  if (controls.length === 0) {
    return fields;
  }
  for (const part of controls.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    fields[part.slice(0, separator)] = part.slice(separator + 1);
  }
  return fields;
}
