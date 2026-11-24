import { describe, expect, it } from "vitest";
import { ListTerminalsResponseSchema, ServerInfoStatusPayloadSchema } from "./messages";

describe("terminal image paste wire compatibility", () => {
  it("keeps the server feature optional", () => {
    const base = {
      status: "server_info" as const,
      serverId: "server-1",
      features: {},
    };

    expect(
      ServerInfoStatusPayloadSchema.parse(base).features.codexTerminalImagePaste,
    ).toBeUndefined();
    expect(
      ServerInfoStatusPayloadSchema.parse({
        ...base,
        features: { codexTerminalImagePaste: true },
      }).features.codexTerminalImagePaste,
    ).toBe(true);
  });

  it("keeps per-terminal image paste capability optional", () => {
    const base = {
      type: "list_terminals_response" as const,
      payload: {
        cwd: "/work/repo",
        requestId: "request-1",
        terminals: [{ id: "term-1", name: "Codex Conversation", workspaceId: "ws-1" }],
      },
    };

    expect(
      ListTerminalsResponseSchema.parse(base).payload.terminals[0]?.capabilities,
    ).toBeUndefined();
    expect(
      ListTerminalsResponseSchema.parse({
        ...base,
        payload: {
          ...base.payload,
          terminals: [
            {
              ...base.payload.terminals[0],
              capabilities: { imagePaste: true },
            },
          ],
        },
      }).payload.terminals[0]?.capabilities,
    ).toEqual({ imagePaste: true });
  });
});
