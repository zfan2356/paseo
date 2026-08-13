import { describe, expect, it, vi } from "vitest";
import {
  MAX_TERMINAL_IMAGE_BYTES,
  createTerminalPastedImage,
  terminalPastedImageFromDataUrl,
  uploadTerminalPastedImages,
} from "./terminal-image-paste";

describe("terminal image paste", () => {
  it("decodes a clipboard data URL into an uploadable PNG", () => {
    expect(terminalPastedImageFromDataUrl("data:image/png;base64,AAEC")).toEqual({
      fileName: "pasted-image.png",
      mimeType: "image/png",
      bytes: new Uint8Array([0, 1, 2]),
    });
  });

  it("rejects non-images and images over the upload limit", () => {
    expect(() =>
      createTerminalPastedImage({ mimeType: "text/plain", bytes: new Uint8Array([1]) }),
    ).toThrow("Unsupported clipboard image type");
    expect(() =>
      createTerminalPastedImage({
        mimeType: "image/png",
        bytes: new Uint8Array(MAX_TERMINAL_IMAGE_BYTES + 1),
      }),
    ).toThrow("50MB");
  });

  it("uploads every image before pasting host paths in order", async () => {
    const pastePath = vi.fn();
    const uploadFile = vi
      .fn()
      .mockResolvedValueOnce({ file: { path: "/host/first.png" }, error: null })
      .mockResolvedValueOnce({ file: { path: "/host/second.jpg" }, error: null });

    await expect(
      uploadTerminalPastedImages({
        images: [
          createTerminalPastedImage({ mimeType: "image/png", bytes: new Uint8Array([1]) }),
          createTerminalPastedImage({ mimeType: "image/jpeg", bytes: new Uint8Array([2]) }),
        ],
        uploadFile,
        pastePath,
      }),
    ).resolves.toEqual(["/host/first.png", "/host/second.jpg"]);

    expect(pastePath.mock.calls).toEqual([["/host/first.png"], ["/host/second.jpg"]]);
  });

  it("does not paste a partial upload when a later upload fails", async () => {
    const pastePath = vi.fn();
    const uploadFile = vi
      .fn()
      .mockResolvedValueOnce({ file: { path: "/host/first.png" }, error: null })
      .mockResolvedValueOnce({ file: null, error: "Upload failed" });

    await expect(
      uploadTerminalPastedImages({
        images: [
          createTerminalPastedImage({ mimeType: "image/png", bytes: new Uint8Array([1]) }),
          createTerminalPastedImage({ mimeType: "image/png", bytes: new Uint8Array([2]) }),
        ],
        uploadFile,
        pastePath,
      }),
    ).rejects.toThrow("Upload failed");
    expect(pastePath).not.toHaveBeenCalled();
  });
});
