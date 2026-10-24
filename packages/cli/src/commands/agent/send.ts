import { type Command, Option } from "commander";
import type { ActiveTurnBehavior } from "@getpaseo/protocol/messages";
import { collectMultiple } from "../../utils/command-options.js";
import { connectToDaemon } from "../../utils/client.js";
import type {
  CommandOptions,
  SingleResult,
  OutputSchema,
  CommandError,
} from "../../output/index.js";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

/** Result type for agent send command */
export interface AgentSendResult {
  agentId: string;
  status: "queued" | "sent" | "completed" | "timeout" | "permission" | "error";
  message: string;
}

/** Schema for agent send output */
export const agentSendSchema: OutputSchema<AgentSendResult> = {
  idField: "agentId",
  columns: [
    { header: "AGENT ID", field: "agentId", width: 12 },
    { header: "STATUS", field: "status", width: 12 },
    { header: "MESSAGE", field: "message", width: 40 },
  ],
};

export interface AgentSendOptions extends CommandOptions {
  behavior?: ActiveTurnBehavior;
  wait?: boolean;
  image?: string[];
  prompt?: string;
  promptFile?: string;
  ifIdle?: boolean;
  messageId?: string;
}

export function addSendOptions(cmd: Command): Command {
  return cmd
    .description("Send a message/task to an existing agent")
    .argument("<id>", "Agent ID (or prefix)")
    .argument("[prompt]", "The message to send")
    .option("--prompt <text>", "Provide the message inline as a flag")
    .option("--prompt-file <path>", "Read the message from a UTF-8 text file")
    .option("--image <path>", "Attach image(s) to the message", collectMultiple, [])
    .addOption(
      new Option(
        "--behavior <behavior>",
        "Active-turn behavior (agent default: steer; otherwise: interrupt)",
      ).choices(["interrupt", "steer"]),
    )
    .option("--message-id <id>", "Caller-supplied ID for message deduplication")
    .option(
      "--if-idle",
      "Reject with agent_busy instead of steering or interrupting an active turn",
    )
    .option("--no-wait", "Return immediately without waiting for completion");
}

/**
 * Read image files and convert them to base64 data URIs
 */
async function readImageFiles(
  imagePaths: string[],
): Promise<Array<{ data: string; mimeType: string }>> {
  return Promise.all(
    imagePaths.map(async (path) => {
      try {
        const buffer = await readFile(path);
        const ext = extname(path).toLowerCase();

        let mimeType = "image/jpeg";
        switch (ext) {
          case ".png":
            mimeType = "image/png";
            break;
          case ".jpg":
          case ".jpeg":
            mimeType = "image/jpeg";
            break;
          case ".gif":
            mimeType = "image/gif";
            break;
          case ".webp":
            mimeType = "image/webp";
            break;
          default:
            mimeType = "image/jpeg";
        }

        return { data: buffer.toString("base64"), mimeType };
      } catch (err) {
        if (err && typeof err === "object" && "code" in err) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw {
          code: "IMAGE_READ_ERROR",
          message: `Failed to read image file: ${path}`,
          details: message,
        } satisfies CommandError;
      }
    }),
  );
}

async function resolvePromptInput(options: {
  promptArgument: string | undefined;
  promptOption: string | undefined;
  promptFile: string | undefined;
}): Promise<string> {
  const promptText = options.promptArgument?.trim();
  const promptOptionText = options.promptOption?.trim();
  const promptFilePath = options.promptFile?.trim();
  const providedSourceCount = [promptText, promptOptionText, promptFilePath].filter(Boolean).length;

  if (providedSourceCount > 1) {
    const error: CommandError = {
      code: "CONFLICTING_PROMPT_INPUT",
      message: "Provide exactly one of prompt argument, --prompt, or --prompt-file",
    };
    throw error;
  }

  if (promptText) {
    return options.promptArgument as string;
  }

  if (promptOptionText) {
    return options.promptOption as string;
  }

  if (!promptFilePath) {
    const error: CommandError = {
      code: "MISSING_PROMPT",
      message: "A prompt is required",
      details:
        "Usage: paseo agent send [options] <id> [prompt] | --prompt <text> | --prompt-file <path>",
    };
    throw error;
  }

  try {
    return await readFile(resolve(promptFilePath), "utf8");
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "PROMPT_FILE_READ_ERROR",
      message: `Failed to read prompt file: ${promptFilePath}`,
      details: message,
    };
    throw error;
  }
}

type SendWaitState = Awaited<
  ReturnType<Awaited<ReturnType<typeof connectToDaemon>>["waitForFinish"]>
>;

function buildSendResult(agentIdArg: string, state: SendWaitState): AgentSendResult {
  const agentId = state.final?.id ?? agentIdArg;
  if (state.status === "timeout") {
    return { agentId, status: "timeout", message: "Timed out waiting for agent to finish" };
  }
  if (state.status === "permission") {
    return { agentId, status: "permission", message: "Agent is waiting for permission" };
  }
  if (state.status === "error") {
    return {
      agentId,
      status: "error",
      message: state.error ?? "Agent finished with error",
    };
  }
  return { agentId, status: "completed", message: "Agent completed processing the message" };
}

