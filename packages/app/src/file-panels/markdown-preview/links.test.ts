import { describe, expect, it } from "vitest";
import {
  MarkdownHeadingSlugger,
  markdownHeadingSlug,
  resolveMarkdownPreviewLink,
  sameMarkdownDocument,
} from "./links";

const DOCUMENT = "/repo/docs/guide.md";

describe("resolveMarkdownPreviewLink", () => {
  it("resolves relative links against the current document directory", () => {
    expect(resolveMarkdownPreviewLink("./next.md", DOCUMENT)).toEqual({
      kind: "file",
      path: "/repo/docs/next.md",
    });
    expect(resolveMarkdownPreviewLink("../readme.md", DOCUMENT)).toEqual({
      kind: "file",
      path: "/repo/readme.md",
    });
    expect(resolveMarkdownPreviewLink("chapter.md", DOCUMENT)).toEqual({
      kind: "file",
      path: "/repo/docs/chapter.md",
    });
    expect(resolveMarkdownPreviewLink("./nested/page.md", DOCUMENT)).toEqual({
      kind: "file",
      path: "/repo/docs/nested/page.md",
    });
  });

  it("keeps absolute paths and decodes them", () => {
    expect(resolveMarkdownPreviewLink("/repo/docs/other.md", DOCUMENT)).toEqual({
      kind: "file",
      path: "/repo/docs/other.md",
    });
    expect(resolveMarkdownPreviewLink("./next%20file.md", DOCUMENT)).toEqual({
      kind: "file",
      path: "/repo/docs/next file.md",
    });
  });

  it("opens http links externally and drops other schemes", () => {
    expect(resolveMarkdownPreviewLink("https://paseo.sh/docs", DOCUMENT)).toEqual({
      kind: "external",
      url: "https://paseo.sh/docs",
    });
    expect(resolveMarkdownPreviewLink("mailto:hi@example.com", DOCUMENT)).toEqual({
      kind: "ignored",
    });
    expect(resolveMarkdownPreviewLink("", DOCUMENT)).toEqual({ kind: "ignored" });
  });

  it("separates heading anchors from line fragments", () => {
    expect(resolveMarkdownPreviewLink("#章节锚点", DOCUMENT)).toEqual({
      kind: "file",
      path: DOCUMENT,
      anchor: "章节锚点",
    });
    expect(resolveMarkdownPreviewLink("./next.md#Install", DOCUMENT)).toEqual({
      kind: "file",
      path: "/repo/docs/next.md",
      anchor: "install",
    });
    expect(resolveMarkdownPreviewLink("#L12", DOCUMENT)).toEqual({
      kind: "file",
      path: DOCUMENT,
      lineStart: 12,
    });
    expect(resolveMarkdownPreviewLink("../readme.md#L4-L8", DOCUMENT)).toEqual({
      kind: "file",
      path: "/repo/readme.md",
      lineStart: 4,
      lineEnd: 8,
    });
  });

  it("resolves file urls against the document only for the fragment", () => {
    expect(resolveMarkdownPreviewLink("file:///repo/docs/next.md#overview", DOCUMENT)).toEqual({
      kind: "file",
      path: "/repo/docs/next.md",
      anchor: "overview",
    });
  });
});

describe("markdown heading slugs", () => {
  it("matches GitHub-style ids and suffixes duplicates", () => {
    expect(markdownHeadingSlug("Hello, World!")).toBe("hello-world");
    const slugger = new MarkdownHeadingSlugger();
    expect(slugger.slug("Intro")).toBe("intro");
    expect(slugger.slug("Intro")).toBe("intro-1");
    slugger.reset();
    expect(slugger.slug("Intro")).toBe("intro");
  });
});

describe("sameMarkdownDocument", () => {
  it("compares normalized paths", () => {
    expect(sameMarkdownDocument("/repo/docs/guide.md", "/repo/docs/guide.md")).toBe(true);
    expect(sameMarkdownDocument("C:\\repo\\guide.md", "c:/repo/guide.md")).toBe(true);
    expect(sameMarkdownDocument("/repo/a.md", "/repo/b.md")).toBe(false);
  });
});
