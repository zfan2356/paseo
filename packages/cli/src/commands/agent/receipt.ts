import { type Command } from "commander";
import { connectToDaemon } from "../../utils/client.js";
import type {
  CommandOptions,
  SingleResult,
  OutputSchema,
  CommandError,
} from "../../output/index.js";

/** Result type for agent receipt command */
export interface AgentReceiptResult {
  agentId: string;
  messageId: string;
  status: "accepted" | "pending" | "absent";
}

/** Schema for agent receipt output */
export const agentReceiptSchema: OutputSchema<AgentReceiptResult> = {
  idField: "agentId",
  columns: [
    { header: "AGENT ID", field: "agentId", width: 12 },
    { header: "MESSAGE ID", field: "messageId", width: 36 },
    { header: "STATUS", field: "status", width: 10 },
  ],
};

export interface AgentReceiptOptions extends CommandOptions {
  host?: string;
}

function toReceiptCommandError(error: unknown): CommandError {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code.trim()
      : "";
  if (code === "unsupported_operation") {
    return {
      code: "DAEMON_UPDATE_REQUIRED",
      message: "Update the host to look up message delivery receipts.",
    };
  }
  if (code === "agent_request_receipt_identity_mismatch") return { code, message };
  return {
    code: "RECEIPT_LOOKUP_FAILED",
    message: `Failed to look up delivery receipt: ${message}`,
  };
}

export function addReceiptOptions(cmd: Command): Command {
  return cmd
    .description("Read a delivery receipt without redelivering the message")
    .argument("<id>", "Agent ID (or prefix)")
    .argument("<message-id>", "Stable message ID used for the original send");
}

export async function runReceiptCommand(
  agentIdArg: string,
  messageIdArg: string,
  options: AgentReceiptOptions,
  _command: Command,
): Promise<SingleResult<AgentReceiptResult>> {
  if (!agentIdArg || agentIdArg.trim().length === 0) {
    throw {
      code: "MISSING_AGENT_ID",
      message: "Agent ID is required",
      details: "Usage: paseo agent receipt <id> <message-id>",
    } satisfies CommandError;
  }
  const messageId = messageIdArg?.trim();
  if (!messageId) {
    throw {
      code: "MISSING_MESSAGE_ID",
      message: "Message ID is required",
      details: "Usage: paseo agent receipt <id> <message-id>",
    } satisfies CommandError;
  }

  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    const receipt = await client.getAgentMessageReceipt(agentIdArg, messageId);
    return { type: "single", data: receipt, schema: agentReceiptSchema };
  } catch (error) {
    throw toReceiptCommandError(error);
  } finally {
    await client.close().catch(() => {});
  }
}
