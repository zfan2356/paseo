import type MarkdownIt from "markdown-it";
import { enableMarkdownMath } from "@/components/markdown/math-parser";
import { createMarkdownParser } from "@/utils/markdown-parser";
import { enableStreamingMarkdown } from "@/utils/streaming-markdown";

export function createAssistantMarkdownParser({ streaming = false } = {}): MarkdownIt {
  const parser = enableMarkdownMath(createMarkdownParser({ linkify: true }));
  const defaultValidateLink = parser.validateLink.bind(parser);

  // Assistant messages are the only surface allowed to link into the
  // filesystem. Every other parser keeps markdown-it's stricter default.
  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  if (streaming) {
    enableStreamingMarkdown(parser);
  }

  return parser;
}
