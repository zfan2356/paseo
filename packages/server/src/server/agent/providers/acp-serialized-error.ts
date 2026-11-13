/**
 * Some ACP agents report a failed turn as ordinary assistant prose and still
 * answer `session/prompt` with `end_turn`. Cursor CLI does this for its typed
 * turn errors, so a failed turn looks successful and the serialized error ends
 * up in the conversation as if the assistant had written it.
 *
 * Recognize only that exact shape — one short single-line message, a known
 * error kind, nothing after it but a bracketed code and a brief message — so
 * prose that merely talks about an error stays prose.
 */
const SERIALIZED_TURN_ERROR = /^Error: ([A-Za-z]+Error):(?: \[([a-z0-9_]+)\])?(?: (.*))?$/;

/** Kinds the Cursor CLI raises for a failed turn. */
const KNOWN_KINDS = new Set([
  "RetriableError",
  "NonRetriableError",
  "ActionRequiredError",
  "CancelledError",
]);

/** Kinds where re-running the same turn can succeed. */
const RETRIABLE_KINDS = new Set(["RetriableError"]);

const MAX_SERIALIZED_ERROR_LENGTH = 300;
const MAX_SERIALIZED_ERROR_MESSAGE_LENGTH = 160;

export interface ACPSerializedTurnError {
  kind: string;
  code?: string;
  message: string;
  retriable: boolean;
}

/**
 * Whether a chunk can still turn into a serialized error once later chunks
 * arrive. Callers buffer `possible` text so the error is never rendered and
 * then retracted; `settled` text is safe to emit immediately.
 */
export type ACPSerializedErrorVerdict = "error" | "possible" | "settled";

export function classifyACPSerializedErrorText(text: string): ACPSerializedErrorVerdict {
  if (parseACPSerializedTurnError(text)) {
    return "error";
  }
  if (text.length > MAX_SERIALIZED_ERROR_LENGTH || text.includes("\n")) {
    return "settled";
  }
  return isSerializedErrorPrefix(text) ? "possible" : "settled";
}

export function parseACPSerializedTurnError(text: string): ACPSerializedTurnError | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SERIALIZED_ERROR_LENGTH) {
    return null;
  }
  const match = SERIALIZED_TURN_ERROR.exec(trimmed);
  if (!match) {
    return null;
  }
  const [, kind, code, rest] = match;
  if (!KNOWN_KINDS.has(kind)) {
    return null;
  }
  const message = (rest ?? "").trim();
  if (message.length > MAX_SERIALIZED_ERROR_MESSAGE_LENGTH) {
    return null;
  }
  return {
    kind,
    code: code ?? undefined,
    message: message.length > 0 ? message : kind,
    retriable: RETRIABLE_KINDS.has(kind),
  };
}

/**
 * True while `text` is a prefix of the serialized-error grammar. The check runs
 * against the same grammar as the parser, so text that has already diverged
 * from it is settled prose rather than something to keep buffering.
 */
function isSerializedErrorPrefix(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (!"Error:".startsWith(trimmed)) {
    if (!trimmed.startsWith("Error:")) {
      return false;
    }
    const afterLabel = trimmed.slice("Error:".length).trimStart();
    if (afterLabel.length === 0) {
      return true;
    }
    const [head] = afterLabel.split(/\s+/, 1);
    const withoutCode = head.replace(/\[[a-z0-9_]*\]?$/, "");
    const kind = withoutCode.endsWith(":") ? withoutCode.slice(0, -1) : withoutCode;
    if (kind.length === 0) {
      return true;
    }
    return [...KNOWN_KINDS].some((known) => known.startsWith(kind));
  }
  return true;
}
