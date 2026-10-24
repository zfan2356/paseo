import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderError, toCommandError } from "../../output/index.js";
import { connectToDaemon } from "../../utils/client.js";
import { runSendCommand } from "./send.js";

vi.mock("../../utils/client.js", () => ({ connectToDaemon: vi.fn() }));

const daemonTarget = { kind: "endpoint" as const, host: "example.test:12345" };

function installClient(overrides: Record<string, unknown> = {}) {
  const client = {
    sendAgentMessageIfIdle: vi.fn(async () => ({ agentId: "canonical-agent" })),
    sendAgentMessage: vi.fn(async () => ({})),
    waitForFinish: vi.fn(async () => ({
      status: "idle",
      final: { id: "canonical-agent" },
      error: null,
    })),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
  vi.mocked(connectToDaemon).mockResolvedValue(client as never);
  return client;
}

const send = (options: Record<string, unknown>, prompt = "hello", id = "requested-agent") =>
  runSendCommand(id, prompt, { daemonTarget, ...options }, {} as never);

let scratch: string | undefined;
const originalAgentId = process.env.PASEO_AGENT_ID;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PASEO_AGENT_ID;
});

afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
  scratch = undefined;
});

afterAll(() => {
  if (originalAgentId === undefined) delete process.env.PASEO_AGENT_ID;
  else process.env.PASEO_AGENT_ID = originalAgentId;
});

