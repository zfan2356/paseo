import { describe, expect, it } from "vitest";

import { canOfferSideChat, resolveSideChatHeaderChrome } from "./chrome";

describe("side chat chrome", () => {
  const claudeAgent = { provider: "claude", archivedAt: null };

  it("offers side chat for a live Claude agent when the host supports it", () => {
    expect(canOfferSideChat(claudeAgent, { featureEnabled: true })).toBe(true);
  });

  it("offers side chat for a live Codex agent when the host supports it", () => {
    expect(
      canOfferSideChat({ provider: "codex", archivedAt: null }, { featureEnabled: true }),
    ).toBe(true);
  });

  it("does not offer side chat without the host feature", () => {
    expect(canOfferSideChat(claudeAgent, { featureEnabled: false })).toBe(false);
  });

  it("does not offer side chat for other providers or archived agents", () => {
    expect(canOfferSideChat({ provider: "cursor" }, { featureEnabled: true })).toBe(false);
    expect(
      canOfferSideChat({ provider: "claude", archivedAt: "2026-08-20" }, { featureEnabled: true }),
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
