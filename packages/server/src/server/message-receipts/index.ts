import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeJsonFileAtomic } from "../atomic-file.js";

const ReceiptSchema = z.object({
  fingerprint: z.string(),
  state: z.enum(["pending", "completed"]),
  agentId: z.string(),
});

export type MessageReceiptStatus = "accepted" | "pending" | "absent";

interface SendMessageInput {
  agentId: string;
  messageId: string;
  request: unknown;
  send: () => Promise<void>;
  prepare?: () => Promise<void>;
  /**
   * Only for an error that proves the provider saw no work: the pending receipt
   * is removed so the same message ID may retry. Any other error keeps the
   * receipt pending because the outcome is unknown.
   */
  isProvenNoEffect?: (error: unknown) => boolean;
}

/** Owns message delivery receipts; creation is owned by CreationService. */
export class MessageReceipts {
  private readonly pending = new Map<string, Promise<void>>();
  constructor(private readonly directory: string) {}

  send(input: SendMessageInput): Promise<void> {
    // Preserve the existing on-disk identity and shape across daemon upgrades.
    const key = receiptKey(input.agentId, input.messageId);
    const previous = this.pending.get(key);
    const result = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
      this.sendOnce(key, input),
    );
    this.pending.set(key, result);
    void result
      .finally(() => {
        if (this.pending.get(key) === result) this.pending.delete(key);
      })
      .catch(() => undefined);
    return result;
  }

  /**
   * Read the durable receipt for one delivery identity without sending,
   * loading an agent, or clearing a pending outcome.
   *
   * `accepted` means the provider accepted the turn start. `pending` means a
   * receipt exists but completion was never recorded, so the outcome is
   * unknown. `absent` only means no local receipt was found: it is not proof
   * that the request never ran, and callers must not replay on it alone.
   */
  async lookup(agentId: string, messageId: string): Promise<MessageReceiptStatus> {
    const key = receiptKey(agentId, messageId);
    const existing = await readReceipt(receiptFile(this.directory, key));
    if (!existing) {
      // A send for this identity may still be preparing, before its receipt is
      // written. Report the delivery as unresolved rather than absent.
      return this.pending.has(key) ? "pending" : "absent";
    }
    if (existing.agentId !== agentId) {
      throw new Error("agent_request_receipt_identity_mismatch");
    }
    return existing.state === "completed" ? "accepted" : "pending";
  }

  private async sendOnce(key: string, input: SendMessageInput): Promise<void> {
    const file = receiptFile(this.directory, key);
    const fingerprint = digest(input.request);
    const existing = await readReceipt(file);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error("agent_request_key_conflict");
      if (existing.state === "completed") return;
      // A provider may have accepted the message before its receipt was committed.
      throw new Error("agent_request_outcome_unknown");
    }
    await input.prepare?.();
    const receipt = { fingerprint, agentId: input.agentId };
    await writeJsonFileAtomic(file, { ...receipt, state: "pending" });
    try {
      await input.send();
    } catch (error) {
      if (input.isProvenNoEffect?.(error)) {
        await rm(file, { force: true });
      }
      throw error;
    }
    await writeJsonFileAtomic(file, { ...receipt, state: "completed" });
  }
}

function receiptKey(agentId: string, messageId: string): string {
  return digest(["send", agentId, messageId]);
}

function receiptFile(directory: string, key: string): string {
  return path.join(directory, `${key}.json`);
}

async function readReceipt(file: string): Promise<z.infer<typeof ReceiptSchema> | null> {
  try {
    return ReceiptSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, candidate: unknown) => {
        if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
          return Object.fromEntries(
            Object.entries(candidate).sort(([a], [b]) => a.localeCompare(b)),
          );
        }
        return candidate;
      }),
    )
    .digest("hex");
}