describe("runSendCommand idle-only delivery", () => {
  it("requires a nonempty --message-id before connecting", async () => {
    await expect(send({ ifIdle: true, wait: false })).rejects.toMatchObject({
      code: "MISSING_MESSAGE_ID",
    });
    await expect(send({ ifIdle: true, messageId: "   ", wait: false })).rejects.toMatchObject({
      code: "MISSING_MESSAGE_ID",
    });
    expect(connectToDaemon).not.toHaveBeenCalled();
  });

  it("rejects an explicit behavior override before connecting", async () => {
    await expect(
      send({ ifIdle: true, messageId: "stable-id", behavior: "steer", wait: false }),
    ).rejects.toMatchObject({
      code: "CONFLICTING_OPTIONS",
      message: expect.stringContaining("--behavior"),
    });
    expect(connectToDaemon).not.toHaveBeenCalled();
  });

  it("uses the dedicated SDK call, returns the canonical ID, and reads --prompt-file", async () => {
    scratch = await mkdtemp(join(tmpdir(), "paseo-send-if-idle-"));
    const promptFile = join(scratch, "prompt.txt");
    await writeFile(promptFile, "line one\nline two\n");
    const client = installClient();

    const result = await runSendCommand(
      "requested-agent",
      undefined,
      { daemonTarget, ifIdle: true, messageId: " stable-id ", promptFile, wait: false },
      {} as never,
    );

    expect(client.sendAgentMessageIfIdle).toHaveBeenCalledWith(
      "requested-agent",
      "line one\nline two\n",
      {
        messageId: "stable-id",
      },
    );
    expect(client.sendAgentMessage).not.toHaveBeenCalled();
    expect(result.data).toEqual({
      agentId: "canonical-agent",
      status: "sent",
      message: "Message sent, not waiting for completion",
    });
    expect(client.close).toHaveBeenCalled();
  });

  it("preserves agent-origin provenance on the idle-only call", async () => {
    process.env.PASEO_AGENT_ID = "caller-agent";
    const client = installClient();

    await send({ ifIdle: true, messageId: "stable-id", wait: false });

    expect(client.sendAgentMessageIfIdle).toHaveBeenCalledWith("requested-agent", "hello", {
      messageId: "stable-id",
      sourceAgentId: "caller-agent",
    });
  });

  it("waits on the canonical ID after acceptance", async () => {
    const client = installClient({
      sendAgentMessageIfIdle: vi.fn(async () => ({ agentId: "canonical-agent" })),
    });

    const result = await send({ ifIdle: true, messageId: "stable-id" });

    expect(client.waitForFinish).toHaveBeenCalledWith("canonical-agent", 600000);
    expect(result.data).toMatchObject({ agentId: "canonical-agent", status: "completed" });
  });

  it.each([
    [
      "agent_busy",
      Object.assign(new Error("agent_busy"), { code: "agent_busy" }),
      "agent_busy",
      "agent_busy",
    ],
    [
      "unsupported_operation",
      new Error("unsupported_operation"),
      "DAEMON_UPDATE_REQUIRED",
      "Update the host to send messages only when the agent is idle.",
    ],
    [
      "agent_request_key_conflict",
      new Error("agent_request_key_conflict"),
      "agent_request_key_conflict",
      "agent_request_key_conflict",
    ],
    [
      "agent_request_outcome_unknown",
      new Error("agent_request_outcome_unknown"),
      "agent_request_outcome_unknown",
      "agent_request_outcome_unknown",
    ],
  ])("surfaces %s as a structured rejection", async (_reason, rejection, code, message) => {
    const client = installClient({
      sendAgentMessageIfIdle: vi.fn(async () => {
        throw rejection;
      }),
    });

    const error = await send({ ifIdle: true, messageId: "stable-id", wait: false }).catch(
      (err: unknown) => err,
    );

    expect(error).toMatchObject({ code, message });
    expect(client.close).toHaveBeenCalled();
    expect(client.sendAgentMessage).not.toHaveBeenCalled();
    expect(client.waitForFinish).not.toHaveBeenCalled();
    expect(JSON.parse(renderError(toCommandError(error), { format: "json" }))).toEqual({
      error: { code, message },
    });
  });

  it("maps an unlisted code-like failure to SEND_FAILED", async () => {
    installClient({
      sendAgentMessageIfIdle: vi.fn(async () => {
        throw new Error("some_unexpected_failure");
      }),
    });

    await expect(send({ ifIdle: true, messageId: "stable-id", wait: false })).rejects.toMatchObject(
      {
        code: "SEND_FAILED",
        message: "Failed to send message: some_unexpected_failure",
      },
    );
  });

  it("does not turn an unknown failure into a success or a host rejection code", async () => {
    installClient({
      sendAgentMessageIfIdle: vi.fn(async () => {
        throw new Error("socket closed");
      }),
    });

    await expect(send({ ifIdle: true, messageId: "stable-id", wait: false })).rejects.toMatchObject(
      {
        code: "SEND_FAILED",
        message: "Failed to send message: socket closed",
      },
    );
  });
});

describe("runSendCommand normal send", () => {
  it("passes --message-id through and keeps the existing behavior", async () => {
    const client = installClient();

    const result = await send({ messageId: "stable-id", wait: false });

    expect(client.sendAgentMessage).toHaveBeenCalledWith(
      "requested-agent",
      "hello",
      expect.objectContaining({
        messageId: "stable-id",
        sourceAgentId: undefined,
        activeTurnBehavior: "interrupt",
      }),
    );
    expect(client.sendAgentMessageIfIdle).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ agentId: "requested-agent", status: "sent" });
  });

  it("keeps agent-origin sends steering by default", async () => {
    process.env.PASEO_AGENT_ID = "caller-agent";
    const client = installClient();

    await send({ wait: false });

    expect(client.sendAgentMessage).toHaveBeenCalledWith(
      "requested-agent",
      "hello",
      expect.objectContaining({ sourceAgentId: "caller-agent", activeTurnBehavior: "steer" }),
    );
  });

  it("keeps the native queued receipt in the no-wait result", async () => {
    installClient({
      sendAgentMessage: vi.fn(async () => ({ deliveryStatus: "queued" })),
    });

    const result = await send({ wait: false });

    expect(result.data).toEqual({
      agentId: "requested-agent",
      status: "queued",
      message: "Message queued for delivery after two quiet seconds",
    });
  });
});
