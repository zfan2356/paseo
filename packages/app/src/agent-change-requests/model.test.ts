import { describe, expect, it, vi } from "vitest";
import type { AgentChangeRequestsSnapshot } from "@getpaseo/client";
import { openChangeRequests } from "./model";

const snapshot: AgentChangeRequestsSnapshot = { agentId: "a", autoLink: true, items: [] };
function setup() {
  let receive: (snapshot: AgentChangeRequestsSnapshot) => void = () => {};
  const stop = vi.fn();
  const update = vi.fn(async () => snapshot);
  const read = {
    list: async () => snapshot,
    subscribe: (listener: typeof receive) => {
      receive = listener;
      return stop;
    },
  };
  const model = openChangeRequests({ read, update });
  model.start();
  return { model, update, stop, receive: (value = snapshot) => receive(value) };
}

describe("session change request form", () => {
  it("gates mutations on the initial snapshot and dispatches add/remove/opt-out", async () => {
    const h = setup();
    h.model.setUrl(" https://github.com/a/b/pull/1 ");
    await h.model.add();
    expect(h.update).not.toHaveBeenCalled();
    h.receive();
    await h.model.add();
    expect(h.update).toHaveBeenLastCalledWith({ addUrl: "https://github.com/a/b/pull/1" });
    expect(h.model.getState()).toMatchObject({ url: "", inputRevision: 1, busy: false });
    await h.model.remove("key");
    expect(h.update).toHaveBeenLastCalledWith({ removeKey: "key" });
    await h.model.setAutoLink(false);
    expect(h.update).toHaveBeenLastCalledWith({ autoLink: false });
    h.model.close();
    expect(h.stop).toHaveBeenCalledOnce();
  });
  it("keeps a failed URL for correction and never replaces a newer push with the mutation response", async () => {
    const h = setup();
    h.receive();
    h.model.setUrl("invalid");
    h.update.mockRejectedValueOnce(new Error("Unsupported URL"));
    await h.model.add();
    expect(h.model.getState()).toMatchObject({
      error: "Unsupported URL",
      url: "invalid",
      busy: false,
    });
    h.receive({ ...snapshot, autoLink: false });
    await h.model.remove("key");
    expect(h.model.getState().snapshot?.autoLink).toBe(false);
    h.model.close();
    const closed = h.model.getState();
    h.receive();
    expect(h.model.getState()).toBe(closed);
  });
});