const SEND_IF_IDLE_ERROR_CODES = new Set([
  "agent_busy",
  "agent_request_key_conflict",
  "agent_request_outcome_unknown",
]);

/** Preserve the SDK's stable rejection code so `--json` reports the native reason. */
function toSendIfIdleCommandError(error: unknown): CommandError {
  const message = error instanceof Error ? error.message : String(error);
  const errorCode =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code.trim()
      : undefined;
  const code = errorCode || message.trim();

  // Capability absence is a host dependency, not a send failure.
  if (code === "unsupported_operation") {
    return {
      code: "DAEMON_UPDATE_REQUIRED",
      message: "Update the host to send messages only when the agent is idle.",
    };
  }
  if (SEND_IF_IDLE_ERROR_CODES.has(code)) return { code, message };
  return { code: "SEND_FAILED", message: `Failed to send message: ${message}` };
}

function resolveIfIdleRequest(
  options: AgentSendOptions,
  messageId: string | undefined,
): { messageId: string } | null {
  if (!options.ifIdle) return null;
  if (!messageId) {
    throw {
      code: "MISSING_MESSAGE_ID",
      message: "--if-idle requires a nonempty --message-id",
      details: "Retries must reuse the same --message-id so the host can deduplicate them.",
    } satisfies CommandError;
  }
  if (options.behavior !== undefined) {
    throw {
      code: "CONFLICTING_OPTIONS",
      message: "--if-idle cannot be combined with --behavior",
      details: "Idle-only sends never steer or interrupt an active turn.",
    } satisfies CommandError;
  }
  return { messageId };
}

interface SendAcceptance {
  agentId: string;
  queued?: boolean;
}

async function sendIfIdle(
  client: Awaited<ReturnType<typeof connectToDaemon>>,
  agentId: string,
  prompt: string,
  request: {
    messageId: string;
    images?: Array<{ data: string; mimeType: string }>;
    sourceAgentId?: string;
  },
): Promise<SendAcceptance> {
  try {
    const accepted = await client.sendAgentMessageIfIdle(agentId, prompt, {
      messageId: request.messageId,
      ...(request.images ? { images: request.images } : {}),
      ...(request.sourceAgentId ? { sourceAgentId: request.sourceAgentId } : {}),
    });
    return { agentId: accepted.agentId };
  } catch (err) {
    throw toSendIfIdleCommandError(err);
  }
}

async function finishSend(
  client: Awaited<ReturnType<typeof connectToDaemon>>,
  acceptance: SendAcceptance,
  wait: boolean | undefined,
): Promise<SingleResult<AgentSendResult>> {
  try {
    if (wait === false) {
      return {
        type: "single",
        data: {
          agentId: acceptance.agentId,
          status: acceptance.queued ? "queued" : "sent",
          message: acceptance.queued
            ? "Message queued for delivery after two quiet seconds"
            : "Message sent, not waiting for completion",
        },
        schema: agentSendSchema,
      };
    }

    const state = await client.waitForFinish(acceptance.agentId, 600000); // 10 minute timeout
    return {
      type: "single",
      data: buildSendResult(acceptance.agentId, state),
      schema: agentSendSchema,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runSendCommand(
  agentIdArg: string,
  prompt: string | undefined,
  options: AgentSendOptions,
  _command: Command,
): Promise<SingleResult<AgentSendResult>> {
  // Validate arguments
  if (!agentIdArg || agentIdArg.trim().length === 0) {
    const error: CommandError = {
      code: "MISSING_AGENT_ID",
      message: "Agent ID is required",
      details: "Usage: paseo agent send [options] <id> [prompt]",
    };
    throw error;
  }

  const messageId = options.messageId?.trim() || undefined;
  const ifIdleRequest = resolveIfIdleRequest(options, messageId);

  const promptInput = await resolvePromptInput({
    promptArgument: prompt,
    promptOption: options.prompt,
    promptFile: options.promptFile,
  });

  const client = await connectToDaemon({ target: options.daemonTarget });

  try {
    // Read image files if provided
    const images =
      options.image && options.image.length > 0 ? await readImageFiles(options.image) : undefined;

    const sourceAgentId = process.env.PASEO_AGENT_ID?.trim() || undefined;

    let acceptance: SendAcceptance;
    if (ifIdleRequest) {
      acceptance = await sendIfIdle(client, agentIdArg, promptInput, {
        messageId: ifIdleRequest.messageId,
        images,
        sourceAgentId,
      });
    } else {
      const receipt = await client.sendAgentMessage(agentIdArg, promptInput, {
        images,
        sourceAgentId,
        activeTurnBehavior: options.behavior ?? (sourceAgentId ? "steer" : "interrupt"),
        messageId,
      });
      acceptance = { agentId: agentIdArg, queued: receipt.deliveryStatus === "queued" };
    }

    return await finishSend(client, acceptance, options.wait);
  } catch (err) {
    await client.close().catch(() => {});

    // Re-throw CommandError as-is
    if (err && typeof err === "object" && "code" in err) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "SEND_FAILED",
      message: `Failed to send message: ${message}`,
    };
    throw error;
  }
}
