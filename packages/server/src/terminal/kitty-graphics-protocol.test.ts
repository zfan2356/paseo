import { describe, expect, it } from "vitest";
import { KittyGraphicsReplyTracker } from "./kitty-graphics-protocol";

const QUERY = "\x1b_Gi=469108283,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\";
const REPLY = "\x1b_Gi=469108283;OK\x1b\\";

describe("KittyGraphicsReplyTracker", () => {
  it("acks a Kitty graphics query on stdin", () => {
    const tracker = new KittyGraphicsReplyTracker();
    expect(tracker.feed(QUERY)).toEqual([REPLY]);
  });

  it("reassembles a query split across chunks", () => {
    const tracker = new KittyGraphicsReplyTracker();
    expect(tracker.feed(QUERY.slice(0, 8))).toEqual([]);
    expect(tracker.feed(QUERY.slice(8))).toEqual([REPLY]);
  });

  it("does not ack quiet queries", () => {
    const tracker = new KittyGraphicsReplyTracker();
    expect(tracker.feed("\x1b_Gi=1,a=q,q=1;AAAA\x1b\\")).toEqual([]);
    expect(tracker.feed("\x1b_Gi=1,a=q,q=2;AAAA\x1b\\")).toEqual([]);
  });

  it("does not ack an already-complete response", () => {
    const tracker = new KittyGraphicsReplyTracker();
    expect(tracker.feed(REPLY)).toEqual([]);
  });

  it("acks multiple queries in one chunk", () => {
    const tracker = new KittyGraphicsReplyTracker();
    expect(tracker.feed(`${QUERY}\x1b_Gi=7,a=q;AAAA\x1b\\`)).toEqual([REPLY, "\x1b_Gi=7;OK\x1b\\"]);
  });
});
