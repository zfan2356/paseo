import { describe, expect, it } from "vitest";
import {
  GetAgentMessageReceiptRequestSchema,
  GetAgentMessageReceiptResponseMessageSchema,
  SendAgentMessageIfIdleRequestSchema,
  SendAgentMessageIfIdleResponseMessageSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("agent.message.send_if_idle", () => {
  it("requires a nonempty messageId and carries no active-turn behavior", () => {
    expect(() =>
      SendAgentMessageIfIdleRequestSchema.parse({
        type: "agent.message.send_if_idle.request",
        requestId: "request-1",
        agentId: "agent-1",
        text: "notification",
        messageId: "",
      }),
    ).toThrow();

    const parsed = SendAgentMessageIfIdleRequestSchema.parse({
      type: "agent.message.send_if_idle.request",
      requestId: "request-2",
      agentId: "agent-1",
      text: "notification",
      messageId: "message-1",
      sourceAgentId: "sender",
      sourceAgentServerId: "host",
      activeTurnBehavior: "steer",
    });
    expect(parsed.messageId).toBe("message-1");
    expect("activeTurnBehavior" in parsed).toBe(false);
  });

  it("round-trips through the session unions and reports a busy rejection", () => {
    const request = {
      type: "agent.message.send_if_idle.request" as const,
      requestId: "request-1",
      agentId: "agent-1",
      text: "notification",
      messageId: "message-1",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    const response = {
      type: "agent.message.send_if_idle.response" as const,
      payload: {
        requestId: "request-1",
        agentId: "agent-1",
        accepted: false,
        error: "agent_busy",
      },
    };
    expect(SendAgentMessageIfIdleResponseMessageSchema.parse(response)).toEqual(response);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  it("advertises the optional capability on server_info", () => {
    const info = {
      status: "server_info" as const,
      serverId: "server",
      features: { agentMessageIfIdle: true },
    };
    expect(ServerInfoStatusPayloadSchema.parse(info).features?.agentMessageIfIdle).toBe(true);
  });
});

describe("agent.message.get_receipt", () => {
  it("requires both the agent and message identities", () => {
    expect(() =>
      GetAgentMessageReceiptRequestSchema.parse({
        type: "agent.message.get_receipt.request",
        requestId: "request-1",
        agentId: "agent-1",
        messageId: "",
      }),
    ).toThrow();
    expect(() =>
      GetAgentMessageReceiptRequestSchema.parse({
        type: "agent.message.get_receipt.request",
        requestId: "request-1",
        agentId: "",
        messageId: "message-1",
      }),
    ).toThrow();
  });

  it("round-trips status results and error results through the session unions", () => {
    const request = {
      type: "agent.message.get_receipt.request" as const,
      requestId: "request-1",
      agentId: "agent-1",
      messageId: "message-1",
    };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    for (const status of ["accepted", "pending", "absent"] as const) {
      const response = {
        type: "agent.message.get_receipt.response" as const,
        payload: {
          requestId: "request-1",
          agentId: "agent-1",
          messageId: "message-1",
          status,
          error: null,
        },
      };
      expect(GetAgentMessageReceiptResponseMessageSchema.parse(response)).toEqual(response);
      expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
    }

    const failure = {
      type: "agent.message.get_receipt.response" as const,
      payload: {
        requestId: "request-1",
        agentId: "agent-1",
        messageId: "message-1",
        status: null,
        error: "Agent not found: agent-1",
      },
    };
    expect(GetAgentMessageReceiptResponseMessageSchema.parse(failure)).toEqual(failure);
  });

  it("advertises the readonly lookup capability on server_info", () => {
    const info = {
      status: "server_info" as const,
      serverId: "server",
      features: { agentMessageReceiptLookup: true },
    };
    expect(ServerInfoStatusPayloadSchema.parse(info).features?.agentMessageReceiptLookup).toBe(
      true,
    );
  });
});
