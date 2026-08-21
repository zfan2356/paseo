import { describe, expect, it } from "vitest";

import { canOfferSideChat, resolveSideChatHeaderChrome } from "./chrome";
import {
  beginSideChatExchange,
  failSideChatExchange,
  hasPendingSideChatExchange,
  resolveSideChatExchange,
  type SideChatExchange,
} from "./model";

function pendingExchange(id = "x1", question = "What does this error mean?"): SideChatExchange[] {
  return beginSideChatExchange([], { id, question });
}

describe("side chat exchanges", () => {
  it("begins an exchange in the pending state", () => {
    const exchanges = pendingExchange();
    expect(exchanges).toEqual([
      {
        id: "x1",
        question: "What does this error mean?",
        status: "pending",
        response: null,
        synthetic: false,
        error: null,
      },
    ]);
    expect(hasPendingSideChatExchange(exchanges)).toBe(true);
  });

  it("resolves a pending exchange with the answer", () => {
    const exchanges = resolveSideChatExchange(pendingExchange(), "x1", {
      response: "It means the file is missing.",
      synthetic: false,
    });
    expect(exchanges[0]).toMatchObject({
      status: "answered",
      response: "It means the file is missing.",
      synthetic: false,
    });
    expect(hasPendingSideChatExchange(exchanges)).toBe(false);
  });

  it("keeps the synthetic flag from a fallback answer", () => {
    const exchanges = resolveSideChatExchange(pendingExchange(), "x1", {
      response: "Fallback answer",
      synthetic: true,
    });
    expect(exchanges[0]).toMatchObject({ status: "answered", synthetic: true });
  });

  it("fails an exchange when the daemon reports an error", () => {
    const exchanges = resolveSideChatExchange(pendingExchange(), "x1", {
      response: null,
      error: "Provider does not support side questions",
    });
    expect(exchanges[0]).toMatchObject({
      status: "failed",
      error: "Provider does not support side questions",
      response: null,
    });
  });

  it("fails without an error message when no response was produced", () => {
    const exchanges = resolveSideChatExchange(pendingExchange(), "x1", { response: null });
    expect(exchanges[0]).toMatchObject({ status: "failed", error: null, response: null });
  });

  it("fails an exchange on transport errors", () => {
    const exchanges = failSideChatExchange(pendingExchange(), "x1", "Request timed out");
    expect(exchanges[0]).toMatchObject({ status: "failed", error: "Request timed out" });
  });

  it("ignores resolutions for unknown or already-settled exchanges", () => {
    const answered = resolveSideChatExchange(pendingExchange(), "x1", { response: "Answer" });
    const late = resolveSideChatExchange(answered, "x1", { response: null, error: "late error" });
    expect(late[0]).toMatchObject({ status: "answered", response: "Answer" });
    expect(resolveSideChatExchange(answered, "missing", { response: "other" })).toEqual(answered);
  });
});

describe("side chat chrome", () => {
  const claudeAgent = { provider: "claude", archivedAt: null };

  it("offers side chat for a live Claude agent when the host supports it", () => {
    expect(canOfferSideChat(claudeAgent, { featureEnabled: true })).toBe(true);
  });

  it("does not offer side chat without the host feature", () => {
    expect(canOfferSideChat(claudeAgent, { featureEnabled: false })).toBe(false);
  });

  it("does not offer side chat for other providers or archived agents", () => {
    expect(canOfferSideChat({ provider: "codex" }, { featureEnabled: true })).toBe(false);
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
