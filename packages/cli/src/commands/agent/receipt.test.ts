import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDaemon } from "../../utils/client.js";
import { runReceiptCommand } from "./receipt.js";

vi.mock("../../utils/client.js", () => ({ connectToDaemon: vi.fn() }));

const daemonTarget = { kind: "endpoint" as const, host: "example.test:12345" };

function installClient(overrides: Record<string, unknown> = {}) {
  const client = {
    getAgentMessageReceipt: vi.fn(async () => ({
      agentId: "canonical-agent",
      messageId: "stable-id",
      status: "accepted",
    })),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
  vi.mocked(connectToDaemon).mockResolvedValue(client as never);
  return client;
}

const receipt = (agentId = "requested-agent", messageId = "stable-id") =>
  runReceiptCommand(agentId, messageId, { daemonTarget }, {} as never);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runReceiptCommand", () => {
  it("requires both identities before connecting", async () => {
    await expect(receipt("", "stable-id")).rejects.toMatchObject({ code: "MISSING_AGENT_ID" });
    await expect(receipt("requested-agent", "   ")).rejects.toMatchObject({
      code: "MISSING_MESSAGE_ID",
    });
    expect(connectToDaemon).not.toHaveBeenCalled();
  });

  it("returns the canonical lookup result without delivering anything", async () => {
    const client = installClient();

    const result = await receipt();

    expect(client.getAgentMessageReceipt).toHaveBeenCalledWith("requested-agent", "stable-id");
    expect(result.data).toEqual({
      agentId: "canonical-agent",
      messageId: "stable-id",
      status: "accepted",
    });
    expect(client.close).toHaveBeenCalled();
  });

  it("maps a host without receipt lookup to an update requirement", async () => {
    installClient({
      getAgentMessageReceipt: vi.fn(async () => {
        throw Object.assign(new Error("unsupported_operation"), {
          code: "unsupported_operation",
        });
      }),
    });

    await expect(receipt()).rejects.toMatchObject({
      code: "DAEMON_UPDATE_REQUIRED",
      message: expect.stringContaining("Update the host"),
    });
  });

  it("reports other lookup failures without inventing a receipt status", async () => {
    installClient({
      getAgentMessageReceipt: vi.fn(async () => {
        throw new Error("connection lost");
      }),
    });

    await expect(receipt()).rejects.toMatchObject({
      code: "RECEIPT_LOOKUP_FAILED",
      message: expect.stringContaining("connection lost"),
    });
  });
});
