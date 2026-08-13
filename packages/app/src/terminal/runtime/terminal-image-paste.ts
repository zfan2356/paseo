import { isRasterImageMimeType } from "@/attachments/file-types";
import { parseDataUrl } from "@/attachments/utils";

export const MAX_TERMINAL_IMAGE_BYTES = 50 * 1024 * 1024;

export interface TerminalPastedImage {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface TerminalImageUploadResult {
  file: { path: string } | null;
  error: string | null;
}

const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/tiff": "tiff",
};

function decodeBase64(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getPastedImageFileName(mimeType: string): string {
  const extension = IMAGE_EXTENSION_BY_MIME_TYPE[mimeType] ?? "png";
  return `pasted-image.${extension}`;
}

export function createTerminalPastedImage(input: {
  mimeType: string;
  bytes: Uint8Array;
}): TerminalPastedImage {
  const mimeType = input.mimeType.trim().toLowerCase();
  if (!isRasterImageMimeType(mimeType)) {
    throw new Error(`Unsupported clipboard image type: ${input.mimeType}`);
  }
  if (input.bytes.byteLength === 0) {
    throw new Error("The clipboard image is empty.");
  }
  if (input.bytes.byteLength > MAX_TERMINAL_IMAGE_BYTES) {
    throw new Error("The clipboard image exceeds the 50MB upload limit.");
  }
  return {
    fileName: getPastedImageFileName(mimeType),
    mimeType,
    bytes: input.bytes,
  };
}

export function terminalPastedImageFromDataUrl(dataUrl: string): TerminalPastedImage {
  const parsed = parseDataUrl(dataUrl);
  return createTerminalPastedImage({
    mimeType: parsed.mimeType,
    bytes: decodeBase64(parsed.base64),
  });
}

export async function uploadTerminalPastedImages(input: {
  images: readonly TerminalPastedImage[];
  uploadFile: (image: TerminalPastedImage) => Promise<TerminalImageUploadResult>;
  pastePath: (path: string) => void;
}): Promise<string[]> {
  const paths: string[] = [];
  for (const image of input.images) {
    const validated = createTerminalPastedImage(image);
    const result = await input.uploadFile(validated);
    const path = result.file?.path.trim();
    if (result.error || !path) {
      throw new Error(result.error ?? "The image upload did not return a host path.");
    }
    paths.push(path);
  }

  for (const path of paths) {
    input.pastePath(path);
  }
  return paths;
}
