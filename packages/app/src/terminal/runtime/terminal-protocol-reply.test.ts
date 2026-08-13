import { describe, expect, it } from "vitest";
import { isEmulatorGeneratedProtocolReply } from "./terminal-protocol-reply";

describe("isEmulatorGeneratedProtocolReply", () => {
  it("drops Kitty graphics protocol replies", () => {
    expect(isEmulatorGeneratedProtocolReply("\x1b_Gi=469108283;OK\x1b\\")).toBe(true);
  });

  it("keeps ordinary typed input", () => {
    expect(isEmulatorGeneratedProtocolReply("hello")).toBe(false);
    expect(isEmulatorGeneratedProtocolReply("\x1b[A")).toBe(false);
  });
});
