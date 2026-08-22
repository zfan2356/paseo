import { ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN } from "../../assistant-message-boundary.js";
import type { CodexThreadForkParams } from "./app-server-transport.js";

// Codex has no native side-question channel, so a side question rides a forked
// thread: the fork shares the main thread's history, the answer turn runs
// read-only with approvals disabled, and nothing reaches the main thread or
// the Paseo timeline. The caller intercepts the forked thread's notifications
// and feeds them to a CodexSideQuestionRun.

export const CODEX_SIDE_QUESTION_TIMEOUT_MS = 150_000;

const SIDE_QUESTION_PREAMBLE =
  "Answer this side question directly from the conversation context. " +
  "Do not run commands or use tools. Reply with a concise answer.";

export function buildCodexSideQuestionPrompt(question: string): string {
  return `${SIDE_QUESTION_PREAMBLE}\n\n${question}`;
}

export function buildCodexSideQuestionForkParams(input: {
  threadId: string;
  cwd: string | null;
  model: string | null;
  serviceTier: string | null;
}): CodexThreadForkParams {
  return {
    threadId: input.threadId,
    cwd: input.cwd,
    model: input.model,
    serviceTier: input.serviceTier,
    excludeTurns: false,
    // Best effort: an app-server that honors ephemeral never persists the
    // fork; otherwise the caller archives the forked thread afterwards.
    ephemeral: true,
  };
}

export function buildCodexSideQuestionTurnParams(input: {
  threadId: string;
  input: unknown;
  model: string | null;
  serviceTier: string | null;
}): Record<string, unknown> {
  return {
    threadId: input.threadId,
    input: input.input,
    // Match Claude side-question semantics: the answer turn must not mutate
    // anything and must never surface an approval request in the UI.
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly" },
    ...(input.model ? { model: input.model } : {}),
    ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
  };
}

export interface CodexSideQuestionOutcome {
  status: string;
  errorMessage: string | null;
}

// Structural view of ParsedCodexNotification: every member carries a string
// `kind`, and the fields used here are re-validated before use.
export interface CodexSideQuestionNotification {
  kind: string;
  [key: string]: unknown;
}

function isAgentMessageItemType(type: unknown): boolean {
  return type === "agentMessage" || type === "AgentMessage" || type === "agent_message";
}

function stripBoundaryPrefix(text: string): string {
  return text.startsWith(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN)
    ? text.slice(ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN.length)
    : text;
}

/**
 * Collects the assistant answer for one side-question turn on a forked
 * thread. Streaming deltas are kept per item as a fallback; a completed
 * agent-message item's text is authoritative for that item.
 */
export class CodexSideQuestionRun {
  private readonly deltaTextByItemId = new Map<string, string>();
  private readonly finalTextByItemId = new Map<string, string>();
  private readonly itemOrder: string[] = [];
  private settled = false;
  private resolveCompletion!: (outcome: CodexSideQuestionOutcome) => void;
  private readonly completion = new Promise<CodexSideQuestionOutcome>((resolve) => {
    this.resolveCompletion = resolve;
  });

  handleNotification(parsed: CodexSideQuestionNotification): void {
    if (this.settled) {
      return;
    }
    switch (parsed.kind) {
      case "agent_message_delta": {
        const itemId = typeof parsed.itemId === "string" ? parsed.itemId : "";
        const delta = typeof parsed.delta === "string" ? parsed.delta : "";
        if (!itemId || !delta) {
          return;
        }
        this.trackItem(itemId);
        this.deltaTextByItemId.set(itemId, (this.deltaTextByItemId.get(itemId) ?? "") + delta);
        return;
      }
      case "item_completed": {
        const item = parsed.item;
        if (typeof item !== "object" || item === null) {
          return;
        }
        const record = item as { id?: unknown; type?: unknown; text?: unknown };
        if (!isAgentMessageItemType(record.type)) {
          return;
        }
        const itemId =
          typeof record.id === "string" && record.id ? record.id : `item-${this.itemOrder.length}`;
        this.trackItem(itemId);
        this.finalTextByItemId.set(itemId, typeof record.text === "string" ? record.text : "");
        return;
      }
      case "turn_completed": {
        this.settled = true;
        this.resolveCompletion({
          status: typeof parsed.status === "string" ? parsed.status : "completed",
          errorMessage: typeof parsed.errorMessage === "string" ? parsed.errorMessage : null,
        });
        return;
      }
      default:
        return;
    }
  }

  async waitForCompletion(timeoutMs: number): Promise<CodexSideQuestionOutcome> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Codex did not answer the side question in time")),
        timeoutMs,
      );
      timer.unref?.();
    });
    try {
      return await Promise.race([this.completion, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  answerText(): string | null {
    const parts: string[] = [];
    for (const itemId of this.itemOrder) {
      const text = this.finalTextByItemId.get(itemId) ?? this.deltaTextByItemId.get(itemId) ?? "";
      const stripped = stripBoundaryPrefix(text).trim();
      if (stripped) {
        parts.push(stripped);
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : null;
  }

  private trackItem(itemId: string): void {
    if (!this.deltaTextByItemId.has(itemId) && !this.finalTextByItemId.has(itemId)) {
      this.itemOrder.push(itemId);
    }
  }
}
