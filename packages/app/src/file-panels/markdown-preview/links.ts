import { isAbsolutePath } from "@/utils/path";

export interface MarkdownPreviewFileTarget {
  kind: "file";
  path: string;
  lineStart?: number;
  lineEnd?: number;
  anchor?: string;
}

export type MarkdownPreviewLinkTarget =
  | { kind: "external"; url: string }
  | MarkdownPreviewFileTarget
  | { kind: "ignored" };

const LINE_FRAGMENT = /^L([0-9]+)(?:C[0-9]+)?(?:-L?([0-9]+)(?:C[0-9]+)?)?$/i;

export interface MarkdownAstTextNode {
  content?: string;
  children?: MarkdownAstTextNode[];
}

export function markdownAstPlainText(node: MarkdownAstTextNode): string {
  if (node.children && node.children.length > 0) {
    return node.children.map((child) => markdownAstPlainText(child)).join("");
  }
  return node.content ?? "";
}

/** GitHub-style heading id, without the duplicate suffix. */
export function markdownHeadingSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ +/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export class MarkdownHeadingSlugger {
  private readonly counts = new Map<string, number>();

  reset(): void {
    this.counts.clear();
  }

  slug(text: string): string | undefined {
    const base = markdownHeadingSlug(text);
    if (!base) {
      return undefined;
    }
    const seen = this.counts.get(base) ?? 0;
    this.counts.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen}`;
  }
}

export function resolveMarkdownPreviewLink(
  href: string,
  documentPath: string,
): MarkdownPreviewLinkTarget {
  const trimmed = href.trim();
  if (!trimmed) {
    return { kind: "ignored" };
  }

  if (isHttpUrl(trimmed)) {
    return { kind: "external", url: trimmed };
  }

  const fileUrl = parseFileUrl(trimmed);
  if (fileUrl) {
    return fileTarget(fileUrl.path, documentPath, fileUrl.fragment);
  }

  if (hasUnsupportedScheme(trimmed)) {
    return { kind: "ignored" };
  }

  const hashIndex = trimmed.indexOf("#");
  const beforeHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  const fragment = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : "";
  const pathPart = stripQuery(safeDecode(beforeHash)).trim();
  return fileTarget(pathPart, documentPath, safeDecode(fragment));
}

export function sameMarkdownDocument(left: string, right: string): boolean {
  return normalizePathKey(left) === normalizePathKey(right);
}

function fileTarget(
  pathPart: string,
  documentPath: string,
  fragment: string,
): MarkdownPreviewLinkTarget {
  const lines = parseLineFragment(fragment);
  const anchor = lines || !fragment.trim() ? undefined : markdownHeadingSlug(fragment);
  const resolved = pathPart
    ? resolveDocumentPath(pathPart, documentPath)
    : normalizeDocumentPath(documentPath);
  if (!resolved || (!pathPart && !lines && !anchor)) {
    return { kind: "ignored" };
  }

  return {
    kind: "file",
    path: resolved,
    ...(lines?.lineStart ? { lineStart: lines.lineStart } : {}),
    ...(lines?.lineEnd ? { lineEnd: lines.lineEnd } : {}),
    ...(anchor ? { anchor } : {}),
  };
}

function resolveDocumentPath(pathValue: string, documentPath: string): string | null {
  const normalized = stripQuery(pathValue).replace(/\\/g, "/").trim();
  if (!normalized || normalized.includes("\0") || isHomeRelative(normalized)) {
    return null;
  }

  if (isAbsolutePath(normalized)) {
    return normalizeAbsolutePath(normalized);
  }

  const directory = directoryName(documentPath.replace(/\\/g, "/").trim());
  const joined = directory === "/" ? `/${normalized}` : `${directory}/${normalized}`;
  return normalizeAbsolutePath(joined);
}

function normalizeDocumentPath(documentPath: string): string | null {
  const normalized = documentPath.replace(/\\/g, "/").trim();
  if (!normalized) {
    return null;
  }
  return isAbsolutePath(normalized) ? normalizeAbsolutePath(normalized) : normalized;
}

function directoryName(pathValue: string): string {
  const index = pathValue.lastIndexOf("/");
  if (index < 0) {
    return ".";
  }
  if (index === 0) {
    return "/";
  }
  return pathValue.slice(0, index);
}

function normalizeAbsolutePath(value: string): string | null {
  const drive = /^([A-Za-z]:)\/(.*)$/.exec(value);
  if (drive) {
    const body = normalizeSegments(drive[2] ?? "", false);
    if (body == null) {
      return null;
    }
    return body ? `${drive[1]}/${body}` : `${drive[1]}/`;
  }

  const absolute = value.startsWith("/");
  const body = normalizeSegments(value.replace(/^\/+/, ""), !absolute);
  if (body == null) {
    return null;
  }
  if (!absolute) {
    return body || null;
  }
  return body ? `/${body}` : "/";
}

function normalizeSegments(value: string, rejectEscape: boolean): string | null {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        if (rejectEscape) {
          return null;
        }
        continue;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function parseLineFragment(fragment: string): { lineStart: number; lineEnd?: number } | null {
  const match = fragment.trim().match(LINE_FRAGMENT);
  if (!match) {
    return null;
  }
  const lineStart = parseInt(match[1] ?? "", 10);
  const lineEnd = match[2] ? parseInt(match[2], 10) : undefined;
  if (!Number.isFinite(lineStart) || lineStart <= 0) {
    return null;
  }
  if (lineEnd !== undefined && (!Number.isFinite(lineEnd) || lineEnd < lineStart)) {
    return null;
  }
  return lineEnd ? { lineStart, lineEnd } : { lineStart };
}

function parseFileUrl(value: string): { path: string; fragment: string } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") {
    return null;
  }
  let path = safeDecode(url.pathname);
  if (/^\/[A-Za-z]:\//.test(path)) {
    path = path.slice(1);
  }
  if (!path) {
    return null;
  }
  return { path, fragment: safeDecode(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash) };
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function hasUnsupportedScheme(value: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return false;
  }
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function isHomeRelative(value: string): boolean {
  return value === "~" || value.startsWith("~/");
}

function stripQuery(value: string): string {
  const queryIndex = value.indexOf("?");
  return queryIndex >= 0 ? value.slice(0, queryIndex) : value;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePathKey(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized;
}
