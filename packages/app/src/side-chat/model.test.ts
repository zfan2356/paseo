import type { AgentCapabilityFlags } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";

import { canOfferSideChat, resolveSideChatHeaderChrome } from "./chrome";

const BASE_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
};

const forkable = { capabilities: { ...BASE_CAPABILITIES, sideChatFork: true } };
const noFork = { capabilities: { ...BASE_CAPABILITIES, sideChatFork: false } };

describe("side chat chrome", () => {
  it("offers side chat for a live Claude agent when the host supports it", () => {
    expect(
      canOfferSideChat(
        { provider: "claude", archivedAt: null, ...forkable },
        { featureEnabled: true },
      ),
    ).toBe(true);
  });

  it("offers side chat for a live Codex agent when the host supports it", () => {
    expect(
      canOfferSideChat(
        { provider: "codex", archivedAt: null, ...forkable },
        { featureEnabled: true },
      ),
    ).toBe(true);
  });

  it("offers side chat for an ACP agent whose session advertises a native fork", () => {
    expect(
      canOfferSideChat(
        { provider: "cursor", archivedAt: null, ...forkable },
        { featureEnabled: true },
      ),
    ).toBe(true);
  });

  it("does not offer side chat without the host feature", () => {
    expect(
      canOfferSideChat(
        { provider: "claude", archivedAt: null, ...forkable },
        { featureEnabled: false },
      ),
    ).toBe(false);
  });

  it("does not offer side chat for providers without a fork capability or archived agents", () => {
    expect(
      canOfferSideChat(
        { provider: "cursor", archivedAt: null, ...noFork },
        { featureEnabled: true },
      ),
    ).toBe(false);
    expect(canOfferSideChat({ provider: "cursor" }, { featureEnabled: true })).toBe(false);
    expect(
      canOfferSideChat(
        { provider: "claude", archivedAt: "2026-08-20", ...forkable },
        { featureEnabled: true },
      ),
    ).toBe(false);
    expect(canOfferSideChat(null, { featureEnabled: true })).toBe(false);
  });

  it("disables the header entry while disconnected", () => {
    expect(resolveSideChatHeaderChrome({ canOffer: true, isConnected: false })).toEqual({
      show: true,
      disabled: true,
    });
    expect(resolveSideChatHeaderChrome({ canOffer: true, isConnected: true })).toEqual({
      show: true,
      disabled: false,
    });
  });
});
